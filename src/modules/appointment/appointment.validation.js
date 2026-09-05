import { z } from "zod";

export const searchDoctorsSchema = z.object({
  q: z.string().optional(),
  doctorName: z.string().optional(),
  clinicName: z.string().optional(),
  clinicId: z.string().uuid().optional(),
  city: z.string().optional(),
  date: z.string().optional(),
});

export const bookOnlineAppointmentSchema = z.object({
  doctorId: z.string().uuid(),
  clinicId: z.string().uuid(),
  scheduleId: z.string().uuid("scheduleId is required to identify the session"), // NEW
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
});

export const bookReceptionAppointmentSchema = z.object({
  doctorId: z.string().uuid(),
  clinicId: z.string().uuid(),
  scheduleId: z.string().uuid("scheduleId is required"), // NEW
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  patientId: z.string().uuid().optional(),
  newPatient: z.object({
    name: z.string(),
    phone: z.string(),
  }).optional(),
  bookingSource: z.enum(["RECEPTION", "WALK_IN", "PHONE"]).optional(),
}).refine(data => data.patientId || data.newPatient, {
  message: "Either patientId or newPatient details must be provided",
});

export const walkInAppointmentSchema = z.object({
  doctorId: z.string().uuid(),
  scheduleId: z.string().uuid("scheduleId is required for walk-in"), // NEW
  name: z.string().min(2, "Patient name is required"),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, "Valid phone number required"),
});

export const cancelAppointmentSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const rescheduleAppointmentSchema = z.object({
  date: z.string(),
});