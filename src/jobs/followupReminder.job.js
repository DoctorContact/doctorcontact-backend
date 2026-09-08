import cron from "node-cron";
import logger from "../config/logger.config.js";
import {
  findDueFollowupsForReminder,
  markReminderSent,
  findAutoFollowupCandidates,
  autoFollowupExists,
  createFollowup,
} from "../modules/followup/followup.repository.js";
import { notifyUser } from "../modules/notification/notification.service.js";

const runFollowupReminders = async () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const due = await findDueFollowupsForReminder(today);

  for (const followup of due) {
    try {
      if (followup.patient.userId) {
        await notifyUser({
          userId: followup.patient.userId,
          type: "GENERAL",
          title: "Follow-up Reminder",
          message: `You have a follow-up visit today with Dr. ${followup.doctor.user.name} at ${followup.clinic.clinicName}.`,
          meta: { followupId: followup.id },
        });
      }
      await markReminderSent(followup.id);
    } catch (err) {
      // One bad row should never stop the rest of today's reminders.
      logger.error(`[followup-reminder] failed for followup ${followup.id}: ${err.message}`);
    }
  }

  if (due.length) logger.info(`[followup-reminder] sent ${due.length} follow-up reminder(s)`);
};

// Clinics with `autoFollowupEnabled` get a follow-up auto-created for any patient
// whose last completed visit was ~1 month ago and who has not returned since.
const runAutoFollowups = async () => {
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - 31);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 1); // a 1-day window, 31 days ago

  const followUpDate = new Date();
  followUpDate.setUTCHours(0, 0, 0, 0);
  followUpDate.setUTCDate(followUpDate.getUTCDate() + 1); // notify from tomorrow

  const candidates = await findAutoFollowupCandidates({ from, to });
  let created = 0;

  for (const a of candidates) {
    try {
      if (await autoFollowupExists(a.patientId, a.clinicId, a.id)) continue;

      const followup = await createFollowup({
        patientId: a.patientId,
        doctorId: a.doctorId,
        clinicId: a.clinicId,
        appointmentId: a.id,
        followUpDate,
        notes: "Auto-scheduled: no visit in the last month.",
        createdByUserId: a.clinic.userId,
        createdByRole: "CLINIC",
      });

      if (a.patient.userId) {
        await notifyUser({
          userId: a.patient.userId,
          type: "GENERAL",
          title: "Follow-up Suggested",
          message: `It's been a month since your visit at ${a.clinic.clinicName}. A follow-up has been scheduled for you.`,
          meta: { followupId: followup.id, auto: true },
        });
      }
      created += 1;
    } catch (err) {
      logger.error(`[auto-followup] failed for appointment ${a.id}: ${err.message}`);
    }
  }

  if (created) logger.info(`[auto-followup] created ${created} follow-up(s)`);
};

// Runs once a day at 8:00 AM server time. Not "no polling" territory — this
// is a scheduled batch job, not a client-facing real-time channel; the
// actual notification delivery to the patient still goes out over the
// existing Socket.io + persisted-notification path.
export const startFollowupReminderJob = () => {
  cron.schedule("0 8 * * *", () => {
    runFollowupReminders().catch((err) => logger.error(`[followup-reminder] job crashed: ${err.message}`));
    runAutoFollowups().catch((err) => logger.error(`[auto-followup] job crashed: ${err.message}`));
  });
};

// Exported for manual testing/triggering without waiting for the schedule.
export { runFollowupReminders, runAutoFollowups };
