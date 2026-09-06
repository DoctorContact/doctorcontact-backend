import { z } from "zod";

export const searchDoctorsByNameSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

export const sendRequestToDoctorSchema = z.object({
  doctorId: z.string().uuid(),
  fee: z.number().nonnegative().optional(),
  dayOfWeek: z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]).default("MONDAY"), // Fallback for legacy association
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "startTime must be HH:mm"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "endTime must be HH:mm"),
  maxPatients: z.number().int().positive().default(20),
  recurrenceType: z.enum(["DAILY", "WEEKLY", "MONTHLY_DATE", "MONTHLY_WEEKDAY"]).default("DAILY"),
  recurrencePattern: z.record(z.any()).optional().default({}),
}).refine((data) => data.startTime < data.endTime, {
  message: "endTime must be after startTime",
});

// ADD THIS SCHEMA:
export const sendRequestToClinicSchema = z.object({
  clinicId: z.string().uuid(), // Assuming you are targeting a clinic by its UUID
  fee: z.number().nonnegative().optional(),
  dayOfWeek: z.enum([
    "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
  ]),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "startTime must be HH:mm"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "endTime must be HH:mm"),
}).refine((data) => data.startTime < data.endTime, {
  message: "endTime must be after startTime",
});

export const respondToRequestSchema = z.object({
  action: z.enum(["ACCEPT", "REJECT"]),
});

export const updateConsultationTimeSchema = z.object({
  avgConsultationMinutes: z.number().int().positive().max(180),
});

export const markLeaveSchema = z.object({
  date: z.string(),
  reason: z.string().max(500).optional(),
});

export const delayNotificationSchema = z.object({
  delayMinutes: z.number().int().positive().max(300),
});

// === NEW: Schedule Validation Schemas ===
export const createScheduleSchema = z.object({
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "startTime must be HH:mm"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "endTime must be HH:mm"),
  maxPatients: z.number().int().positive().default(20),
  // 🟢 ADDED SPECIFIC_DATE BELOW
  recurrenceType: z.enum(["DAILY", "WEEKLY", "MONTHLY_DATE", "MONTHLY_WEEKDAY", "SPECIFIC_DATE"]),
  recurrencePattern: z.record(z.any()), 
  isActive: z.boolean().default(true),
  onlineBookingEnabled: z.boolean().default(true),
}).refine((data) => data.startTime < data.endTime, {
  message: "endTime must be after startTime",
});

export const updateScheduleSchema = z.object({
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  maxPatients: z.number().int().positive().optional(),
  // 🟢 ADDED SPECIFIC_DATE BELOW
  recurrenceType: z.enum(["DAILY", "WEEKLY", "MONTHLY_DATE", "MONTHLY_WEEKDAY", "SPECIFIC_DATE"]).optional(),
  recurrencePattern: z.record(z.any()).optional(),
  isActive: z.boolean().optional(),
  onlineBookingEnabled: z.boolean().optional(),
}).refine((data) => {
  if (data.startTime && data.endTime) return data.startTime < data.endTime;
  return true;
}, {
  message: "endTime must be after startTime",
});

// === NEW: Step 29 Advanced Search ===
export const advancedSearchSchema = z.object({
  query: z.string().optional(), // Can match Doctor Name or Clinic Name
  specializationId: z.string().uuid().optional(),
  city: z.string().optional(),
  maxFee: z.coerce.number().nonnegative().optional(),
  availableToday: z.enum(["true", "false"]).optional().transform(v => v === "true"),
  liveNow: z.enum(["true", "false"]).optional().transform(v => v === "true"),
});

// === Step 13: Schedule Exceptions ===
export const scheduleExceptionSchema = z.object({
  date: z.string().min(8, "date is required (YYYY-MM-DD)"),
  isCancelled: z.boolean().optional().default(false),
  overrideStartTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  overrideEndTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  overrideMaxPatients: z.number().int().positive().optional(),
  reason: z.string().optional(),
}).refine((data) => data.isCancelled || data.overrideStartTime || data.overrideEndTime || data.overrideMaxPatients, {
  message: "Provide isCancelled or at least one override field",
});