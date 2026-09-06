import ApiError from "../../utils/apiError.js";
import prisma from "../../config/db.config.js";
import { findClinicByUserId, findReceptionistByUserId } from "../clinic/clinic.repository.js";
import { findReceptionistAssignment } from "../queue/queue.repository.js";
import { notifyUser } from "../notification/notification.service.js";
import { normalizePhone } from "../../utils/phoneNormalizer.js";
// Patient lookup/creation is owned by the patient module (single source of
// truth for patient records) — reused here instead of duplicating it, so
// walk-in/reception bookings and the receptionist "quick add" screen always
// dedupe against the same phone-keyed Patient/User records.
import { findPatientByPhone, createGuestPatient } from "../patient/patient.repository.js";
import { logAudit } from "../audit/audit.service.js";
import {
  searchDoctors,
  getBookableClinicsForDoctor,
  findOrCreateQueue,
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
  cancelAppointmentRecord,
  findConflictingAppointmentForPatient,
  getDoctorLeaveForDate // <--- ADD THIS HERE
} from "./appointment.repository.js";
import { emitQueueUpdate } from "../../sockets/queue.socket.js";

const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

const getPatientByUserId = (userId) => {
  return prisma.patient.findUnique({ where: { userId } });
};

export const searchForDoctors = async (filters) => {
  return searchDoctors(filters);
};

export const bookOnlineAppointment = async (patientUserId, { doctorId, clinicId, scheduleId, date }) => {
  let patient = await getPatientByUserId(patientUserId);
  
  // Auto-create a patient profile if one doesn't exist yet for this user
  // (e.g. testing as Clinic/Admin). Patient.phone is unique + required now,
  // so we can't fall back to a dummy placeholder — that would collide the
  // second time this ever ran for a different phone-less user.
  if (!patient) {
    const user = await prisma.user.findUnique({ where: { id: patientUserId } });
    if (!user.phone) {
      throw new ApiError(400, "Your account has no phone number on file — please update your profile first.");
    }
    patient = await prisma.patient.create({
      data: {
        userId: patientUserId,
        name: user.name,
        phone: user.phone
      }
    });
  }

  await assertBookableClinic(doctorId, clinicId);
  await assertClinicOperational(clinicId, date, { isOnlineBooking: true }, doctorId);

  return bookAppointmentCore({
    doctorId,
    clinicId,
    scheduleId,
    patientId: patient.id,
    date,
    bookingSource: "ONLINE",
  });
};

export const bookReceptionAppointment = async (
  user,
  { doctorId, clinicId, scheduleId, date, patientId, newPatient, bookingSource }
) => {
  await assertReceptionBookingAccess(user, clinicId, doctorId);
  await assertBookableClinic(doctorId, clinicId);
  await assertClinicOperational(clinicId, date, { isOnlineBooking: false }, doctorId);

  let finalPatientId = patientId;

  if (!finalPatientId && newPatient) {
    const patient = await createGuestPatient({
      name: newPatient.name,
      phone: normalizePhone(newPatient.phone),
      gender: newPatient.gender,
    });
    finalPatientId = patient.id;
  } else if (finalPatientId) {
    const existing = await getPatientById(finalPatientId);
    if (!existing) throw new ApiError(404, "Patient not found");
  }

  return bookAppointmentCore({
    doctorId,
    clinicId,
    scheduleId,
    patientId: finalPatientId,
    date,
    bookingSource: bookingSource || "RECEPTION",
  });
};

export const getMyAppointments = async (patientUserId) => {
  const patient = await getPatientByUserId(patientUserId);
  if (!patient) throw new ApiError(404, "Patient profile not found");

  const appointments = await findAppointmentsForPatient(patient.id);

  const appointmentsWithVisibility = await Promise.all(
    appointments.map(async (appt) => {
      const queueMode = await getQueueModeForDoctorClinic(appt.doctorId, appt.clinicId);
      const patientsAhead = Math.max(0, appt.token - appt.queue.currentToken - 1);
      const consultationMinutes = await getConsultationMinutesForDoctorClinic(appt.doctorId, appt.clinicId);
      const estimatedWaitMinutes = patientsAhead * consultationMinutes;

      if (queueMode === "PRIVATE") {
        return {
          ...appt,
          queue: { status: appt.queue.status },
          queueMode: "PRIVATE",
          patientsAhead,
          estimatedWaitMinutes,
        };
      }

      return { ...appt, queueMode: "LIVE", patientsAhead, estimatedWaitMinutes };
    })
  );

  return appointmentsWithVisibility;
};

const assertAppointmentModifyAccess = async (user, appointment) => {
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") return;

  if (user.role === "PATIENT") {
    if (!appointment.patient.userId || appointment.patient.userId !== user.id) {
      throw new ApiError(403, "This appointment does not belong to you");
    }
    if (appointment.status !== "WAITING") {
      throw new ApiError(400, "You can only cancel or reschedule an appointment that is still waiting");
    }
    return;
  }

  if (user.role === "CLINIC") {
    const clinic = await findClinicByUserId(user.id);
    if (!clinic || clinic.id !== appointment.clinicId) {
      throw new ApiError(403, "You can only modify appointments at your own clinic");
    }
    return;
  }

  if (user.role === "RECEPTIONIST") {
    const assignment = await findReceptionistAssignment(user.id, appointment.doctorId, appointment.clinicId);
    if (!assignment) {
      throw new ApiError(403, "You are not assigned to manage this doctor at this clinic");
    }
    return;
  }

  throw new ApiError(403, "You do not have permission to modify this appointment");
};

export const cancelAppointment = async (user, appointmentId, reason) => {
  const appointment = await findAppointmentByIdFull(appointmentId);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  if (appointment.status === "CANCELLED") {
    throw new ApiError(400, "This appointment is already cancelled");
  }
  if (appointment.status === "COMPLETED") {
    throw new ApiError(400, "Cannot cancel a completed appointment");
  }

  await assertAppointmentModifyAccess(user, appointment);

  const cancelled = await cancelAppointmentRecord(appointmentId, {
    cancelReason: reason,
    cancelledBy: user.id,
  });

  await logAudit({
    actorUserId: user.id,
    actorRole: user.role,
    action: "APPOINTMENT_CANCELLED",
    targetType: "Appointment",
    targetId: appointmentId,
    meta: { doctorId: appointment.doctorId, clinicId: appointment.clinicId, reason },
  });

  if (appointment.patient.userId) {
    await notifyUser({
      userId: appointment.patient.userId,
      type: "APPOINTMENT_CANCELLED",
      title: "Appointment Cancelled",
      message: `Your appointment (Token #${appointment.token}) on ${appointment.date.toISOString().split("T")[0]} has been cancelled.${reason ? ` Reason: ${reason}` : ""}`,
      meta: { appointmentId: appointment.id, doctorId: appointment.doctorId, clinicId: appointment.clinicId },
    });
  }

  return cancelled;
};

export const rescheduleAppointment = async (user, appointmentId, newDate) => {
  const appointment = await findAppointmentByIdFull(appointmentId);
  if (!appointment) throw new ApiError(404, "Appointment not found");

  if (appointment.status === "CANCELLED") {
    throw new ApiError(400, "Cannot reschedule a cancelled appointment");
  }
  if (appointment.status === "COMPLETED") {
    throw new ApiError(400, "Cannot reschedule a completed appointment");
  }

  await assertAppointmentModifyAccess(user, appointment);
  await assertClinicOperational(appointment.clinicId, newDate, { isOnlineBooking: false }, appointment.doctorId);

  await cancelAppointmentRecord(appointmentId, {
    cancelReason: `Rescheduled to ${newDate}`,
    cancelledBy: user.id,
  });

  const newAppointment = await bookAppointmentCore({
    doctorId: appointment.doctorId,
    clinicId: appointment.clinicId,
    patientId: appointment.patientId,
    date: newDate,
    bookingSource: appointment.bookingSource,
  });

  if (appointment.patient.userId) {
    await notifyUser({
      userId: appointment.patient.userId,
      type: "GENERAL",
      title: "Appointment Rescheduled",
      message: `Your appointment has been rescheduled to ${newDate} — new Token #${newAppointment.token}.`,
      meta: {
        oldAppointmentId: appointment.id,
        newAppointmentId: newAppointment.id,
        doctorId: appointment.doctorId,
        clinicId: appointment.clinicId,
      },
    });
  }

  return newAppointment;
};

const assertReceptionBookingAccess = async (user, clinicId, doctorId) => {
  if (user.role === "SUPER_ADMIN" || user.role === "ADMIN") return;

  if (user.role === "CLINIC") {
    const clinic = await findClinicByUserId(user.id);
    if (!clinic || clinic.id !== clinicId) {
      throw new ApiError(403, "You can only book appointments for your own clinic");
    }
    return;
  }

  if (user.role === "RECEPTIONIST") {
    const assignment = await findReceptionistAssignment(user.id, doctorId, clinicId);
    if (!assignment) {
      throw new ApiError(403, "You are not assigned to book appointments for this doctor at this clinic");
    }
    return;
  }

  throw new ApiError(403, "You do not have permission to book this appointment");
};

const assertBookableClinic = async (doctorId, clinicId) => {
  const bookableClinicIds = await getBookableClinicsForDoctor(doctorId);
  if (!bookableClinicIds.includes(clinicId)) {
    throw new ApiError(400, "This doctor is not currently bookable at the specified clinic");
  }
};

const bookAppointmentCore = async ({ doctorId, clinicId, scheduleId, patientId, date, bookingSource }) => {
  try {
    const doctor = await getDoctorById(doctorId);
    if (!doctor) throw new ApiError(404, "Doctor not found");
    if (!doctor.isVerified) throw new ApiError(403, "Doctor is not yet verified");

    const schedule = await getDoctorScheduleById(scheduleId);
    if (!schedule || schedule.doctorId !== doctorId || schedule.clinicId !== clinicId) {
      throw new ApiError(404, "Invalid schedule selected");
    }
    if (!schedule.isActive) throw new ApiError(400, "This schedule is currently inactive");
    if (bookingSource === "ONLINE" && schedule.onlineBookingEnabled === false) {
      throw new ApiError(400, "Online booking is currently turned off for this doctor/session — please book by phone or visit the clinic");
    }

    const queue = await findOrCreateQueue(doctorId, clinicId, date, scheduleId);
    if (queue.status === "CLOSED") {
      throw new ApiError(400, "Queue is closed for this session");
    }

    // Rule: no patient should end up double-booked — either two tokens with
    // the same doctor, or two different doctors within 45 minutes of each
    // other on the same day (they physically can't be in two places at once).
    const conflict = await findConflictingAppointmentForPatient({
      patientId,
      date,
      scheduleStartTime: schedule.startTime,
      excludeDoctorId: doctorId,
    });
    if (conflict) {
      const doctorName = conflict.appointment.doctor?.user?.name || "another doctor";
      throw new ApiError(
        409,
        conflict.sameDoctor
          ? `You already have an active appointment (Token #${conflict.appointment.token}) with this doctor on ${date}.`
          : `You already have an appointment with Dr. ${doctorName} (Token #${conflict.appointment.token}) at ${conflict.appointment.queue.schedule.startTime} on ${date} — please choose a time at least 45 minutes away.`
      );
    }

    const { appointment, queue: updatedQueue } = await createAppointmentWithToken({
      doctorId,
      clinicId,
      patientId,
      queueId: queue.id,
      scheduleId,
      date,
      bookingSource,
    });

    // 🟢 FIXED: Removed 'req.query.date' and properly mapped capacity count to queueId
    const activeCount = await prisma.appointment.count({
      where: { 
        queueId: queue.id, 
        status: { in: ["WAITING", "CHECKED_IN", "COMPLETED"] } 
      }
    });
    
    const capacityPayload = {
      scheduleId,
      maxPatients: schedule.maxPatients,
      currentBookings: activeCount,
      isFull: activeCount >= schedule.maxPatients
    };

    const queueMode = await getQueueModeForDoctorClinic(doctorId, clinicId);
    const broadcastPayload = queueMode === "PRIVATE"
        ? { doctorId, clinicId, date, scheduleId, status: updatedQueue.status, capacity: capacityPayload }
        : {
            doctorId,
            clinicId,
            date,
            scheduleId,
            currentToken: updatedQueue.currentToken,
            lastTokenIssued: updatedQueue.lastTokenIssued,
            status: updatedQueue.status,
            capacity: capacityPayload 
          };

    emitQueueUpdate(doctorId, clinicId, broadcastPayload);

    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (patient?.userId) {
      await notifyUser({
        userId: patient.userId,
        type: "APPOINTMENT_BOOKED",
        title: "Appointment Confirmed",
        message: `Your appointment is confirmed — Token #${appointment.token} for ${date} (${schedule.startTime} - ${schedule.endTime}).`,
        meta: { appointmentId: appointment.id, doctorId, clinicId, date, token: appointment.token },
      });
    }

    return appointment;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.code === "P2034") {
      // Serializable transaction conflict — another booking for the same
      // schedule/queue committed first. Not a real failure, just contention.
      throw new ApiError(409, "This slot was just booked by someone else — please try again.");
    }
    throw new ApiError(500, `Booking failed: ${error.message}`);
  }
};

const formatTime = (date) => {
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
};

const assertClinicOperational = async (clinicId, date, { isOnlineBooking }, doctorId) => {
  const clinic = await getClinicById(clinicId);
  if (!clinic) throw new ApiError(404, "Clinic not found");

  if (isOnlineBooking && !clinic.onlineConsultationEnabled) {
    throw new ApiError(400, "This clinic does not accept online bookings — please book in person or by phone");
  }

  const holiday = await getHolidayForClinicDate(clinicId, date);
  if (holiday) {
    throw new ApiError(400, `Clinic is closed on this date${holiday.reason ? `: ${holiday.reason}` : ""}`);
  }

  const dayOfWeek = DAY_NAMES[new Date(date).getDay()];
  const hours = await getWorkingHoursForClinicDay(clinicId, dayOfWeek);
  if (hours?.isClosed) {
    throw new ApiError(400, `Clinic is closed on ${dayOfWeek.toLowerCase()}s`);
  }

  if (doctorId) {
    const leave = await getDoctorLeaveForDate(doctorId, clinicId, date);
    if (leave) {
      throw new ApiError(400, `Doctor is on leave on this date${leave.reason ? `: ${leave.reason}` : ""}`);
    }
  }
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

  await assertBookableClinic(doctorId, clinicId);

  let patient = await findPatientByPhone(normalizedPhone);
  if (!patient) {
    patient = await createGuestPatient({ name, phone: normalizedPhone });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const appointment = await bookAppointmentCore({
    doctorId,
    clinicId,
    scheduleId,
    patientId: patient.id,
    date: today.toISOString().split('T')[0], // Enforce string format for walk-ins too
    bookingSource: "WALK_IN"
  });

  return { appointment, token: appointment.token };
};