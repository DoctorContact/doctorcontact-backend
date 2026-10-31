import { randomUUID } from "crypto";
import ApiError from "../../utils/apiError.js";
import prisma from "../../config/db.config.js";
import {
  createAnnouncement,
  findActiveAnnouncementsForClinic,
  findAllPlatformAnnouncements,
  findAllAnnouncementsForAdmin,
  findAnnouncementById,
  deactivateAnnouncement,
  deleteAnnouncementById,
  updateAnnouncementById,
} from "./announcement.repository.js";
import { findClinicByUserId, findDoctorById } from "../clinic/clinic.repository.js";
import { emitGlobalAnnouncement, emitClinicAnnouncement } from "../../sockets/announcement.socket.js";
import { emitNewNotification } from "../../sockets/notification.socket.js";

const BROADCAST_BATCH_SIZE = 1000;

// 🔔 Saves ONE notification row for EVERY active user (so it shows up in each
// user's inbox even if they were offline) and also pushes it live over
// Socket.io to whoever is online right now.
// Runs in the background — it never blocks or fails the announcement itself.
const broadcastAnnouncementToAllUsers = async (announcement, creatorUserId) => {
  let cursor = null;

  while (true) {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        ...(creatorUserId ? { id: { not: creatorUserId } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: BROADCAST_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (users.length === 0) break;

    const createdAt = new Date();
    const rows = users.map((u) => ({
      id: randomUUID(), // pre-generated so we can emit the exact same row over the socket
      userId: u.id,
      type: "GENERAL",
      title: announcement.title,
      message: announcement.message,
      isRead: false,
      meta: {
        kind: "ANNOUNCEMENT",
        announcementId: announcement.id,
        announcementType: announcement.type,
      },
      createdAt,
    }));

    await prisma.notification.createMany({ data: rows });

    for (const row of rows) {
      try {
        emitNewNotification(row.userId, row);
      } catch (err) {
        // a single failed socket emit must not stop the rest
      }
    }

    cursor = users[users.length - 1].id;
    if (users.length < BROADCAST_BATCH_SIZE) break;
  }
};

export const publishPlatformAnnouncement = async (
  adminUserId,
  { type, title, message }
) => {
  const announcement = await createAnnouncement({
    type,
    title,
    message,
    createdByUserId: adminUserId,
    clinicId: null,
    doctorId: null,
  });

  emitGlobalAnnouncement(announcement);

  // 🔔 Send to every active user's notification inbox (background, non-blocking)
  setImmediate(() => {
    broadcastAnnouncementToAllUsers(announcement, adminUserId).catch((err) =>
      console.error("Announcement broadcast to users failed:", err)
    );
  });

  return announcement;
};

export const publishClinicAnnouncement = async (clinicUserId, { type, title, message, doctorId }) => {
  const clinic = await findClinicByUserId(clinicUserId);
  if (!clinic) throw new ApiError(404, "Clinic profile not found");

  if (doctorId) {
    const doctor = await findDoctorById(doctorId);
    if (!doctor || doctor.clinicId !== clinic.id) {
      throw new ApiError(400, "Doctor does not belong to your clinic");
    }
  }

  const announcement = await createAnnouncement({
    type,
    title,
    message,
    createdByUserId: clinicUserId,
    clinicId: clinic.id,
    doctorId: doctorId || null,
  });

  emitClinicAnnouncement(clinic.id, announcement);
  return announcement;
};

export const listForClinic = async (clinicId, { page, limit }) => {
  return findActiveAnnouncementsForClinic({ clinicId, page, limit });
};

export const listAllPlatform = async ({ page, limit }) => {
  return findAllPlatformAnnouncements({ page, limit });
};

export const deactivate = async (announcementId, requestingUser) => {
  const announcement = await findAnnouncementById(announcementId);
  if (!announcement) throw new ApiError(404, "Announcement not found");

  if (requestingUser.role === "CLINIC") {
    const clinic = await findClinicByUserId(requestingUser.id);
    if (!clinic || announcement.clinicId !== clinic.id) {
      throw new ApiError(403, "You can only deactivate your own clinic's announcements");
    }
  }

  return deactivateAnnouncement(announcementId);
};

export const updatePlatformAnnouncement = async (id, data) => {
  const announcement = await findAnnouncementById(id);
  if (!announcement) throw new ApiError(404, "Announcement not found");

  return await updateAnnouncementById(id, data);
};

export const listAllForAdmin = async () => {
  return await findAllAnnouncementsForAdmin();
};

export const deleteAnnouncement = async (id) => {
  const announcement = await findAnnouncementById(id);
  if (!announcement) throw new ApiError(404, "Announcement not found");

  return await deleteAnnouncementById(id);
};