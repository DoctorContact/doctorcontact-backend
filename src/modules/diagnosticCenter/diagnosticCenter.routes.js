import { Router } from "express";
import * as centerController from "./diagnosticCenter.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";
import upload from "../../middlewares/upload.middleware.js";

const router = Router();

// Any authenticated user can browse/search diagnostic centers and view global tests
router.get("/search", authMiddleware, centerController.searchByName);
router.get("/all", authMiddleware, centerController.listAllApprovedCenters);
router.get("/global-tests", authMiddleware, centerController.getGlobalTests); // NEW

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

// Working hours (matches the existing frontend contract — PUT + `hours`)
router.put("/working-hours", centerController.setWorkingHours);
router.get("/working-hours", centerController.getWorkingHours);

export default router;