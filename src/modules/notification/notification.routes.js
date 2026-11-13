import { Router } from "express";
import * as notificationController from "./notification.controller.js";
import authMiddleware, { optionalAuth } from "../../middlewares/auth.middleware.js";

const router = Router();

router.post("/push-token", optionalAuth, notificationController.registerPushToken);
router.get("/web-push-key", notificationController.getWebPushKey);

router.use(authMiddleware);

router.post("/web-push/subscribe", notificationController.subscribeWebPush);
router.delete("/web-push/subscribe", notificationController.unsubscribeWebPush);

router.get("/me", notificationController.getMyNotifications);
router.get("/unread-count", notificationController.getUnreadCount);
router.patch("/:notificationId/read", notificationController.markRead);
router.patch("/read-all", notificationController.markAllRead);

export default router;