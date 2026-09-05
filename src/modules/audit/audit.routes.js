import { Router } from "express";
import authMiddleware from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";
import * as auditController from "./audit.controller.js";

const router = Router();

/**
 * @swagger
 * /audit:
 *   get:
 *     summary: List administrative audit log entries (Super Admin only)
 *     tags: [Audit]
 *     parameters:
 *       - in: query
 *         name: targetType
 *         schema: { type: string }
 *       - in: query
 *         name: targetId
 *         schema: { type: string }
 *       - in: query
 *         name: actorUserId
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: List of audit log entries, most recent first
 */
router.get("/", authMiddleware, roleMiddleware("SUPER_ADMIN"), auditController.getAuditLogs);

export default router;
