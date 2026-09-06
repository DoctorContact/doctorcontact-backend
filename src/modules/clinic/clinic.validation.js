import { z } from "zod";

export const updateClinicProfileSchema = z.object({
  clinicName: z.string().min(1, "Clinic name is required").optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  
  // 🟢 NEW: Add these so Zod doesn't strip them before saving!
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  googleMapsUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

export const createDoctorSchema = z
  .object({
    name: z.string().min(2, "Name is required"),
    email: z.string().email("Invalid email").optional(),
    phone: z.string().min(10, "Invalid phone number").optional(),
    password: z.string().optional().refine((val) => !val || val.length >= 6, {
      message: "Password must be at least 6 characters",
    }),
    specialization: z.string().optional(), // Kept for legacy/fallback text
    specializationIds: z.array(z.string().uuid()).optional(), // DB-driven specializations
    qualification: z.string().optional(),
    experience: z.number().int().nonnegative().optional(),
    fee: z.number().nonnegative().optional(),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "startTime must be in HH:mm 24-hour format")
      .optional(),
  })
  .refine((data) => data.email || data.phone, { message: "Email or phone number is required" });

export const updateDoctorSchema = z.object({
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "startTime must be in HH:mm 24-hour format")
    .optional(),
  specialization: z.string().optional(),
  specializationIds: z.array(z.string().uuid()).optional(), // DB-driven specializations
  qualification: z.string().optional(),
  experience: z.number().int().nonnegative().optional(),
  fee: z.number().nonnegative().optional(),
  queueMode: z.enum(["LIVE", "PRIVATE", "TIME_SLOT"]).optional(),
});

export const createReceptionistSchema = z
  .object({
    name: z.string().min(2, "Name is required"),
    email: z.string().email("Invalid email").optional(),
    phone: z.string().min(10, "Invalid phone number").optional(),
    password: z.string().min(6, "Password must be at least 6 characters"),
  })
  .refine((data) => data.email || data.phone, { message: "Email or phone number is required" });

export const assignDoctorsSchema = z.object({
  receptionistId: z.string().uuid(),
  doctorIds: z.array(z.string().uuid()).min(1, "At least one doctor is required"),
});

export const changeStaffPasswordSchema = z.object({
  userId: z.string().uuid(),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

export const searchClinicsByNameSchema = z.object({
  name: z.string().min(1, "Name is required"),
});

export const setWorkingHoursSchema = z.object({
  workingHours: z
    .array(
      z.object({
        // Transform kore always UPPERCASE kore nebe, jate "Monday" pathaleo error na ase
        dayOfWeek: z.string().transform((v) => v.toUpperCase()).pipe(
          z.enum([
            "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
          ])
        ),
        isClosed: z.boolean().default(false),
        // Empty string ("") ba null asle jate bad request na hoy, tar jonno refine kora holo
        openTime: z
          .string()
          .nullable()
          .optional()
          .refine(
            (val) => !val || /^([01]\d|2[0-3]):([0-5]\d)$/.test(val),
            "openTime must be HH:mm"
          ),
        closeTime: z
          .string()
          .nullable()
          .optional()
          .refine(
            (val) => !val || /^([01]\d|2[0-3]):([0-5]\d)$/.test(val),
            "closeTime must be HH:mm"
          ),
      })
    )
    .min(1, "At least one day must be provided"),
});
export const addHolidaySchema = z.object({
  date: z.string(), // YYYY-MM-DD
  reason: z.string().optional(),
});

export const toggleOnlineConsultationSchema = z.object({
  enabled: z.boolean(),
});

export const toggleAvailabilitySchema = z.object({
  isAvailableToday: z.boolean(),
});