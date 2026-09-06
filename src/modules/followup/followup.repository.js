import prisma from "../../config/db.config.js";

export const createFollowup = (data) => prisma.followup.create({ data });

export const findFollowupById = (id) =>
  prisma.followup.findUnique({
    where: { id },
    include: {
      patient: { include: { user: { select: { id: true, name: true, phone: true } } } },
      doctor: { include: { user: { select: { name: true } } } },
      clinic: { select: { id: true, clinicName: true } },
    },
  });

// "kake kake follow-up diyeche" — everyone this clinic (optionally scoped to
// one doctor) has scheduled a follow-up for, most recent first.
export const listFollowupsForClinic = (clinicId, { doctorId, status, upcomingOnly } = {}) =>
  prisma.followup.findMany({
    where: {
      clinicId,
      ...(doctorId && { doctorId }),
      ...(status && { status }),
      ...(upcomingOnly && { followUpDate: { gte: new Date(new Date().toDateString()) } }),
    },
    include: {
      patient: { include: { user: { select: { name: true, phone: true } } } },
      doctor: { include: { user: { select: { name: true } } } },
    },
    orderBy: { followUpDate: "asc" },
  });

export const listFollowupsForPatient = (patientId) =>
  prisma.followup.findMany({
    where: { patientId },
    include: { doctor: { include: { user: { select: { name: true } } } }, clinic: { select: { clinicName: true } } },
    orderBy: { followUpDate: "desc" },
  });

export const updateFollowupStatus = (id, status) =>
  prisma.followup.update({ where: { id }, data: { status } });

// Used by the daily reminder job — today's SCHEDULED follow-ups that haven't
// already had a reminder sent (so a job restart/retry never double-notifies).
export const findDueFollowupsForReminder = (dateOnly) =>
  prisma.followup.findMany({
    where: { followUpDate: dateOnly, status: "SCHEDULED", reminderSentAt: null },
    include: {
      patient: { select: { userId: true, name: true } },
      doctor: { include: { user: { select: { name: true } } } },
      clinic: { select: { clinicName: true } },
    },
  });

export const markReminderSent = (id) =>
  prisma.followup.update({ where: { id }, data: { reminderSentAt: new Date() } });
