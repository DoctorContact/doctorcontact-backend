// ============================================================================
// CENTRALIZED AVAILABILITY ENGINE
// ============================================================================
// Single source of truth for "what can a patient actually book" —
//   Doctor + Clinic + Schedule + Selected Date + Existing Appointments + Now
//   = Actual available sessions
//
// Both booking directions (Clinic -> Doctor -> Appointment and
// Doctor -> Clinic -> Appointment) call into this module instead of each
// re-implementing recurrence/holiday/leave/capacity checks. It reuses the
// existing DoctorSchedule / ScheduleException / ClinicHoliday / DoctorLeave
// / Queue / Appointment models exactly as they already exist — no new
// scheduling system, no new tables.
//
// PERFORMANCE NOTE: scanning forward day-by-day to find the next available
// dates used to issue ~6 DB round-trips PER DAY scanned (holiday check,
// working-hours check, leave check, schedule list, exceptions, per-session
// booking count) - up to 90 days = 500+ sequential queries for one page
// load. Everything below now loads all of that ONCE per request as a small
// fixed number of range queries, then does the day-by-day recurrence math
// in memory. Same rules, same output shape - just no N+1.
// ============================================================================

import prisma from "../../config/db.config.js";
import ApiError from "../../utils/apiError.js";
import {
  getDateContext,
  scheduleMatchesDate,
  applyExceptionToSchedule,
} from "./schedule.helper.js";
import {
  getTodayISTDateString,
  getCurrentISTTime,
  toISTDateString,
  addDaysToDateString,
} from "./doctor.helper.js";
import { findDoctorScheduleById } from "./doctor.repository.js";

const ACTIVE_APPOINTMENT_STATUSES = ["WAITING", "CHECKED_IN", "COMPLETED"];

// ---- slot-display helpers (pure functions, no DB) ----

const toMinutes = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (mins) => {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

// Builds a rough, evenly-spaced list of display slot times within a
// session's time range. This is a DISPLAY convenience only - bookings are
// still made against the session (scheduleId + date), matching how the
// Queue/token model already works.
const buildDisplaySlots = (startTime, endTime, stepMinutes, floorTime /* HH:mm or null */) => {
  const step = stepMinutes && stepMinutes > 0 ? stepMinutes : 15;
  let start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (floorTime) {
    const floor = toMinutes(floorTime);
    if (floor > start) {
      const stepsPast = Math.ceil((floor - start) / step);
      start = start + stepsPast * step;
    }
  }
  const slots = [];
  for (let t = start; t < end; t += step) {
    slots.push(toHHMM(t));
  }
  return slots;
};

const dbDateToDateString = (d) => new Date(d).toISOString().slice(0, 10);

// ============================================================================
// BULK CONTEXT LOADER - the single place that hits the database for a
// doctor+clinic date-range query. Everything else below is pure JS.
// ============================================================================

/**
 * Loads every piece of data needed to evaluate availability for a
 * doctor+clinic across a date range, in a small fixed number of queries.
 */
const loadAvailabilityContext = async (doctorId, clinicId, fromDateString, toDateString) => {
  const fromDate = new Date(fromDateString);
  const toDate = new Date(toDateString);

  const [doctor, workingHoursRows, activeSchedules, holidayRows, leaveRows] = await Promise.all([
    prisma.doctor.findUnique({ where: { id: doctorId }, select: { avgConsultationMinutes: true } }),
    prisma.clinicWorkingHours.findMany({ where: { clinicId } }),
    prisma.doctorSchedule.findMany({ where: { doctorId, clinicId, isActive: true }, orderBy: { startTime: "asc" } }),
    prisma.clinicHoliday.findMany({ where: { clinicId, date: { gte: fromDate, lte: toDate } } }),
    prisma.doctorLeave.findMany({ where: { doctorId, clinicId, date: { gte: fromDate, lte: toDate } } }),
  ]);

  const scheduleIds = activeSchedules.map((s) => s.id);

  const [exceptionRows, queueRows] = await Promise.all([
    scheduleIds.length
      ? prisma.scheduleException.findMany({ where: { scheduleId: { in: scheduleIds }, date: { gte: fromDate, lte: toDate } } })
      : Promise.resolve([]),
    scheduleIds.length
      ? prisma.queue.findMany({
          where: { doctorId, clinicId, scheduleId: { in: scheduleIds }, date: { gte: fromDate, lte: toDate } },
          include: { appointments: { where: { status: { in: ACTIVE_APPOINTMENT_STATUSES } }, select: { id: true } } },
        })
      : Promise.resolve([]),
  ]);

  const workingHoursByDay = new Map(workingHoursRows.map((w) => [w.dayOfWeek, w]));
  const holidayByDate = new Map(holidayRows.map((h) => [dbDateToDateString(h.date), h]));
  const leaveByDate = new Map(leaveRows.map((l) => [dbDateToDateString(l.date), l]));

  const exceptionByScheduleAndDate = new Map(
    exceptionRows.map((e) => [`${e.scheduleId}|${dbDateToDateString(e.date)}`, e])
  );

  const bookedCountByScheduleAndDate = new Map(
    queueRows.map((q) => [`${q.scheduleId}|${dbDateToDateString(q.date)}`, q.appointments.length])
  );

  return {
    doctor,
    activeSchedules,
    workingHoursByDay,
    holidayByDate,
    leaveByDate,
    exceptionByScheduleAndDate,
    bookedCountByScheduleAndDate,
  };
};

// ============================================================================
// PURE, IN-MEMORY DAY EVALUATION - no DB calls. Reads only from a context
// object already loaded by loadAvailabilityContext.
// ============================================================================

const computeDayFromContext = (dateString, context, { isToday, currentTime }) => {
  const dateContext = getDateContext(dateString);

  const holiday = context.holidayByDate.get(dateString);
  if (holiday) {
    return { date: dateString, isPast: false, closedReason: "CLINIC_HOLIDAY", reason: holiday.reason || null, sessions: [], hasAvailability: false };
  }

  const workingHours = context.workingHoursByDay.get(dateContext.dayName);
  if (workingHours?.isClosed) {
    return { date: dateString, isPast: false, closedReason: "CLINIC_CLOSED_WEEKLY", sessions: [], hasAvailability: false };
  }

  const leave = context.leaveByDate.get(dateString);
  if (leave) {
    return { date: dateString, isPast: false, closedReason: "DOCTOR_ON_LEAVE", reason: leave.reason || null, sessions: [], hasAvailability: false };
  }

  const consultationMinutes = workingHours?.avgConsultationMinutes || context.doctor?.avgConsultationMinutes || 15;

  const matchingSchedules = context.activeSchedules
    .map((schedule) => applyExceptionToSchedule(schedule, context.exceptionByScheduleAndDate.get(`${schedule.id}|${dateString}`)))
    .filter((schedule) => schedule && scheduleMatchesDate(schedule, dateContext));

  const liveSchedules = matchingSchedules.filter((schedule) => {
    if (!isToday) return true;
    return currentTime < schedule.endTime;
  });

  const sessions = liveSchedules
    .map((schedule) => {
      const bookedCount = context.bookedCountByScheduleAndDate.get(`${schedule.id}|${dateString}`) || 0;
      const slotsLeft = Math.max(0, schedule.maxPatients - bookedCount);
      const floorTime = isToday && currentTime > schedule.startTime ? currentTime : null;

      return {
        scheduleId: schedule.id,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        recurrenceType: schedule.recurrenceType,
        onlineBookingEnabled: schedule.onlineBookingEnabled,
        maxPatients: schedule.maxPatients,
        bookedCount,
        slotsLeft,
        isFull: slotsLeft <= 0,
        displaySlotTimes: buildDisplaySlots(schedule.startTime, schedule.endTime, consultationMinutes, floorTime),
      };
    })
    .sort((a, b) => (a.startTime < b.startTime ? -1 : 1));

  return {
    date: dateString,
    isPast: false,
    closedReason: null,
    sessions,
    hasAvailability: sessions.some((s) => !s.isFull && s.onlineBookingEnabled !== false),
  };
};

// ============================================================================
// PUBLIC API - same signatures/output shapes as before
// ============================================================================

/**
 * Resolves the sessions that actually run for a doctor+clinic on ONE
 * specific calendar date. Loads a single-day context and evaluates it -
 * used by the `getSchedules` (date-filtered) endpoint and by
 * assertScheduleBookableNow at booking time.
 */
export const getDayAvailability = async (doctorId, clinicId, dateStringRaw) => {
  const dateString = toISTDateString(dateStringRaw);
  const todayString = getTodayISTDateString();
  const isToday = dateString === todayString;
  const currentTime = isToday ? getCurrentISTTime() : null;

  if (dateString < todayString) {
    return { date: dateString, isPast: true, closedReason: "PAST_DATE", sessions: [], hasAvailability: false };
  }

  const context = await loadAvailabilityContext(doctorId, clinicId, dateString, dateString);
  return computeDayFromContext(dateString, context, { isToday, currentTime });
};

/**
 * Scans forward from today (inclusive) and returns the next `limit` actual
 * calendar dates that have at least one bookable session for this exact
 * doctor + clinic pair - never an abstract "every Monday", always real
 * dates ("16 Sep", "23 Sep", ...).
 *
 * Loads the ENTIRE scan window's data in one batch (a handful of queries
 * total), then walks the days in memory - no DB calls inside the loop.
 */
export const getUpcomingAvailableDates = async (doctorId, clinicId, { limit = 10, maxDaysToScan = 90 } = {}) => {
  const todayString = getTodayISTDateString();
  const currentTime = getCurrentISTTime();
  const lastDayString = addDaysToDateString(todayString, maxDaysToScan - 1);

  const context = await loadAvailabilityContext(doctorId, clinicId, todayString, lastDayString);

  const results = [];
  let cursor = todayString;

  for (let i = 0; i < maxDaysToScan && results.length < limit; i++) {
    const isToday = cursor === todayString;
    const day = computeDayFromContext(cursor, context, { isToday, currentTime: isToday ? currentTime : null });
    if (day.hasAvailability) {
      results.push({
        date: day.date,
        sessions: day.sessions.filter((s) => !s.isFull && s.onlineBookingEnabled !== false),
      });
    }
    cursor = addDaysToDateString(cursor, 1);
  }

  return results;
};

/**
 * Powers the Doctor -> Clinic reverse flow: given only a doctorId, returns
 * every clinic this doctor actually has DoctorSchedule rows for (the real
 * scheduling relationship - not the separate legacy DoctorClinicAssociation
 * request/approval records, which can go stale relative to real schedules),
 * each clinic's schedules kept strictly separate, plus each clinic's
 * next few actual available dates.
 */
export const getClinicsWithAvailabilityForDoctor = async (doctorId, { datesPerClinic = 5 } = {}) => {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
  if (!doctor) throw new ApiError(404, "Doctor not found");

  const schedules = await prisma.doctorSchedule.findMany({
    where: { doctorId, isActive: true },
    include: { clinic: true },
    orderBy: { startTime: "asc" },
  });

  const clinicIds = [...new Set(schedules.map((s) => s.clinicId))];

  // One clinic's scan doesn't depend on another's, so these can run
  // concurrently instead of one-clinic-at-a-time.
  const clinics = await Promise.all(
    clinicIds.map(async (clinicId) => {
      const clinicSchedules = schedules.filter((s) => s.clinicId === clinicId);
      const clinicInfo = clinicSchedules[0].clinic;
      const upcomingDates = await getUpcomingAvailableDates(doctorId, clinicId, { limit: datesPerClinic });

      return {
        clinicId,
        clinic: clinicInfo,
        schedules: clinicSchedules.map((s) => ({
          id: s.id,
          startTime: s.startTime,
          endTime: s.endTime,
          recurrenceType: s.recurrenceType,
          recurrencePattern: s.recurrencePattern,
          maxPatients: s.maxPatients,
          onlineBookingEnabled: s.onlineBookingEnabled,
        })),
        upcomingDates, // never merged with another clinic's dates/sessions
      };
    })
  );

  return clinics;
};

export const assertScheduleBookableNow = async (doctorId, clinicId, scheduleId, dateStringRaw) => {
  const schedule = await findDoctorScheduleById(scheduleId);
  if (!schedule || schedule.doctorId !== doctorId || schedule.clinicId !== clinicId) {
    throw new ApiError(404, "Invalid schedule selected");
  }
  const day = await getDayAvailability(doctorId, clinicId, dateStringRaw);
  const session = day.sessions.find((s) => s.scheduleId === scheduleId);
  if (!session) {
    throw new ApiError(400, day.closedReason ? `Not bookable: ${day.closedReason}` : "This session is not available on the selected date");
  }
  if (session.isFull) {
    throw new ApiError(409, "This session is fully booked for the selected date");
  }
  return session;
};
