// Mirrors clinic.helper.js's evaluateClinicAvailability, scoped down for
// DiagnosticCenter (no holiday model here — just per-day open/close time).

const formatTime12Hour = (time24) => {
  if (!time24) return null;
  const [hours, minutes] = time24.split(":");
  const h = parseInt(hours, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12.toString().padStart(2, "0")}:${minutes} ${ampm}`;
};

export const evaluateCenterAvailability = (center) => {
  const now = new Date();
  const timeZone = "Asia/Kolkata";

  const currentDay = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
  })
    .format(now)
    .toUpperCase();

  const currentTime = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  const todaySchedule = center.workingHours?.find(
    (sch) => sch.dayOfWeek.toUpperCase() === currentDay
  );

  if (!todaySchedule || todaySchedule.isClosed) {
    return { isOnline: false, status: "Closed Today" };
  }

  const { openTime, closeTime } = todaySchedule;

  if (openTime && closeTime) {
    if (currentTime < openTime) {
      return { isOnline: false, status: `Opens at ${formatTime12Hour(openTime)}` };
    }
    if (currentTime > closeTime) {
      return { isOnline: false, status: "Closed Now" };
    }
    return { isOnline: true, status: `Open • Ends at ${formatTime12Hour(closeTime)}` };
  }

  // No explicit times set for today but not marked closed — treat as open.
  return { isOnline: true, status: "Open Today" };
};
