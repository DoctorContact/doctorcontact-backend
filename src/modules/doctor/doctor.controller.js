import prisma from "../../config/db.config.js";
import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/apiResponse.js";
import ApiError from "../../utils/apiError.js";
import * as doctorService from "./doctor.service.js";
import { getDayAvailability, getUpcomingAvailableDates, getClinicsWithAvailabilityForDoctor } from "./availability.service.js";
import { toISTDateString as sharedToISTDateString } from "./doctor.helper.js";
import {
  searchDoctorsByNameSchema,
  sendRequestToDoctorSchema,
  sendRequestToClinicSchema,
  respondToRequestSchema,
  advancedSearchSchema,
  updateConsultationTimeSchema,
  markLeaveSchema,
  delayNotificationSchema,
  createScheduleSchema,
  updateScheduleSchema,
  scheduleExceptionSchema
} from "./doctor.validation.js";

// ==========================================
// 🛑 ULTIMATE TIMEZONE FIXER (IST - INDIA)
// ==========================================
// This used to be a controller-local copy of the same logic that also lived
// in availability.service.js — now both import the single implementation
// from doctor.helper.js so date parsing can never silently diverge again.
const toISTDateString = sharedToISTDateString;

// ==========================================
// DOCTOR PROFILE & ASSOCIATION
// ==========================================

export const searchByName = asyncHandler(async (req, res) => {
  const { name } = searchDoctorsByNameSchema.parse(req.query);
  const doctors = await doctorService.searchByName(name);
  res.status(200).json(new ApiResponse(true, "Doctors fetched", { doctors }));
});

export const searchDoctorByEmail = asyncHandler(async (req, res) => {
  const { email } = req.query;
  if (!email) {
    return res.status(200).json(new ApiResponse(true, "No email provided", { doctors: [] }));
  }
  const doctors = await prisma.doctor.findMany({
    where: {
      user: { email: { equals: email, mode: "insensitive" } }
    },
    include: {
      user: { select: { name: true, email: true, phone: true, avatar: true } }
    }
  });
  res.status(200).json(new ApiResponse(true, "Doctor search successful", { doctors }));
});

export const advancedSearch = asyncHandler(async (req, res) => {
  const filters = advancedSearchSchema.parse(req.query);
  const doctors = await doctorService.searchDoctorsAdvanced(filters);
  res.status(200).json(new ApiResponse(true, "Advanced search completed", { doctors }));
});

export const sendRequestToDoctor = asyncHandler(async (req, res) => {
  const data = sendRequestToDoctorSchema.parse(req.body);
  const result = await doctorService.sendRequestToDoctor(req.user.id, data);
  res.status(201).json(new ApiResponse(true, "Request sent to doctor", result));
});

export const sendRequestToClinic = asyncHandler(async (req, res) => {
  const data = sendRequestToClinicSchema.parse(req.body);
  const result = await doctorService.sendRequestToClinic(req.user.id, data);
  res.status(201).json(new ApiResponse(true, "Request sent to clinic", result));
});

export const respondToClinicRequest = asyncHandler(async (req, res) => {
  const { action } = respondToRequestSchema.parse(req.body);
  const association = await doctorService.respondToClinicRequest(req.user.id, req.params.associationId, action);
  res.status(200).json(new ApiResponse(true, `Request ${action === "ACCEPT" ? "approved" : "rejected"}`, { association }));
});

export const getMyReceivedRequests = asyncHandler(async (req, res) => {
  const requests = await doctorService.getMyReceivedRequests(req.user.id);
  res.status(200).json(new ApiResponse(true, "Received requests fetched", { requests }));
});

export const getMySentRequests = asyncHandler(async (req, res) => {
  const requests = await doctorService.getMySentRequests(req.user.id);
  res.status(200).json(new ApiResponse(true, "Sent requests fetched", { requests }));
});

export const cancelAssociation = asyncHandler(async (req, res) => {
  const association = await doctorService.cancelAssociation(req.user.id, req.user.role, req.params.associationId);
  res.status(200).json(new ApiResponse(true, "Association cancelled", { association }));
});

export const uploadProfilePhoto = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "No image file provided");
  const doctor = await doctorService.uploadProfilePhoto(req.user.id, req.file.buffer);
  res.status(200).json(new ApiResponse(true, "Profile photo uploaded", { doctor }));
});

// ==========================================
// CONSULTATION & LEAVES
// ==========================================

export const updateConsultationTime = asyncHandler(async (req, res) => {
  const { avgConsultationMinutes } = updateConsultationTimeSchema.parse(req.body);
  const result = await doctorService.updateConsultationTime(req.user, req.params.doctorId, req.params.clinicId, avgConsultationMinutes);
  res.status(200).json(new ApiResponse(true, "Consultation time updated", { result }));
});

export const markLeave = asyncHandler(async (req, res) => {
  const { date, reason } = markLeaveSchema.parse(req.body);
  const leave = await doctorService.markDoctorOnLeave(req.user, req.params.doctorId, req.params.clinicId, date, reason);
  res.status(201).json(new ApiResponse(true, "Doctor marked on leave", { leave }));
});

export const cancelLeave = asyncHandler(async (req, res) => {
  await doctorService.cancelDoctorLeave(req.user, req.params.doctorId, req.params.clinicId, req.query.date);
  res.status(200).json(new ApiResponse(true, "Leave cancelled"));
});

export const listLeaves = asyncHandler(async (req, res) => {
  const leaves = await doctorService.listUpcomingDoctorLeaves(req.params.doctorId, req.params.clinicId);
  res.status(200).json(new ApiResponse(true, "Upcoming leaves fetched", { leaves }));
});

export const notifyDelay = asyncHandler(async (req, res) => {
  const { delayMinutes } = delayNotificationSchema.parse(req.body);
  const result = await doctorService.notifyDoctorDelay(req.user, req.params.doctorId, req.params.clinicId, delayMinutes);
  res.status(200).json(new ApiResponse(true, "Delay notification sent", result));
});

export const resumeConsultation = asyncHandler(async (req, res) => {
  const result = await doctorService.resumeConsultation(req.user, req.params.doctorId, req.params.clinicId);
  res.status(200).json(new ApiResponse(true, "Status cleared back to normal", result));
});

// ==========================================
// PUBLIC & ADMIN LISTINGS
// ==========================================

export const getAllDoctors = asyncHandler(async (req, res) => {
  const doctors = await doctorService.fetchAllDoctors();
  res.status(200).json(new ApiResponse(true, "All doctors fetched successfully", doctors));
});

export const getFeaturedDoctors = asyncHandler(async (req, res) => {
  const doctors = await doctorService.fetchFeaturedDoctors();
  res.status(200).json(new ApiResponse(true, "Featured doctors fetched successfully", doctors));
});

export const getAvailableDoctors = asyncHandler(async (req, res) => {
  const doctors = await doctorService.fetchAvailableDoctors();
  res.status(200).json(new ApiResponse(true, "Available doctors fetched successfully", doctors));
});

export const toggleDoctorFeaturedStatus = asyncHandler(async (req, res) => {
  const { doctorId } = req.params;
  const { isFeatured, featuredOrder } = req.body;
  try {
    const updatedDoctor = await doctorService.updateFeaturedStatus(doctorId, isFeatured, featuredOrder);
    res.status(200).json(new ApiResponse(true, "Doctor featured status updated", updatedDoctor));
  } catch (error) {
    throw new ApiError(error.message === "Doctor not found" ? 404 : 500, error.message);
  }
});

export const toggleDoctorAvailability = asyncHandler(async (req, res) => {
  const { doctorId } = req.params;
  const { isAvailable } = req.body;
  try {
    const updatedDoctor = await doctorService.updateAvailabilityStatus(doctorId, isAvailable, req.user.id, req.user.role);
    res.status(200).json(new ApiResponse(true, "Doctor availability updated successfully", updatedDoctor));
  } catch (error) {
    let statusCode = 500;
    if (error.message === "Doctor not found") statusCode = 404;
    if (error.message.includes("Access Denied")) statusCode = 403;
    throw new ApiError(statusCode, error.message);
  }
});

export const getDoctorById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const doctor = await doctorService.getDoctorProfileWithClinics(id, req.query.location);
  res.status(200).json(new ApiResponse(true, "Doctor profile fetched successfully", doctor));
});

// ==========================================
// DOCTOR SCHEDULE ENGINE (IST TIMEZONE FIXED)
// ==========================================

// ==========================================
// DOCTOR SCHEDULE ENGINE (IST TIMEZONE FIXED)
// ==========================================

export const addSchedule = asyncHandler(async (req, res) => {
  // 1. Zod parses the request
  const data = createScheduleSchema.parse(req.body);

  // 2. 🛑 ULTIMATE TIMEZONE FIX: 
  // Bypass Zod and JavaScript Date parsing entirely. 
  // Extract the raw string EXACTLY as the frontend sent it.
  if (req.body.recurrencePattern && req.body.recurrencePattern.exactDate) {
    // If the frontend sent "2026-09-12", we force it back to exactly "2026-09-12"
    const rawDate = String(req.body.recurrencePattern.exactDate);
    data.recurrencePattern.exactDate = rawDate.includes("T") ? rawDate.split("T")[0] : rawDate;
  }

  // excludedDates now lives as proper ScheduleException rows, not in this
  // JSON blob (one mechanism instead of two) — pull it out before saving,
  // then migrate each date below once the schedule (and its id) exists.
  const excludedDates = req.body.recurrencePattern?.excludedDates || [];
  if (data.recurrencePattern) delete data.recurrencePattern.excludedDates;

  const schedule = await doctorService.addSchedule(req.user, req.params.doctorId, req.params.clinicId, data);

  for (const raw of excludedDates) {
    const dateStr = String(raw).includes("T") ? String(raw).split("T")[0] : String(raw);
    await doctorService.setScheduleException(req.user, schedule.id, { date: dateStr, isCancelled: true });
  }

  res.status(201).json(new ApiResponse(true, "Schedule created successfully", { schedule }));
});

export const updateSchedule = asyncHandler(async (req, res) => {
  // 1. Zod parses the request
  const data = updateScheduleSchema.parse(req.body);

  // 2. 🛑 ULTIMATE TIMEZONE FIX: 
  if (req.body.recurrencePattern && req.body.recurrencePattern.exactDate) {
    const rawDate = String(req.body.recurrencePattern.exactDate);
    data.recurrencePattern.exactDate = rawDate.includes("T") ? rawDate.split("T")[0] : rawDate;
  }

  const excludedDates = req.body.recurrencePattern?.excludedDates || [];
  if (data.recurrencePattern) delete data.recurrencePattern.excludedDates;

  const schedule = await doctorService.editSchedule(req.user, req.params.doctorId, req.params.clinicId, req.params.scheduleId, data);

  for (const raw of excludedDates) {
    const dateStr = String(raw).includes("T") ? String(raw).split("T")[0] : String(raw);
    await doctorService.setScheduleException(req.user, schedule.id, { date: dateStr, isCancelled: true });
  }

  res.status(200).json(new ApiResponse(true, "Schedule updated successfully", { schedule }));
});

export const deleteSchedule = asyncHandler(async (req, res) => {
  await doctorService.removeSchedule(req.user, req.params.doctorId, req.params.clinicId, req.params.scheduleId);
  res.status(200).json(new ApiResponse(true, "Schedule deleted successfully"));
});

// === Step 13: Schedule Exceptions ===
export const setScheduleException = asyncHandler(async (req, res) => {
  const data = scheduleExceptionSchema.parse(req.body);
  const exception = await doctorService.setScheduleException(req.user, req.params.scheduleId, data);
  res.status(200).json(new ApiResponse(true, "Schedule exception saved", { exception }));
});

export const getScheduleExceptions = asyncHandler(async (req, res) => {
  const exceptions = await doctorService.getScheduleExceptions(req.user, req.params.scheduleId);
  res.status(200).json(new ApiResponse(true, "Schedule exceptions fetched", { exceptions }));
});

export const deleteScheduleException = asyncHandler(async (req, res) => {
  await doctorService.removeScheduleException(req.user, req.params.scheduleId, req.params.exceptionId);
  res.status(200).json(new ApiResponse(true, "Schedule exception removed"));
});

export const getSchedules = asyncHandler(async (req, res) => {
  const { doctorId, clinicId } = req.params;
  const { date } = req.query;

  if (!date) {
    // No date given => this is the raw schedule-management view (doctor/clinic
    // editing their recurring sessions), not a booking-availability query.
    // Kept exactly as before: all active schedule definitions, no date math.
    const allSchedules = await doctorService.listSchedules(doctorId, clinicId);
    const activeSchedules = allSchedules.filter((s) => s.isActive);
    return res.status(200).json(new ApiResponse(true, "Schedules fetched successfully", { schedules: activeSchedules }));
  }

  // 🟢 Delegates to the single centralized availability engine
  // (availability.service.js) instead of re-deriving recurrence/holiday/
  // leave/capacity rules here. This also means a doctor on leave, or a
  // clinic holiday, now correctly empties this list — previously this
  // endpoint ignored both and only checked recurrence + raw capacity.
  const day = await getDayAvailability(doctorId, clinicId, date);

  // Response shape kept 1:1 with the previous version (schedules[].id,
  // .slotsLeft, .currentBookings, .startTime, .endTime, ...) so existing
  // frontend consumers (doctors/[id]/page.tsx, ReceptionistBookingModal,
  // DoctorScheduleManager, clinic/add-patient) don't need to change.
  const schedules = day.sessions.map((s) => ({
    id: s.scheduleId,
    doctorId,
    clinicId,
    startTime: s.startTime,
    endTime: s.endTime,
    recurrenceType: s.recurrenceType,
    maxPatients: s.maxPatients,
    onlineBookingEnabled: s.onlineBookingEnabled,
    currentBookings: s.bookedCount,
    slotsLeft: s.slotsLeft,
    displaySlotTimes: s.displaySlotTimes,
  }));

  res.status(200).json(
    new ApiResponse(true, "Schedules fetched successfully", {
      schedules,
      closedReason: day.closedReason, // e.g. CLINIC_HOLIDAY / CLINIC_CLOSED_WEEKLY / DOCTOR_ON_LEAVE — null when open
    })
  );
});

// ==========================================
// AVAILABILITY ENGINE — public endpoints
// ==========================================

// GET /doctors/:doctorId/clinics/:clinicId/schedules/available-dates?limit=10
// Powers the "Today / 13 Sep / 14 Sep / ..." date-strip. Returns only real
// calendar dates that have at least one bookable session, scanning forward
// from today and skipping over dates with no availability (holidays,
// leaves, no matching recurrence, or fully booked).
export const getAvailableDates = asyncHandler(async (req, res) => {
  const { doctorId, clinicId } = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 30);

  const dates = await getUpcomingAvailableDates(doctorId, clinicId, { limit });
  res.status(200).json(new ApiResponse(true, "Upcoming available dates fetched", { dates }));
});

// GET /doctors/:doctorId/clinics-with-schedules
// Powers the Doctor -> Clinic reverse flow: every clinic this doctor has
// real DoctorSchedule rows at (not just legacy DoctorClinicAssociation
// requests), each with its own schedules and next available dates, never
// merged together.
export const getClinicsWithSchedules = asyncHandler(async (req, res) => {
  const { doctorId } = req.params;
  const clinics = await getClinicsWithAvailabilityForDoctor(doctorId);
  res.status(200).json(new ApiResponse(true, "Doctor's clinics with schedules fetched", { clinics }));
});

export const getLiveDoctors = asyncHandler(async (req, res) => {
  const doctors = await doctorService.fetchLiveDoctors();
  res.status(200).json(new ApiResponse(true, "Live doctors fetched successfully", doctors));
});

// Lightweight count for the header "Live Doctors" pill — clients refetch this on
// the `liveDoctorsChanged` socket event / window focus instead of polling.
export const getLiveDoctorsCount = asyncHandler(async (req, res) => {
  const doctors = await doctorService.fetchLiveDoctors();
  res.status(200).json(new ApiResponse(true, "Live doctor count fetched", { count: doctors.length }));
});