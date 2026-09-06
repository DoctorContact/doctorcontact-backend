import { z } from "zod";

export const scheduleFollowupSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  clinicId: z.string().uuid(),
  appointmentId: z.string().uuid().optional(),
  followUpDate: z.string().min(8, "followUpDate is required (YYYY-MM-DD)"),
  notes: z.string().optional(),
});

export const listClinicFollowupsQuerySchema = z.object({
  doctorId: z.string().uuid().optional(),
  status: z.enum(["SCHEDULED", "COMPLETED", "CANCELLED"]).optional(),
  upcomingOnly: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
});
