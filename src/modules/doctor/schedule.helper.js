// Converts "HH:mm" into total minutes for easy comparison
const toMinutes = (time) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

// Returns true if two time ranges on the same day overlap
export const rangesOverlap = (startA, endA, startB, endB) => {
  const sA = toMinutes(startA);
  const eA = toMinutes(endA);
  const sB = toMinutes(startB);
  const eB = toMinutes(endB);

  return sA < eB && sB < eA;
};

// Checks a candidate schedule against a list of existing APPROVED associations.
// Returns the conflicting association if found, otherwise null.
export const findConflict = (candidate, existingApprovedAssociations) => {
  for (const existing of existingApprovedAssociations) {
    if (existing.dayOfWeek !== candidate.dayOfWeek) continue;
    if (rangesOverlap(candidate.startTime, candidate.endTime, existing.startTime, existing.endTime)) {
      return existing;
    }
  }
  return null;
};

// === NEW: Schedule Overlap Checker ===

// Checks if two recurrence patterns intersect
const patternsIntersect = (typeA, patternA, typeB, patternB) => {
  // If either is DAILY, they intersect on some day
  if (typeA === "DAILY" || typeB === "DAILY") return true;

  // If both are WEEKLY, check if they share any days
  if (typeA === "WEEKLY" && typeB === "WEEKLY") {
    const daysA = patternA.days || [];
    const daysB = patternB.days || [];
    return daysA.some((day) => daysB.includes(day));
  }

  // Fallback: assume they might intersect to be safe
  return true; 
};

// Checks a candidate schedule against existing schedules for overlaps
export const checkScheduleConflict = (candidate, existingSchedules) => {
  for (const existing of existingSchedules) {
    if (!existing.isActive) continue;

    // Check time overlap
    if (rangesOverlap(candidate.startTime, candidate.endTime, existing.startTime, existing.endTime)) {
      // Check recurrence pattern overlap
      if (patternsIntersect(candidate.recurrenceType, candidate.recurrencePattern, existing.recurrenceType, existing.recurrencePattern)) {
        return existing;
      }
    }
  }
  return null;
};

// === CENTRALIZED DATE-MATCHING ENGINE ===
// This is now the SINGLE place that decides "does this DoctorSchedule run
// on this particular calendar date?". Previously this exact logic was
// hand-copied (and slowly drifting apart) in doctor.controller.js
// (getSchedules), doctor.helper.js (evaluateDoctorStatus), and nowhere at
// all for future-date lookups. Everything — today's live status, a specific
// date's sessions, and the "next available dates" scan used by the booking
// flow — now calls through here so the three can never disagree again.

const DAY_NAMES = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

// Builds the small set of facts about a calendar date (given as "YYYY-MM-DD")
// that every recurrence type needs to check itself against.
export const getDateContext = (dateString) => {
  const [y, m, d] = dateString.split("-").map(Number);
  // Using Date.UTC keeps this independent of the server's local timezone —
  // dateString is already an IST calendar date by the time it gets here.
  const dayIndex = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weekNth = Math.ceil(d / 7);
  const isLast = d + 7 > daysInMonth;

  return {
    dateString,
    dayName: DAY_NAMES[dayIndex],
    dayOfMonth: d,
    weekNth,
    isLast,
  };
};

// Given a schedule (already exception-adjusted by the caller, see
// applyExceptionToSchedule below) and a dateContext, returns true if that
// schedule runs on that date.
export const scheduleMatchesDate = (schedule, dateContext) => {
  const type = schedule.recurrenceType;
  const pattern = schedule.recurrencePattern || {};

  if (type === "SPECIFIC_DATE") {
    const savedDate = String(pattern.exactDate || "").slice(0, 10);
    return savedDate === dateContext.dateString;
  }
  if (type === "DAILY") return true;
  if (type === "WEEKLY") return Array.isArray(pattern.days) && pattern.days.includes(dateContext.dayName);
  if (type === "MONTHLY_DATE") return pattern.date === dateContext.dayOfMonth;
  if (type === "MONTHLY_WEEKDAY") {
    if (pattern.day !== dateContext.dayName) return false;
    if (pattern.isLast) return dateContext.isLast;
    return pattern.week === dateContext.weekNth;
  }
  return false; // Unknown recurrence types are safely ignored, never assumed active.
};

// Applies a one-off ScheduleException (Step 13) to a schedule for a single
// date: cancels it outright, or overrides start/end/capacity. Returns null
// if the schedule doesn't run that day because of the exception.
export const applyExceptionToSchedule = (schedule, exception) => {
  if (!exception) return schedule;
  if (exception.isCancelled) return null;
  return {
    ...schedule,
    startTime: exception.overrideStartTime || schedule.startTime,
    endTime: exception.overrideEndTime || schedule.endTime,
    maxPatients: exception.overrideMaxPatients ?? schedule.maxPatients,
  };
};
