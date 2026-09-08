import { Router } from "express";
import * as clinicController from "./clinic.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";
import upload from "../../middlewares/upload.middleware.js";

const router = Router();

// =========================================================================
// 1. PUBLIC ROUTES (No Auth Required)
// =========================================================================

/**
 * @swagger
 * /clinic/featured:
 *   get:
 *     summary: Get all featured and approved clinics
 *     tags: [Clinic (Public)]
 *     responses:
 *       200:
 *         description: List of featured clinics fetched successfully
 *       500:
 *         description: Internal server error
 */
router.get("/featured", clinicController.getFeaturedClinics);

/**
 * @swagger
 * /clinic:
 *   get:
 *     summary: Get all approved clinics
 *     tags: [Clinic (Public)]
 *     responses:
 *       200:
 *         description: List of all clinics fetched successfully
 *       500:
 *         description: Internal server error
 */
router.get("/", clinicController.getAllClinics);


/**
 * @swagger
 * /clinic/{id}:
 *   get:
 *     summary: Get single clinic by ID
 *     tags: [Clinic (Public)]
 */
router.get("/:id", (req, res, next) => {
  // If the ID is not exactly 36 characters (a standard UUID length), 
  // skip this route so it doesn't block /profile, /doctors, etc.
  if (req.params.id.length !== 36) {
    return next();
  }
  // Otherwise, fetch the clinic by ID
  clinicController.getClinicById(req, res, next);
});

// =========================================================================
// 2. ADMIN ROUTES (Only Admin/Super Admin)
// =========================================================================

/**
 * @swagger
 * /clinic/{clinicId}/featured:
 *   patch:
 *     summary: Mark a clinic as featured or un-featured (Admin Only)
 *     tags: [Clinic (Admin)]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: clinicId
 *         required: true
 *         schema: 
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               isFeatured: { type: boolean, example: true }
 *               featuredOrder: { type: integer, example: 1 }
 *     responses:
 *       200:
 *         description: Clinic featured status updated successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (Admin role required)
 *       404:
 *         description: Clinic not found
 */
router.patch(
  "/:clinicId/featured",
  authMiddleware,
  roleMiddleware("ADMIN", "SUPER_ADMIN"),
  clinicController.toggleClinicFeaturedStatus
);

// =========================================================================
// 3. CLINIC PROTECTED ROUTES (Only Clinic Role)
// =========================================================================
// Industry Standard: Applying middleware globally for all routes defined BELOW this line.
router.use(authMiddleware, roleMiddleware("CLINIC"));

/**
 * @swagger
 * /clinic/profile:
 *   get:
 *     summary: Get the logged-in clinic's own profile
 *     tags: [Clinic]
 *     responses:
 *       200:
 *         description: Clinic profile fetched
 *       404:
 *         description: Clinic profile not found
 */
router.get("/profile", clinicController.getMyProfile);

/**
 * @swagger
 * /clinic/profile:
 *   patch:
 *     summary: Update the logged-in clinic's profile
 *     tags: [Clinic]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clinicName]
 *             properties:
 *               clinicName: { type: string }
 *               address: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               pincode: { type: string }
 *     responses:
 *       200: { description: Clinic profile updated }
 *       404: { description: Clinic profile not found }
 */
router.patch("/profile", clinicController.updateMyProfile);

/**
 * @swagger
 * /clinic/doctors:
 *   post:
 *     summary: Create a new doctor account under this clinic
 *     tags: [Clinic]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, example: "Dr. Biswajit" }
 *               email: { type: string }
 *               password: { type: string }
 *               phone: { type: string }
 *               specialization: { type: string }
 *               qualification: { type: string }
 *               experience: { type: integer }
 *               fee: { type: number }
 *               startTime: { type: string, example: "10:00" }
 *     responses:
 *       201: { description: Doctor created successfully }
 *       403: { description: Clinic not yet approved by admin }
 *       409: { description: A user with this email already exists }
 */
router.post("/doctors", clinicController.addDoctor);

/**
 * @swagger
 * /clinic/doctors:
 *   get:
 *     summary: List all doctors belonging to this clinic
 *     tags: [Clinic]
 *     responses:
 *       200: { description: Doctors fetched }
 */
router.get("/doctors", clinicController.listDoctors);

/**
 * @swagger
 * /clinic/doctors/{doctorId}:
 *   patch:
 *     summary: Update a doctor's clinic-specific settings
 *     tags: [Clinic]
 *     parameters:
 *       - in: path
 *         name: doctorId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               startTime: { type: string, example: "10:00" }
 *               specialization: { type: string }
 *               qualification: { type: string }
 *               experience: { type: integer }
 *               fee: { type: number }
 *               queueMode: { type: string, enum: [LIVE, PRIVATE, TIME_SLOT] }
 *     responses:
 *       200: { description: Doctor updated successfully }
 *       404: { description: Doctor not found in your clinic }
 */
router.patch("/doctors/:doctorId", clinicController.editDoctor);

/**
 * @swagger
 * /clinic/receptionists:
 *   post:
 *     summary: Create a new receptionist account under this clinic
 *     tags: [Clinic]
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
 *       201: { description: Receptionist created successfully }
 *       409: { description: A user with this email already exists }
 */
router.post("/receptionists", clinicController.addReceptionist);

/**
 * @swagger
 * /clinic/receptionists:
 *   get:
 *     summary: List all receptionists belonging to this clinic
 *     tags: [Clinic]
 *     responses:
 *       200: { description: Receptionists fetched }
 */
router.get("/receptionists", clinicController.listReceptionists);

/**
 * @swagger
 * /clinic/receptionists/assign-doctors:
 *   post:
 *     summary: Assign one or more doctors to a receptionist
 *     tags: [Clinic]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [receptionistId, doctorIds]
 *             properties:
 *               receptionistId: { type: string, format: uuid }
 *               doctorIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *     responses:
 *       200: { description: Doctors assigned successfully }
 *       404: { description: Receptionist not found in your clinic }
 *       400: { description: One or more doctors do not belong to your clinic }
 */
router.post("/receptionists/assign-doctors", clinicController.assignDoctorsToReceptionist);

/**
 * @swagger
 * /clinic/staff/change-password:
 *   patch:
 *     summary: Change a doctor's or receptionist's password (staff cannot change their own)
 *     tags: [Clinic]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userId, newPassword]
 *             properties:
 *               userId: { type: string, format: uuid }
 *               newPassword: { type: string }
 *     responses:
 *       200: { description: Password updated successfully }
 *       404: { description: Doctor or Receptionist not found in your clinic }
 */
router.patch("/staff/change-password", clinicController.changeStaffPassword);

/**
 * @swagger
 * /clinic/requests/{associationId}/respond:
 *   patch:
 *     summary: Accept or reject a doctor's request to join this clinic
 *     tags: [Clinic]
 *     parameters:
 *       - in: path
 *         name: associationId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [action]
 *             properties:
 *               action: { type: string, enum: [ACCEPT, REJECT] }
 *     responses:
 *       200: { description: Request approved or rejected }
 *       409: { description: Approval blocked due to a schedule conflict }
 *       403: { description: Request does not belong to your clinic }
 */
router.patch("/requests/:associationId/respond", clinicController.respondToDoctorRequest);

/**
 * @swagger
 * /clinic/logo:
 *   post:
 *     summary: Upload the clinic's logo image
 *     tags: [Clinic]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo: { type: string, format: binary }
 *     responses:
 *       200: { description: Logo uploaded }
 *       400: { description: No image file provided }
 */
router.post("/logo", upload.single("photo"), clinicController.uploadLogo);

/**
 * @swagger
 * /clinic/working-hours:
 *   post:
 *     summary: Set clinic working hours for one or more days of the week
 *     tags: [Clinic]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [workingHours]
 *             properties:
 *               workingHours:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [dayOfWeek]
 *                   properties:
 *                     dayOfWeek: { type: string, enum: [MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY] }
 *                     isClosed: { type: boolean, default: false }
 *                     openTime: { type: string, example: "09:00" }
 *                     closeTime: { type: string, example: "18:00" }
 *     responses:
 *       200: { description: Working hours updated }
 */
router.post("/working-hours", clinicController.setWorkingHours);

/**
 * @swagger
 * /clinic/working-hours:
 *   get:
 *     summary: Get the clinic's configured working hours
 *     tags: [Clinic]
 *     responses:
 *       200: { description: Working hours fetched }
 */
router.get("/working-hours", clinicController.getWorkingHours);

/**
 * @swagger
 * /clinic/holidays:
 *   post:
 *     summary: Add a holiday date for the clinic
 *     tags: [Clinic]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date]
 *             properties:
 *               date: { type: string, example: "2026-08-15" }
 *               reason: { type: string, example: "Independence Day" }
 *     responses:
 *       201: { description: Holiday added }
 *       409: { description: A holiday is already set for this date }
 */
router.post("/holidays", clinicController.addHoliday);

/**
 * @swagger
 * /clinic/holidays/{holidayId}:
 *   delete:
 *     summary: Remove a holiday
 *     tags: [Clinic]
 *     parameters:
 *       - in: path
 *         name: holidayId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Holiday removed }
 *       404: { description: Holiday not found }
 */
router.delete("/holidays/:holidayId", clinicController.removeHoliday);

/**
 * @swagger
 * /clinic/holidays:
 *   get:
 *     summary: List all configured holidays for the clinic
 *     tags: [Clinic]
 *     responses:
 *       200: { description: Holidays fetched }
 */
router.get("/holidays", clinicController.listHolidays);

/**
 * @swagger
 * /clinic/online-consultation:
 *   patch:
 *     summary: Enable or disable online booking for this clinic
 *     tags: [Clinic]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [enabled]
 *             properties:
 *               enabled: { type: boolean }
 *     responses:
 *       200: { description: Online consultation setting updated }
 */
router.patch("/online-consultation", clinicController.toggleOnlineConsultation);

/**
 * @swagger
 * /clinic/auto-followup:
 *   patch:
 *     summary: Toggle automatic follow-up (after 1 month with no visit) on or off
 *     tags: [Clinic]
 */
router.patch("/auto-followup", clinicController.toggleAutoFollowup);

/**
 * @swagger
 * /clinic/requests/received:
 *   get:
 *     summary: Get all doctor association requests received by the clinic
 *     tags: [Clinic]
 *     responses:
 *       200:
 *         description: Successfully fetched received requests
 */
router.get("/requests/received", clinicController.getMyReceivedRequests);

/**
 * @swagger
 * /clinic/availability:
 *   patch:
 *     summary: Toggle clinic real-time availability on or off
 *     tags: [Clinic]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [availableNow]
 *             properties:
 *               availableNow: { type: boolean }
 *     responses:
 *       200: { description: Clinic availability updated }
 */
router.patch("/availability", clinicController.toggleAvailability);

export default router;