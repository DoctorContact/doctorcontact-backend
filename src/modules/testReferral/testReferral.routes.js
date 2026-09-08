import { Router } from "express";
import * as referralController from "./testReferral.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";

const router = Router();

router.post(
  "/",
  authMiddleware,
  roleMiddleware("DOCTOR", "RECEPTIONIST", "CLINIC"),
  referralController.createReferral
);

router.get("/me", authMiddleware, roleMiddleware("PATIENT"), referralController.getMyReferrals);

router.get(
  "/incoming",
  authMiddleware,
  roleMiddleware("DIAGNOSTIC_CENTER", "DIAGNOSTIC_STAFF"),
  referralController.getIncomingReferrals
);

router.get(
  "/stats",
  authMiddleware,
  roleMiddleware("DIAGNOSTIC_CENTER", "DIAGNOSTIC_STAFF"),
  referralController.getCenterStats
);

router.get("/sent", authMiddleware, roleMiddleware("CLINIC"), referralController.getSentReferrals);

router.get(
  "/all",
  authMiddleware,
  roleMiddleware("SUPER_ADMIN", "ADMIN"),
  referralController.getAllReferrals
);

router.get(
  "/:id",
  authMiddleware,
  roleMiddleware("PATIENT", "CLINIC", "DIAGNOSTIC_CENTER", "DIAGNOSTIC_STAFF", "ADMIN", "SUPER_ADMIN"),
  referralController.getReferralById
);

router.patch(
  "/:id/status",
  authMiddleware,
  roleMiddleware("DIAGNOSTIC_CENTER", "DIAGNOSTIC_STAFF"),
  referralController.updateReferralStatus
);

export default router;
