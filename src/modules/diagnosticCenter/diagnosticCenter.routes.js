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

// PUBLIC lab-details page — genuinely public, no login required at all.
// IMPORTANT: this must stay ABOVE the `router.use(authMiddleware, roleMiddleware(...))`
// line below, otherwise it silently inherits DIAGNOSTIC_CENTER-only access
// (this was exactly the earlier bug: added below that line, so every
// non-diagnostic-center user — including logged-out visitors — got
// 401/403 from role.middleware.js instead of seeing the page).
router.get("/public/:centerId", centerController.getPublicCenterDetails);

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

// Own weekly schedule — drives the public "Available Now / Offline" badge
router.get("/working-hours", centerController.getWorkingHours);
router.put("/working-hours", centerController.updateWorkingHours);

// === NEW: Step 26 Diagnostic Tests Routes ===
router.get("/tests", centerController.getMyTests);
router.post("/tests", centerController.addCenterTest);
router.patch("/tests/:testId", centerController.updateCenterTest);
router.delete("/tests/:testId", centerController.removeCenterTest);

export default router;