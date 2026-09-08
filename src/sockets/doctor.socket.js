import { getIO } from "../config/socket.config.js";

// Broadcast (to every connected client) that the set of "live now" doctors may
// have changed — a doctor was marked available/unavailable, put on leave, had a
// schedule edited, or a delay/resume was posted. Clients that show a live count
// or list (e.g. the header "Live Doctors" pill) refetch on this instead of
// polling on a timer (Rule 5).
export const emitLiveDoctorsChanged = (meta = {}) => {
  try {
    getIO().emit("liveDoctorsChanged", { at: new Date().toISOString(), ...meta });
  } catch {
    // Socket not initialised (e.g. during a script/seed) — non-fatal.
  }
};
