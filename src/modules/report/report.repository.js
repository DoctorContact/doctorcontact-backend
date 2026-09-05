import prisma from "../../config/db.config.js";

// Helper function to build dynamic WHERE clause
const buildWhereClause = (clinicId, dateFilter, doctorId) => {
  const where = { clinicId, ...dateFilter };
  if (doctorId) {
    where.doctorId = doctorId; // Filter for specific doctor if provided
  }
  return where;
};

// Common include for all reports to get Doctor & Patient details
const includeDetails = {
  doctor: { include: { user: { select: { name: true } } } },
  patient: { include: { user: { select: { name: true, phone: true } } } },
};

export const getAppointmentsForClinicOnDate = (clinicId, date, doctorId = null) => {
  return prisma.appointment.findMany({
    where: buildWhereClause(clinicId, { date: new Date(date) }, doctorId),
    include: includeDetails,
  });
};

export const getAppointmentsForClinicInMonth = (clinicId, startDate, endDate, doctorId = null) => {
  return prisma.appointment.findMany({
    where: buildWhereClause(clinicId, { date: { gte: startDate, lte: endDate } }, doctorId),
    include: includeDetails,
  });
};

export const getAppointmentsForClinicInRange = (clinicId, startDate, endDate, doctorId = null) => {
  return prisma.appointment.findMany({
    where: buildWhereClause(clinicId, { date: { gte: startDate, lte: endDate } }, doctorId),
    include: includeDetails,
  });
};

export const getDistinctPatientsForClinic = async (clinicId) => {
  const appointments = await prisma.appointment.findMany({
    where: { clinicId },
    distinct: ["patientId"],
    include: includeDetails,
  });

  return appointments.map((appt) => ({
    name: appt.patient?.user?.name || appt.patient?.name,
    phone: appt.patient?.user?.phone || appt.patient?.phone,
  }));
};

export const getDistinctPatientsForDoctorAtClinic = async (doctorId, clinicId, date) => {
  const appointments = await prisma.appointment.findMany({
    where: { doctorId, clinicId, date: new Date(date) },
    distinct: ["patientId"],
    include: includeDetails,
  });

  return appointments.map((appt) => ({
    name: appt.patient?.user?.name || appt.patient?.name,
    dob: appt.patient?.dob,
    phone: appt.patient?.user?.phone || appt.patient?.phone,
  }));
};