import { Router } from "express";
import * as notificationController from "./notification.controller.js";
import authMiddleware, { optionalAuth } from "../../middlewares/auth.middleware.js";

const router = Router();

/**
 * @swagger
 * /notifications/push-token:
 *   post:
 *     summary: Register Expo Push Token for mobile device
 *     description: Stores the device Expo Push Token to deliver push alerts to the mobile notification bar even when app is closed.
 *     tags: [Notifications]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pushToken]
 *             properties:
 *               pushToken:
 *                 type: string
 *                 example: ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]
 *     responses:
 *       200: { description: Push token registered }
 */
router.post("/push-token", optionalAuth, notificationController.registerPushToken);

router.use(authMiddleware);

/**
 * @swagger
 * tags:
 *   name: Notifications
 *   description: 🚀 Real-time User Alert & Notification Management System
 */

/**
 * @swagger
 * /notifications/me:
 *   get:
 *     summary: Retrieve personalized user notifications
 *     description: Fetches a chronologically ordered list of real-time alerts and updates for the authenticated user.
 *     tags: [Notifications]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: Notifications fetched successfully }
 */
router.get("/me", notificationController.getMyNotifications);

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     summary: Get unread notification count
 *     description: Returns the total number of unread notifications for displaying on the bell icon badge.
 *     tags: [Notifications]
 *     responses:
 *       200: { description: Unread count fetched }
 */
router.get("/unread-count", notificationController.getUnreadCount);

/**
 * @swagger
 * /notifications/{notificationId}/read:
 *   patch:
 *     summary: Mark a single notification as read
 *     tags: [Notifications]
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Notification marked as read }
 *       403: { description: This notification does not belong to you }
 *       404: { description: Notification not found }
 */
router.patch("/:notificationId/read", notificationController.markRead);

/**
 * @swagger
 * /notifications/read-all:
 *   patch:
 *     summary: Mark all notifications as read
 *     tags: [Notifications]
 *     responses:
 *       200: { description: All notifications marked as read }
 */
router.patch("/read-all", notificationController.markAllRead);

export default router;