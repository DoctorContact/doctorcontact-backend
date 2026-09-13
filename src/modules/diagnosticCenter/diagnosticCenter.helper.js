// Time-ke 12-hour (AM/PM) format e dekhabar jonno helper
const formatTime12Hour = (time24) => {
  if (!time24) return null;
  const [hours, minutes] = time24.split(":");
  const h = parseInt(hours, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12.toString().padStart(2, "0")}:${minutes} ${ampm}`;
};

// Deterministic IST (UTC+5:30) day/time calculation — does NOT rely on
// Intl.DateTimeFormat, which can behave inconsistently across Node ICU
// builds/locales (e.g. wrong weekday string, "24:00" instead of "00:00").
//
// IMPORTANT: now.getTime() is ALWAYS an absolute UTC epoch timestamp,
// regardless of the server's local timezone. We must NOT also add
// now.getTimezoneOffset() on top of it — that was the original bug.
// Doing so double-shifts the time (or cancels the shift out entirely,
// depending on what timezone the server/host machine happens to be
// running in), which made "online/offline" only look correct by
// coincidence on servers already running in UTC.
const getISTDayAndTime = () => {
  const now = new Date();
  const IST_OFFSET_MINUTES = 5 * 60 + 30; // +5:30

  // Shift the absolute UTC timestamp forward by the IST offset directly.
  const istMs = now.getTime() + IST_OFFSET_MINUTES * 60000;
  const istDate = new Date(istMs);

  const dayNames = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ];

  // Use UTC getters on istDate since we already manually shifted the
  // timestamp — using local getters here would re-apply the server's
  // own timezone offset on top of our shift.
  const currentDay = dayNames[istDate.getUTCDay()];
  const hh = istDate.getUTCHours().toString().padStart(2, "0");
  const mm = istDate.getUTCMinutes().toString().padStart(2, "0");
  const currentTime = `${hh}:${mm}`;

  return { currentDay, currentTime };
};

// Mirrors clinic.helper.js's evaluateClinicAvailability, but for a
// DiagnosticCenter + its DiagnosticCenterWorkingHours. Used to compute the
// "Available Now / Offline" (isOnline) badge shown on the labs pages —
// isOnline is NOT a stored column, it's derived from today's working hours.
export const evaluateCenterAvailability = (center) => {
  const { currentDay, currentTime } = getISTDayAndTime();

  // No working-hours configured at all for this center yet — default to
  // "online" so a center isn't punished for not having set this up.
  if (!center.workingHours || center.workingHours.length === 0) {
    return { isOnline: true, status: "Open Today" };
  }

  const todaySchedule = center.workingHours.find(
    (sch) => sch.dayOfWeek?.toUpperCase() === currentDay
  );

  if (!todaySchedule || todaySchedule.isClosed) {
    return { isOnline: false, status: "Closed Today" };
  }

  const openTime = todaySchedule.openTime;
  const closeTime = todaySchedule.closeTime;

  if (openTime && closeTime) {
    if (currentTime < openTime) {
      return { isOnline: false, status: `Opens at ${formatTime12Hour(openTime)}` };
    }
    if (currentTime > closeTime) {
      return { isOnline: false, status: "Closed Now" };
    }
    return { isOnline: true, status: `Open • Ends at ${formatTime12Hour(closeTime)}` };
  }

  return { isOnline: true, status: "Open Today" };
};