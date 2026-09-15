import prisma from "../../config/db.config.js";
import ApiError from "../../utils/apiError.js";
import { MAX_ACTIVE_APPOINTMENTS } from "./appointment.constants.js";

export const searchDoctors = async ({ q, doctorName, clinicName, clinicId, city, date }) => {
  const where = { isVerified: true, clinic: { isApproved: true } };

  if (doctorName) where.user = { name: { contains: doctorName, mode: "insensitive" } };
  if (clinicName) where.clinic = { ...where.clinic, clinicName: { contains: clinicName, mode: "insensitive" } };
  if (clinicId) where.clinicId = clinicId;
  if (city) where.clinic = { ...where.clinic, city: { contains: city, mode: "insensitive" } };
  if (q) {
    where.OR = [
      { user: { name: { contains: q, mode: "insensitive" } } },
      { specialization: { contains: q, mode: "insensitive" } },
      { qualification: { contains: q, mode: "insensitive" } },
      { clinic: { clinicName: { contains: q, mode: "insensitive" } } },
      { clinic: { city: { contains: q, mode: "insensitive" } } },
      { clinic: { address: { contains: q, mode: "insensitive" } } },
    ];
  }

  const doctors = await prisma.doctor.findMany({
    where,
    include: {
      user: { select: { name: true } },
      clinic: { select: { id: true, clinicName: true, city: true, address: true } },
    },
    orderBy: [{ isFeatured: "desc" }, { featuredOrder: "asc" }],
  });

  if (!date) return doctors;

  return Promise.all(
    doctors.map(async (doctor) => {
      if (!doctor.clinicId) return { ...doctor, todayQueue: null };

      const queues = await prisma.queue.findMany({
        where: { doctorId: doctor.id, clinicId: doctor.clinicId, date: new Date(date) },
      });

      if (queues.length === 0) return { ...doctor, todayQueue: null };

      return {
        ...doctor,
        todayQueue: {
          currentToken: Math.max(...queues.map((queue) => queue.currentToken)),
          lastTokenIssued: queues.reduce((sum, queue) => sum + queue.lastTokenIssued, 0),
          status: queues.every((queue) => queue.status === "CLOSED") ? "CLOSED" : "OPEN",
          sessions: queues.length,
        },
      };
    })
  );
};

export const getBookableClinicsForDoctor = async (doctorId) => {
  const [doctor, approvedAssociations] = await Promise.all([
    prisma.doctor.findUnique({ where: { id: doctorId }, select: { clinicId: true } }),
    prisma.doctorClinicAssociation.findMany({ where: { doctorId, status: "APPROVED" }, select: { clinicId: true } }),
  ]);
  if (!doctor) return [];
  return [doctor.clinicId, ...approvedAssociations.map((assoc) => assoc.clinicId)].filter(Boolean);
};

export const getDoctorById = (id) => prisma.doctor.findUnique({ where: { id } });
export const getPatientById = (id) => prisma.patient.findUnique({ where: { id } });
export const getDoctorScheduleById = (scheduleId) => prisma.doctorSchedule.findUnique({ where: { id: scheduleId } });
export const getClinicById = (id) => prisma.clinic.findUnique({ where: { id } });
export const getWorkingHoursForClinicDay = (clinicId, dayOfWeek) => prisma.clinicWorkingHours.findUnique({ where: { clinicId_dayOfWeek: { clinicId, dayOfWeek } } });
export const getHolidayForClinicDate = (clinicId, date) => prisma.clinicHoliday.findUnique({ where: { clinicId_date: { clinicId, date: new Date(date) } } });
export const getDoctorLeaveForDate = (doctorId, clinicId, date) => prisma.doctorLeave.findUnique({ where: { doctorId_clinicId_date: { doctorId, clinicId, date: new Date(date) } } });

const findConflictingAppointment = async (db, { patientId, date, scheduleStartTime, excludeDoctorId }) => {
  const activeAppointments = await db.appointment.findMany({
    where: { patientId, date: new Date(date), status: { in: ["WAITING", "CHECKED_IN"] } },
    select: {
      id: true, token: true, doctorId: true,
      doctor: { select: { user: { select: { name: true } } } },
      queue: { select: { schedule: { select: { startTime: true } } } },
    },
  });

  if (activeAppointments.length === 0) return null;

  const [newHours, newMinutes] = scheduleStartTime.split(":").map(Number);
  const newTotalMinutes = newHours * 60 + newMinutes;
  const GAP_MINUTES = 45;

  for (const appointment of activeAppointments) {
    const sameDoctor = appointment.doctorId === excludeDoctorId;
    const otherStartTime = appointment.queue?.schedule?.startTime;
    if (!otherStartTime) continue;

    const [otherHours, otherMinutes] = otherStartTime.split(":").map(Number);
    const otherTotalMinutes = otherHours * 60 + otherMinutes;
    const gap = Math.abs(newTotalMinutes - otherTotalMinutes);

    if (sameDoctor || gap < GAP_MINUTES) {
      return { appointment, gap, sameDoctor };
    }
  }
  return null;
};

export const findConflictingAppointmentForPatient = async ({ patientId, date, scheduleStartTime, excludeDoctorId }) => {
  return findConflictingAppointment(prisma, { patientId, date, scheduleStartTime, excludeDoctorId });
};

// 🚀 ULTRA-FAST ATOMIC TRANSACTION FOR BOOKING 🚀
export const createAppointmentWithToken = async ({
  doctorId, clinicId, patientId, scheduleId, date, bookingSource, maxCapacity
}) => {
  return prisma.$transaction(async (tx) => {
    const queueDate = new Date(date);

    // 1. Atomic Queue Upsert (Directly locks the queue row safely without selecting it first)
    const queue = await tx.queue.upsert({
      where: { doctorId_clinicId_date_scheduleId: { doctorId, clinicId, date: queueDate, scheduleId } },
      update: { lastTokenIssued: { increment: 1 } },
      create: { doctorId, clinicId, date: queueDate, scheduleId, status: "OPEN", currentToken: 0, lastTokenIssued: 1 }
    });

    if (queue.status === "CLOSED") {
      throw new ApiError(400, "Queue is closed for this session");
    }

    // 2. Fast Active count limit check
    const patientActiveCount = await tx.appointment.count({
      where: { patientId, status: { in: ["WAITING", "CHECKED_IN"] } }
    });
    if (patientActiveCount >= MAX_ACTIVE_APPOINTMENTS) {
      throw new ApiError(409, `You already have ${patientActiveCount} active upcoming appointments (max ${MAX_ACTIVE_APPOINTMENTS}).`);
    }

    // 3. Queue Capacity check
    const currentBookingsCount = await tx.appointment.count({
      where: { queueId: queue.id, status: { in: ["WAITING", "CHECKED_IN", "COMPLETED"] } }
    });
    if (currentBookingsCount >= maxCapacity) {
      throw new ApiError(409, `This session is full (Capacity: ${maxCapacity}/${maxCapacity}). Please select another session.`);
    }

    // 4. Create appointment safely
    const appointment = await tx.appointment.create({
      data: {
        doctorId, clinicId, patientId, queueId: queue.id, date: queueDate, token: queue.lastTokenIssued, bookingSource, status: "WAITING"
      }
    });

    return { appointment, queue, currentBookingsCount: currentBookingsCount + 1 };
  }, { isolationLevel: "ReadCommitted" });
};

export const findAppointmentsForPatient = (patientId) => {
  return prisma.appointment.findMany({
    where: { patientId },
    include: {
      doctor: { include: { user: { select: { name: true } } } },
      clinic: { select: { clinicName: true } },
      queue: true,
    },
    orderBy: { createdAt: "desc" },
  });
};

export const findAppointmentById = (id) => prisma.appointment.findUnique({ where: { id }, include: { queue: true, doctor: true, patient: { include: { user: true } } } });
export const findAppointmentByIdFull = (id) => prisma.appointment.findUnique({ where: { id }, include: { patient: true } });
export const findAppointmentForLiveView = (id) => prisma.appointment.findUnique({ where: { id }, include: { patient: { select: { id: true, userId: true, name: true } }, doctor: { include: { user: { select: { name: true } } } }, clinic: { select: { id: true, clinicName: true } }, queue: { include: { schedule: true } } } });

export const getQueueModeForDoctorClinic = async (doctorId, clinicId) => {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) return "LIVE";
  if (doctor.clinicId === clinicId) return doctor.queueMode;
  const association = await prisma.doctorClinicAssociation.findFirst({ where: { doctorId, clinicId, status: "APPROVED" } });
  return association?.queueMode || "LIVE";
};

export const getConsultationMinutesForDoctorClinic = async (doctorId, clinicId) => {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) return null;
  if (doctor.clinicId === clinicId) return doctor.avgConsultationMinutes;
  const association = await prisma.doctorClinicAssociation.findFirst({ where: { doctorId, clinicId, status: "APPROVED" } });
  return association?.avgConsultationMinutes || null;
};

export const cancelAppointmentRecord = (id, { cancelReason, cancelledBy }) => prisma.appointment.update({ where: { id }, data: { status: "CANCELLED", cancelReason, cancelledBy } });
export const countActiveAppointmentsForPatient = (patientId) => prisma.appointment.count({ where: { patientId, status: { in: ["WAITING", "CHECKED_IN"] } } });
export const getPatientRestrictionStatus = (patientId) => prisma.patient.findUnique({ where: { id: patientId }, select: { id: true, bookingRestrictedUntil: true } });
export const setPatientBookingRestriction = (patientId, restrictedUntil) => prisma.patient.update({ where: { id: patientId }, data: { bookingRestrictedUntil: restrictedUntil } });
export const countActiveTokensAhead = (queueId, currentToken, patientToken) => {
  if (patientToken <= currentToken) return Promise.resolve(0);
  return prisma.appointment.count({ where: { queueId, token: { gte: currentToken, lt: patientToken }, status: { in: ["WAITING", "CHECKED_IN"] } } });
};

export const findAppointmentsForClinic = (clinicId, { doctorId, status, date, patientId, from, to } = {}) => {
  const where = { clinicId };
  if (doctorId) where.doctorId = doctorId;
  if (patientId) where.patientId = patientId;
  if (status) where.status = Array.isArray(status) ? { in: status } : status;
  if (date) where.date = new Date(date);
  else if (from || to) {
    where.date = {};
    if (from) where.date.gte = new Date(from);
    if (to) where.date.lte = new Date(to);
  }
  return prisma.appointment.findMany({
    where,
    include: {
      doctor: { include: { user: { select: { name: true } } } },
      patient: { include: { user: { select: { name: true, phone: true } } } },
      queue: { select: { id: true, currentToken: true, status: true, scheduleId: true } },
    },
    orderBy: [{ date: "desc" }, { token: "asc" }],
  });
};

export const formatWaitEstimate = (minutes) => {
  if (minutes == null) return null;
  if (minutes <= 0) return "~0 min";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `~${mins} min`;
  if (mins === 0) return `~${hours} hr`;
  return `~${hours} hr ${mins} min`;
};

export const computeQueueView = ({ currentToken, patientToken, activeTokensAhead, consultationMinutes }) => {
  const isYourTurn = currentToken === patientToken;
  const patientsAhead = isYourTurn ? 0 : Math.max(0, activeTokensAhead);
  const minutes = patientsAhead * (consultationMinutes || 0);
  return {
    currentToken, yourToken: patientToken, patientsAhead, isYourTurn,
    estimatedWaitMinutes: consultationMinutes ? minutes : null,
    estimatedWaitLabel: consultationMinutes ? formatWaitEstimate(minutes) : null,
  };
};