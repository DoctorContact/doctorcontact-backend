import { z } from "zod";

export const searchPatientSchema = z.object({
  phone: z.string().min(4, "Phone number is required"),
});

// Receptionist/Clinic quick-add: Name + Mobile only (matches minimum patient
// record requirement). This now also creates a login-capable account behind
// the scenes — see patient.service.createGuest.
export const createGuestPatientSchema = z.object({
  name: z.string().min(2, "Name is required"),
  phone: z.string().min(4, "Phone number is required"),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
});

export const updatePatientProfileSchema = z.object({
  name: z.string().min(2).optional(),
  dob: z.string().datetime().optional(),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]).optional(),
  bloodGroup: z.string().optional(),
});
