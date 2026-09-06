import prisma from "../../config/db.config.js";
import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/apiResponse.js";
import ApiError from "../../utils/apiError.js";
import * as doctorService from "./doctor.service.js";
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
// This forces any date sent by the frontend into exact Indian Standard Time (YYYY-MM-DD)
const toISTDateString = (dateVal) => {
  if (!dateVal) return dateVal;
  
  // If frontend sent a strict pure string like "2026-09-12" without "Z" or time, keep it.
  if (typeof dateVal === 'string' && dateVal.length === 10 && !dateVal.includes("T")) {
    return dateVal;
  }

  const rawDate = new Date(dateVal);
  // Convert UTC timestamp to IST local string
  const istDateStr = rawDate.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const localDate = new Date(istDateStr);
  
  // Return perfect YYYY-MM-DD
  const year = localDate.getFullYear();
  const month = String(localDate.getMonth() + 1).padStart(2, '0');
  const day = String(localDate.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
};

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

  const allSchedules = await doctorService.listSchedules(doctorId, clinicId);
  const activeSchedules = allSchedules.filter((s) => s.isActive);

  if (!date) {
    return res.status(200).json(new ApiResponse(true, "Schedules fetched successfully", { schedules: activeSchedules }));
  }

  // 🟢 IST CONVERSION APPLIED TO SEARCH QUERY
  const targetDateString = toISTDateString(date);

  const [year, month, day] = targetDateString.split("-").map(Number);

  // This Date object is purely used to find the Day of the week in India
  const targetDate = new Date(year, month - 1, day);

  const dayNames = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const targetDayName = dayNames[targetDate.getDay()];
  const targetDateNum = targetDate.getDate();

  const getOrdinalData = (d) => {
    const dateNum = d.getDate();
    const weekNth = Math.ceil(dateNum / 7);
    const isLast = (dateNum + 7) > new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return { weekNth, isLast, dayName: dayNames[d.getDay()] };
  };

  // ScheduleException is now the ONE place "cancel/override this schedule
  // for one date" lives — recurrencePattern.excludedDates is retired (any
  // still-stored values are ignored from here on; addSchedule/updateSchedule
  // migrate them into ScheduleException rows instead of writing new ones).
  const exceptionsForDate = await doctorService.getExceptionsForSchedulesOnDate(
    activeSchedules.map((s) => s.id),
    targetDateString
  );
  const exceptionBySchedule = new Map(exceptionsForDate.map((e) => [e.scheduleId, e]));

  const validSchedules = activeSchedules
    .map((schedule) => {
      const exception = exceptionBySchedule.get(schedule.id);
      if (!exception) return schedule;
      if (exception.isCancelled) return null;
      return {
        ...schedule,
        startTime: exception.overrideStartTime || schedule.startTime,
        endTime: exception.overrideEndTime || schedule.endTime,
        maxPatients: exception.overrideMaxPatients ?? schedule.maxPatients,
      };
    })
    .filter((schedule) => {
      if (!schedule) return false;
      const type = schedule.recurrenceType;
      const pattern = schedule.recurrencePattern || {};

      if (type === "SPECIFIC_DATE") {
        const savedDate = toISTDateString(pattern.exactDate);
        return savedDate === targetDateString;
      }

      if (type === "DAILY") return true;
      if (type === "WEEKLY") return pattern.days && pattern.days.includes(targetDayName);
      if (type === "MONTHLY_DATE") return pattern.date === targetDateNum;

      if (type === "MONTHLY_WEEKDAY") {
        const { weekNth, isLast, dayName } = getOrdinalData(targetDate);
        if (pattern.day !== dayName) return false;
        if (pattern.isLast && isLast) return true;
        if (pattern.week === weekNth) return true;
        return false;
      }

      return false;
    });

  // Prisma range boundary (12:00:00 AM IST to 11:59:59 PM IST)
  // We use string representations mapped back to UTC bounds to ensure Prisma finds it regardless of hosting
  const startOfDay = new Date(`${targetDateString}T00:00:00.000+05:30`);
  const endOfDay = new Date(`${targetDateString}T23:59:59.999+05:30`);

  const schedulesWithCapacity = await Promise.all(
    validSchedules.map(async (schedule) => {
      const queue = await prisma.queue.findFirst({
        where: {
          doctorId,
          clinicId,
          scheduleId: schedule.id,
          date: { gte: startOfDay, lte: endOfDay }
        }
      });

      let currentBookings = 0;
      if (queue) {
        currentBookings = await prisma.appointment.count({
          where: {
            queueId: queue.id,
            status: { in: ["WAITING", "CHECKED_IN", "COMPLETED"] }
          }
        });
      }

      return {
        ...schedule,
        currentBookings,
        slotsLeft: Math.max(0, schedule.maxPatients - currentBookings)
      };
    })
  );

  res.status(200).json(new ApiResponse(true, "Schedules fetched successfully", { schedules: schedulesWithCapacity }));
});