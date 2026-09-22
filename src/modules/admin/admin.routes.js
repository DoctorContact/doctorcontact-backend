import { Router } from "express";
import * as adminController from "./admin.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";

const router = Router();

// এই মিডলওয়্যারটি সব রাউটের জন্য বেসিক অ্যাডমিন অ্যাক্সেস নিশ্চিত করে
router.use(authMiddleware, roleMiddleware("SUPER_ADMIN", "ADMIN"));

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     summary: Get platform-wide stats (users, clinics, doctors, patients)
 */
router.get("/stats", adminController.getStats);

/**
 * @swagger
 * /admin/clinics:
 *   get:
 *     summary: List clinics, optionally filtered by approval status
 */
router.get("/clinics", adminController.listClinics);

/**
 * @swagger
 * /admin/clinics/{clinicId}/approve:
 *   patch:
 *     summary: Approve a pending clinic
 */
router.patch("/clinics/:clinicId/approve", adminController.approveClinic);

/**
 * @swagger
 * /admin/clinics/{clinicId}/revoke:
 *   patch:
 *     summary: Revoke a clinic's approval
 */
router.patch("/clinics/:clinicId/revoke", adminController.revokeClinicApproval);


// ==========================================
// 🟢 DOCTOR ROUTES (ORDER FIXED)
// স্ট্যাটিক রাউটগুলো ডায়নামিক রাউটের উপরে রাখা হয়েছে
// ==========================================

router.get("/doctors", adminController.listAllDoctors);
router.get("/doctors/unverified", adminController.listUnverifiedDoctors);
router.get("/doctors/featured", adminController.listFeaturedDoctors);

router.post("/doctors", adminController.createDoctor);

router.patch("/doctors/:doctorId/verify", adminController.verifyDoctor);
router.patch("/doctors/:doctorId/unverify", adminController.unverifyDoctor);
router.patch("/doctors/:doctorId/featured", adminController.setFeaturedDoctor);
router.delete("/doctors/:doctorId", adminController.deleteDoctor);

// ==========================================


/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: List users, optionally filtered by role
 */
router.get("/users", adminController.listUsers);

/**
 * @swagger
 * /admin/users/{userId}/status:
 *   patch:
 *     summary: Activate or deactivate a user account
 */
router.patch("/users/:userId/status", adminController.toggleUserStatus);

/**
 * @swagger
 * /admin/settings:
 *   get:
 *     summary: Get platform settings (e.g. booking window minutes)
 */
router.get("/settings", roleMiddleware("SUPER_ADMIN"), adminController.getSettings);

/**
 * @swagger
 * /admin/settings:
 *   patch:
 *     summary: Update platform settings
 */
router.patch("/settings", roleMiddleware("SUPER_ADMIN"), adminController.updateSettings);

/**
 * @swagger
 * /admin/clinics:
 *   post:
 *     summary: (Admin/Super Admin) Create a new Clinic account
 */
router.post("/clinics", adminController.createClinic);

// Super Admin: global bookings feed across every clinic.
router.get("/bookings", roleMiddleware("SUPER_ADMIN"), adminController.listBookings);

router.post("/diagnostic-centers", adminController.createDiagnosticCenter);
router.get("/diagnostic-centers", adminController.listDiagnosticCenters);
router.patch("/diagnostic-centers/:centerId/approve", adminController.approveDiagnosticCenter);
router.patch("/diagnostic-centers/:centerId/revoke", adminController.revokeDiagnosticCenter);

/**
 * @swagger
 * /admin/clinics/{clinicId}:
 *   patch:
 *     summary: Edit clinic details (Super Admin)
 */
router.patch(
  "/clinics/:clinicId",
  authMiddleware,
  roleMiddleware("SUPER_ADMIN"),
  adminController.updateClinic
);

/**
 * @swagger
 * /admin/clinics/{clinicId}:
 *   delete:
 *     summary: Soft-delete/deactivate a clinic (Super Admin)
 */
router.delete(
  "/clinics/:clinicId",
  authMiddleware,
  roleMiddleware("SUPER_ADMIN"),
  adminController.deactivateClinic
);

export default router;