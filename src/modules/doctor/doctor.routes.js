import { Router } from "express";
import * as doctorController from "./doctor.controller.js";
import * as clinicController from "../clinic/clinic.controller.js";
import authMiddleware from "../../middlewares/auth.middleware.js";
import roleMiddleware from "../../middlewares/role.middleware.js";
import upload from "../../middlewares/upload.middleware.js";
import { searchDoctorByEmail } from "./doctor.controller.js";

const router = Router();

// =========================================================================
// 1. PUBLIC ROUTES (No Auth Required) - সবাই দেখতে পারবে
// =========================================================================

router.get("/advanced-search", doctorController.advancedSearch);
router.get("/featured", doctorController.getFeaturedDoctors);
router.get("/available", doctorController.getAvailableDoctors);
router.get("/", doctorController.getAllDoctors);

// 🟢 FIX: Search রাউটগুলো পাবলিক করা হলো এবং authMiddleware সরানো হলো
router.get("/search", doctorController.searchByName);
router.get("/search-email", searchDoctorByEmail);
router.get("/clinics/search", clinicController.searchByName);
router.get("/live", doctorController.getLiveDoctors);


// =========================================================================
// 2. ADMIN ROUTES (Only Admin/Super Admin)
// =========================================================================

router.patch(
  "/:doctorId/featured",
  authMiddleware,
  roleMiddleware("ADMIN", "SUPER_ADMIN"),
  doctorController.toggleDoctorFeaturedStatus
);

// =========================================================================
// 3. MIXED ROLES ROUTES (Admin, Clinic, Doctor)
// =========================================================================

router.patch(
  "/:doctorId/available",
  authMiddleware,
  roleMiddleware("ADMIN", "SUPER_ADMIN", "CLINIC", "DOCTOR"),
  doctorController.toggleDoctorAvailability
);

// 🔴 PROTECTED ROUTES BELOW (Requires Login)
router.post(
  "/requests",
  authMiddleware,
  roleMiddleware("CLINIC"),
  doctorController.sendRequestToDoctor
);

router.get(
  "/requests/sent",
  authMiddleware,
  roleMiddleware("CLINIC", "DOCTOR"),
  doctorController.getMySentRequests
);

router.get(
  "/requests/received",
  authMiddleware,
  roleMiddleware("CLINIC", "DOCTOR"),
  doctorController.getMyReceivedRequests
);

router.patch(
  "/requests/:associationId/respond",
  authMiddleware,
  roleMiddleware("DOCTOR"),
  doctorController.respondToClinicRequest
);

router.post(
  "/clinic-requests",
  authMiddleware,
  roleMiddleware("DOCTOR"),
  doctorController.sendRequestToClinic
);

router.patch(
  "/associations/:associationId/cancel",
  authMiddleware,
  roleMiddleware("DOCTOR", "CLINIC"),
  doctorController.cancelAssociation
);

router.post(
  "/profile-photo",
  authMiddleware,
  roleMiddleware("DOCTOR"),
  upload.single("photo"),
  doctorController.uploadProfilePhoto
);

router.patch(
  "/:doctorId/clinics/:clinicId/consultation-time",
  authMiddleware,
  roleMiddleware("DOCTOR", "CLINIC", "RECEPTIONIST", "SUPER_ADMIN", "ADMIN"),
  doctorController.updateConsultationTime
);

router.post(
  "/:doctorId/clinics/:clinicId/leave",
  authMiddleware,
  roleMiddleware("DOCTOR", "CLINIC", "RECEPTIONIST", "SUPER_ADMIN", "ADMIN"),
  doctorController.markLeave
);

router.delete(
  "/:doctorId/clinics/:clinicId/leave",
  authMiddleware,
  roleMiddleware("DOCTOR", "CLINIC", "RECEPTIONIST", "SUPER_ADMIN", "ADMIN"),
  doctorController.cancelLeave
);

router.get(
  "/:doctorId/clinics/:clinicId/leave",
  authMiddleware,
  doctorController.listLeaves
);

router.post(
  "/:doctorId/clinics/:clinicId/delay",
  authMiddleware,
  roleMiddleware("DOCTOR", "CLINIC", "RECEPTIONIST", "SUPER_ADMIN", "ADMIN"),
  doctorController.notifyDelay
);

router.post(
  "/:doctorId/clinics/:clinicId/resume",
  authMiddleware,
  roleMiddleware("DOCTOR", "CLINIC", "RECEPTIONIST", "SUPER_ADMIN", "ADMIN"),
  doctorController.resumeConsultation
);

// =========================================================================
// 4. SCHEDULE ROUTES
// =========================================================================

router.get(
  "/:doctorId/clinics/:clinicId/schedules",
  doctorController.getSchedules
);

router.post(
  "/:doctorId/clinics/:clinicId/schedules",
  authMiddleware,
  roleMiddleware("DOCTOR", "CLINIC", "RECEPTIONIST", "SUPER_ADMIN", "ADMIN"),
  doctorController.addSchedule
);

router.put(
  "/:doctorId/clinics/:clinicId/schedules/:scheduleId",
  authMiddleware,
  roleMiddleware("DOCTOR", "CLINIC", "RECEPTIONIST", "SUPER_ADMIN", "ADMIN"),
  doctorController.updateSchedule
);

router.delete(
  "/:doctorId/clinics/:clinicId/schedules/:scheduleId",
  authMiddleware,
  roleMiddleware("DOCTOR", "CLINIC", "RECEPTIONIST", "SUPER_ADMIN", "ADMIN"),
  doctorController.deleteSchedule
);

// === Step 13: Schedule Exceptions ===
router.get(
  "/schedules/:scheduleId/exceptions",
  authMiddleware,
  roleMiddleware("DOCTOR", "CLINIC", "RECEPTIONIST", "SUPER_ADMIN", "ADMIN"),
  doctorController.getScheduleExceptions
);

router.post(
  "/schedules/:scheduleId/exceptions",
  authMiddleware,
  roleMiddleware("DOCTOR", "CLINIC", "SUPER_ADMIN", "ADMIN"),
  doctorController.setScheduleException
);

router.delete(
  "/schedules/:scheduleId/exceptions/:exceptionId",
  authMiddleware,
  roleMiddleware("DOCTOR", "CLINIC", "SUPER_ADMIN", "ADMIN"),
  doctorController.deleteScheduleException
);

// =========================================================================
// 5. GENERIC ID ROUTE (MUST BE ABSOLUTELY LAST)
// =========================================================================

router.get("/:id", doctorController.getDoctorById);

export default router;