import { Router } from "express";
import * as adminController from "./admin.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";
import upload from "../../middlewares/upload.middleware.js";

const router = Router();

router.use(authMiddleware, roleMiddleware("SUPER_ADMIN", "ADMIN"));

router.get("/stats", adminController.getStats);

router.get("/otp-balance", roleMiddleware("SUPER_ADMIN"), adminController.checkOtpBalance);

router.get("/clinics", adminController.listClinics);
router.patch("/clinics/:clinicId/approve", adminController.approveClinic);
router.patch("/clinics/:clinicId/revoke", adminController.revokeClinicApproval);

router.get("/doctors", adminController.listAllDoctors);
router.get("/doctors/unverified", adminController.listUnverifiedDoctors);
router.get("/doctors/featured", adminController.listFeaturedDoctors);
router.post("/doctors", adminController.createDoctor);
router.patch("/doctors/:doctorId/verify", adminController.verifyDoctor);
router.patch("/doctors/:doctorId/unverify", adminController.unverifyDoctor);
router.patch("/doctors/:doctorId/featured", adminController.setFeaturedDoctor);
router.delete("/doctors/:doctorId", adminController.deleteDoctor);

router.get("/users", adminController.listUsers);
router.patch("/users/:userId/status", adminController.toggleUserStatus);

router.get("/settings", roleMiddleware("SUPER_ADMIN"), adminController.getSettings);
router.patch("/settings", roleMiddleware("SUPER_ADMIN"), adminController.updateSettings);

router.post("/clinics", upload.single("logo"), adminController.createClinic);
router.get("/bookings", roleMiddleware("SUPER_ADMIN"), adminController.listBookings);

router.post("/diagnostic-centers", adminController.createDiagnosticCenter);
router.get("/diagnostic-centers", adminController.listDiagnosticCenters);
router.patch("/diagnostic-centers/:centerId/approve", adminController.approveDiagnosticCenter);
router.patch("/diagnostic-centers/:centerId/revoke", adminController.revokeDiagnosticCenter);

router.patch("/clinics/:clinicId", authMiddleware, roleMiddleware("SUPER_ADMIN"), adminController.updateClinic);
router.delete("/clinics/:clinicId", authMiddleware, roleMiddleware("SUPER_ADMIN"), adminController.deactivateClinic);

router.patch("/doctors/:doctorId/edit", authMiddleware, roleMiddleware("SUPER_ADMIN"), upload.single("photo"), adminController.updateDoctorAdmin);
router.patch("/clinics/:clinicId/edit", authMiddleware, roleMiddleware("SUPER_ADMIN"), upload.single("logo"), adminController.updateClinicAdmin);

router.get("/requests", roleMiddleware("SUPER_ADMIN"), adminController.listAssociationRequests);
router.post("/clinics/:clinicId/assign-doctor", authMiddleware, roleMiddleware("SUPER_ADMIN"), adminController.assignDoctorToClinic);

export default router;