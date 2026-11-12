import ApiError from "../../utils/apiError.js";
import { getIO } from "../../config/socket.config.js";
import * as notificationRepo from "./notification.repository.js";

// 📱 Mobile App Push (Expo)
import { 
  getUserPushTokens, 
  getAllPushTokens, 
  sendExpoPushNotification,
  savePushToken
} from "../../utils/pushNotification.js";

// 💻 Web Browser Push (Chrome, Safari, Edge)
import {
  getWebPushPublicKey,
  saveWebPushSubscription,
  removeWebPushSubscription,
  sendWebPushToUser,
  sendWebPushToAll
} from "../../utils/webPush.js";

// ==========================================
// 🔴 CORE FUNCTION: Notify Single User
// ==========================================
export const notifyUser = async (userId, { type, title, message, meta = {} }) => {
  if (!userId) return null;

  try {
    // 1. Save to Database
    const notification = await notificationRepo.createNotification({
      userId,
      type,
      title,
      message,
      meta,
    });

    // 2. Send Real-time Socket Event (In-App Bell)
    const io = getIO();
    if (io) {
      io.to(userId).emit("newNotification", notification);
    }

    const payloadData = { notificationId: notification.id, ...meta };

    // 3. Send Mobile App Push (Android/iOS via Expo)
    getUserPushTokens(userId).then((mobileTokens) => {
      if (mobileTokens && mobileTokens.length > 0) {
        sendExpoPushNotification(mobileTokens, {
          title: title || "Doctor Contact",
          message: message || "",
          data: payloadData,
        }).catch(() => {});
      }
    }).catch(() => {});

    // 4. Send Web Browser Push (Chrome/Safari)
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

// ==========================================
// 🔴 CORE FUNCTION: Broadcast to All Users
// ==========================================
export const broadcastAnnouncement = async ({ title, message, meta = {}, excludeUserId = null }) => {
  try {
    const payloadData = { type: "ANNOUNCEMENT", ...meta };

    // 1. Send Real-time Socket Event (In-App Bell to everyone online)
    const io = getIO();
    if (io) {
      io.emit("newAnnouncement", { title, message, ...payloadData });
    }

    // 2. Send Mobile App Push (Android/iOS via Expo)
    getAllPushTokens().then((allMobileTokens) => {
      if (allMobileTokens && allMobileTokens.length > 0) {
        sendExpoPushNotification(allMobileTokens, {
          title: title || "Doctor Contact Announcement",
          message: message || "",
          data: payloadData,
        }).catch(() => {});
      }
    }).catch(() => {});

    // 3. Send Web Browser Push (Chrome/Safari)
    sendWebPushToAll({
      title: title || "Doctor Contact Announcement",
      body: message || "",
      url: meta.url || "/",
      tag: "announcement-" + Date.now(),
    }, { excludeUserId }).catch(() => {});

    return true;
  } catch (error) {
    console.error("[Notification] broadcastAnnouncement error:", error.message);
    return false;
  }
};

// ==========================================
// Standard Notification API Services
// ==========================================
export const getMyNotifications = async (userId, { page, limit }) => {
  const [notifications, total] = await Promise.all([
    notificationRepo.findMyNotifications({ userId, page, limit }),
    notificationRepo.countMyNotifications(userId),
  ]);

  return {
    notifications,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getUnreadCount = async (userId) => {
  const count = await notificationRepo.countUnread(userId);
  return { count };
};

export const markNotificationRead = async (userId, notificationId) => {
  const notification = await notificationRepo.findNotificationById(notificationId);
  if (!notification) throw new ApiError(404, "Notification not found");
  if (notification.userId !== userId) {
    throw new ApiError(403, "You do not have permission to read this notification");
  }

  return notificationRepo.markAsRead(notificationId);
};

export const markAllNotificationsRead = async (userId) => {
  return notificationRepo.markAllAsRead(userId);
};

// ==========================================
// Mobile Push Services (Expo)
// ==========================================
export const saveUserPushToken = async (pushToken, userId, meta) => {
  return savePushToken(pushToken, userId, meta);
};

// ==========================================
// Web Push Services (Browser)
// ==========================================
export const getWebPushKey = () => getWebPushPublicKey();

export const subscribeWebPush = (userId, subscription) =>
  saveWebPushSubscription(userId, subscription);

export const unsubscribeWebPush = (userId, endpoint) =>
  removeWebPushSubscription(userId, endpoint);

export const testWebPush = async (userId) => {
  return sendWebPushToUser(userId, {
    title: "Test Successful!",
    body: "Your browser notifications are working perfectly.",
    url: "/",
    tag: "test-" + Date.now(),
  });
};