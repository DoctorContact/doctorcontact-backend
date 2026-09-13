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

// Diagnostic-center working hours (Lab Manager). Field/verb names here
// intentionally match what the frontend (useDiagnosticCenter.ts /
// diagnosticCenter/schedule page) already sends and expects — PUT with a
// `hours` array, response under `hours` — rather than the clinic module's
// `workingHours` naming, since that UI was already built against this shape.
export const setWorkingHoursSchema = z.object({
  hours: z
    .array(
      z.object({
        dayOfWeek: z.string().transform((v) => v.toUpperCase()).pipe(
          z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"])
        ),
        isClosed: z.boolean().default(false),
        openTime: z
          .string()
          .nullable()
          .optional()
          .refine((val) => !val || /^([01]\d|2[0-3]):([0-5]\d)$/.test(val), "openTime must be HH:mm"),
        closeTime: z
          .string()
          .nullable()
          .optional()
          .refine((val) => !val || /^([01]\d|2[0-3]):([0-5]\d)$/.test(val), "closeTime must be HH:mm"),
      })
    )
    .min(1, "At least one day is required"),
});