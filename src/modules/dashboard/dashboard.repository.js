import prisma from "../../config/db.config.js";

export const getDoctorPrimaryClinicStats = async (doctorId) => {
  const totalPatients = await prisma.appointment.findMany({
    where: { doctorId },
    distinct: ["patientId"],
    select: { patientId: true },
  });

  return totalPatients.length;
};

export const getDoctorTodayAppointments = (doctorId, date) => {
  return prisma.appointment.findMany({
    where: { doctorId, date: new Date(date) },
    include: {
      patient: { select: { name: true, user: { select: { name: true } } } },
    },
    orderBy: { token: "asc" },
  });
};

export const getDoctorApprovedAssociations = (doctorId) => {
  return prisma.doctorClinicAssociation.findMany({
    where: { doctorId, status: "APPROVED" },
    include: { clinic: { select: { clinicName: true, city: true, logo: true } } },
  });
};

export const getDoctorPendingAssociations = (doctorId) => {
  return prisma.doctorClinicAssociation.findMany({
    where: { doctorId, status: "PENDING" },
    include: { clinic: { select: { clinicName: true, city: true, logo: true } } },
  });
};

export const getClinicTotalAndActiveDoctors = async (clinicId) => {
  const doctors = await prisma.doctor.findMany({
    where: { clinicId },
    include: { user: { select: { isActive: true } } },
  });

  const total = doctors.length;
  const active = doctors.filter((d) => d.user.isActive).length;

  return { total, active };
};

export const getClinicAssociationCounts = async (clinicId) => {
  const [pending, approved, rejected] = await Promise.all([
    prisma.doctorClinicAssociation.count({ where: { clinicId, status: "PENDING" } }),
    prisma.doctorClinicAssociation.count({ where: { clinicId, status: "APPROVED" } }),
    prisma.doctorClinicAssociation.count({ where: { clinicId, status: "REJECTED" } }),
  ]);

  return { pending, approved, rejected };
};

export const getClinicTodayAppointments = (clinicId, date) => {
  return prisma.appointment.findMany({
    where: {
      date: new Date(date),
      doctor: { clinicId },
    },
    include: {
      doctor: { include: { user: { select: { name: true } } } },
      patient: { select: { name: true, user: { select: { name: true } } } },
    },
  });
};

export const getClinicQueueSummary = (clinicId, date) => {
  return prisma.queue.findMany({
    where: {
      date: new Date(date),
      doctor: { clinicId },
    },
    include: { doctor: { include: { user: { select: { name: true } } } } },
  });
};