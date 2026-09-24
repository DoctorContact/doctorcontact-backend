import { Router } from "express";
import * as centerController from "./diagnosticCenter.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";
import upload from "../../middlewares/upload.middleware.js";

const router = Router();

// ==========================================
// 🟢 PUBLIC ROUTES (লগইন ছাড়াই দেখা যাবে)
// ==========================================
// এখান থেকে authMiddleware সরিয়ে দেওয়া হয়েছে 
router.get("/search", centerController.searchByName);
router.get("/all", centerController.listAllApprovedCenters);
router.get("/public/:id", centerController.getPublicCenterDetails); 
router.get("/global-tests", centerController.getGlobalTests); // ফিল্টার করার জন্য এটিও পাবলিক করা হলো

// ==========================================
// 🔴 PROTECTED ROUTES (লগইন লাগবে)
// ==========================================

// DIAGNOSTIC_STAFF portal: own profile + parent center
router.get(
  "/staff/me",
  authMiddleware,
  roleMiddleware("DIAGNOSTIC_STAFF"),
  centerController.getMyStaffProfile
);

router.use(authMiddleware, roleMiddleware("DIAGNOSTIC_CENTER"));

router.get("/profile", centerController.getMyProfile);
router.patch("/profile", centerController.updateMyProfile);

router.post("/staff", centerController.addStaff);
router.get("/staff", centerController.listStaff);
router.patch("/staff/change-password", centerController.changeStaffPassword);

router.post("/logo", upload.single("photo"), centerController.uploadLogo);

// === NEW: Step 26 Diagnostic Tests Routes ===
router.get("/tests", centerController.getMyTests);
router.post("/tests", centerController.addCenterTest);
router.patch("/tests/:testId", centerController.updateCenterTest);
router.delete("/tests/:testId", centerController.removeCenterTest);

// === NEW: Working Hours Routes ===
router.get("/working-hours", centerController.getWorkingHours);
router.patch("/working-hours", centerController.updateWorkingHours);
router.put("/working-hours", centerController.updateWorkingHours);

export default router;