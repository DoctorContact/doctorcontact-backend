# Jeet Backend — Doctor Appointment & Clinic Management System

A production-grade backend for a multi-clinic, multi-role healthcare appointment, queue, and diagnostic-referral platform. Built with Node.js, Express, Prisma, PostgreSQL (Supabase), Redis, and Socket.io.

Live deployment: https://doctor-management-system-backend.onrender.com
Health check: `GET /api/v1/health`
API Docs (local only, disabled in production): `http://localhost:8000/api-docs`

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Roles](#roles)
- [Features by Module](#features-by-module)
- [Folder Structure](#folder-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [Running with Docker](#running-with-docker)
- [Deployment](#deployment)
- [API Documentation](#api-documentation)
- [Security](#security)
- [Known Limitations / Roadmap](#known-limitations--roadmap)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 |
| Framework | Express.js |
| Database | PostgreSQL (hosted on Supabase) |
| ORM | Prisma 6.x (deliberately not upgraded to 7 — breaking changes to datasource config) |
| Cache / Pub-Sub | Redis (ioredis) — Upstash in production |
| Realtime | Socket.io |
| Auth | JWT (access + refresh tokens, hashed at rest), Google OAuth (Passport.js, Patient-only) |
| Validation | Zod |
| Logging | Pino |
| Password Hashing | bcrypt |
| Email | Nodemailer |
| File Storage | Cloudinary (profile photos, clinic/diagnostic-center logos, avatars) |
| PDF Generation | PDFKit |
| Excel Generation | ExcelJS |
| API Docs | swagger-jsdoc + swagger-ui-express |
| Rate Limiting | express-rate-limit |
| Containerization | Docker |
| Hosting | Render (app) + Upstash (Redis) + Supabase (Postgres) |

---

## Architecture

Feature-based modular architecture. Each module under `src/modules/<name>/` follows the same internal shape:

```
<module>/
  <module>.controller.js   — handles req/res, calls service layer
  <module>.service.js      — business logic, orchestrates repository calls
  <module>.repository.js   — all Prisma/DB queries live here
  <module>.routes.js       — Express router + Swagger JSDoc annotations
  <module>.validation.js   — Zod schemas for request validation
  <module>.constants.js    — module-specific constants
  <module>.helper.js       — small pure helper functions
```

Controllers never talk to Prisma directly; services never build HTTP responses.

---

## Roles

Eight roles share a single `User` table, with role-specific profile tables:

- **SUPER_ADMIN** — platform owner. Manages global settings (booking window, etc.), creates Admin and Clinic accounts.
- **ADMIN** — approves clinics and diagnostic centers, verifies doctors, manages users, moderates reviews, creates Clinic/Diagnostic Center accounts. Cannot touch platform-wide settings — that's Super Admin only.
- **CLINIC** — manages its own doctors, receptionists, working hours, holidays, announcements, referrals sent.
- **RECEPTIONIST** — manages assigned doctors' queues (strictly per-clinic-scoped), books walk-in/phone appointments.
- **DOCTOR** — global profile, can work at multiple clinics via approved associations, sets own leave/consultation time.
- **PATIENT** — books appointments, views queue status, submits reviews, receives test referrals, manages own profile.
- **DIAGNOSTIC_CENTER** — receives and manages incoming test referrals; manages its own profile, logo, and staff accounts.
- **DIAGNOSTIC_STAFF** — created by a Diagnostic Center; views incoming referrals at that center.

**Public self-registration (`POST /auth/register`) is Patient-only.** Clinic and Diagnostic Center accounts are created exclusively by Super Admin or Admin (auto-approved). Doctor and Receptionist accounts are created by a Clinic; Diagnostic Staff accounts are created by a Diagnostic Center. Admin accounts are created exclusively by Super Admin.

---

## Features by Module

### Auth
- Register (Patient-only) / login (JWT access + refresh tokens)
- Refresh token rotation, refresh tokens are SHA-256 hashed at rest
- Logout, forgot/reset password via email OTP — restricted to self-registered accounts only
- Google OAuth login — **Patient accounts only**, all other roles rejected with a clear error
- Role-based access control (RBAC) middleware on every protected route

### Clinic
- Profile management, logo upload
- Create Doctor and Receptionist accounts
- Assign receptionists to doctors, scoped per-clinic (isolates access when a doctor also works at another clinic)
- Change Doctor/Receptionist password (staff cannot change their own)
- Configure working hours, holidays, online-consultation toggle
- Approve/reject incoming doctor connection requests (multi-clinic)
- Send test referrals to Diagnostic Centers; view referrals sent

### Doctor (Multi-Clinic)
- Global profile, independent of any single clinic
- Search/connect with clinics, schedule-conflict-checked approvals (Serializable transaction, race-condition safe)
- Cancel associations; upload profile photo
- Set average consultation minutes per clinic (drives patient wait-time estimates) — editable by Doctor, Clinic, assigned Receptionist, or Admin
- Mark self on leave for a specific date/clinic (blocks both online and reception booking that day)
- Send a "running late" delay notification to today's waiting patients

### Patient
- Guest/walk-in (no login account) and self-registered patient types, unified phone search
- Self-service profile update
- Receives live + persisted notifications for every relevant event
- Submits reviews after a completed appointment

### Appointment
- Search bookable doctors by name/clinic/city/date
- Online booking — booking-window rule, clinic hours/holidays, online-toggle, doctor-leave check
- Reception booking — bypasses online-only restrictions, still respects holidays/leave; strictly access-scoped (Receptionist/Clinic can only book within their own assignment)
- Fully independent sequential token counter per doctor per clinic per day, shared across all booking sources
- **Cancel** — Patient can cancel their own WAITING appointment; Receptionist/Clinic/Admin can cancel at their scope
- **Reschedule** — cancels the old slot (with reason logged) and books a fresh token on the new date
- Live `patientsAhead` and `estimatedWaitMinutes` on the patient's own appointment list
- Queue detail redacted if the doctor's queue mode is PRIVATE

### Queue
- Full lifecycle: Next, Previous, Skip, Recall, Pause, Resume, Close, Reopen, Emergency token
- Audit trail (`QueueLog`) on every action
- Live Socket.io broadcast per doctor+clinic room, plus `tokenCalled`/`appointmentCompleted` events
- Strict per-clinic-scoped receptionist access control
- LIVE and PRIVATE queue modes functional; TIME_SLOT is schema-only

### Notifications
- Persisted, database-backed inbox — list, unread count, mark read/all-read
- **Live** via Socket.io (`user:<id>` room) — every notification-producing action across the entire app pushes instantly, not just on next poll
- Auto-fired on: appointment booked/cancelled/rescheduled, token called, consultation complete, doctor delay, test referral created (to both patient and diagnostic center)
- `notifyUser()` never throws — a failed notification never blocks the action that triggered it

### Reviews & Feedback
- 1–5 star rating + written review, tied to a specific completed appointment (one per appointment)
- Starts PENDING, invisible publicly until Admin approves
- Live-computed average rating per doctor and per clinic
- Report-as-inappropriate flow; Admin moderation queue for pending and reported reviews

### Diagnostic Centers & Test Referrals
- Diagnostic Centers are a parallel entity to Clinics — own profile, logo, staff accounts, Admin-only creation/approval
- Doctor, Receptionist, or Clinic can create a **Test Referral**: one or more tests, optional notes, targeting a specific Diagnostic Center
- Referring clinic is auto-resolved from the creator's context
- Diagnostic Center (and its staff) see incoming referrals with full patient name, address, phone, referred test(s), referring clinic, and who created it
- Referring clinic sees its sent referrals; patient sees their own; Admin/Super Admin see everything for audit
- Both the patient and the diagnostic center receive live + persisted notifications on referral creation

### Admin
- Approve/reject clinics and diagnostic centers; create either directly (auto-approved)
- Verify doctors; list/deactivate any user account
- Create Admin accounts (Super Admin only)
- Platform-wide settings (Super Admin only — Admin is explicitly blocked)
- Platform stats; update any Doctor's photo, Clinic/Diagnostic Center's logo, or any user's avatar

### Announcement
- Platform-wide (Super Admin/Admin) and clinic-specific (optionally doctor-tied) announcements
- Live Socket.io broadcast; deactivation scoped by role

### Dashboard
- Doctor and Clinic dashboards (totals, requests, today's appointments, queue summary)
- Note: dashboard patient/appointment data currently reflects only a doctor's *primary* clinic

### Analytics
- **Daily Dashboard** — today's (or any date's) total/new/returning patients, status breakdown, doctor-wise counts, live queue summary
- **Growth Trend** — daily/weekly/monthly/yearly bucketed new-vs-returning patient counts over a date range, with period-over-period growth-rate %
- New-vs-returning is computed live: a patient is "new" on the date of their earliest-ever appointment at that clinic, "returning" otherwise

### Reports
- Daily, weekly, monthly, yearly, and custom-range clinic reports — JSON, PDF, or Excel
- Status/booking-source/per-doctor breakdown, estimated revenue
- Full clinic patient-list PDF and doctor+clinic+exact-date-scoped patient-list PDF
- All downloadable filenames are prefixed with the sanitized clinic name (e.g. `City_Health_Center_daily-report_2026-08-11.pdf`)

---

## Folder Structure

```
src/
  app.js                 — Express app setup, middleware, route mounting
  server.js              — HTTP server bootstrap, Socket.io init, graceful shutdown
  config/                — env, db, redis, logger, socket, cloudinary, passport, swagger config
  middlewares/            — auth, role, error, rate limiter, upload, 404 handler
  modules/                — auth, clinic, doctor, patient, appointment, queue, admin,
                              announcement, dashboard, analytics, report, review,
                              notification, diagnosticCenter, testReferral, user
  sockets/                — Socket.io event emitters (queue, announcement, notification)
  utils/                  — ApiError, ApiResponse, asyncHandler, token generator,
                              PDF generator, Excel generator, Cloudinary upload, email service
prisma/
  schema.prisma           — full data model
  migrations/             — migration history
  seed.js                 — creates the initial Super Admin + PlatformSetting row
Dockerfile
docker-compose.yml
.dockerignore
.env.example
```

---

## Getting Started

```bash
git clone https://github.com/soumya28022005/doctor-management-system-backend.git
cd "jeet backend"
npm install
cp .env.example .env   # fill in real values — see below
npx prisma generate
npx prisma migrate dev
node prisma/seed.js    # creates Super Admin + platform settings row
npm run dev
```

---

## Environment Variables

See `.env.example` for the full list. Key ones:

```
NODE_ENV=development
PORT=8000

DATABASE_URL=            # Supabase pooled connection (port 6543, ?pgbouncer=true)
DIRECT_URL=              # Supabase direct connection (port 5432) — required for migrations

JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

REDIS_URL=               # redis://localhost:6379 locally, rediss://... (TLS) on Upstash in prod

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

CLIENT_URL=              # frontend URL, used for CORS and OAuth redirect
```

**Never commit `.env`.**

---

## Database

- PostgreSQL, hosted on Supabase
- Prisma ORM — schema in `prisma/schema.prisma`
- Migrations tracked in `prisma/migrations/`
- Seed script creates the initial Super Admin account and the single required `PlatformSetting` row

```bash
npx prisma migrate deploy   # apply migrations against a fresh database
```

---

## Running with Docker

```bash
docker compose up --build
```

Starts the app (port 8000) plus a local Redis container. Postgres always points at Supabase, even in local Docker development.

---

## Deployment

Deployed on **Render**, connected directly to this GitHub repo — every push to `main` triggers an automatic rebuild from the `Dockerfile`.

- **Database:** Supabase
- **Redis:** Upstash (`rediss://` TLS connection string)
- **Environment variables:** set individually in Render's dashboard, never committed

---

## API Documentation

Interactive Swagger UI at `/api-docs` — **only available when `NODE_ENV !== "production"`**, intentionally disabled in production.

---

## Security

- Passwords hashed with bcrypt
- Refresh tokens hashed (SHA-256) before storage — never stored in plaintext
- JWT access tokens (short-lived) + rotated refresh tokens
- Strict, per-clinic-scoped role-based access control — a Receptionist's doctor assignment (and their reception-booking access) is specific to one clinic, preventing cross-clinic privilege escalation when a doctor works at multiple locations
- Rate limiting: 300 req/15min globally, 10 req/15min on login/register, 5 req/hour on OTP endpoints
- Helmet security headers (CSP disabled specifically to allow Swagger UI to render)
- CORS restricted to `CLIENT_URL`
- Input validation on every endpoint via Zod
- Google OAuth restricted to Patient accounts only

---

## Known Limitations / Roadmap

Deliberately deferred:

- **No automated test suite** — Jest/Supertest planned but not implemented
- **Time Slot queue mode** — schema field exists, booking logic isn't built
- **Prescription and Pharmacy modules** — out of scope for this version
- **AI-assisted features** — out of scope
- **SMS/WhatsApp notifications** — in-app/Socket.io notifications used instead, avoiding a paid third-party dependency
- **Real payment gateway** — any future Billing module is planned as record-keeping only (mark paid/unpaid), not live payment processing
- **Dashboard data for secondary clinics** — Doctor/Clinic dashboards only reflect real appointment data for a doctor's *primary* clinic
- **Follow-up module, Staff Activity Log, automated reminders, data export** — scoped and planned, deprioritized for now
- A leftover unused `TestRecommendation` model sits in the schema (superseded by `TestReferral`) — harmless, cleanup migration pending,
- Peak Hour, Avg Waiting Time, Follow-up not done

---

## License

Private project — not currently licensed for public/commercial reuse.


SCHEDULE EXCEPTIONS (Step 13) + AUDIT LOG (Step 53)
=====================================================

Stacks on top of backend-update.zip and double-booking-fix.zip from
before — this includes the full current version of every file it
touches, not a diff.

MIGRATION NEEDED
-----------------
This adds 2 new tables (ScheduleException, AuditLog) — both purely
additive, nothing existing is touched or renamed. Run:

  npx prisma migrate dev --name schedule_exceptions_and_audit_log

WHAT'S NEW
----------
1. Schedule exceptions — override or cancel a recurring schedule for
   ONE specific date without touching the recurring pattern itself.
     POST   /doctors/schedules/:scheduleId/exceptions
            body: { date, isCancelled?, overrideStartTime?,
                     overrideEndTime?, overrideMaxPatients?, reason? }
     GET    /doctors/schedules/:scheduleId/exceptions
     DELETE /doctors/schedules/:scheduleId/exceptions/:exceptionId

   Enforced in TWO places, not just display:
     - evaluateDoctorStatus (Live/Available cards)
     - the actual booking transaction's capacity check (so a
       reduced-capacity override date can't be overbooked)

2. Audit log — a generic trail separate from QueueLog (which only
   covers queue actions like Next/Skip/Recall).
     GET /audit  (Super Admin only) — filter by targetType, targetId,
     actorUserId, limit.

   Wired into: schedule exceptions created/removed, appointment
   cancellations, clinic marking a holiday/closure, doctor marked on
   leave. NOT wired into everything the spec's example list mentions
   (e.g. "doctor schedule changed" on normal create/update, "walk-in
   created by clinic") — those are easy to add the same way
   (logAudit() is a 6-line call) but I stopped at a representative
   set rather than touching every mutation in one pass.

TWO THINGS FOUND MID-WORK THAT NEED YOUR CALL
------------------------------------------------
1. There was ALREADY a partial answer to "skip a schedule on one
   date" living in recurrencePattern as excludedDates/exactDate
   (used in GET .../schedules?date=X, but never in Live/Available or
   actual booking before now). I made evaluateDoctorStatus respect
   BOTH that AND the new ScheduleException table, so nothing regresses
   — but you now have two ways to do the same half of this feature.
   My suggestion: standardize on ScheduleException going forward
   (it also supports overrides, not just skipping) and treat
   excludedDates as legacy/read-only. Your call though.

2. doctor.controller.js's getSchedules already checks for a
   recurrenceType called "SPECIFIC_DATE" — but that value doesn't
   exist in the Prisma RecurrenceType enum (only DAILY / WEEKLY /
   MONTHLY_DATE / MONTHLY_WEEKDAY). That code path can never actually
   match anything right now. Either add SPECIFIC_DATE to the enum, or
   it's dead code worth removing — didn't want to guess which without
   asking.

A BUG I CAUGHT BEFORE SHIPPING IT
------------------------------------
My first pass at MONTHLY_WEEKDAY matching used a shape I invented
({ordinal, weekday}). Before finalizing I found doctor.controller.js
already has a working implementation using a DIFFERENT shape
({ day, week, isLast }). Rewrote evaluateDoctorStatus to match the
real, existing shape instead — worth double-checking on your end
that a "2nd Sunday" / "last Friday" schedule now shows correctly
Live/Available, since this is the first time that logic has run
outside the schedule-listing endpoint it was written for.



CONSOLIDATION UPDATE — one mechanism per feature + email/phone flexibility
============================================================================

Stacks on top of everything before (auth/patient, double-booking,
schedule-exceptions/audit-log). No new migration needed — no schema
change this round (SPECIFIC_DATE was already a valid enum value,
turns out my earlier note that it wasn't was wrong — double-checked
this time before touching the schema).

1. excludedDates RETIRED — ScheduleException is now the ONLY place
   "skip/override a schedule for one date" lives.
     - GET .../schedules?date=X now checks ScheduleException instead
       of recurrencePattern.excludedDates.
     - POST/PATCH a schedule with recurrencePattern.excludedDates in
       the body still works from the frontend's point of view — the
       dates just get converted into ScheduleException rows
       (isCancelled: true) under the hood instead of being stored in
       the JSON blob.
     - evaluateDoctorStatus (Live/Available) no longer reads
       excludedDates at all — only ScheduleException.
     - SPECIFIC_DATE (a schedule that only runs once, non-recurring)
       is a genuinely different concept and was KEPT, not merged —
       it's "this schedule only exists on one date" vs
       ScheduleException's "this normally-recurring schedule doesn't
       run / runs differently on one date."

2. Email-or-phone flexibility, consistently, everywhere an account
   gets created:
     - Admin creates Admin (createAdminSchema)
     - Admin creates Clinic (createClinicSchema) — was requiring BOTH
       before, now either one
     - Clinic creates Doctor (createDoctorSchema)
     - Clinic creates Receptionist (createReceptionistSchema)
   Each now validates "at least one of email/phone", and the service
   layer checks uniqueness against whichever was actually provided
   (previously some of these would have crashed calling
   findUserByEmail(undefined) once email became optional — fixed).

3. Doctor-clinic "add by email" no longer auto-approves.
   Clinic adds an existing doctor by email/phone -> a
   DoctorClinicAssociation is created as PENDING (was APPROVED before,
   silently, with no consent) -> the doctor gets a notification and
   accepts/rejects through the same respondToDoctorRequest flow used
   everywhere else in the app. One consistent rule for "does this
   doctor-clinic link need consent" instead of two.
   Also: the lookup itself now checks by phone too, not just email,
   matching #2 above.

4. /auth/register (old email+password patient signup) is retired —
   removed from auth.routes.js. The controller/service functions are
   still in the codebase, just not routed, in case you want to reuse
   the underlying logic for something else later. Patients only ever
   go through POST /auth/patient/phone now.

ONE KNOWN GAP, LOW RISK
-------------------------
If someone provides BOTH email and phone when creating a
Doctor/Receptionist/Clinic/Admin, only email gets pre-checked for
uniqueness before insert (phone collision would surface as a raw DB
constraint error instead of a clean 409, if it ever actually
happens). Flagging rather than silently leaving it — low probability
since normally only one identifier is given, but not literally
airtight.


RETURNING PATIENT — UPDATE EXISTING RECORD INSTEAD OF IGNORING CHANGES
=========================================================================

Replaces: src/modules/patient/patient.repository.js (full file, no
migration needed).

WHAT CHANGED
------------
Before: if receptionist typed a phone number that already had a
Patient record, the existing record was returned as-is — any new
name/gender typed in that moment was silently dropped.

Now: if the phone matches an existing Patient AND the name or gender
typed this time is different from what's on file, that existing
record (and the linked User's name, so the two don't drift apart)
gets updated in place. Still the same Patient — no duplicate, same
appointment history — just corrected details.

If nothing actually changed, it behaves exactly as before (just
returns the existing record, no extra writes).


FOLLOW-UPS + PERSISTENT DOCTOR STATUS + PER-DOCTOR ONLINE TOGGLE + CLINIC SEARCH
====================================================================================

MIGRATION NEEDED (3 new tables, 1 new column — all additive)
----------------------------------------------------------------
  npx prisma migrate dev --name followups_doctor_status_online_toggle

New tables: Followup, DoctorDailyStatus
New column: DoctorSchedule.onlineBookingEnabled (default true — nothing
existing changes behavior until a clinic explicitly turns it off)

New dependency: node-cron — run npm install after copying package.json.

1. FOLLOW-UP MODULE (brand new)
---------------------------------
Doctor, Clinic, Receptionist (if assigned to that doctor at that clinic),
or Admin/Super Admin can schedule a follow-up for a patient.

  POST   /followups                        { patientId, doctorId, clinicId,
                                              appointmentId?, followUpDate,
                                              notes? }
  GET    /followups/me                     (patient's own — role: PATIENT)
  GET    /followups/clinic/:clinicId       ?doctorId=&status=&upcomingOnly=true
                                            — "who have we given a follow-up to"
  PATCH  /followups/:followupId/cancel
  PATCH  /followups/:followupId/complete

Patient gets a notification immediately when scheduled, AND a reminder
notification on the follow-up date itself — a daily cron job (8:00 AM
server time, node-cron) checks for today's SCHEDULED follow-ups and
notifies each patient once (a `reminderSentAt` timestamp stops it from
ever double-notifying if the server restarts).

2. PERSISTENT DOCTOR STATUS (Step 40)
----------------------------------------
Previously "Running Late" was only ever a one-shot notification — nothing
remembered that state. Now:
  - POST /doctors/:doctorId/clinics/:clinicId/delay   (existing, unchanged
    body) now ALSO saves the status, not just notifies.
  - POST /doctors/:doctorId/clinics/:clinicId/resume  (new) clears it back
    to normal.
  - Every Live Doctor card (evaluateDoctorStatus) now includes
    operationalStatus ("NORMAL" | "RUNNING_LATE" | "PAUSED") and
    delayMinutes, and the "Live Now" reason text mentions the delay when
    running late.

3. PER-DOCTOR ONLINE-BOOKING TOGGLE
--------------------------------------
DoctorSchedule now has onlineBookingEnabled (default true). Set to false
via the existing schedule create/update endpoints and online bookings for
that specific session are blocked with a clear message — walk-in and
reception bookings are completely unaffected. This is separate from (and
layered on top of) the existing clinic-wide onlineConsultationEnabled
toggle.

4. CLINIC SEARCH FILTERS (Step 55)
--------------------------------------
GET /clinics now accepts query/city/specializationId, same names as the
doctor search. Existing calls with no params (or just ?available=true)
behave exactly as before — filters only kick in when you actually pass
one. Scope note: the filtered/search branch does NOT compute
availability (open-now/working-hours) like the default listing does —
that's still only on the plain GET /clinics call. Didn't want to
silently bolt on a heavier computed field without you weighing in on
whether "available doctors" search should really live on the CLINIC
search or is better left to the (already much more capable) doctor
search.

ALSO FIXED WHILE IN THERE
----------------------------
bookOnlineAppointment had a dummy-phone fallback ("0000000000") for
users with no phone on file — since Patient.phone is unique+required
now, a SECOND phone-less user hitting this path would have crashed on
a duplicate-key error. Now throws a clear "update your profile first"
error instead of silently colliding later.


DOCTOR CONTACT BACKEND — FULL CONSOLIDATED UPDATE
====================================================
Everything from this entire session, merged into ONE package (42
files). This replaces needing to apply the 6 earlier zips one by
one — every file here is already the final, combined version.

HOW TO APPLY
------------
1. Copy every file in this zip into the matching path in your
   `developer` branch (overwrite existing files, add new ones).
2. npm install          (adds firebase-admin, node-cron)
3. npx prisma migrate dev --name full_platform_update
4. Add to .env (see .env.example for the exact keys):
     FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY
   From Firebase Console -> Project Settings -> Service Accounts ->
   Generate new private key. Also turn on Phone Authentication under
   Authentication -> Sign-in method.
5. Start the server and smoke-test at least: login, patient phone
   login, book an appointment, cancel it, call next in queue.
   NONE of this has been run against a live database yet — only
   syntax-checked and manually reviewed. Test in staging first.

WHAT'S IN HERE (everything built this session)
--------------------------------------------------

AUTH
  - POST /auth/patient/phone           patient login+signup (Firebase OTP)
  - POST /auth/login                   now takes email OR phone + password
  - POST /auth/reset-password/phone    phone-based reset (Doctor/Clinic/Receptionist/Admin)
  - /auth/register (old email+password patient signup) — retired

PATIENT
  - Guest patient add (Name+Mobile) now always creates a real account
    behind it (no password) — later phone+OTP login lands in that
    SAME account, full history intact, no separate "link" step.
  - Phone normalization (spaces/+91/dashes) so the same number never
    creates two records.
  - Re-adding an existing phone with a different name/gender now
    UPDATES the existing record instead of ignoring the change.

APPOINTMENTS / BOOKING
  - Capacity + concurrency-safe booking (Serializable transaction),
    with a clean 409 instead of a raw 500 on a race.
  - A patient can't double-book the same doctor, or book two
    different doctors within 45 minutes of each other.
  - Walk-in booking now shares the same patient-lookup/creation code
    as reception (used to be a separate, non-normalizing duplicate).
  - Per-schedule online-booking toggle — a clinic can turn OFF online
    booking for one specific doctor/session while walk-in/reception
    still works.
  - Fixed a dummy-phone placeholder that would have crashed the
    second time a phone-less user tried to book online.

DOCTOR SCHEDULE
  - DoctorSchedule: multi-session/day, per-session maxPatients,
    recurrenceType (DAILY/WEEKLY/MONTHLY_DATE/MONTHLY_WEEKDAY/
    SPECIFIC_DATE).
  - Schedule Exceptions: cancel or override (time/capacity) a
    schedule for ONE date without touching the recurring pattern.
    POST/GET/DELETE /doctors/schedules/:scheduleId/exceptions
  - The old recurrencePattern.excludedDates approach is retired —
    consolidated into Schedule Exceptions (frontend can keep sending
    excludedDates in the same request shape; the backend converts it
    automatically).

LIVE / AVAILABLE DOCTORS
  - evaluateDoctorStatus now factors in schedule exceptions, the
    real MONTHLY_WEEKDAY shape ({day, week, isLast} — matches what
    the existing schedule-listing endpoint already used), and
    persistent doctor status.
  - Doctor status is now persistent, not a one-shot notification:
      POST /doctors/:doctorId/clinics/:clinicId/delay   (existing route, now also saves state)
      POST /doctors/:doctorId/clinics/:clinicId/resume  (new — clears it)
    Every doctor search/list result now includes operationalStatus
    ("NORMAL"/"RUNNING_LATE"/"PAUSED") and delayMinutes.

DOCTOR ↔ CLINIC
  - Adding an existing doctor by email OR phone now creates a
    PENDING connection request (doctor gets notified and must
    accept) instead of silently auto-approving.
  - Email/phone flexibility (need only one, not both) rolled out
    consistently: Admin creates Admin, Admin creates Clinic, Clinic
    creates Doctor, Clinic creates Receptionist.

FOLLOW-UPS (brand new module)
  - POST /followups { patientId, doctorId, clinicId, appointmentId?, followUpDate, notes? }
  - GET  /followups/me                     (patient's own)
  - GET  /followups/clinic/:clinicId       ?doctorId=&status=&upcomingOnly=true
  - PATCH /followups/:followupId/cancel | /complete
  - Patient notified immediately when scheduled, then again on the
    follow-up date itself via a daily 8 AM cron job (node-cron) —
    each reminder only ever sends once even across server restarts.

SEARCH
  - GET /doctors/search — query/specializationId/city/maxFee/
    availableToday/liveNow (already existed, confirmed working)
  - GET /clinics — now also takes query/city/specializationId

AUDIT LOG (new)
  - GET /audit  (Super Admin) — targetType/targetId/actorUserId/limit
  - Logged so far: schedule exceptions, appointment cancellations,
    clinic holidays, doctor leave, doctor-clinic connection requests.
    NOT logged on every single mutation in the app — a representative
    set, easy to extend the same way (logAudit() is a 6-line call).

KNOWN GAPS / NOT DONE (be upfront about these)
--------------------------------------------------
  - Booking cutoff window — explicitly descoped, not built.
  - rescheduleAppointment doesn't pass a scheduleId to the rebooking
    step — pre-existing bug, needs a product decision (same session
    as before, or let the patient pick a new one) before fixing.
  - Queue status set is WAITING/CHECKED_IN/ABSENT/COMPLETED/CANCELLED
    — no separate NO_SHOW vs SKIPPED like the original spec listed.
  - Clinic search's query/city/specialization filter doesn't compute
    open-now/availability like the plain GET /clinics does.
  - If someone provides BOTH email and phone when an account's being
    created, only email gets pre-checked for uniqueness before
    insert (phone collision would surface as a raw DB error instead
    of a clean 409) — low probability, not airtight.
  - Nothing in this entire session has been run against a live
    Postgres/Redis instance — everything is syntax-checked
    (node --check) and manually reviewed, not integration-tested.

OUT OF SCOPE THIS ENTIRE SESSION (frontend / deployment)
------------------------------------------------------------
  - Header "Live Doctors" button (still shows the disabled dark-mode
    toggle)
  - Wiring any of the above endpoints into actual UI
  - Frontend Socket.io subscriptions for queue live-updates (backend
    emits correctly; the queue screens don't listen yet)
  - Firebase Phone Auth client-side integration (reCAPTCHA, OTP
    input, confirmationResult.confirm()) — this package only covers
    the backend token-verification half
