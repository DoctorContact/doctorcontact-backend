import ApiError from "../../utils/apiError.js";
import prisma from "../../config/db.config.js";
import {
  findReceptionistAssignment,
  logQueueAction,
  createEmergencyAppointment,
} from "./queue.repository.js";
import { QUEUE_ACTIONS } from "./queue.constants.js";
import {
  emitQueueUpdate,
  emitTokenCalled,
  emitAppointmentCompleted,
} from "../../sockets/queue.socket.js";
import { notifyUser } from "../notification/notification.service.js";
import { notifyApproaching } from "../doctor/doctor.service.js";

// Shared wrapper for every transaction that advances/mutates queue state.
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
      throw new ApiError(
        409,
        "This action timed out or conflicted with another update — please try again."
      );
    }

    throw err;
  }
};

const assertAccess = async (user, doctorId, clinicId) => {
  if (
    user.role === "CLINIC" ||
    user.role === "SUPER_ADMIN" ||
    user.role === "ADMIN"
  ) {
    return;
  }

  if (user.role === "RECEPTIONIST") {
    const assignment = await findReceptionistAssignment(
      user.id,
      doctorId,
      clinicId
    );

    if (!assignment) {
      throw new ApiError(
        403,
        "You are not assigned to manage this doctor's queue"
      );
    }

    return;
  }

  throw new ApiError(
    403,
    "You do not have permission to control this queue"
  );
};

const getQueueOrThrow = async (
  doctorId,
  clinicId,
  date,
  scheduleId
) => {
  const queue = await prisma.queue.findUnique({
    where: {
      doctorId_clinicId_date_scheduleId: {
        doctorId,
        clinicId,
        date: new Date(date),
        scheduleId,
      },
    },
  });

  if (!queue) {
    throw new ApiError(
      404,
      "No queue found for this session on this date"
    );
  }

  return queue;
};

// These appointments are still active in the queue.
const ACTIVE_STATUSES = ["WAITING", "CHECKED_IN"];

// ---------------------------------------------------------
// GET QUEUE STATUS
// ---------------------------------------------------------

export const getQueueStatus = async (
  doctorId,
  clinicId,
  date,
  scheduleId
) => {
  const queue = await prisma.queue.findUnique({
    where: {
      doctorId_clinicId_date_scheduleId: {
        doctorId,
        clinicId,
        date: new Date(date),
        scheduleId,
      },
    },
    include: {
      appointments: {
        orderBy: {
          token: "asc",
        },
        include: {
          patient: true,
        },
      },
    },
  });

  if (!queue) {
    return {
      doctorId,
      clinicId,
      date,
      scheduleId,
      currentToken: 0,
      lastTokenIssued: 0,
      status: "OPEN",
      totalPatients: 0,
      completedCount: 0,
      skippedCount: 0,
      cancelledCount: 0,
      current: null,
      next: null,
      tokens: [],
      appointments: [],
    };
  }

  return buildQueueDashboard(queue);
};

// ---------------------------------------------------------
// PATIENT INFO
// ---------------------------------------------------------

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

// ---------------------------------------------------------
// QUEUE TOKEN
// ---------------------------------------------------------

const toQueueToken = (appt) => ({
  id: appt.id,
  token: appt.token,
  patientName: appt.patient?.name || null,
  patientAge: appt.patient?.age ?? null,
  patientGender: appt.patient?.gender ?? null,
  status: appt.status,
  bookedAt: appt.createdAt,
});

// ---------------------------------------------------------
// QUEUE DASHBOARD
// ---------------------------------------------------------

const buildQueueDashboard = (queue) => {
  const appointments = queue.appointments || [];

  const completedCount = appointments.filter(
    (a) => a.status === "COMPLETED"
  ).length;

  const skippedCount = appointments.filter(
    (a) => a.status === "ABSENT"
  ).length;

  const cancelledCount = appointments.filter(
    (a) => a.status === "CANCELLED"
  ).length;

  // Cancelled appointments should not appear in visible queue.
  const visibleAppointments = appointments.filter(
    (a) => a.status !== "CANCELLED"
  );

  const current =
    queue.currentToken > 0
      ? visibleAppointments.find(
          (a) => a.token === queue.currentToken
        ) || null
      : null;

  // Find the next active patient after current token.
  const next =
    visibleAppointments
      .filter(
        (a) =>
          a.token > queue.currentToken &&
          ACTIVE_STATUSES.includes(a.status)
      )
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

    tokens: visibleAppointments.map(toQueueToken),

    // Kept for API compatibility.
    appointments: visibleAppointments,
  };
};

// ---------------------------------------------------------
// BROADCAST
// ---------------------------------------------------------

const broadcastAndReturn = async (
  doctorId,
  clinicId,
  date,
  scheduleId
) => {
  const dashboard = await getQueueStatus(
    doctorId,
    clinicId,
    date,
    scheduleId
  );

  emitQueueUpdate(
    doctorId,
    clinicId,
    dashboard
  );

  return dashboard;
};

// ---------------------------------------------------------
// NEXT TOKEN
// ---------------------------------------------------------

export const nextToken = async (
  user,
  doctorId,
  clinicId,
  date,
  scheduleId
) => {
  await assertAccess(user, doctorId, clinicId);

  const result = await runQueueTransaction(async (tx) => {
    const queue = await tx.queue.findUnique({
      where: {
        doctorId_clinicId_date_scheduleId: {
          doctorId,
          clinicId,
          date: new Date(date),
          scheduleId,
        },
      },
    });

    if (!queue) {
      throw new ApiError(
        404,
        "No queue found for this session on this date"
      );
    }

    if (queue.status !== "OPEN") {
      throw new ApiError(
        400,
        `Queue is currently ${queue.status.toLowerCase()}`
      );
    }

    let completedAppointment = null;

    // Complete current patient first.
    if (queue.currentToken > 0) {
      const prevAppointment = await tx.appointment.findUnique({
        where: {
          queueId_token: {
            queueId: queue.id,
            token: queue.currentToken,
          },
        },
      });

      if (
        prevAppointment &&
        ACTIVE_STATUSES.includes(prevAppointment.status)
      ) {
        completedAppointment = await tx.appointment.update({
          where: {
            id: prevAppointment.id,
          },
          data: {
            status: "COMPLETED",
          },
        });
      }
    }

    // If nothing was completed and there are no more tokens.
    if (
      !completedAppointment &&
      queue.currentToken >= queue.lastTokenIssued
    ) {
      throw new ApiError(
        400,
        "No more patients waiting in this queue"
      );
    }

    const oldCurrentToken = queue.currentToken;

    let newToken = oldCurrentToken + 1;
    let nextAppointment = null;

    const autoSkippedTokens = [];

    // Skip cancelled / absent tokens automatically.
    while (newToken <= queue.lastTokenIssued) {
      const candidate = await tx.appointment.findUnique({
        where: {
          queueId_token: {
            queueId: queue.id,
            token: newToken,
          },
        },
        include: {
          patient: true,
        },
      });

      if (
        candidate &&
        ACTIVE_STATUSES.includes(candidate.status)
      ) {
        nextAppointment = candidate;
        break;
      }

      if (candidate) {
        autoSkippedTokens.push(candidate.token);
      }

      newToken++;
    }

    // Concurrency-safe queue update.
    const updateResult = await tx.queue.updateMany({
      where: {
        id: queue.id,
        currentToken: oldCurrentToken,
      },
      data: {
        currentToken: newToken,
      },
    });

    if (updateResult.count === 0) {
      throw new ApiError(
        409,
        "This queue was just updated by another action — please retry."
      );
    }

    // Mark next patient as checked in.
    if (
      nextAppointment &&
      nextAppointment.status === "WAITING"
    ) {
      nextAppointment = await tx.appointment.update({
        where: {
          id: nextAppointment.id,
        },
        data: {
          status: "CHECKED_IN",
        },
        include: {
          patient: true,
        },
      });
    }

    await tx.queueLog.create({
      data: {
        queueId: queue.id,
        action: QUEUE_ACTIONS.NEXT,
        performedBy: user.id,
        meta: {
          newToken,
          autoSkippedCancelledTokens:
            autoSkippedTokens,
        },
      },
    });

    return {
      newToken,
      completedAppointment,
      nextAppointment,
      queueId: queue.id,
    };
  });

  // Notify completed patient.
  if (result.completedAppointment) {
    emitAppointmentCompleted(
      doctorId,
      clinicId,
      {
        appointmentId:
          result.completedAppointment.id,
        token:
          result.completedAppointment.token,
      }
    );

    const finishedPatient =
      await prisma.patient.findUnique({
        where: {
          id: result.completedAppointment.patientId,
        },
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

  // Notify next patient.
  if (result.nextAppointment?.patient?.userId) {
    await notifyUser({
      userId:
        result.nextAppointment.patient.userId,
      type: "GENERAL",
      title: "Your Turn",
      message: `Token #${result.newToken} is now being called. Please proceed to the consultation room.`,
    });
  }

  emitTokenCalled(
    doctorId,
    clinicId,
    {
      token: result.newToken,
      appointmentId:
        result.nextAppointment?.id || null,
      patientName:
        result.nextAppointment?.patient?.name ||
        null,
    }
  );

  // Courtesy notification.
  notifyApproaching(
    result.queueId,
    result.newToken
  ).catch((err) =>
    console.error(
      "notifyApproaching failed:",
      err
    )
  );

  return broadcastAndReturn(
    doctorId,
    clinicId,
    date,
    scheduleId
  );
};

// ---------------------------------------------------------
// PREVIOUS TOKEN
// ---------------------------------------------------------

export const previousToken = async (
  user,
  doctorId,
  clinicId,
  date,
  scheduleId
) => {
  await assertAccess(
    user,
    doctorId,
    clinicId
  );

  await runQueueTransaction(async (tx) => {
    const queue = await tx.queue.findUnique({
      where: {
        doctorId_clinicId_date_scheduleId: {
          doctorId,
          clinicId,
          date: new Date(date),
          scheduleId,
        },
      },
    });

    if (!queue) {
      throw new ApiError(
        404,
        "No queue found for this session on this date"
      );
    }

    if (queue.currentToken <= 0) {
      throw new ApiError(
        400,
        "Already at the beginning of the queue"
      );
    }

    const previousAppointment =
      await tx.appointment.findFirst({
        where: {
          queueId: queue.id,
          token: {
            lt: queue.currentToken,
          },
          status: {
            in: ACTIVE_STATUSES,
          },
        },
        orderBy: {
          token: "desc",
        },
      });

    if (!previousAppointment) {
      throw new ApiError(
        400,
        "No previous active patient found"
      );
    }

    const updateResult =
      await tx.queue.updateMany({
        where: {
          id: queue.id,
          currentToken: queue.currentToken,
        },
        data: {
          currentToken:
            previousAppointment.token,
        },
      });

    if (updateResult.count === 0) {
      throw new ApiError(
        409,
        "This queue was just updated by another action — please retry."
      );
    }

    await tx.queueLog.create({
      data: {
        queueId: queue.id,
        action: QUEUE_ACTIONS.PREVIOUS,
        performedBy: user.id,
        meta: {
          previousToken:
            previousAppointment.token,
        },
      },
    });
  });

  return broadcastAndReturn(
    doctorId,
    clinicId,
    date,
    scheduleId
  );
};

// ---------------------------------------------------------
// SKIP TOKEN
// ---------------------------------------------------------

export const skipToken = async (
  user,
  doctorId,
  clinicId,
  date,
  scheduleId
) => {
  await assertAccess(
    user,
    doctorId,
    clinicId
  );

  const result = await runQueueTransaction(
    async (tx) => {
      const queue = await tx.queue.findUnique({
        where: {
          doctorId_clinicId_date_scheduleId: {
            doctorId,
            clinicId,
            date: new Date(date),
            scheduleId,
          },
        },
      });

      if (!queue) {
        throw new ApiError(
          404,
          "No queue found for this session on this date"
        );
      }

      if (queue.currentToken <= 0) {
        throw new ApiError(
          400,
          "No patient is currently being served — call 'Next' first before skipping"
        );
      }

      const currentAppointment =
        await tx.appointment.findUnique({
          where: {
            queueId_token: {
              queueId: queue.id,
              token: queue.currentToken,
            },
          },
        });

      let skippedAppointment = null;

      if (currentAppointment) {
        if (
          currentAppointment.status ===
          "COMPLETED"
        ) {
          throw new ApiError(
            400,
            "This appointment is already completed and cannot be skipped"
          );
        }

        if (
          currentAppointment.status ===
          "CANCELLED"
        ) {
          throw new ApiError(
            400,
            "This appointment was cancelled — there is nothing to skip"
          );
        }

        if (
          currentAppointment.status !==
          "ABSENT"
        ) {
          skippedAppointment =
            await tx.appointment.update({
              where: {
                id: currentAppointment.id,
              },
              data: {
                status: "ABSENT",
              },
            });
        } else {
          skippedAppointment =
            currentAppointment;
        }
      }

      let newToken =
        queue.currentToken + 1;

      let nextAppointment = null;

      const autoSkippedTokens = [];

      while (
        newToken <= queue.lastTokenIssued
      ) {
        const candidate =
          await tx.appointment.findUnique({
            where: {
              queueId_token: {
                queueId: queue.id,
                token: newToken,
              },
            },
            include: {
              patient: true,
            },
          });

        if (
          candidate &&
          ACTIVE_STATUSES.includes(
            candidate.status
          )
        ) {
          nextAppointment = candidate;
          break;
        }

        if (candidate) {
          autoSkippedTokens.push(
            candidate.token
          );
        }

        newToken++;
      }

      const updateResult =
        await tx.queue.updateMany({
          where: {
            id: queue.id,
            currentToken:
              queue.currentToken,
          },
          data: {
            currentToken: newToken,
          },
        });

      if (updateResult.count === 0) {
        throw new ApiError(
          409,
          "This queue was just updated by another action — please retry."
        );
      }

      if (
        nextAppointment &&
        nextAppointment.status ===
          "WAITING"
      ) {
        nextAppointment =
          await tx.appointment.update({
            where: {
              id: nextAppointment.id,
            },
            data: {
              status: "CHECKED_IN",
            },
            include: {
              patient: true,
            },
          });
      }

      await tx.queueLog.create({
        data: {
          queueId: queue.id,
          action: QUEUE_ACTIONS.SKIP,
          performedBy: user.id,
          meta: {
            skippedToken:
              queue.currentToken,
            newToken,
            autoSkippedCancelledTokens:
              autoSkippedTokens,
          },
        },
      });

      return {
        skippedAppointment,
        nextAppointment,
        newToken,
      };
    }
  );

  // Notify next patient.
  if (result.nextAppointment?.patient?.userId) {
    await notifyUser({
      userId:
        result.nextAppointment.patient.userId,
      type: "GENERAL",
      title: "Your Turn",
      message: `Token #${result.newToken} is now being called. Please proceed to the consultation room.`,
    });
  }

  emitTokenCalled(
    doctorId,
    clinicId,
    {
      token: result.newToken,
      appointmentId:
        result.nextAppointment?.id || null,
      patientName:
        result.nextAppointment?.patient?.name ||
        null,
    }
  );

  return broadcastAndReturn(
    doctorId,
    clinicId,
    date,
    scheduleId
  );
};

// ---------------------------------------------------------
// RECALL TOKEN
// ---------------------------------------------------------

export const recallToken = async (
  user,
  doctorId,
  clinicId,
  date,
  scheduleId,
  token
) => {
  await assertAccess(
    user,
    doctorId,
    clinicId
  );

  const result = await runQueueTransaction(
    async (tx) => {
      const queue = await tx.queue.findUnique({
        where: {
          doctorId_clinicId_date_scheduleId: {
            doctorId,
            clinicId,
            date: new Date(date),
            scheduleId,
          },
        },
      });

      if (!queue) {
        throw new ApiError(
          404,
          "No queue found for this session on this date"
        );
      }

      const appointment =
        await tx.appointment.findUnique({
          where: {
            queueId_token: {
              queueId: queue.id,
              token,
            },
          },
          include: {
            patient: true,
          },
        });

      if (!appointment) {
        throw new ApiError(
          404,
          "No appointment found with this token"
        );
      }

      if (
        appointment.status ===
        "CANCELLED"
      ) {
        throw new ApiError(
          400,
          "Cannot recall a cancelled appointment"
        );
      }

      // FIX:
      // Completed appointment should not be recalled.
      if (
        appointment.status ===
        "COMPLETED"
      ) {
        throw new ApiError(
          400,
          "Cannot recall a completed appointment"
        );
      }

      const updated =
        await tx.appointment.update({
          where: {
            id: appointment.id,
          },
          data: {
            status: "CHECKED_IN",
          },
          include: {
            patient: true,
          },
        });

      const updateResult =
        await tx.queue.updateMany({
          where: {
            id: queue.id,
            currentToken:
              queue.currentToken,
          },
          data: {
            currentToken: token,
          },
        });

      if (updateResult.count === 0) {
        throw new ApiError(
          409,
          "This queue was just updated by another action — please retry."
        );
      }

      await tx.queueLog.create({
        data: {
          queueId: queue.id,
          action: QUEUE_ACTIONS.RECALL,
          performedBy: user.id,
          meta: {
            recalledToken: token,
          },
        },
      });

      return {
        appointment: updated,
      };
    }
  );

  emitTokenCalled(
    doctorId,
    clinicId,
    {
      token,
      appointmentId:
        result.appointment.id,
      patientName:
        result.appointment.patient?.name ||
        null,
    }
  );

  return broadcastAndReturn(
    doctorId,
    clinicId,
    date,
    scheduleId
  );
};

// ---------------------------------------------------------
// PAUSE QUEUE
// ---------------------------------------------------------

export const pauseQueue = async (
  user,
  doctorId,
  clinicId,
  date,
  scheduleId
) => {
  await assertAccess(
    user,
    doctorId,
    clinicId
  );

  const queue = await getQueueOrThrow(
    doctorId,
    clinicId,
    date,
    scheduleId
  );

  await prisma.queue.update({
    where: {
      id: queue.id,
    },
    data: {
      status: "PAUSED",
    },
  });

  await logQueueAction(
    queue.id,
    QUEUE_ACTIONS.PAUSE,
    user.id
  );

  return broadcastAndReturn(
    doctorId,
    clinicId,
    date,
    scheduleId
  );
};

// ---------------------------------------------------------
// RESUME QUEUE
// ---------------------------------------------------------

export const resumeQueue = async (
  user,
  doctorId,
  clinicId,
  date,
  scheduleId
) => {
  await assertAccess(
    user,
    doctorId,
    clinicId
  );

  const queue = await getQueueOrThrow(
    doctorId,
    clinicId,
    date,
    scheduleId
  );

  await prisma.queue.update({
    where: {
      id: queue.id,
    },
    data: {
      status: "OPEN",
    },
  });

  await logQueueAction(
    queue.id,
    QUEUE_ACTIONS.RESUME,
    user.id
  );

  return broadcastAndReturn(
    doctorId,
    clinicId,
    date,
    scheduleId
  );
};

// ---------------------------------------------------------
// CLOSE QUEUE
// ---------------------------------------------------------

export const closeQueue = async (
  user,
  doctorId,
  clinicId,
  date,
  scheduleId
) => {
  await assertAccess(
    user,
    doctorId,
    clinicId
  );

  const queue = await getQueueOrThrow(
    doctorId,
    clinicId,
    date,
    scheduleId
  );

  await prisma.queue.update({
    where: {
      id: queue.id,
    },
    data: {
      status: "CLOSED",
    },
  });

  await logQueueAction(
    queue.id,
    QUEUE_ACTIONS.CLOSE,
    user.id
  );

  return broadcastAndReturn(
    doctorId,
    clinicId,
    date,
    scheduleId
  );
};

// ---------------------------------------------------------
// REOPEN QUEUE
// ---------------------------------------------------------

export const reopenQueue = async (
  user,
  doctorId,
  clinicId,
  date,
  scheduleId
) => {
  await assertAccess(
    user,
    doctorId,
    clinicId
  );

  const queue = await getQueueOrThrow(
    doctorId,
    clinicId,
    date,
    scheduleId
  );

  await prisma.queue.update({
    where: {
      id: queue.id,
    },
    data: {
      status: "OPEN",
    },
  });

  await logQueueAction(
    queue.id,
    QUEUE_ACTIONS.REOPEN,
    user.id
  );

  return broadcastAndReturn(
    doctorId,
    clinicId,
    date,
    scheduleId
  );
};

// ---------------------------------------------------------
// EMERGENCY TOKEN
// ---------------------------------------------------------

export const emergencyToken = async (
  user,
  doctorId,
  clinicId,
  date,
  scheduleId,
  patientId
) => {
  await assertAccess(
    user,
    doctorId,
    clinicId
  );

  const queue = await getQueueOrThrow(
    doctorId,
    clinicId,
    date,
    scheduleId
  );

  if (queue.status === "CLOSED") {
    throw new ApiError(
      400,
      "Queue is closed for this session"
    );
  }

  const { appointment } =
    await createEmergencyAppointment(
      doctorId,
      clinicId,
      queue.id,
      date,
      patientId
    );

  await logQueueAction(
    queue.id,
    QUEUE_ACTIONS.EMERGENCY,
    user.id,
    {
      appointmentId: appointment.id,
      token: appointment.token,
    }
  );

  await broadcastAndReturn(
    doctorId,
    clinicId,
    date,
    scheduleId
  );

  return appointment;
};