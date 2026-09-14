import prisma from "../../config/db.config.js";

export const findQueue = (doctorId, clinicId, date) => {
  return prisma.queue.findUnique({
    where: { doctorId_clinicId_date: { doctorId, clinicId, date: new Date(date) } },
  });
};

export const findQueueWithAppointments = (doctorId, clinicId, date) => {
  return prisma.queue.findUnique({
    where: { doctorId_clinicId_date: { doctorId, clinicId, date: new Date(date) } },
    include: {
      appointments: {
        orderBy: { token: "asc" },
        include: {
          patient: {
            select: {
              id: true,
              name: true,
              phone: true,
              user: { select: { name: true, phone: true } },
            },
          },
        },
      },
    },
  });
};

export const updateQueueStatus = (queueId, status) => {
  return prisma.queue.update({ where: { id: queueId }, data: { status } });
};

export const setCurrentToken = (queueId, currentToken) => {
  return prisma.queue.update({ where: { id: queueId }, data: { currentToken } });
};

// FIX: the appointment's real unique constraint is [queueId, token] (see
// prisma/schema.prisma) — a doctorId_clinicId_date_token key does not exist
// on this model at all (queues are scoped per scheduleId, so multiple
// queues/sessions can share a doctor+clinic+date, each restarting token at
// 1). Calling this with the old key would throw a Prisma "unknown argument"
// error the moment it was ever invoked.
export const findAppointmentByToken = (queueId, token) => {
  return prisma.appointment.findUnique({
    where: { queueId_token: { queueId, token } },
    include: { patient: true },
  });
};

export const updateAppointmentStatus = (id, status) => {
  return prisma.appointment.update({ where: { id }, data: { status } });
};

export const findReceptionistAssignment = (userId, doctorId, clinicId) => {
  return prisma.receptionist.findFirst({
    where: {
      userId,
      assignedDoctors: { some: { doctorId, clinicId } },
    },
  });
};

export const createEmergencyAppointment = (doctorId, clinicId, queueId, date, patientId) => {
  return prisma.$transaction(async (tx) => {
    const queue = await tx.queue.update({
      where: { id: queueId },
      data: { lastTokenIssued: { increment: 1 } },
    });

    const appointment = await tx.appointment.create({
      data: {
        doctorId,
        clinicId,
        patientId,
        queueId,
        date: new Date(date),
        token: queue.lastTokenIssued,
        bookingSource: "RECEPTION",
        isEmergency: true,
      },
    });

    return { appointment, queue };
  });
};

export const logQueueAction = (queueId, action, performedBy, meta = {}) => {
  return prisma.queueLog.create({
    data: { queueId, action, performedBy, meta },
  });
};