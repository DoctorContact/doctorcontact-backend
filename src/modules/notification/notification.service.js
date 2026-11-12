import ApiError from "../../utils/apiError.js";
import { getIO } from "../../config/socket.config.js";
import * as notificationRepo from "./notification.repository.js";

// Mobile App Push (Expo)
import { 
  getUserPushTokens, 
  getAllPushTokens, 
  sendExpoPushNotification,
  savePushToken
} from "../../utils/pushNotification.js";

// Web Browser Push
import {
  getWebPushPublicKey,
  saveWebPushSubscription,
  removeWebPushSubscription,
  sendWebPushToUser,
  sendWebPushToAll
} from "../../utils/webPush.js";

export const notifyUser = async (userId, { type, title, message, meta = {} }) => {
  if (!userId) return null;
  try {
    // 1. Save to Database
    const notification = await notificationRepo.createNotification({
      userId, type, title, message, meta,
    });

    // 2. Real-time Socket (Web In-App)
    const io = getIO();
    if (io) {
      io.to(userId).emit("newNotification", notification);
    }

    // 3. Mobile Push (App/Expo)
    const mobileTokens = await getUserPushTokens(userId);
    if (mobileTokens && mobileTokens.length > 0) {
      sendExpoPushNotification(mobileTokens, {
        title: title || "Doctor Contact",
        message: message || "",
        data: { notificationId: notification.id, ...meta },
      }).catch(() => {});
    }

    // 4. Web Browser Push
    sendWebPushToUser(userId, {
      title: title || "Doctor Contact",
      body: message || "",
      url: meta.url || "/",
      tag: notification.id,
    }).catch(() => {});

    return notification;
  } catch (error) {
    console.error("[Notification] notifyUser error:", error.message);
    return null;
  }
};

export const broadcastAnnouncementToAllUsers = async ({ title, message, meta = {}, excludeUserId = null }) => {
  try {
    const io = getIO();
    if (io) {
      io.emit("newAnnouncement", { title, message, ...meta });
    }

    const mobileTokens = await getAllPushTokens();
    if (mobileTokens && mobileTokens.length > 0) {
      sendExpoPushNotification(mobileTokens, {
        title: title || "Doctor Contact Announcement",
        message: message || "",
        data: { type: "ANNOUNCEMENT", ...meta },
      }).catch(() => {});
    }

    sendWebPushToAll({
      title: title || "Doctor Contact Announcement",
      body: message || "",
      url: meta.url || "/",
      tag: "announcement-" + Date.now(),
    }, { excludeUserId }).catch(() => {});
    
    return true;
  } catch (err) {
    return false;
  }
};

export const getMyNotifications = async (userId, { page, limit }) => {
  const [notifications, total] = await Promise.all([
    notificationRepo.findMyNotifications({ userId, page, limit }),
    notificationRepo.countMyNotifications(userId),
  ]);
  return {
    notifications,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
};

export const getUnreadCount = async (userId) => {
  const count = await notificationRepo.countUnread(userId);
  return { count };
};

export const markNotificationRead = async (userId, notificationId) => {
  const notification = await notificationRepo.findNotificationById(notificationId);
  if (!notification) throw new ApiError(404, "Notification not found");
  if (notification.userId !== userId) throw new ApiError(403, "Access denied");
  return notificationRepo.markAsRead(notificationId);
};

export const markAllNotificationsRead = async (userId) => {
  return notificationRepo.markAllAsRead(userId);
};

export const saveUserPushToken = async (pushToken, userId, meta) => {
  return savePushToken(pushToken, userId, meta);
};

export const getWebPushKey = () => getWebPushPublicKey();
export const subscribeWebPush = (userId, subscription) => saveWebPushSubscription(userId, subscription);
export const unsubscribeWebPush = (userId, endpoint) => removeWebPushSubscription(userId, endpoint);