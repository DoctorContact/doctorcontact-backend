import { Router } from "express";
import * as appointmentController from "./appointment.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";

const router = Router();

/**
 * @swagger
 * /appointments/doctors/search:
 *   get:
 *     summary: Search bookable doctors by name, clinic, city, or clinic+date
 *     tags: [Appointment]
 *     parameters:
 *       - in: query
 *         name: doctorName
 *         schema: { type: string }
 *       - in: query
 *         name: clinicName
 *         schema: { type: string }
 *       - in: query
 *         name: clinicId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: date
 *         schema: { type: string, example: "2026-07-21" }
 *     responses:
 *       200: { description: Doctors fetched }
 */
router.get("/doctors/search", appointmentController.searchDoctors);

/**
 * @swagger
 * /appointments/book/online:
 *   post:
 *     summary: (Patient) Book an online appointment
 *     tags: [Appointment]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [doctorId, clinicId, date]
 *             properties:
 *               doctorId: { type: string, format: uuid }
 *               clinicId: { type: string, format: uuid }
 *               date: { type: string, example: "2026-07-21" }
 *     responses:
 *       201: { description: Appointment booked successfully }
 */
router.post(
  "/book/online",
  authMiddleware,
  roleMiddleware("PATIENT", "CLINIC", "ADMIN", "SUPER_ADMIN"), 
  appointmentController.bookOnline
);

/**
 * @swagger
 * /appointments/book/reception:
 *   post:
 *     summary: (Receptionist/Clinic) Book for an existing or new patient
 *     tags: [Appointment]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [doctorId, clinicId, date]
 *             properties:
 *               doctorId: { type: string, format: uuid }
 *               clinicId: { type: string, format: uuid }
 *               date: { type: string }
 *               bookingSource: { type: string, enum: [RECEPTION, WALK_IN, PHONE] }
 *               patientId: { type: string, format: uuid }
 *               newPatient:
 *                 type: object
 *                 properties:
 *                   name: { type: string }
 *                   age: { type: integer }
 *                   phone: { type: string }
 *     responses:
 *       201: { description: Appointment booked successfully }
 */
router.post(
  "/book/reception",
  authMiddleware,
  // 🟢 FIX: Added ADMIN and SUPER_ADMIN for testing
  roleMiddleware("RECEPTIONIST", "CLINIC", "ADMIN", "SUPER_ADMIN"),
  appointmentController.bookReception
);

/**
 * @swagger
 * /appointments/me:
 *   get:
 *     summary: (Patient) List my own appointments
 *     tags: [Appointment]
 *     responses:
 *       200: { description: Appointments fetched }
 */
router.get("/me", authMiddleware, roleMiddleware("PATIENT"), appointmentController.getMyAppointments);

/**
 * @swagger
 * /appointments/me/booking-status:
 *   get:
 *     summary: (Patient) Active appointment count vs the max-3 cap, and any active post-cancellation booking restriction
 *     tags: [Appointment]
 *     responses:
 *       200: { description: Booking status fetched }
 */
router.get("/me/booking-status", authMiddleware, roleMiddleware("PATIENT"), appointmentController.getMyBookingStatus);

/**
 * @swagger
 * /appointments/clinic:
 *   get:
 *     summary: (Clinic/Receptionist) List all appointments for the caller's OWN clinic, with optional filters
 *     tags: [Appointment]
 *     parameters:
 *       - in: query
 *         name: doctorId
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: status
 *         schema: { type: string, example: "WAITING,CHECKED_IN" }
 *       - in: query
 *         name: date
 *         schema: { type: string, example: "2026-07-21" }
 *       - in: query
 *         name: patientId
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Clinic appointments fetched }
 */
router.get(
  "/clinic",
  authMiddleware,
  roleMiddleware("CLINIC", "RECEPTIONIST"),
  appointmentController.getClinicAppointments
);

/**
 * @swagger
 * /appointments/{appointmentId}/live:
 *   get:
 *     summary: Live queue view for a single appointment (current token, patient's token, patients ahead, estimated wait) — fetch on open, then keep live via Socket.io
 *     tags: [Appointment]
 *     parameters:
 *       - in: path
 *         name: appointmentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200: { description: Live queue status fetched }
 */
router.get("/:appointmentId/live", authMiddleware, appointmentController.getAppointmentLiveView);

/**
 * @swagger
 * /appointments/{appointmentId}/cancel:
 *   patch:
 *     summary: Cancel an appointment (Patient can cancel own if WAITING; Receptionist/Clinic/Admin can cancel any at their scope)
 *     tags: [Appointment]
 *     parameters:
 *       - in: path
 *         name: appointmentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       200: { description: Appointment cancelled }
 *       400: { description: Already cancelled/completed, or not modifiable in current status }
 *       403: { description: Not authorized to modify this appointment }
 */
router.patch("/:appointmentId/cancel", authMiddleware, appointmentController.cancelAppointment);

/**
 * @swagger
 * /appointments/{appointmentId}/reschedule:
 *   patch:
 *     summary: Reschedule an appointment to a new date — cancels the old slot and books a fresh token on the new date
 *     tags: [Appointment]
 *     parameters:
 *       - in: path
 *         name: appointmentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date]
 *             properties:
 *               date: { type: string, example: "2026-07-25" }
 *     responses:
 *       200: { description: Appointment rescheduled, returns the new appointment }
 *       400: { description: Already cancelled/completed, or clinic closed on new date }
 *       403: { description: Not authorized to modify this appointment }
 */
router.patch("/:appointmentId/reschedule", authMiddleware, appointmentController.rescheduleAppointment);

router.post("/walk-in", authMiddleware, roleMiddleware("CLINIC", "RECEPTIONIST"), appointmentController.createWalkInAppointment);

export default router;