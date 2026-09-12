// === NEW: Live & Available Evaluation Engine (Steps 14 & 15) ===

export const getTodayISTDate = () => {
  const now = new Date();
  const timeZone = "Asia/Kolkata";
  const dateString = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(dateString); // Returns UTC midnight of the local date
};

// Single source of truth for "what is today's date string in IST" and
// "what time is it right now in IST" (HH:mm, 24h) — the availability engine
// and the schedule-management endpoints both need these and must never
// drift apart on timezone handling.
export const getTodayISTDateString = () => {
  const timeZone = "Asia/Kolkata";
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
};

export const getCurrentISTTime = () => {
  const timeZone = "Asia/Kolkata";
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
};

// Normalizes anything the frontend might send (a bare "YYYY-MM-DD", a full
// ISO timestamp, or a Date) into a plain "YYYY-MM-DD" IST calendar-date
// string. Moved here (from a controller-local copy) so every module that
// needs to reason about "which calendar date is this" agrees on the answer.
export const toISTDateString = (dateVal) => {
  if (!dateVal) return dateVal;

  if (typeof dateVal === "string" && dateVal.length === 10 && !dateVal.includes("T")) {
    return dateVal;
  }

  const rawDate = new Date(dateVal);
  const istDateStr = rawDate.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const localDate = new Date(istDateStr);

  const year = localDate.getFullYear();
  const month = String(localDate.getMonth() + 1).padStart(2, "0");
  const day = String(localDate.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

// Adds `days` calendar days to a "YYYY-MM-DD" string, returning another
// "YYYY-MM-DD" string. Pure UTC arithmetic on the calendar date only — no
// timezone conversion needed since we're just walking the calendar.
export const addDaysToDateString = (dateString, days) => {
  const [y, m, d] = dateString.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
};

export const evaluateDoctorStatus = (doctor) => {
  const now = new Date();
  const timeZone = "Asia/Kolkata";

  const todayDateString = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const currentDay = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long" }).format(now).toUpperCase();
  const currentTime = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now);

  let isAvailable = false;
  let isLive = false;
  let reason = "Not Available";
  let activeSchedule = null;
  let currentCapacity = { booked: 0, max: 0 };

  // 1. Clinic Status Check
  if (doctor.clinic?.isAvailableToday === false) {
    return { isAvailable: false, isLive: false, reason: "Clinic Closed", capacity: null };
  }
  const isHoliday = doctor.clinic?.holidays?.length > 0;
  if (isHoliday) {
    return { isAvailable: false, isLive: false, reason: "Clinic Holiday", capacity: null };
  }

  // 2. Doctor Leave Check
  if (doctor.leaves?.length > 0) {
    return { isAvailable: false, isLive: false, reason: "Doctor on Leave", capacity: null };
  }

  // 2b. Manual unavailability toggle (Step 38/40) — overrides schedule entirely.
  if (doctor.isAvailable === false) {
    return { isAvailable: false, isLive: false, reason: "Doctor Unavailable", capacity: null };
  }

  // 3. Filter Today's Active Schedules (applying any one-off exception first)
  const todaysSchedules = (doctor.schedules || [])
    .filter((sch) => sch.isActive)
    .map((sch) => {
      const exception = sch.exceptions?.[0]; // pre-filtered to today's date by the query
      if (!exception) return sch;
      if (exception.isCancelled) return null; // cancelled just for today
      return {
        ...sch,
        startTime: exception.overrideStartTime || sch.startTime,
        endTime: exception.overrideEndTime || sch.endTime,
        maxPatients: exception.overrideMaxPatients ?? sch.maxPatients,
      };
    })
    .filter((sch) => {
      if (!sch) return false;
      const pattern = sch.recurrencePattern || {};

      if (sch.recurrenceType === "SPECIFIC_DATE") {
        return String(pattern.exactDate || "").slice(0, 10) === todayDateString;
      }

      if (sch.recurrenceType === "DAILY") return true;
      if (sch.recurrenceType === "WEEKLY") return pattern.days?.includes(currentDay);
      if (sch.recurrenceType === "MONTHLY_DATE") {
        const todayDayNum = parseInt(todayDateString.split("-")[2], 10);
        return pattern.date === todayDayNum;
      }
      if (sch.recurrenceType === "MONTHLY_WEEKDAY") {
        // Same shape as doctor.controller.js's getOrdinalData: { day, week, isLast }
        const [y, m, d] = todayDateString.split("-").map(Number);
        const dayOfMonth = d;
        const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const weekNth = Math.ceil(dayOfMonth / 7);
        const isLast = dayOfMonth + 7 > daysInMonth;
        if (pattern.day !== currentDay) return false;
        if (pattern.isLast) return isLast;
        return pattern.week === weekNth;
      }
      return false; // Safely ignore anything else untracked
    });

  if (todaysSchedules.length === 0) {
    return { isAvailable: false, isLive: false, reason: "No schedule for today", capacity: null };
  }

  // 4. Evaluate Live Status and Capacity
  for (const sch of todaysSchedules) {
    // Count active appointments linked to this specific schedule's queue
    const activeBookings = (doctor.appointments || []).filter(
      (a) => a.queue?.scheduleId === sch.id
    ).length;

    const maxPts = sch.maxPatients || 20;

    // Check if LIVE right now
    if (currentTime >= sch.startTime && currentTime <= sch.endTime) {
      isLive = true;
      activeSchedule = sch;
      currentCapacity = { booked: activeBookings, max: maxPts };
    }

    // Check if AVAILABLE (Has capacity and session hasn't ended)
    if (activeBookings < maxPts && currentTime <= sch.endTime) {
      isAvailable = true;
      // If we aren't live yet, but have a future available schedule today, preview its capacity
      if (!isLive) {
        currentCapacity = { booked: activeBookings, max: maxPts };
      }
    }
  }

  // Determine specific display reason
  if (isLive && !isAvailable) {
    reason = "Full (Live)"; // Rule 35: Full doctor can still be Live
  } else if (isLive && isAvailable) {
    reason = "Live Now";
  } else if (!isLive && isAvailable) {
    reason = "Available Later Today";
  } else {
    reason = "Fully Booked / Session Ended";
  }

  // Persistent operational status (Step 40) — set via notifyDoctorDelay /
  // resumeConsultation, not just a one-shot notification.
  const dailyStatus = doctor.dailyStatuses?.[0];
  const operationalStatus = dailyStatus?.status || "NORMAL";
  const delayMinutes = dailyStatus?.delayMinutes ?? null;
  if (operationalStatus === "RUNNING_LATE") {
    reason = isLive ? `Live Now — running ~${delayMinutes} min late` : reason;
  }

  return { isAvailable, isLive, reason, capacity: currentCapacity, operationalStatus, delayMinutes };
};