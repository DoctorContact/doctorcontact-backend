import prisma from "../../config/db.config.js";
import ApiError from "../../utils/apiError.js";

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

  // Single search-box mode: match doctor name, specialization, qualification,
  // clinic name, city, or address — whichever field the text matches.
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
        const queue = await prisma.queue.findUnique({
          where: {
            doctorId_clinicId_date: { doctorId: doctor.id, clinicId: doctor.clinicId, date: new Date(date) },
          },
        });
        return { ...doctor, todayQueue: queue || null };
      })
    );
    return doctorsWithQueue;
  }

  return doctors;
};

// Returns every clinic a doctor can currently be booked at: their primary clinic
// plus any clinic where they have an APPROVED association.
export const getBookableClinicsForDoctor = async (doctorId) => {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) return [];

  const approvedAssociations = await prisma.doctorClinicAssociation.findMany({
    where: { doctorId, status: "APPROVED" },
  });

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
      scheduleId, // Bind Queue to specific session
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

// Rule: a patient shouldn't end up with two active appointments too close
// together in time on the same day — whether that's the same doctor twice,
// or two different doctors whose sessions overlap/nearly-overlap. Returns
// the conflicting appointment (with its schedule + doctor name) if one
// exists, so the caller can give a clear error.
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

export const createAppointmentWithToken = async ({ doctorId, clinicId, patientId, queueId, scheduleId, date, bookingSource }) => {
  // Use a Serializable transaction to ensure capacity is strictly enforced (Rule 22)
  return prisma.$transaction(async (tx) => {
    const queue = await tx.queue.findUnique({
      where: { id: queueId },
      include: { schedule: true } // Bring in schedule to check maxPatients
    });

    if (!queue) throw new ApiError(404, "Queue not found");
    if (queue.status === "CLOSED") throw new ApiError(400, "Queue is closed for this session");

    // === CAPACITY CHECK (STEP 6) ===
    const schedule = queue.schedule;
    if (!schedule) throw new ApiError(500, "Queue is missing schedule attachment");

    // A one-off exception for THIS date can override the recurring maxPatients
    // (Step 13) — check it inside the same transaction so it's as safe against
    // races as the count below.
    const exception = await tx.scheduleException.findUnique({
      where: { scheduleId_date: { scheduleId: schedule.id, date: new Date(date) } },
    });
    if (exception?.isCancelled) {
      throw new ApiError(400, "This session has been cancelled for this date");
    }

    // Default capacity is 20 if somehow missing
    const maxCapacity = exception?.overrideMaxPatients ?? schedule.maxPatients ?? 20;

    // Count currently ACTIVE appointments in this queue
    const activeAppointmentsCount = await tx.appointment.count({
      where: {
        queueId,
        status: { in: ["WAITING", "CHECKED_IN"] } // Cancelled/Completed don't consume future booking space
      }
    });

    if (activeAppointmentsCount >= maxCapacity) {
      throw new ApiError(409, `This session is full (Capacity: ${maxCapacity}/${maxCapacity}). Please select another session.`);
    }

    // === QUEUE/SERIAL GENERATION (STEP 11) ===
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

    return { appointment, queue: updatedQueue };
  }, { isolationLevel: 'Serializable' }); // Strict protection against concurrent bookings
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

// stop queeue system if not need
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

