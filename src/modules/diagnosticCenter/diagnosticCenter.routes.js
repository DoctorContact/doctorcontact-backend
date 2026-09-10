import { Router } from "express";
import * as centerController from "./diagnosticCenter.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";
import upload from "../../middlewares/upload.middleware.js";

const router = Router();

// === 1. PUBLIC ROUTES (No Auth Required) ===
router.get("/all", centerController.listAllApprovedCenters);
router.get("/public/:id", centerController.getPublicCenterDetails);

// === 2. SUPER ADMIN ROUTES (Must be placed before DIAGNOSTIC_CENTER global middleware) ===
router.post("/admin/global-tests", authMiddleware, roleMiddleware("SUPER_ADMIN"), centerController.adminAddGlobalTest);
router.patch("/admin/global-tests/:id", authMiddleware, roleMiddleware("SUPER_ADMIN"), centerController.adminUpdateGlobalTest);
router.delete("/admin/global-tests/:id", authMiddleware, roleMiddleware("SUPER_ADMIN"), centerController.adminDeleteGlobalTest);

// === 3. GENERAL AUTHENTICATED ROUTES ===
router.get("/search", authMiddleware, centerController.searchByName);
router.get("/global-tests", authMiddleware, centerController.getGlobalTests); 

// === 4. DIAGNOSTIC STAFF ROUTES ===
router.get(
  "/staff/me",
  authMiddleware,
  roleMiddleware("DIAGNOSTIC_STAFF"),
  centerController.getMyStaffProfile
);

// === 5. DIAGNOSTIC CENTER (Lab Manager) ROUTES ===
// 🟢 নিচের লাইনের পর থেকে সবকিছু শুধু ল্যাব ম্যানেজার অ্যাক্সেস পাবে
router.use(authMiddleware, roleMiddleware("DIAGNOSTIC_CENTER"));

router.get("/working-hours", centerController.getCenterWorkingHoursController);
router.put("/working-hours", centerController.updateWorkingHours);

router.get("/profile", centerController.getMyProfile);
router.patch("/profile", centerController.updateMyProfile);

router.post("/staff", centerController.addStaff);
router.get("/staff", centerController.listStaff);
router.patch("/staff/change-password", centerController.changeStaffPassword);

router.post("/logo", upload.single("photo"), centerController.uploadLogo);

router.get("/tests", centerController.getMyTests);
router.post("/tests", centerController.addCenterTest);
router.patch("/tests/:testId", centerController.updateCenterTest);
router.delete("/tests/:testId", centerController.removeCenterTest);

export default router;