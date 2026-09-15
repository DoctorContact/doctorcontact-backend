import prisma from "../../config/db.config.js";
import ApiError from "../../utils/apiError.js";
import { MAX_ACTIVE_APPOINTMENTS } from "./appointment.constants.js";

export const searchDoctors = async ({ q, doctorName, clinicName, clinicId, city, date }) => {
  const where = {
    isVerified: true,
    clinic: { isApproved: true },
  };

  if (doctorName) {
    where.user = { name: { contains: doctorName, mode: "insensitive" } };
  }
  if (clinicName) {
    where.clinic = { ...where.clinic, clinicName: { contains: clinicName, mode: "insensitive" } };
  }
  if (clinicId) {
    where.clinicId = clinicId;
  }
  if (city) {
    where.clinic = { ...where.clinic, city: { contains: city, mode: "insensitive" } };
  }

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

  if (date) {
    const doctorsWithQueue = await Promise.all(
      doctors.map(async (doctor) => {
        if (!doctor.clinicId) return { ...doctor, todayQueue: null };
        const queues = await prisma.queue.findMany({
          where: { doctorId: doctor.id, clinicId: doctor.clinicId, date: new Date(date) },
        });
        if (queues.length === 0) return { ...doctor, todayQueue: null };
        const todayQueue = {
          currentToken: Math.max(...queues.map((q) => q.currentToken)),
          lastTokenIssued: queues.reduce((sum, q) => sum + q.lastTokenIssued, 0),
          status: queues.every((q) => q.status === "CLOSED") ? "CLOSED" : "OPEN",
          sessions: queues.length,
        };
        return { ...doctor, todayQueue };
      })
    );
    return doctorsWithQueue;
  }

  return doctors;
};

export const getBookableClinicsForDoctor = async (doctorId) => {
  // doctor + associations are independent reads (both only need doctorId),
  // so fire them together instead of awaiting one before starting the next —
  // was 2 sequential round trips, now 1 round-trip's worth of latency.
  const [doctor, approvedAssociations] = await Promise.all([
    prisma.doctor.findUnique({ where: { id: doctorId } }),
    prisma.doctorClinicAssociation.findMany({
      where: { doctorId, status: "APPROVED" },
    }),
  ]);
  if (!doctor) return [];

  return [doctor.clinicId, ...approvedAssociations.map((a) => a.clinicId)];
};

export const findOrCreateQueue = async (doctorId, clinicId, date, scheduleId) => {
  const queue = await prisma.queue.findUnique({
    where: {
      doctorId_clinicId_date_scheduleId: {
        doctorId,
        clinicId,
        date: new Date(date),
        scheduleId
      }
    }
  });

  if (queue) return queue;

  return prisma.queue.create({
    data: {
      doctorId,
      clinicId,
      date: new Date(date),
      scheduleId,
      status: "OPEN",
      currentToken: 0,
      lastTokenIssued: 0,
    }
  });
};

export const getDoctorById = (id) => {
  return prisma.doctor.findUnique({ where: { id } });
};

export const getPatientById = (id) => {
  return prisma.patient.findUnique({ where: { id } });
};
export const getDoctorScheduleById = (scheduleId) => {
  return prisma.doctorSchedule.findUnique({ where: { id: scheduleId } });
};

export const findConflictingAppointmentForPatient = async ({
  patientId,
  date,
  scheduleStartTime,
  excludeDoctorId,
}) => {
  const active = await prisma.appointment.findMany({
    where: {
      patientId,
      date: new Date(date),
      status: { in: ["WAITING", "CHECKED_IN"] },
    },
    include: {
      queue: { include: { schedule: true } },
      doctor: { include: { user: { select: { name: true } } } },
    },
  });

  const [newH, newM] = scheduleStartTime.split(":").map(Number);
  const newMinutes = newH * 60 + newM;
  const GAP_MINUTES = 45;

  for (const appt of active) {
    const sameDoctor = appt.doctorId === excludeDoctorId;
    const otherStart = appt.queue?.schedule?.startTime;
    if (!otherStart) continue;

    const [oh, om] = otherStart.split(":").map(Number);
    const otherMinutes = oh * 60 + om;
    const gap = Math.abs(newMinutes - otherMinutes);

    if (sameDoctor || gap < GAP_MINUTES) {
      return { appointment: appt, gap, sameDoctor };
    }
  }

  return null;
};

export const createAppointmentWithToken = async ({ doctorId, clinicId, patientId, queueId, schedule, date, bookingSource }) => {
  return prisma.$transaction(async (tx) => {
    // Was: fetched with `include: { schedule: true }` just to read
    // schedule.id/maxPatients — but the caller already fetched and
    // validated this exact schedule a moment ago (isActive,
    // onlineBookingEnabled checks) before starting the transaction, so
    // there's no need to join it again here. Passing it in drops one join
    // from this query.
    const queue = await tx.queue.findUnique({ where: { id: queueId } });

    if (!queue) throw new ApiError(404, "Queue not found");
    if (queue.status === "CLOSED") throw new ApiError(400, "Queue is closed for this session");

    const exception = await tx.scheduleException.findUnique({
      where: { scheduleId_date: { scheduleId: schedule.id, date: new Date(date) } },
    });
    if (exception?.isCancelled) {
      throw new ApiError(400, "This session has been cancelled for this date");
    }

    const maxCapacity = exception?.overrideMaxPatients ?? schedule.maxPatients ?? 20;

    // Was two separate count() queries — one here (WAITING+CHECKED_IN, for
    // the capacity check) and another identical-shaped one at the very end
    // (WAITING+CHECKED_IN+COMPLETED, for the broadcast payload). Both are
    // just different sums over the same per-status counts for this queue,
    // so fetch every status count in one groupBy and derive both numbers
    // from it in memory — one query instead of two.
    const statusCounts = await tx.appointment.groupBy({
      by: ["status"],
      where: { queueId, status: { in: ["WAITING", "CHECKED_IN", "COMPLETED"] } },
      _count: { _all: true },
    });
    const countFor = (status) => statusCounts.find((s) => s.status === status)?._count._all || 0;
    const activeAppointmentsCount = countFor("WAITING") + countFor("CHECKED_IN");
    const completedCountBeforeInsert = countFor("COMPLETED");

    if (activeAppointmentsCount >= maxCapacity) {
      throw new ApiError(409, `This session is full (Capacity: ${maxCapacity}/${maxCapacity}). Please select another session.`);
    }

    const patientActiveCount = await tx.appointment.count({
      where: { patientId, status: { in: ["WAITING", "CHECKED_IN"] } },
    });
    if (patientActiveCount >= MAX_ACTIVE_APPOINTMENTS) {
      throw new ApiError(
        409,
        `You already have ${patientActiveCount} active upcoming appointments — the maximum allowed is ${MAX_ACTIVE_APPOINTMENTS}.`
      );
    }

    const newToken = queue.lastTokenIssued + 1;

    const appointment = await tx.appointment.create({
      data: {
        doctorId,
        clinicId,
        patientId,
        queueId,
        date: new Date(date),
        token: newToken,
        bookingSource,
        status: "WAITING"
      },
    });

    const updatedQueue = await tx.queue.update({
      where: { id: queueId },
      data: { lastTokenIssued: newToken },
    });

    // The appointment just created is WAITING, so it adds exactly 1 to both
    // "active" and "booked today" — no extra query needed to know the
    // post-insert total; this removes the query that used to sit here.
    const currentBookingsCount = activeAppointmentsCount + completedCountBeforeInsert + 1;

    return { appointment, queue: updatedQueue, currentBookingsCount };
  }, { isolationLevel: 'Serializable' });
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

export const findAppointmentById = (id) => {
  return prisma.appointment.findUnique({
    where: { id },
    include: { queue: true, doctor: true, patient: { include: { user: true } } },
  });
};

export const getQueueModeForDoctorClinic = async (doctorId, clinicId) => {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) return "LIVE";

  if (doctor.clinicId === clinicId) {
    return doctor.queueMode;
  }

  const association = await prisma.doctorClinicAssociation.findFirst({
    where: { doctorId, clinicId, status: "APPROVED" },
  });

  return association?.queueMode || "LIVE";
};
export const getClinicById = (id) => {
  return prisma.clinic.findUnique({ where: { id } });
};

export const getWorkingHoursForClinicDay = (clinicId, dayOfWeek) => {
  return prisma.clinicWorkingHours.findUnique({
    where: { clinicId_dayOfWeek: { clinicId, dayOfWeek } },
  });
};

export const getHolidayForClinicDate = (clinicId, date) => {
  return prisma.clinicHoliday.findUnique({
    where: { clinicId_date: { clinicId, date: new Date(date) } },
  });
};

export const getConsultationMinutesForDoctorClinic = async (doctorId, clinicId) => {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) return null;

  if (doctor.clinicId === clinicId) return doctor.avgConsultationMinutes;

  const association = await prisma.doctorClinicAssociation.findFirst({
    where: { doctorId, clinicId, status: "APPROVED" },
  });
  return association?.avgConsultationMinutes || null;
};

export const findAppointmentByIdFull = (id) => {
  return prisma.appointment.findUnique({
    where: { id },
    include: { patient: true },
  });
};

export const findAppointmentForLiveView = (id) => {
  return prisma.appointment.findUnique({
    where: { id },
    include: {
      patient: { select: { id: true, userId: true, name: true } },
      doctor: { include: { user: { select: { name: true } } } },
      clinic: { select: { id: true, clinicName: true } },
      queue: { include: { schedule: true } },
    },
  });
};

export const cancelAppointmentRecord = (id, { cancelReason, cancelledBy }) => {
  return prisma.appointment.update({
    where: { id },
    data: { status: "CANCELLED", cancelReason, cancelledBy },
  });
};

export const getDoctorLeaveForDate = (doctorId, clinicId, date) => {
  return prisma.doctorLeave.findUnique({
    where: { doctorId_clinicId_date: { doctorId, clinicId, date: new Date(date) } },
  });
};

export const countActiveAppointmentsForPatient = (patientId) => {
  return prisma.appointment.count({
    where: { patientId, status: { in: ["WAITING", "CHECKED_IN"] } },
  });
};

export const getPatientRestrictionStatus = (patientId) => {
  return prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true, bookingRestrictedUntil: true },
  });
};

export const setPatientBookingRestriction = (patientId, restrictedUntil) => {
  return prisma.patient.update({
    where: { id: patientId },
    data: { bookingRestrictedUntil: restrictedUntil },
  });
};

// Part 14: the appointment sitting at currentToken is still being
// consulted (CHECKED_IN) until "Next" is pressed again — it has NOT
// finished yet, so it must count as one of the people ahead for every
// patient behind it. Using `gte: currentToken` (not `gt`) includes it, and
// the early-return below only short-circuits when patientToken is at or
// behind currentToken (already passed) — NOT at currentToken + 1, since
// that's exactly the immediate-next patient who DOES have one person
// (whoever's currently being served) ahead of them.
export const countActiveTokensAhead = (queueId, currentToken, patientToken) => {
  if (patientToken <= currentToken) {
    return Promise.resolve(0);
  }

  return prisma.appointment.count({
    where: {
      queueId,
      token: {
        gte: currentToken,
        lt: patientToken,
      },
      status: {
        in: ["WAITING", "CHECKED_IN"],
      },
    },
  });
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