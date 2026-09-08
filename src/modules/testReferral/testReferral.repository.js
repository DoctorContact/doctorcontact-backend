import prisma from "../../config/db.config.js";

const patientSelect = {
  name: true,
  address: true,
  user: { select: { name: true, phone: true, email: true } },
  phone: true,
};

export const createReferral = (data) => {
  return prisma.testReferral.create({
    data,
    include: {
      patient: { select: patientSelect },
      referringClinic: { select: { clinicName: true } },
      diagnosticCenter: { select: { centerName: true, userId: true } },
    },
  });
};

export const findReferralById = (id) => {
  return prisma.testReferral.findUnique({
    where: { id },
    include: {
      patient: { select: { userId: true, ...patientSelect } },
      referringClinic: { select: { clinicName: true, userId: true } },
      diagnosticCenter: { select: { centerName: true, userId: true } },
    },
  });
};

export const updateReferral = (id, data) => {
  return prisma.testReferral.update({
    where: { id },
    data,
    include: {
      patient: { select: { userId: true, ...patientSelect } },
      referringClinic: { select: { clinicName: true } },
      diagnosticCenter: { select: { centerName: true } },
    },
  });
};

export const findReferralsForPatient = ({ patientId, page, limit }) => {
  return prisma.testReferral.findMany({
    where: { patientId },
    include: {
      referringClinic: { select: { clinicName: true } },
      diagnosticCenter: { select: { centerName: true } },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
  });
};

export const findReferralsForDiagnosticCenter = ({ diagnosticCenterId, page, limit, status }) => {
  return prisma.testReferral.findMany({
    where: { diagnosticCenterId, ...(status && { status }) },
    include: {
      patient: { select: patientSelect },
      referringClinic: { select: { clinicName: true } },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
  });
};

export const countReferralsForDiagnosticCenter = async (diagnosticCenterId) => {
  const rows = await prisma.testReferral.groupBy({
    by: ["status"],
    where: { diagnosticCenterId },
    _count: { _all: true },
  });
  const counts = { PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0, TOTAL: 0 };
  for (const r of rows) {
    counts[r.status] = r._count._all;
    counts.TOTAL += r._count._all;
  }
  return counts;
};

export const findReferralsForClinic = ({ clinicId, page, limit }) => {
  return prisma.testReferral.findMany({
    where: { referringClinicId: clinicId },
    include: {
      patient: { select: patientSelect },
      diagnosticCenter: { select: { centerName: true } },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
  });
};

export const findAllReferrals = ({ page, limit }) => {
  return prisma.testReferral.findMany({
    include: {
      patient: { select: patientSelect },
      referringClinic: { select: { clinicName: true } },
      diagnosticCenter: { select: { centerName: true } },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
  });
};

export const getPatientByUserId = (userId) => {
  return prisma.patient.findUnique({ where: { userId } });
};

export const getPatientById = (id) => {
  return prisma.patient.findUnique({ where: { id } });
};

export const getDiagnosticCenterById = (id) => {
  return prisma.diagnosticCenter.findUnique({ where: { id } });
};

export const getDoctorByUserId = (userId) => {
  return prisma.doctor.findUnique({ where: { userId } });
};

export const getClinicByUserId = (userId) => {
  return prisma.clinic.findUnique({ where: { userId } });
};

export const getReceptionistByUserId = (userId) => {
  return prisma.receptionist.findUnique({ where: { userId } });
};

export const getDiagnosticStaffByUserId = (userId) => {
  return prisma.diagnosticCenterStaff.findUnique({ where: { userId } });
};