import { Router } from "express";
import * as specializationController from "./specialization.controller.js";
import authMiddleware, { optionalAuth } from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";
import upload from "../../middlewares/upload.middleware.js";

const router = Router();

// Public route for homepage. `authMiddleware` is optional here so an
// authenticated admin can additionally pass ?all=true to see inactive entries,
// while anonymous visitors still get the active list.
router.get("/", optionalAuth, specializationController.getAllSpecializations);

// Secure Admin route for adding new categories with image
router.post(
  "/",
  authMiddleware,
  roleMiddleware("SUPER_ADMIN", "ADMIN"),
  upload.single("icon"),
  specializationController.createSpecialization
);

// Secure Admin route for editing / activating / deactivating a specialization
router.patch(
  "/:id",
  authMiddleware,
  roleMiddleware("SUPER_ADMIN", "ADMIN"),
  upload.single("icon"),
  specializationController.updateSpecialization
);

export default router;