import ApiError from "../../utils/apiError.js";
import prisma from "../../config/db.config.js";
import { findReceptionistAssignment, logQueueAction, createEmergencyAppointment } from "./queue.repository.js";
import { QUEUE_ACTIONS } from "./queue.constants.js";
import { emitQueueUpdate, emitTokenCalled, emitAppointmentCompleted } from "../../sockets/queue.socket.js";
import { notifyUser } from "../notification/notification.service.js";
// Step 3: "your turn is approaching" ping for the patient a few tokens
// ahead — only wired into nextToken (not skip/recall) per the requested
// scope.
import { notifyApproaching } from "../doctor/doctor.service.js";

// Shared wrapper for every transaction that advances/mutates queue state.
// Two things this guards against:
//  - P2028 "Transaction not found": Prisma's interactive-transaction
//    timeout (default 5s) or the dev server briefly losing its DB
//    connection mid-transaction. maxWait/timeout below give real headroom;
//    if it still happens, this turns the raw Prisma error into a clean,
//    retryable 409 instead of a 500 with a Prisma stack trace reaching
//    the client.
//  - P2034: serialization conflict under concurrent access — same
//    handling, consistent with how booking already treats it.
const runQueueTransaction = async (fn) => {
  try {
    return await prisma.$transaction(fn, {
      isolationLevel: "Serializable",
      maxWait: 10000,
      timeout: 15000,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err.code === "P2028" || err.code === "P2034") {
      throw new ApiError(409, "This action timed out or conflicted with another update — please try again.");
    }
    throw err;
  }
};

const assertAccess = async (user, doctorId, clinicId) => {
  if (user.role === "CLINIC" || user.role === "SUPER_ADMIN" || user.role === "ADMIN") return;
  if (user.role === "RECEPTIONIST") {
    const assignment = await findReceptionistAssignment(user.id, doctorId, clinicId);
    if (!assignment) throw new ApiError(403, "You are not assigned to manage this doctor's queue");
    return;
  }
  throw new ApiError(403, "You do not have permission to control this queue");
};

const getQueueOrThrow = async (doctorId, clinicId, date, scheduleId) => {
  const queue = await prisma.queue.findUnique({
    where: { doctorId_clinicId_date_scheduleId: { doctorId, clinicId, date: new Date(date), scheduleId } }
  });
  if (!queue) throw new ApiError(404, "No queue found for this session on this date");
  return queue;
};

// Statuses that still occupy an active slot in the queue (haven't been
// finalized). Used consistently so "next patient" can never resolve to
// something already COMPLETED, ABSENT, or CANCELLED.
const ACTIVE_STATUSES = ["WAITING", "CHECKED_IN"];

// Step 2: the receptionist's live queue view — total patients, completed/
// skipped counts, and (highest priority) the CURRENT and NEXT patient's
// name + token, computed here so the frontend never has to derive queue
// state itself.
export const getQueueStatus = async (doctorId, clinicId, date, scheduleId) => {
  const queue = await prisma.queue.findUnique({
    where: { doctorId_clinicId_date_scheduleId: { doctorId, clinicId, date: new Date(date), scheduleId } },
    include: { appointments: { orderBy: { token: "asc" }, include: { patient: true } } }
  });

  if (!queue) {
    return {
      doctorId, clinicId, date, scheduleId,
      currentToken: 0, lastTokenIssued: 0, status: "OPEN",
      totalPatients: 0, completedCount: 0, skippedCount: 0, cancelledCount: 0,
      current: null, next: null,
      tokens: [],
      appointments: [],
    };
  }

  return buildQueueDashboard(queue);
};

const toPatientInfo = (appt) => {
  if (!appt) return null;
  return {
    appointmentId: appt.id,
    token: appt.token,
    patientId: appt.patientId,
    patientName: appt.patient?.name || null,
    status: appt.status,
    isEmergency: appt.isEmergency,
  };
};

// The web app (apps/web) has always read `queue.tokens` — a flattened
// list with the patient's name/age/gender inlined onto each token — never
// `queue.appointments` (see packages/shared/src/types.ts: QueueToken /
// DoctorQueue). That field never existed on this endpoint's response,
// which is the actual reason names, "Patients Waiting", and "Completed
// Today" showed as 0/blank on the receptionist dashboard — it had nothing
// to read from, not a stale frontend build.
const toQueueToken = (appt) => ({
  id: appt.id,
  token: appt.token,
  patientName: appt.patient?.name || null,
  patientAge: appt.patient?.age ?? null,
  patientGender: appt.patient?.gender ?? null,
  status: appt.status,
  bookedAt: appt.createdAt,
});

const buildQueueDashboard = (queue) => {
  const appointments = queue.appointments || [];
  const completedCount = appointments.filter((a) => a.status === "COMPLETED").length;
  const skippedCount = appointments.filter((a) => a.status === "ABSENT").length;
  const cancelledCount = appointments.filter((a) => a.status === "CANCELLED").length;

  // Cancelled appointments opted out entirely — they should never appear
  // in the receptionist's visible list, only be reflected in the
  // cancelledCount tally below.
  const visibleAppointments = appointments.filter((a) => a.status !== "CANCELLED");

  const current = queue.currentToken > 0
    ? visibleAppointments.find((a) => a.token === queue.currentToken) || null
    : null;

  // The next patient is the lowest-numbered token still WAITING/CHECKED_IN
  // above the current token — NOT necessarily currentToken + 1, since that
  // slot may already be CANCELLED/ABSENT.
  const next = visibleAppointments
    .filter((a) => a.token > queue.currentToken && ACTIVE_STATUSES.includes(a.status))
    .sort((a, b) => a.token - b.token)[0] || null;

  return {
    doctorId: queue.doctorId,
    clinicId: queue.clinicId,
    date: queue.date,
    scheduleId: queue.scheduleId,
    status: queue.status,
    currentToken: queue.currentToken,
    lastTokenIssued: queue.lastTokenIssued,
    totalPatients: visibleAppointments.length,
    completedCount,
    skippedCount,
    cancelledCount,
    current: toPatientInfo(current),
    next: toPatientInfo(next),
    tokens: visibleAppointments.map(toQueueToken), // what the web app actually reads
    appointments: visibleAppointments, // kept for API compatibility with any other consumer
  };
};

// Broadcasts + returns the full dashboard after any mutating queue action —
// Step 3: this is what makes the receptionist's socket feed carry the same
// current/next-patient-NAME information as the REST response, not just a
// bare token number.
const broadcastAndReturn = async (doctorId, clinicId, date, scheduleId) => {
  const dashboard = await getQueueStatus(doctorId, clinicId, date, scheduleId);
  emitQueueUpdate(doctorId, clinicId, dashboard);
  return dashboard;
};

export const nextToken = async (user, doctorId, clinicId, date, scheduleId) => {
  await assertAccess(user, doctorId, clinicId);

  const result = await runQueueTransaction(async (tx) => {
    const queue = await tx.queue.findUnique({
      where: { doctorId_clinicId_date_scheduleId: { doctorId, clinicId, date: new Date(date), scheduleId } },
    });
    if (!queue) throw new ApiError(404, "No queue found for this session on this date");
    if (queue.status !== "OPEN") throw new ApiError(400, `Queue is currently ${queue.status.toLowerCase()}`);

    let completedAppointment = null;
    if (queue.currentToken > 0) {
      const prevAppointment = await tx.appointment.findUnique({
        where: { queueId_token: { queueId: queue.id, token: queue.currentToken } },
      });
      // Only complete it if it's still active — protects against a stale
      // double-click re-completing (or clobbering the status of) an
      // appointment another action already finalized.
      if (prevAppointment && ACTIVE_STATUSES.includes(prevAppointment.status)) {
        completedAppointment = await tx.appointment.update({
          where: { id: prevAppointment.id },
          data: { status: "COMPLETED" },
        });
      }
    }

    // "No more patients" only applies if there was truly nothing to do at
    // all — nothing just completed, AND nothing left to advance to. Doing
    // this check BEFORE completing the current appointment (the old order)
    // meant that on the very last patient — where currentToken already
    // equals lastTokenIssued, since there's no "next" token beyond them —
    // the function threw immediately and never reached the completion
    // step above, so the last patient of every session stayed stuck
    // "in progress" forever.
    if (!completedAppointment && queue.currentToken >= queue.lastTokenIssued) {
      throw new ApiError(400, "No more patients waiting in this queue");
    }

    const oldCurrentToken = queue.currentToken;

    // Advance past any tokens that were CANCELLED (or, defensively,
    // already ABSENT) before ever being called — the receptionist should
    // never have "Next" stop on someone who already cancelled, let alone
    // have that cancelled patient get a "Your Turn" notification, which is
    // exactly what happened before: this used to jump straight to
    // currentToken + 1 and treat whatever was sitting there as the next
    // patient, active or not.
    let newToken = oldCurrentToken + 1;
    let nextAppointment = null;
    const autoSkippedTokens = [];
    while (newToken <= queue.lastTokenIssued) {
      const candidate = await tx.appointment.findUnique({
        where: { queueId_token: { queueId: queue.id, token: newToken } },
        include: { patient: true },
      });
      if (candidate && ACTIVE_STATUSES.includes(candidate.status)) {
        nextAppointment = candidate;
        break;
      }
      if (candidate) autoSkippedTokens.push(candidate.token);
      newToken++;
    }
    // newToken now either points at a real active appointment, or has run
    // past lastTokenIssued (queue finished, nothing left to call).

    // Conditional update: only succeeds if currentToken is still what we
    // just read. If another next/skip/recall committed in between, this
    // affects 0 rows and we fail with a clean 409 instead of silently
    // corrupting the token count (concurrency safety).
    const updateResult = await tx.queue.updateMany({
      where: { id: queue.id, currentToken: oldCurrentToken },
      data: { currentToken: newToken },
    });
    if (updateResult.count === 0) {
      throw new ApiError(409, "This queue was just updated by another action — please retry.");
    }

    if (nextAppointment && nextAppointment.status === "WAITING") {
      nextAppointment = await tx.appointment.update({
        where: { id: nextAppointment.id },
        data: { status: "CHECKED_IN" },
        include: { patient: true },
      });
    }

    await tx.queueLog.create({
      data: { queueId: queue.id, action: QUEUE_ACTIONS.NEXT, performedBy: user.id, meta: { newToken, autoSkippedCancelledTokens: autoSkippedTokens } },
    });

    return { newToken, completedAppointment, nextAppointment, queueId: queue.id };
  });

  if (result.completedAppointment) {
    emitAppointmentCompleted(doctorId, clinicId, {
      appointmentId: result.completedAppointment.id,
      token: result.completedAppointment.token,
    });
    // The finished patient gets an explicit "done" message of their own —
    // previously only the *next* patient got notified ("Your Turn"); the
    // one who just finished got nothing telling them it's over.
    const finishedPatient = await prisma.patient.findUnique({
      where: { id: result.completedAppointment.patientId },
    });
    if (finishedPatient?.userId) {
      await notifyUser({
        userId: finishedPatient.userId,
        type: "GENERAL",
        title: "Consultation Complete",
        message: `Your consultation (Token #${result.completedAppointment.token}) is complete. Thank you.`,
      });
    }
  }
  if (result.nextAppointment?.patient?.userId) {
    await notifyUser({
      userId: result.nextAppointment.patient.userId,
      type: "GENERAL",
      title: "Your Turn",
      message: `Token #${result.newToken} is now being called. Please proceed to the consultation room.`,
    });
  }
  emitTokenCalled(doctorId, clinicId, {
    token: result.newToken,
    appointmentId: result.nextAppointment?.id || null,
    patientName: result.nextAppointment?.patient?.name || null,
  });

  // Not awaited: this is a courtesy heads-up, not part of the queue
  // advance itself — it must never delay or fail the receptionist's
  // "Next" response. notifyApproaching has its own guard against a
  // missing/non-active target appointment.
  notifyApproaching(result.queueId, result.newToken).catch((err) =>
    console.error("notifyApproaching failed:", err)
  );

  return broadcastAndReturn(doctorId, clinicId, date, scheduleId);
};

export const previousToken = async (user, doctorId, clinicId, date, scheduleId) => {
  await assertAccess(user, doctorId, clinicId);

  await runQueueTransaction(async (tx) => {
    const queue = await tx.queue.findUnique({
      where: { doctorId_clinicId_date_scheduleId: { doctorId, clinicId, date: new Date(date), scheduleId } },
    });
    if (!queue) throw new ApiError(404, "No queue found for this session on this date");
    if (queue.currentToken <= 0) throw new ApiError(400, "Already at the beginning of the queue");

    const newToken = queue.currentToken - 1;
    const updateResult = await tx.queue.updateMany({
      where: { id: queue.id, currentToken: queue.currentToken },
      data: { currentToken: newToken },
    });
    if (updateResult.count === 0) {
      throw new ApiError(409, "This queue was just updated by another action — please retry.");
    }

    await tx.queueLog.create({
      data: { queueId: queue.id, action: QUEUE_ACTIONS.PREVIOUS, performedBy: user.id, meta: { newToken } },
    });
  });

  return broadcastAndReturn(doctorId, clinicId, date, scheduleId);
};

// Skip marks the CURRENT patient (the one actually just called) as
// not-arrived and moves on — it does NOT touch the next patient, who
// hasn't been called yet. Matches the spec: skipping Token 5 while it's
// current makes Token 6 current next, it doesn't leave Token 5 current-but-absent.
export const skipToken = async (user, doctorId, clinicId, date, scheduleId) => {
  await assertAccess(user, doctorId, clinicId);

  const result = await runQueueTransaction(async (tx) => {
    const queue = await tx.queue.findUnique({
      where: { doctorId_clinicId_date_scheduleId: { doctorId, clinicId, date: new Date(date), scheduleId } },
    });
    if (!queue) throw new ApiError(404, "No queue found for this session on this date");
    if (queue.currentToken <= 0) {
      throw new ApiError(400, "No patient is currently being served — call 'Next' first before skipping");
    }

    const currentAppointment = await tx.appointment.findUnique({
      where: { queueId_token: { queueId: queue.id, token: queue.currentToken } },
    });

    let skippedAppointment = null;
    if (currentAppointment) {
      if (currentAppointment.status === "COMPLETED") {
        throw new ApiError(400, "This appointment is already completed and cannot be skipped");
      }
      if (currentAppointment.status === "CANCELLED") {
        throw new ApiError(400, "This appointment was cancelled — there is nothing to skip");
      }
      if (currentAppointment.status !== "ABSENT") {
        skippedAppointment = await tx.appointment.update({
          where: { id: currentAppointment.id },
          data: { status: "ABSENT" },
        });
      } else {
        skippedAppointment = currentAppointment;
      }
    }

    // Same reasoning as nextToken: don't stop on a token that was
    // CANCELLED before ever being called — keep advancing until we find a
    // real active appointment or run out of issued tokens.
    let newToken = queue.currentToken + 1;
    let nextAppointment = null;
    const autoSkippedTokens = [];
    while (newToken <= queue.lastTokenIssued) {
      const candidate = await tx.appointment.findUnique({
        where: { queueId_token: { queueId: queue.id, token: newToken } },
        include: { patient: true },
      });
      if (candidate && ACTIVE_STATUSES.includes(candidate.status)) {
        nextAppointment = candidate;
        break;
      }
      if (candidate) autoSkippedTokens.push(candidate.token);
      newToken++;
    }

    const updateResult = await tx.queue.updateMany({
      where: { id: queue.id, currentToken: queue.currentToken },
      data: { currentToken: newToken },
    });
    if (updateResult.count === 0) {
      throw new ApiError(409, "This queue was just updated by another action — please retry.");
    }

    if (nextAppointment && nextAppointment.status === "WAITING") {
      nextAppointment = await tx.appointment.update({
        where: { id: nextAppointment.id },
        data: { status: "CHECKED_IN" },
        include: { patient: true },
      });
    }

    await tx.queueLog.create({
      data: { queueId: queue.id, action: QUEUE_ACTIONS.SKIP, performedBy: user.id, meta: { skippedToken: queue.currentToken, newToken, autoSkippedCancelledTokens: autoSkippedTokens } },
    });

    return { skippedAppointment, nextAppointment, newToken };
  });

  if (result.nextAppointment?.patient?.userId) {
    await notifyUser({
      userId: result.nextAppointment.patient.userId,
      type: "GENERAL",
      title: "Your Turn",
      message: `Token #${result.newToken} is now being called. Please proceed to the consultation room.`,
    });
  }
  emitTokenCalled(doctorId, clinicId, {
    token: result.newToken,
    appointmentId: result.nextAppointment?.id || null,
    patientName: result.nextAppointment?.patient?.name || null,
  });

  return broadcastAndReturn(doctorId, clinicId, date, scheduleId);
};

export const recallToken = async (user, doctorId, clinicId, date, scheduleId, token) => {
  await assertAccess(user, doctorId, clinicId);

  const result = await runQueueTransaction(async (tx) => {
    const queue = await tx.queue.findUnique({
      where: { doctorId_clinicId_date_scheduleId: { doctorId, clinicId, date: new Date(date), scheduleId } },
    });
    if (!queue) throw new ApiError(404, "No queue found for this session on this date");

    const appointment = await tx.appointment.findUnique({
      where: { queueId_token: { queueId: queue.id, token } },
      include: { patient: true },
    });
    if (!appointment) throw new ApiError(404, "No appointment found with this token");
    if (appointment.status === "CANCELLED") {
      throw new ApiError(400, "Cannot recall a cancelled appointment");
    }

    const updated = await tx.appointment.update({
      where: { id: appointment.id },
      data: { status: "CHECKED_IN" },
      include: { patient: true },
    });

    const updateResult = await tx.queue.updateMany({
      where: { id: queue.id, currentToken: queue.currentToken },
      data: { currentToken: token },
    });
    if (updateResult.count === 0) {
      throw new ApiError(409, "This queue was just updated by another action — please retry.");
    }

    await tx.queueLog.create({
      data: { queueId: queue.id, action: QUEUE_ACTIONS.RECALL, performedBy: user.id, meta: { recalledToken: token } },
    });

    return { appointment: updated };
  });

  emitTokenCalled(doctorId, clinicId, {
    token,
    appointmentId: result.appointment.id,
    patientName: result.appointment.patient?.name || null,
  });

  return broadcastAndReturn(doctorId, clinicId, date, scheduleId);
};

export const pauseQueue = async (user, doctorId, clinicId, date, scheduleId) => {
  await assertAccess(user, doctorId, clinicId);
  const queue = await getQueueOrThrow(doctorId, clinicId, date, scheduleId);

  await prisma.queue.update({ where: { id: queue.id }, data: { status: "PAUSED" } });
  await logQueueAction(queue.id, QUEUE_ACTIONS.PAUSE, user.id);
  return broadcastAndReturn(doctorId, clinicId, date, scheduleId);
};

export const resumeQueue = async (user, doctorId, clinicId, date, scheduleId) => {
  await assertAccess(user, doctorId, clinicId);
  const queue = await getQueueOrThrow(doctorId, clinicId, date, scheduleId);

  await prisma.queue.update({ where: { id: queue.id }, data: { status: "OPEN" } });
  await logQueueAction(queue.id, QUEUE_ACTIONS.RESUME, user.id);
  return broadcastAndReturn(doctorId, clinicId, date, scheduleId);
};

export const closeQueue = async (user, doctorId, clinicId, date, scheduleId) => {
  await assertAccess(user, doctorId, clinicId);
  const queue = await getQueueOrThrow(doctorId, clinicId, date, scheduleId);

  await prisma.queue.update({ where: { id: queue.id }, data: { status: "CLOSED" } });
  await logQueueAction(queue.id, QUEUE_ACTIONS.CLOSE, user.id);
  return broadcastAndReturn(doctorId, clinicId, date, scheduleId);
};

export const reopenQueue = async (user, doctorId, clinicId, date, scheduleId) => {
  await assertAccess(user, doctorId, clinicId);
  const queue = await getQueueOrThrow(doctorId, clinicId, date, scheduleId);

  await prisma.queue.update({ where: { id: queue.id }, data: { status: "OPEN" } });
  await logQueueAction(queue.id, QUEUE_ACTIONS.REOPEN, user.id);
  return broadcastAndReturn(doctorId, clinicId, date, scheduleId);
};

// Was referenced by queue.controller.js / queue.validation.js already but
// never implemented — POST .../emergency threw "queueService.emergencyToken
// is not a function". createEmergencyAppointment in the repository already
// existed and is race-safe (increments lastTokenIssued inside its own
// transaction); this just wires it up.
export const emergencyToken = async (user, doctorId, clinicId, date, scheduleId, patientId) => {
  await assertAccess(user, doctorId, clinicId);
  const queue = await getQueueOrThrow(doctorId, clinicId, date, scheduleId);

  if (queue.status === "CLOSED") {
    throw new ApiError(400, "Queue is closed for this session");
  }

  const { appointment } = await createEmergencyAppointment(doctorId, clinicId, queue.id, date, patientId);

  await logQueueAction(queue.id, QUEUE_ACTIONS.EMERGENCY, user.id, { appointmentId: appointment.id, token: appointment.token });
  await broadcastAndReturn(doctorId, clinicId, date, scheduleId);

  return appointment;
};