import ApiError from "../../utils/apiError.js";
import prisma from "../../config/db.config.js";
import { emitNewNotification } from "../../sockets/notification.socket.js";
import {
  createNotification,
  findMyNotifications,
  countMyNotifications,
  countUnread,
  findNotificationById,
  markAsRead as markAsReadRepo,
  markAllAsRead as markAllAsReadRepo,
} from "./notification.repository.js";
import {
  savePushToken as savePushTokenUtil,
  getUserPushTokens,
  sendExpoPushNotification,
} from "../../utils/pushNotification.js";
import {
  getWebPushPublicKey,
  saveWebPushSubscription,
  removeWebPushSubscription,
  sendWebPushToUser,
} from "../../utils/webPush.js";

export const notifyUser = async ({ userId, type, title, message, meta }) => {
  if (!userId) return null;
  try {
    const notification = await createNotification({ userId, type, title, message, meta });
    emitNewNotification(userId, notification);

    sendWebPushToUser(userId, {
      title: title || "Doctor Contact",
      body: message || "",
      url: "/",
      tag: notification.id,
    }).catch(() => {});

    getUserPushTokens(userId)
      .then((tokens) => {
        if (tokens && tokens.length > 0) {
          return sendExpoPushNotification(tokens, {
            title: title || "Doctor Contact Alert",
            message: message || "",
            data: {
              notificationId: notification.id,
              type: type || "ALERT",
              appointmentId: meta?.appointmentId || undefined,
              announcementId: meta?.announcementId || undefined,
              meta: meta || null,
            },
          });
        }
      })
      .catch((err) => {
        console.warn("[Push] Error delivering user push notification:", err.message);
      });

    return notification;
  } catch (err) {
    console.error("notifyUser failed:", err.message);
    return null;
  }
};

export const saveUserPushToken = async (pushToken, userId = null, metadata = {}) => {
  return savePushTokenUtil(pushToken, userId, metadata);
};

export const getMyNotifications = async (userId, { page = 1, limit = 20 }) => {
  const [items, total, unread] = await Promise.all([
    findMyNotifications({ userId, page, limit }),
    countMyNotifications(userId),
    countUnread(userId),
  ]);
  return { items, total, unread, page, limit };
};

export const getUnreadCount = async (userId) => {
  const count = await countUnread(userId);
  return { count };
};

export const markNotificationRead = async (userId, notificationId) => {
  const notification = await findNotificationById(notificationId);
  if (!notification) throw new ApiError(404, "Notification not found");
  if (notification.userId !== userId) {
    throw new ApiError(403, "This notification does not belong to you");
  }
  return markAsReadRepo(notificationId);
};

export const markAllNotificationsRead = async (userId) => {
  return markAllAsReadRepo(userId);
};

export const notifyAdmins = async ({ type = "ADMIN_ALERT", title, message, meta = null }) => {
  try {
    const admins = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "SUPER_ADMIN"] }, status: "ACTIVE" },
      select: { id: true },
    });
    await Promise.all(
      admins.map((a) =>
        notifyUser({
          userId: a.id,
          type,
          title,
          message,
          meta,
        })
      )
    );
  } catch (err) {
    console.warn("[Push] notifyAdmins failed:", err.message);
  }
};

export const getWebPushKey = () => getWebPushPublicKey();

export const subscribeWebPush = (userId, subscription) =>
  saveWebPushSubscription(userId, subscription);

export const unsubscribeWebPush = (userId, endpoint) =>
  removeWebPushSubscription(userId, endpoint);