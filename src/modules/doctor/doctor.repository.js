import prisma from "../../config/db.config.js";
import { getTodayISTDate, evaluateDoctorStatus } from "./doctor.helper.js";

export const searchDoctorsByName = (name) => {
  return prisma.doctor.findMany({
    where: {
      isVerified: true,
      user: { name: { contains: name, mode: "insensitive" } },
    },
    include: {
      user: { select: { name: true, email: true } },
      clinic: { select: { clinicName: true, city: true } },
    },
    orderBy: [{ isFeatured: "desc" }, { featuredOrder: "asc" }],
  });
};

export const findDoctorByIdWithUser = (id) => {
  return prisma.doctor.findUnique({
    where: { id },
    include: { user: true },
  });
};

// Any APPROVED association for this doctor, across all clinics — used for conflict checking
export const findApprovedAssociationsForDoctor = (doctorId) => {
  return prisma.doctorClinicAssociation.findMany({
    where: { doctorId, status: "APPROVED" },
  });
};

export const createAssociationRequest = (data) => {
  return prisma.doctorClinicAssociation.create({
    data,
    include: {
      doctor: { include: { user: { select: { name: true } } } },
      clinic: { select: { clinicName: true } },
    },
  });
};

export const findAssociationById = (id) => {
  return prisma.doctorClinicAssociation.findUnique({ where: { id } });
};

export const updateAssociationStatus = (id, status) => {
  return prisma.doctorClinicAssociation.update({ where: { id }, data: { status } });
};

export const findRequestsForDoctor = (doctorId) => {
  return prisma.doctorClinicAssociation.findMany({
    where: { doctorId },
    include: { clinic: { select: { clinicName: true, city: true, logo: true } } },
    orderBy: { createdAt: "desc" },
  });
};

export const findRequestsForClinic = (clinicId) => {
  return prisma.doctorClinicAssociation.findMany({
    where: { clinicId },
    include: {
      doctor: { include: { user: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
};
export const findDoctorByUserId = (userId) => {
  return prisma.doctor.findUnique({
    where: { userId },
    include: { user: true },
  });
};

export const createClinicRequestFromDoctor = (data) => {
  return prisma.doctorClinicAssociation.create({
    data,
    include: {
      doctor: { include: { user: { select: { name: true } } } },
      clinic: { select: { clinicName: true } },
    },
  });
};

export const updateDoctorProfilePhoto = (doctorId, profilePhoto) => {
  return prisma.doctor.update({ where: { id: doctorId }, data: { profilePhoto } });
};

export const updateDoctorAvgConsultation = (doctorId, minutes) => {
  return prisma.doctor.update({ where: { id: doctorId }, data: { avgConsultationMinutes: minutes } });
};

export const findApprovedAssociationByDoctorAndClinic = (doctorId, clinicId) => {
  return prisma.doctorClinicAssociation.findFirst({ where: { doctorId, clinicId, status: "APPROVED" } });
};

export const updateAssociationAvgConsultation = (associationId, minutes) => {
  return prisma.doctorClinicAssociation.update({
    where: { id: associationId },
    data: { avgConsultationMinutes: minutes },
  });
};

export const createDoctorLeave = (doctorId, clinicId, date, reason) => {
  return prisma.doctorLeave.create({
    data: { doctorId, clinicId, date: new Date(date), reason },
  });
};

export const removeDoctorLeave = (doctorId, clinicId, date) => {
  return prisma.doctorLeave.deleteMany({
    where: { doctorId, clinicId, date: new Date(date) },
  });
};

export const findLeaveForDate = (doctorId, clinicId, date) => {
  return prisma.doctorLeave.findUnique({
    where: { doctorId_clinicId_date: { doctorId, clinicId, date: new Date(date) } },
  });
};

export const findUpcomingLeaves = (doctorId, clinicId) => {
  return prisma.doctorLeave.findMany({
    where: { doctorId, clinicId, date: { gte: new Date(new Date().toISOString().split("T")[0]) } },
    orderBy: { date: "asc" },
  });
};


export const getDoctorByIdWithClinic = async (doctorId) => {
  return await prisma.doctor.findUnique({
    where: { id: doctorId },
    include: { clinic: true }
  });
};

export const updateDoctorDetails = async (doctorId, data) => {
  return await prisma.doctor.update({
    where: { id: doctorId },
    data
  });
};

// === NEW: Doctor Schedule Database Operations ===
export const createDoctorSchedule = (data) => prisma.doctorSchedule.create({ data });

export const updateDoctorSchedule = (id, data) => prisma.doctorSchedule.update({
  where: { id },
  data
});

export const deleteDoctorSchedule = (id) => prisma.doctorSchedule.delete({
  where: { id }
});

export const findDoctorSchedules = (doctorId, clinicId) => prisma.doctorSchedule.findMany({
  where: { doctorId, clinicId },
  orderBy: { startTime: 'asc' }
});

export const findDoctorScheduleById = (id) => prisma.doctorSchedule.findUnique({
  where: { id }
});

// === Doctor Daily Operational Status (Step 40) ===
export const upsertDoctorDailyStatus = (doctorId, clinicId, date, data) =>
  prisma.doctorDailyStatus.upsert({
    where: { doctorId_clinicId_date: { doctorId, clinicId, date: new Date(date) } },
    create: { doctorId, clinicId, date: new Date(date), ...data },
    update: data,
  });

export const getDoctorDailyStatus = (doctorId, clinicId, date) =>
  prisma.doctorDailyStatus.findUnique({
    where: { doctorId_clinicId_date: { doctorId, clinicId, date: new Date(date) } },
  });

// === Schedule Exceptions (Step 13) ===
export const upsertScheduleException = (scheduleId, date, data) =>
  prisma.scheduleException.upsert({
    where: { scheduleId_date: { scheduleId, date: new Date(date) } },
    create: { scheduleId, date: new Date(date), ...data },
    update: data,
  });

export const listScheduleExceptions = (scheduleId) =>
  prisma.scheduleException.findMany({
    where: { scheduleId },
    orderBy: { date: "asc" },
  });

export const deleteScheduleException = (id) => prisma.scheduleException.delete({ where: { id } });

export const listExceptionsForSchedulesOnDate = (scheduleIds, date) =>
  prisma.scheduleException.findMany({
    where: { scheduleId: { in: scheduleIds }, date: new Date(date) },
  });

const getDoctorIncludeForStatus = (todayDate) => ({
  user: { select: { name: true, email: true, avatar: true } },
  clinic: {
    select: { 
      clinicName: true, 
      address: true, 
      city: true, 
      isAvailableToday: true,
      // FIXED: Moved inside 'select' instead of using 'include'
      holidays: { where: { date: todayDate } } 
    },
  },
  schedules: {
    where: { isActive: true },
    include: { exceptions: { where: { date: todayDate } } },
  },
  leaves: { where: { date: todayDate } },
  dailyStatuses: { where: { date: todayDate } },
  appointments: {
    where: {
      date: todayDate,
      status: { in: ["WAITING", "CHECKED_IN"] },
    },
    select: { id: true, status: true, queue: { select: { scheduleId: true } } },
  },
});

const mapDoctorStatus = (doctor) => {
  const status = evaluateDoctorStatus(doctor);
  // Clean up heavy arrays before sending to frontend
  delete doctor.schedules;
  delete doctor.leaves;
  delete doctor.appointments;
  return { ...doctor, liveStatus: status };
};

export const getAllVerifiedDoctors = async () => {
  const todayDate = getTodayISTDate();
  const doctors = await prisma.doctor.findMany({
    where: { isVerified: true },
    include: getDoctorIncludeForStatus(todayDate),
  });
  return doctors.map(mapDoctorStatus);
};

export const getFeaturedDoctors = async () => {
  const todayDate = getTodayISTDate();
  const doctors = await prisma.doctor.findMany({
    where: { isVerified: true, isFeatured: true },
    orderBy: { featuredOrder: "asc" },
    include: getDoctorIncludeForStatus(todayDate),
  });
  return doctors.map(mapDoctorStatus);
};

export const getAvailableDoctors = async () => {
  const todayDate = getTodayISTDate();
  const doctors = await prisma.doctor.findMany({
    where: { isVerified: true },
    include: getDoctorIncludeForStatus(todayDate),
  });

  return doctors
    .map(mapDoctorStatus)
    // Filter strictly by the backend-calculated isAvailable flag
    .filter((doc) => doc.liveStatus.isAvailable);
};

// === NEW: Step 29 Advanced Search ===
export const searchDoctorsAdvancedDB = async ({ query, specializationId, city, maxFee }) => {
  const todayDate = getTodayISTDate();

  // Build dynamic WHERE clause
  const whereClause = {
    isVerified: true,
  };

  if (query) {
    whereClause.OR = [
      { user: { name: { contains: query, mode: "insensitive" } } },
      { clinic: { clinicName: { contains: query, mode: "insensitive" } } }
    ];
  }

  if (specializationId) {
    whereClause.specializations = {
      some: { specializationId }
    };
  }

  if (city) {
    whereClause.clinic = {
      city: { equals: city, mode: "insensitive" }
    };
  }

  if (maxFee !== undefined) {
    whereClause.fee = { lte: maxFee };
  }

  return prisma.doctor.findMany({
    where: whereClause,
    include: getDoctorIncludeForStatus(todayDate),
    orderBy: [{ isFeatured: "desc" }, { featuredOrder: "asc" }],
  });
};