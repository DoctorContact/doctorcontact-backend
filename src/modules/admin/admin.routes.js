import { Router } from "express";
import * as adminController from "./admin.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";

const router = Router();

router.use(authMiddleware, roleMiddleware("SUPER_ADMIN", "ADMIN"));

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     summary: Get platform-wide stats (users, clinics, doctors, patients)
 *     tags: [Admin]
 *     responses:
 *       200: { description: Platform stats fetched }
 */
router.get("/stats", adminController.getStats);

/**
 * @swagger
 * /admin/clinics:
 *   get:
 *     summary: List clinics, optionally filtered by approval status
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: isApproved
 *         schema: { type: boolean }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: Clinics fetched }
 */
router.get("/clinics", adminController.listClinics);

/**
 * @swagger
 * /admin/clinics/{clinicId}/approve:
 *   patch:
 *     summary: Approve a pending clinic
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: clinicId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Clinic approved successfully }
 *       400: { description: Clinic is already approved }
 */
router.patch("/clinics/:clinicId/approve", adminController.approveClinic);

/**
 * @swagger
 * /admin/clinics/{clinicId}/revoke:
 *   patch:
 *     summary: Revoke a clinic's approval
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: clinicId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Clinic approval revoked }
 */
router.patch("/clinics/:clinicId/revoke", adminController.revokeClinicApproval);

/**
 * @swagger
 * /admin/doctors/unverified:
 *   get:
 *     summary: List all unverified doctors
 *     tags: [Admin]
 *     responses:
 *       200: { description: Unverified doctors fetched }
 */
router.get("/doctors/unverified", adminController.listUnverifiedDoctors);

/**
 * @swagger
 * /admin/doctors/{doctorId}/verify:
 *   patch:
 *     summary: Verify a doctor
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: doctorId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Doctor verified successfully }
 *       400: { description: Doctor is already verified }
 */
router.patch("/doctors/:doctorId/verify", adminController.verifyDoctor);

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: List users, optionally filtered by role
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [SUPER_ADMIN, ADMIN, CLINIC, RECEPTIONIST, DOCTOR, PATIENT] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200: { description: Users fetched }
 */
router.get("/users", adminController.listUsers);

/**
 * @swagger
 * /admin/users/{userId}/status:
 *   patch:
 *     summary: Activate or deactivate a user account
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isActive]
 *             properties:
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: User activated or deactivated successfully }
 *       403: { description: Cannot modify a Super Admin account }
 */
router.patch("/users/:userId/status", adminController.toggleUserStatus);

/**
 * @swagger
 * /admin/settings:
 *   get:
 *     summary: Get platform settings (e.g. booking window minutes)
 *     tags: [Admin]
 *     responses:
 *       200: { description: Platform settings fetched }
 */
router.get("/settings", roleMiddleware("SUPER_ADMIN"), adminController.getSettings);

/**
 * @swagger
 * /admin/settings:
 *   patch:
 *     summary: Update platform settings
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [bookingWindowMinutes]
 *             properties:
 *               bookingWindowMinutes: { type: integer, example: 180 }
 *     responses:
 *       200: { description: Platform settings updated }
 */
router.patch("/settings", roleMiddleware("SUPER_ADMIN"), adminController.updateSettings);

/**
 * @swagger
 * /admin/admins:
 *   post:
 *     summary: (Super Admin only) Create a new Admin account
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               password: { type: string }
 *               phone: { type: string }
 *     responses:
 *       201: { description: Admin account created successfully }
 *       409: { description: A user with this email already exists }
 */



/**
 * @swagger
 * /admin/clinics:
 *   post:
 *     summary: (Admin/Super Admin) Create a new Clinic account — auto-approved since created by an admin
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password, clinicName]
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               password: { type: string }
 *               phone: { type: string }
 *               clinicName: { type: string }
 *               address: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               pincode: { type: string }
 *     responses:
 *       201: { description: Clinic account created successfully }
 *       409: { description: A user with this email already exists }
 */
router.post("/clinics", adminController.createClinic);

// Admin can onboard a doctor with or without a clinic (clinicId optional).
router.post("/doctors", adminController.createDoctor);

// Super Admin: global bookings feed across every clinic.
router.get("/bookings", roleMiddleware("SUPER_ADMIN"), adminController.listBookings);

router.post("/diagnostic-centers", adminController.createDiagnosticCenter);
router.get("/diagnostic-centers", adminController.listDiagnosticCenters);
router.patch("/diagnostic-centers/:centerId/approve", adminController.approveDiagnosticCenter);
router.patch("/diagnostic-centers/:centerId/revoke", adminController.revokeDiagnosticCenter);

/**
 * @swagger
 * /admin/doctors/{doctorId}/featured:
 *   patch:
 *     summary: (Admin/Super Admin) Mark a doctor as featured (or remove featured status)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: doctorId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isFeatured]
 *             properties:
 *               isFeatured: { type: boolean }
 *               featuredOrder: { type: integer, example: 1, description: "Lower shows first among featured doctors" }
 *     responses:
 *       200: { description: Doctor featured status updated }
 *       404: { description: Doctor not found }
 */
router.patch("/doctors/:doctorId/featured", adminController.setFeaturedDoctor);

/**
 * @swagger
 * /admin/doctors/featured:
 *   get:
 *     summary: List all currently featured doctors, in display order
 *     tags: [Admin]
 *     responses:
 *       200: { description: Featured doctors fetched }
 */
router.get("/doctors/featured", adminController.listFeaturedDoctors);

/**
 * @swagger
 * /admin/clinics/{clinicId}:
 *   patch:
 *     summary: Edit clinic details (Super Admin)
 *     tags: [Admin]
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
 *     tags: [Admin]
 */
router.delete(
  "/clinics/:clinicId",
  authMiddleware,
  roleMiddleware("SUPER_ADMIN"),
  adminController.deactivateClinic
);

export default router;
