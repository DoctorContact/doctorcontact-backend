import ApiError from "../../utils/apiError.js";
import prisma from "../../config/db.config.js";
import { findClinicByUserId, findReceptionistByUserId } from "../clinic/clinic.repository.js";
import { findReceptionistAssignment } from "../queue/queue.repository.js";
import { notifyUser } from "../notification/notification.service.js";
import { normalizePhone } from "../../utils/phoneNormalizer.js";
import { findPatientByPhone, createGuestPatient } from "../patient/patient.repository.js";
import { logAudit } from "../audit/audit.service.js";
import {
  searchDoctors,
  getBookableClinicsForDoctor,
  getDoctorById,
  getPatientById,
  createAppointmentWithToken,
  findAppointmentsForPatient,
  getQueueModeForDoctorClinic,
  getClinicById,
  getDoctorScheduleById,
  getWorkingHoursForClinicDay,
  getHolidayForClinicDate,
  getConsultationMinutesForDoctorClinic,
  findAppointmentByIdFull,
  findAppointmentForLiveView,
  cancelAppointmentRecord,
  findConflictingAppointmentForPatient,
  getDoctorLeaveForDate,
  countActiveAppointmentsForPatient,
  getPatientRestrictionStatus,
  setPatientBookingRestriction,
  countActiveTokensAhead,
  findAppointmentsForClinic,
} from "./appointment.repository.js";
import { emitQueueUpdate } from "../../sockets/queue.socket.js";
import {
  MAX_ACTIVE_APPOINTMENTS,
  POST_CANCEL_RESTRICTION_DAYS,
  DEFAULT_CONSULTATION_MINUTES,
} from "./appointment.constants.js";
import { computeQueueView } from "./appointment.helper.js";

const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

const getPatientByUserId = (userId) => prisma.patient.findUnique({ where: { userId } });

export const searchForDoctors = async (filters) => searchDoctors(filters);

export const bookOnlineAppointment = async (patientUserId, { doctorId, clinicId, scheduleId, date }) => {
  let patient = await getPatientByUserId(patientUserId);

  if (!patient) {
    const user = await prisma.user.findUnique({ where: { id: patientUserId } });
    if (!user.phone) throw new ApiError(400, "Your account has no phone number on file.");
    patient = await prisma.patient.create({ data: { userId: patientUserId, name: user.name, phone: user.phone } });
  }

  await Promise.all([
    assertBookableClinic(doctorId, clinicId),
    assertClinicOperational(clinicId, date, { isOnlineBooking: true }, doctorId),
  ]);

  return bookAppointmentCore({ doctorId, clinicId, scheduleId, patientId: patient.id, patientUserId: patient.userId, date, bookingSource: "ONLINE" });
};

export const bookReceptionAppointment = async (user, { doctorId, clinicId, scheduleId, date, patientId, newPatient, bookingSource }) => {
  await Promise.all([
    assertReceptionBookingAccess(user, clinicId, doctorId),
    assertBookableClinic(doctorId, clinicId),
    assertClinicOperational(clinicId, date, { isOnlineBooking: false }, doctorId),
  ]);

  let finalPatientId = patientId;
  let finalPatientUserId;

  if (!finalPatientId && newPatient) {
    const patient = await createGuestPatient({ name: newPatient.name, phone: normalizePhone(newPatient.phone), gender: newPatient.gender, age: newPatient.age, dob: newPatient.dob });
    finalPatientId = patient.id;
    finalPatientUserId = patient.userId;
  } else if (finalPatientId) {
    const existing = await getPatientById(finalPatientId);
    if (!existing) throw new ApiError(404, "Patient not found");
    finalPatientUserId = existing.userId;
  }

  return bookAppointmentCore({ doctorId, clinicId, scheduleId, patientId: finalPatientId, patientUserId: finalPatientUserId, date, bookingSource: bookingSource || "RECEPTION" });
};

export const processWalkInAppointment = async (user, { doctorId, scheduleId, phone, name }) => {
  const normalizedPhone = normalizePhone(phone);
  let clinicId;

  if (user.role === "CLINIC") {
    const clinic = await findClinicByUserId(user.id);
    if (!clinic) throw new ApiError(404, "Clinic not found");
    clinicId = clinic.id;
  } else if (user.role === "RECEPTIONIST") {
    const receptionist = await findReceptionistByUserId(user.id);
    if (!receptionist) throw new ApiError(404, "Receptionist not found");
    clinicId = receptionist.clinicId;
  } else {
    throw new ApiError(403, "Unauthorized to book walk-ins");
  }

  const [, patientResult] = await Promise.all([
    assertBookableClinic(doctorId, clinicId),
    findPatientByPhone(normalizedPhone),
  ]);

  let patient = patientResult;
  if (!patient) patient = await createGuestPatient({ name, phone: normalizedPhone });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const appointment = await bookAppointmentCore({
    doctorId, clinicId, scheduleId, patientId: patient.id, patientUserId: patient.userId, date: today.toISOString().split('T')[0], bookingSource: "WALK_IN"
  });

  return { appointment, token: appointment.token };
};

// 🚀 ULTRA-FAST BOOKING CORE 🚀
const bookAppointmentCore = async ({ doctorId, clinicId, scheduleId, patientId, patientUserId, date, bookingSource }) => {
  try {
    // 1. Parallel Fetch (Initial Lookups)
    const [doctor, schedule] = await Promise.all([
      getDoctorById(doctorId),
      getDoctorScheduleById(scheduleId),
    ]);

    if (!doctor) throw new ApiError(404, "Doctor not found");
    if (!doctor.isVerified) throw new ApiError(403, "Doctor is not yet verified");
    if (!schedule || schedule.doctorId !== doctorId || schedule.clinicId !== clinicId) throw new ApiError(404, "Invalid schedule selected");
    if (!schedule.isActive) throw new ApiError(400, "This schedule is currently inactive");
    if (bookingSource === "ONLINE" && schedule.onlineBookingEnabled === false) throw new ApiError(400, "Online booking is currently turned off for this doctor/session");

    // 2. Parallel Fetch (Conflicts, Limits, Exceptions)
    const [exception, conflict, restrictionStatus] = await Promise.all([
      prisma.scheduleException.findUnique({ where: { scheduleId_date: { scheduleId, date: new Date(date) } } }),
      findConflictingAppointmentForPatient({ patientId, date, scheduleStartTime: schedule.startTime, excludeDoctorId: doctorId }),
      getPatientRestrictionStatus(patientId)
    ]);

    if (exception?.isCancelled) throw new ApiError(400, "This session has been cancelled for this date");
    if (restrictionStatus?.bookingRestrictedUntil && new Date(restrictionStatus.bookingRestrictedUntil) > new Date()) {
      throw new ApiError(403, `New bookings are temporarily paused until ${restrictionStatus.bookingRestrictedUntil.toISOString().split("T")[0]} due to recent cancellations.`);
    }

    if (conflict) {
      const doctorName = conflict.appointment.doctor?.user?.name || "another doctor";
      throw new ApiError(409, conflict.sameDoctor
        ? `You already have an active appointment (Token #${conflict.appointment.token}) with this doctor on ${date}.`
        : `You already have an appointment with Dr. ${doctorName} at ${conflict.appointment.queue?.schedule?.startTime} on ${date} — please choose a time at least 45 minutes away.`
      );
    }

    const maxCapacity = exception?.overrideMaxPatients ?? schedule.maxPatients ?? 20;

    // 3. FAST ATOMIC DB WRITE
    const { appointment, queue: updatedQueue, currentBookingsCount } = await createAppointmentWithToken({
      doctorId, clinicId, patientId, scheduleId, date, bookingSource, maxCapacity
    });

    // 4. FIRE AND FORGET NOTIFICATIONS (Never blocks the user response)
    setImmediate(async () => {
      try {
        const capacityPayload = { scheduleId, maxPatients: maxCapacity, currentBookings: currentBookingsCount, isFull: currentBookingsCount >= maxCapacity };
        const queueMode = await getQueueModeForDoctorClinic(doctorId, clinicId);
        
        const broadcastPayload = queueMode === "PRIVATE"
          ? { doctorId, clinicId, date, scheduleId, status: updatedQueue.status, capacity: capacityPayload }
          : { doctorId, clinicId, date, scheduleId, currentToken: updatedQueue.currentToken, lastTokenIssued: updatedQueue.lastTokenIssued, status: updatedQueue.status, capacity: capacityPayload };

        emitQueueUpdate(doctorId, clinicId, broadcastPayload);

        if (patientUserId) {
          notifyUser({
            userId: patientUserId, type: "APPOINTMENT_BOOKED", title: "Appointment Confirmed",
            message: `Your appointment is confirmed — Token #${appointment.token} for ${date} (${schedule.startTime} - ${schedule.endTime}).`,
            meta: { appointmentId: appointment.id, doctorId, clinicId, date, token: appointment.token },
          });
        }
      } catch (error) {
        console.error("Post-booking queue update failed:", error);
      }
    });

    return appointment;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.code === "P2034") throw new ApiError(409, "This slot was just booked by someone else — please try again.");
    if (error.code === "P2002") throw new ApiError(409, "This booking conflicts with an existing record — please try again.");
    console.error("BOOK APPOINTMENT ERROR:", error);
    throw new ApiError(500, "Booking failed due to an unexpected server error. Please try again.");
  }
};

const ACTIVE_STATUSES = ["WAITING", "CHECKED_IN"];
const isSameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const bucketAppointment = (appt) => {
  if (appt.status === "COMPLETED" || appt.status === "CANCELLED") return "HISTORY";
  if (isSameDay(appt.date, new Date())) return "TODAY";
  return "UPCOMING";
};

export const getMyAppointments = async (patientUserId) => {
  const patient = await getPatientByUserId(patientUserId);
  if (!patient) throw new ApiError(404, "Patient profile not found");
  const appointments = await findAppointmentsForPatient(patient.id);

  return Promise.all(
    appointments.map(async (appt) => {
      const queueMode = await getQueueModeForDoctorClinic(appt.doctorId, appt.clinicId);
      const consultationMinutes = (await getConsultationMinutesForDoctorClinic(appt.doctorId, appt.clinicId)) || DEFAULT_CONSULTATION_MINUTES;
      const activeTokensAhead = ACTIVE_STATUSES.includes(appt.status) ? await countActiveTokensAhead(appt.queueId, appt.queue.currentToken, appt.token) : 0;
      
      const queueView = computeQueueView({ currentToken: appt.queue.currentToken, patientToken: appt.token, activeTokensAhead, consultationMinutes });
      const bucket = bucketAppointment(appt);

      const base = { ...appt, bucket, patientsAhead: queueView.patientsAhead, isYourTurn: queueView.isYourTurn, estimatedWaitMinutes: queueView.estimatedWaitMinutes, estimatedWaitLabel: queueView.estimatedWaitLabel };
      if (queueMode === "PRIVATE") return { ...base, queue: { status: appt.queue.status }, queueMode: "PRIVATE" };
      return { ...base, queueMode: "LIVE" };
    })
  );
};

export const getMyBookingStatus = async (patientUserId) => {
  const patient = await getPatientByUserId(patientUserId);
  if (!patient) throw new ApiError(404, "Patient profile not found");

  const activeCount = await countActiveAppointmentsForPatient(patient.id);
  const restriction = await getPatientRestrictionStatus(patient.id);
  const restrictedUntil = restriction?.bookingRestrictedUntil && new Date(restriction.bookingRestrictedUntil) > new Date() ? restriction.bookingRestrictedUntil : null;

  return { activeAppointments: activeCount, maxActiveAppointments: MAX_ACTIVE_APPOINTMENTS, canBookMore: activeCount < MAX_ACTIVE_APPOINTMENTS && !restrictedUntil, bookingRestrictedUntil: restrictedUntil };
};

export const getAppointmentLiveView = async (user, appointmentId) => {
  const appt = await findAppointmentForLiveView(appointmentId);
  if (!appt) throw new ApiError(404, "Appointment not found");
  if (user.role === "PATIENT" && appt.patient.userId !== user.id) throw new ApiError(403, "This appointment does not belong to you");

  const queueMode = await getQueueModeForDoctorClinic(appt.doctorId, appt.clinicId);
  const consultationMinutes = (await getConsultationMinutesForDoctorClinic(appt.doctorId, appt.clinicId)) || DEFAULT_CONSULTATION_MINUTES;
  const activeTokensAhead = ACTIVE_STATUSES.includes(appt.status) ? await countActiveTokensAhead(appt.queueId, appt.queue.currentToken, appt.token) : 0;

  const queueView = computeQueueView({ currentToken: appt.queue.currentToken, patientToken: appt.token, activeTokensAhead, consultationMinutes });

  return {
    appointmentId: appt.id, status: appt.status, token: appt.token, date: appt.date, doctorName: appt.doctor?.user?.name, clinicName: appt.clinic?.clinicName,
    session: appt.queue?.schedule ? { startTime: appt.queue.schedule.startTime, endTime: appt.queue.schedule.endTime } : null,
    queueMode, queueStatus: appt.queue?.status,
    ...(queueMode === "PRIVATE" ? { isYourTurn: queueView.isYourTurn } : { currentToken: queueView.currentToken, yourToken: queueView.yourToken, patientsAhead: queueView.patientsAhead, isYourTurn: queueView.isYourTurn, estimatedWaitMinutes: queueView.estimatedWaitMinutes, estimatedWaitLabel: queueView.estimatedWaitLabel }),
  };
};

export const getClinicAppointments = async (user, filters) => {
  const clinicId = await resolveClinicIdForStaffUser(user);
  return findAppointmentsForClinic(clinicId, filters);
};

const resolveClinicIdForStaffUser = async (user) => {
  if (user.role === "CLINIC") {
    const clinic = await findClinicByUserId(user.id);
    if (!clinic) throw new ApiError(404, "Clinic not found");
    return clinic.id;
  }
  if (user.role === "RECEPTIONIST") {
    const receptionist = await findReceptionistByUserId(user.id);
    if (!receptionist) throw new ApiError(404, "Receptionist not found");
    return receptionist.clinicId;
  }
  throw new ApiError(403, "Only clinic or receptionist accounts can view clinic appointment lists");
};

const assertAppointmentModifyAccess = async (user, appointment) => {
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") return;
  if (user.role === "PATIENT") {
    if (!appointment.patient.userId || appointment.patient.userId !== user.id) throw new ApiError(403, "This appointment does not belong to you");
    if (appointment.status !== "WAITING") throw new ApiError(400, "You can only cancel or reschedule an appointment that is still waiting");
    return;
  }
  if (user.role === "CLINIC") {
    const clinic = await findClinicByUserId(user.id);
    if (!clinic || clinic.id !== appointment.clinicId) throw new ApiError(403, "You can only modify appointments at your own clinic");
    return;
  }
  if (user.role === "RECEPTIONIST") {
    const assignment = await findReceptionistAssignment(user.id, appointment.doctorId, appointment.clinicId);
    if (!assignment) throw new ApiError(403, "You are not assigned to manage this doctor at this clinic");
    return;
  }
  throw new ApiError(403, "You do not have permission to modify this appointment");
};

const broadcastCapacityUpdate = async (doctorId, clinicId, date, queueId) => {
  const queue = await prisma.queue.findUnique({ where: { id: queueId } });
  if (!queue) return;
  const schedule = await getDoctorScheduleById(queue.scheduleId);
  if (!schedule) return;

  const currentBookingsCount = await prisma.appointment.count({ where: { queueId, status: { in: ["WAITING", "CHECKED_IN", "COMPLETED"] } } });
  const capacityPayload = { scheduleId: queue.scheduleId, maxPatients: schedule.maxPatients, currentBookings: currentBookingsCount, isFull: currentBookingsCount >= schedule.maxPatients };
  const queueMode = await getQueueModeForDoctorClinic(doctorId, clinicId);
  
  const broadcastPayload = queueMode === "PRIVATE"
    ? { doctorId, clinicId, date, scheduleId: queue.scheduleId, status: queue.status, capacity: capacityPayload }
    : { doctorId, clinicId, date, scheduleId: queue.scheduleId, currentToken: queue.currentToken, lastTokenIssued: queue.lastTokenIssued, status: queue.status, capacity: capacityPayload };

  emitQueueUpdate(doctorId, clinicId, broadcastPayload);
};

export const cancelAppointment = async (user, appointmentId, reason) => {
  const appointment = await findAppointmentByIdFull(appointmentId);
  if (!appointment) throw new ApiError(404, "Appointment not found");
  if (appointment.status === "CANCELLED") throw new ApiError(400, "This appointment is already cancelled");
  if (appointment.status === "COMPLETED") throw new ApiError(400, "Cannot cancel a completed appointment");

  await assertAppointmentModifyAccess(user, appointment);

  const activeCountBeforeCancel = await countActiveAppointmentsForPatient(appointment.patientId);
  const shouldRestrict = activeCountBeforeCancel >= MAX_ACTIVE_APPOINTMENTS;

  const cancelled = await cancelAppointmentRecord(appointmentId, { cancelReason: reason, cancelledBy: user.id });

  if (shouldRestrict) {
    const restrictedUntil = new Date();
    restrictedUntil.setDate(restrictedUntil.getDate() + POST_CANCEL_RESTRICTION_DAYS);
    await setPatientBookingRestriction(appointment.patientId, restrictedUntil);
  }

  await logAudit({ actorUserId: user.id, actorRole: user.role, action: "APPOINTMENT_CANCELLED", targetType: "Appointment", targetId: appointmentId, meta: { doctorId: appointment.doctorId, clinicId: appointment.clinicId, reason } });

  setImmediate(async () => {
    await broadcastCapacityUpdate(appointment.doctorId, appointment.clinicId, appointment.date.toISOString().split("T")[0], appointment.queueId);
    if (appointment.patient.userId) {
      notifyUser({ userId: appointment.patient.userId, type: "APPOINTMENT_CANCELLED", title: "Appointment Cancelled", message: `Your appointment (Token #${appointment.token}) on ${appointment.date.toISOString().split("T")[0]} has been cancelled.${reason ? ` Reason: ${reason}` : ""}`, meta: { appointmentId: appointment.id, doctorId: appointment.doctorId, clinicId: appointment.clinicId } });
    }
  });

  return cancelled;
};

export const rescheduleAppointment = async (user, appointmentId, newDate) => {
  const appointment = await findAppointmentByIdFull(appointmentId);
  if (!appointment) throw new ApiError(404, "Appointment not found");
  if (appointment.status === "CANCELLED") throw new ApiError(400, "Cannot reschedule a cancelled appointment");
  if (appointment.status === "COMPLETED") throw new ApiError(400, "Cannot reschedule a completed appointment");

  await assertAppointmentModifyAccess(user, appointment);
  await assertClinicOperational(appointment.clinicId, newDate, { isOnlineBooking: false }, appointment.doctorId);

  await cancelAppointmentRecord(appointmentId, { cancelReason: `Rescheduled to ${newDate}`, cancelledBy: user.id });

  setImmediate(async () => {
    await broadcastCapacityUpdate(appointment.doctorId, appointment.clinicId, appointment.date.toISOString().split("T")[0], appointment.queueId);
  });

  const newAppointment = await bookAppointmentCore({ doctorId: appointment.doctorId, clinicId: appointment.clinicId, scheduleId: appointment.queue.scheduleId, patientId: appointment.patientId, patientUserId: appointment.patient.userId, date: newDate, bookingSource: appointment.bookingSource });

  if (appointment.patient.userId) {
    setImmediate(() => {
      notifyUser({ userId: appointment.patient.userId, type: "GENERAL", title: "Appointment Rescheduled", message: `Your appointment has been rescheduled to ${newDate} — new Token #${newAppointment.token}.`, meta: { oldAppointmentId: appointment.id, newAppointmentId: newAppointment.id, doctorId: appointment.doctorId, clinicId: appointment.clinicId } });
    });
  }

  return newAppointment;
};

const assertReceptionBookingAccess = async (user, clinicId, doctorId) => {
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") return;
  if (user.role === "CLINIC") {
    const clinic = await findClinicByUserId(user.id);
    if (!clinic || clinic.id !== clinicId) throw new ApiError(403, "You can only book appointments for your own clinic");
    return;
  }
  if (user.role === "RECEPTIONIST") {
    const assignment = await findReceptionistAssignment(user.id, doctorId, clinicId);
    if (!assignment) throw new ApiError(403, "You are not assigned to book appointments for this doctor at this clinic");
    return;
  }
  throw new ApiError(403, "You do not have permission to book this appointment");
};

const assertBookableClinic = async (doctorId, clinicId) => {
  const bookableClinicIds = await getBookableClinicsForDoctor(doctorId);
  if (!bookableClinicIds.includes(clinicId)) throw new ApiError(400, "This doctor is not currently bookable at the specified clinic");
};

const assertClinicOperational = async (clinicId, date, { isOnlineBooking }, doctorId) => {
  const dayOfWeek = DAY_NAMES[new Date(date).getDay()];
  const [clinic, holiday, hours, leave] = await Promise.all([
    getClinicById(clinicId),
    getHolidayForClinicDate(clinicId, date),
    getWorkingHoursForClinicDay(clinicId, dayOfWeek),
    doctorId ? getDoctorLeaveForDate(doctorId, clinicId, date) : Promise.resolve(null),
  ]);

  if (!clinic) throw new ApiError(404, "Clinic not found");
  if (isOnlineBooking && !clinic.onlineConsultationEnabled) throw new ApiError(400, "This clinic does not accept online bookings — please book in person or by phone");
  if (holiday) throw new ApiError(400, `Clinic is closed on this date${holiday.reason ? `: ${holiday.reason}` : ""}`);
  if (hours?.isClosed) throw new ApiError(400, `Clinic is closed on ${dayOfWeek.toLowerCase()}s`);
  if (leave) throw new ApiError(400, `Doctor is on leave on this date${leave.reason ? `: ${leave.reason}` : ""}`);
};