export const BOOKING_SOURCE = {
  ONLINE: "ONLINE",
  RECEPTION: "RECEPTION",
  WALK_IN: "WALK_IN",
  PHONE: "PHONE",
};

// Part 5/6: a patient may have at most this many active (not yet
// completed/cancelled) advance appointments at once. Completed/cancelled
// appointments never count toward this.
export const MAX_ACTIVE_APPOINTMENTS = 3;

// Statuses that count as "active/upcoming" for the purposes of the max-3
// rule and the patient dashboard's UPCOMING bucket.
export const ACTIVE_APPOINTMENT_STATUSES = ["WAITING", "CHECKED_IN"];

// Part 8: cancelling while at the 3-active cap starts a new-booking freeze
// of this many days. Cancelling when NOT at the cap never triggers this.
export const POST_CANCEL_RESTRICTION_DAYS = 2;

// Default average consultation time (minutes) used to estimate wait time
// when no doctor/clinic-specific value is on file (Part 18).
export const DEFAULT_CONSULTATION_MINUTES = 10;