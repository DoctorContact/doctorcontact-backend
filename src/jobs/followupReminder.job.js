import cron from "node-cron";
import logger from "../config/logger.config.js";
import { findDueFollowupsForReminder, markReminderSent } from "../modules/followup/followup.repository.js";
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

// Runs once a day at 8:00 AM server time. Not "no polling" territory — this
// is a scheduled batch job, not a client-facing real-time channel; the
// actual notification delivery to the patient still goes out over the
// existing Socket.io + persisted-notification path.
export const startFollowupReminderJob = () => {
  cron.schedule("0 8 * * *", () => {
    runFollowupReminders().catch((err) => logger.error(`[followup-reminder] job crashed: ${err.message}`));
  });
};

// Exported for manual testing/triggering without waiting for the schedule.
export { runFollowupReminders };
