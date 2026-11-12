import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/apiResponse.js";
import * as notificationService from "./notification.service.js";
import { listNotificationsQuerySchema } from "./notification.validation.js";

export const getMyNotifications = asyncHandler(async (req, res) => {
  const query = listNotificationsQuerySchema.parse(req.query);
  const result = await notificationService.getMyNotifications(req.user.id, query);
  res.status(200).json(new ApiResponse(true, "Notifications fetched", result));
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const result = await notificationService.getUnreadCount(req.user.id);
  res.status(200).json(new ApiResponse(true, "Unread count fetched", result));
});

export const markRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markNotificationRead(req.user.id, req.params.notificationId);
  res.status(200).json(new ApiResponse(true, "Notification marked as read", { notification }));
});

export const markAllRead = asyncHandler(async (req, res) => {
  await notificationService.markAllNotificationsRead(req.user.id);
  res.status(200).json(new ApiResponse(true, "All notifications marked as read", null));
});

export const registerPushToken = asyncHandler(async (req, res) => {
  const { pushToken, platform, deviceId } = req.body || {};
  if (!pushToken) return res.status(400).json(new ApiResponse(false, "pushToken is required", null));
  await notificationService.saveUserPushToken(pushToken, req.user?.id || null, { platform: platform || "android", deviceId: deviceId || null });
  res.status(200).json(new ApiResponse(true, "Push token registered successfully", null));
});

export const getWebPushKey = asyncHandler(async (req, res) => {
  const publicKey = notificationService.getWebPushKey();
  if (!publicKey) return res.status(503).json(new ApiResponse(false, "Browser push is not configured", null));
  res.status(200).json(new ApiResponse(true, "Web push key", { publicKey }));
});

export const subscribeWebPush = asyncHandler(async (req, res) => {
  const ok = await notificationService.subscribeWebPush(req.user.id, req.body?.subscription);
  if (!ok) return res.status(400).json(new ApiResponse(false, "Invalid push subscription", null));
  res.status(200).json(new ApiResponse(true, "Browser notifications enabled", null));
});

export const unsubscribeWebPush = asyncHandler(async (req, res) => {
  await notificationService.unsubscribeWebPush(req.user.id, req.body?.endpoint);
  res.status(200).json(new ApiResponse(true, "Browser notifications disabled", null));
});