import { z } from "zod";

export const updateCenterProfileSchema = z.object({
  centerName: z.string().min(2, "Center name is required").optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  // === NEW: Step 25 Location & Contact Fields ===
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  googleMapsUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  hasHomeService: z.boolean().optional(),
});

export const createStaffSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Invalid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  phone: z.string().optional(),
});

export const changeStaffPasswordSchema = z.object({
  userId: z.string().uuid(),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

// === NEW: Step 26 Diagnostic Tests Validation ===
export const addCenterTestSchema = z.object({
  testId: z.string().uuid("Invalid Test ID"),
  price: z.number().nonnegative("Price cannot be negative").optional(),
  isAvailable: z.boolean().default(true),
});

export const updateCenterTestSchema = z.object({
  price: z.number().nonnegative().optional(),
  isAvailable: z.boolean().optional(),
});