import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  phone: z.string().optional(),
  dob: z.string().datetime().optional(),
});

export const loginSchema = z
  .object({
    email: z.string().email("Invalid email").optional(),
    phone: z.string().optional(),
    password: z.string().min(1, "Password is required"),
  })
  .refine((data) => data.email || data.phone, {
    message: "Email or phone number is required",
  });

// Patient-only: idToken comes from the frontend's Firebase Phone Auth SDK
// after the user confirms the SMS OTP. `name` is only required the first
// time (brand-new phone number, no account yet).
export const patientPhoneAuthSchema = z.object({
  phone: z.string().min(10, "Valid phone number required"),
  otp: z.string().length(6, "OTP must be 6 digits"),
  name: z.string().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email"),
});

export const resetPasswordSchema = z.object({
  email: z.string().email("Invalid email"),
  otp: z.string().length(6, "OTP must be 6 digits"),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

// Phone-based reset for Doctor/Clinic/Receptionist/Admin/Super Admin.
// idToken already proves phone ownership (Firebase OTP was confirmed on the
// frontend), so this is a single call — no separate "send OTP" step needed.
export const resetPasswordByPhoneSchema = z.object({
  phone: z.string().min(10),
  otp: z.string().length(6),
  newPassword: z.string().min(6),
});

// Clinic Profile Update or Registration Schema
export const clinicProfileSchema = z.object({
  clinicName: z.string().min(1, "Clinic name is required").optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  googleMapsUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

