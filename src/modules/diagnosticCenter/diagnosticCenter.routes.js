import { Router } from "express";
import * as centerController from "./diagnosticCenter.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";
import upload from "../../middlewares/upload.middleware.js";

const router = Router();

// ==========================================
// 🟢 PUBLIC ROUTES (লগইন ছাড়াই দেখা যাবে)
// ==========================================
router.get("/search", centerController.searchByName);
router.get("/all", centerController.listAllApprovedCenters);
router.get("/public/:id", centerController.getPublicCenterDetails); 
router.get("/global-tests", centerController.getGlobalTests); 

// ==========================================
// 🔴 ADMIN & SUPER_ADMIN ROUTES (Global Tests)
// ==========================================
router.post("/admin/global-tests", authMiddleware, roleMiddleware("ADMIN", "SUPER_ADMIN"), centerController.addGlobalTest);
router.patch("/admin/global-tests/:id", authMiddleware, roleMiddleware("ADMIN", "SUPER_ADMIN"), centerController.updateGlobalTest);
router.delete("/admin/global-tests/:id", authMiddleware, roleMiddleware("ADMIN", "SUPER_ADMIN"), centerController.deleteGlobalTest);

// ==========================================
// 🔴 DIAGNOSTIC STAFF PORTAL
// ==========================================
router.get("/staff/me", authMiddleware, roleMiddleware("DIAGNOSTIC_STAFF"), centerController.getMyStaffProfile);

// ==========================================
// 🔴 DIAGNOSTIC CENTER ROUTES
// ==========================================
router.use(authMiddleware, roleMiddleware("DIAGNOSTIC_CENTER"));

router.get("/profile", centerController.getMyProfile);
router.patch("/profile", centerController.updateMyProfile);

router.post("/staff", centerController.addStaff);
router.get("/staff", centerController.listStaff);
router.patch("/staff/change-password", centerController.changeStaffPassword);

router.post("/logo", upload.single("photo"), centerController.uploadLogo);

// === Diagnostic Tests Routes (For Centers) ===
router.get("/tests", centerController.getMyTests);
router.post("/tests", centerController.addCenterTest);
router.patch("/tests/:testId", centerController.updateCenterTest);
router.delete("/tests/:testId", centerController.removeCenterTest);

// === Working Hours Routes ===
router.get("/working-hours", centerController.getWorkingHours);
router.patch("/working-hours", centerController.updateWorkingHours);
router.put("/working-hours", centerController.updateWorkingHours);

export default router;