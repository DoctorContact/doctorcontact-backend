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
  if (req.params.id.length !== 36) {
    return next();
  }
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
router.use(authMiddleware, roleMiddleware("CLINIC"));

/**
 * @swagger
 * /clinic/profile:
 *   get:
 *     summary: Get the logged-in clinic's own profile
 *     tags: [Clinic]
 */
router.get("/profile", clinicController.getMyProfile);

/**
 * @swagger
 * /clinic/profile:
 *   patch:
 *     summary: Update the logged-in clinic's profile
 *     tags: [Clinic]
 */
router.patch("/profile", clinicController.updateMyProfile);

/**
 * @swagger
 * /clinic/doctors:
 *   post:
 *     summary: Create a new doctor account under this clinic
 *     tags: [Clinic]
 */
router.post("/doctors", clinicController.addDoctor);

/**
 * @swagger
 * /clinic/doctors:
 *   get:
 *     summary: List all doctors belonging to this clinic
 *     tags: [Clinic]
 */
router.get("/doctors", clinicController.listDoctors);

/**
 * @swagger
 * /clinic/doctors/{doctorId}:
 *   patch:
 *     summary: Update a doctor's clinic-specific settings
 *     tags: [Clinic]
 */
router.patch("/doctors/:doctorId", clinicController.editDoctor);

// 🟢 NEWLY ADDED FIX: DELETE DOCTOR ROUTE
/**
 * @swagger
 * /clinic/doctors/{doctorId}:
 *   delete:
 *     summary: Remove a doctor from this clinic
 *     tags: [Clinic]
 *     parameters:
 *       - in: path
 *         name: doctorId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Doctor removed from clinic successfully }
 *       404: { description: Doctor not found in your clinic }
 */
router.delete("/doctors/:doctorId", clinicController.removeDoctor);

/**
 * @swagger
 * /clinic/receptionists:
 *   post:
 *     summary: Create a new receptionist account under this clinic
 *     tags: [Clinic]
 */
router.post("/receptionists", clinicController.addReceptionist);

/**
 * @swagger
 * /clinic/receptionists:
 *   get:
 *     summary: List all receptionists belonging to this clinic
 *     tags: [Clinic]
 */
router.get("/receptionists", clinicController.listReceptionists);

/**
 * @swagger
 * /clinic/receptionists/assign-doctors:
 *   post:
 *     summary: Assign one or more doctors to a receptionist
 *     tags: [Clinic]
 */
router.post("/receptionists/assign-doctors", clinicController.assignDoctorsToReceptionist);

/**
 * @swagger
 * /clinic/staff/change-password:
 *   patch:
 *     summary: Change a doctor's or receptionist's password (staff cannot change their own)
 *     tags: [Clinic]
 */
router.patch("/staff/change-password", clinicController.changeStaffPassword);

/**
 * @swagger
 * /clinic/requests/{associationId}/respond:
 *   patch:
 *     summary: Accept or reject a doctor's request to join this clinic
 *     tags: [Clinic]
 */
router.patch("/requests/:associationId/respond", clinicController.respondToDoctorRequest);

/**
 * @swagger
 * /clinic/logo:
 *   post:
 *     summary: Upload the clinic's logo image
 *     tags: [Clinic]
 */
router.post("/logo", upload.single("photo"), clinicController.uploadLogo);

/**
 * @swagger
 * /clinic/working-hours:
 *   post:
 *     summary: Set clinic working hours for one or more days of the week
 *     tags: [Clinic]
 */
router.post("/working-hours", clinicController.setWorkingHours);

/**
 * @swagger
 * /clinic/working-hours:
 *   get:
 *     summary: Get the clinic's configured working hours
 *     tags: [Clinic]
 */
router.get("/working-hours", clinicController.getWorkingHours);

/**
 * @swagger
 * /clinic/holidays:
 *   post:
 *     summary: Add a holiday date for the clinic
 *     tags: [Clinic]
 */
router.post("/holidays", clinicController.addHoliday);

/**
 * @swagger
 * /clinic/holidays/{holidayId}:
 *   delete:
 *     summary: Remove a holiday
 *     tags: [Clinic]
 */
router.delete("/holidays/:holidayId", clinicController.removeHoliday);

/**
 * @swagger
 * /clinic/holidays:
 *   get:
 *     summary: List all configured holidays for the clinic
 *     tags: [Clinic]
 */
router.get("/holidays", clinicController.listHolidays);

/**
 * @swagger
 * /clinic/online-consultation:
 *   patch:
 *     summary: Enable or disable online booking for this clinic
 *     tags: [Clinic]
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
 */
router.get("/requests/received", clinicController.getMyReceivedRequests);

/**
 * @swagger
 * /clinic/availability:
 *   patch:
 *     summary: Toggle clinic real-time availability on or off
 *     tags: [Clinic]
 */
router.patch("/availability", clinicController.toggleAvailability);

/**
 * @swagger
 * /clinic/doctors/{doctorId}/online-booking:
 *   patch:
 *     summary: Toggle online booking specifically for a doctor at this clinic
 *     tags: [Clinic]
 */
router.patch("/doctors/:doctorId/online-booking", clinicController.toggleDoctorOnlineBooking);

export default router;