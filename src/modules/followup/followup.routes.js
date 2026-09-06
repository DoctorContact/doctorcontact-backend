import { Router } from "express";
import authMiddleware from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";
import * as followupController from "./followup.controller.js";

const router = Router();

router.use(authMiddleware);

/**
 * @swagger
 * /followups:
 *   post:
 *     summary: Schedule a follow-up visit for a patient (Doctor/Clinic/Receptionist/Admin)
 *     tags: [Followup]
 */
router.post(
  "/",
  roleMiddleware("DOCTOR", "CLINIC", "RECEPTIONIST", "SUPER_ADMIN", "ADMIN"),
  followupController.scheduleFollowup
);

/**
 * @swagger
 * /followups/me:
 *   get:
 *     summary: The logged-in patient's own follow-ups
 *     tags: [Followup]
 */
router.get("/me", roleMiddleware("PATIENT"), followupController.getMyFollowups);

/**
 * @swagger
 * /followups/clinic/{clinicId}:
 *   get:
 *     summary: All follow-ups this clinic has scheduled (optionally filtered by doctor/status)
 *     tags: [Followup]
 */
router.get(
  "/clinic/:clinicId",
  roleMiddleware("DOCTOR", "CLINIC", "RECEPTIONIST", "SUPER_ADMIN", "ADMIN"),
  followupController.getClinicFollowups
);

router.patch(
  "/:followupId/cancel",
  roleMiddleware("DOCTOR", "CLINIC", "RECEPTIONIST", "SUPER_ADMIN", "ADMIN"),
  followupController.cancelFollowup
);

router.patch(
  "/:followupId/complete",
  roleMiddleware("DOCTOR", "CLINIC", "RECEPTIONIST", "SUPER_ADMIN", "ADMIN"),
  followupController.completeFollowup
);

export default router;
