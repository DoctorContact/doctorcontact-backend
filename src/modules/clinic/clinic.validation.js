import { z } from "zod";

export const updateClinicProfileSchema = z.object({
  clinicName: z.string().min(1, "Clinic name is required").optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
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
    medicalSystem: z.enum(["ALLOPATHY", "HOMEOPATHY", "AYURVEDA"]).optional(),
    specialization: z.string().optional(), 
    specializationIds: z.array(z.string().uuid()).optional(),
    qualification: z.string().optional(),
    experience: z.number().int().nonnegative().optional(),
    fee: z.number().nonnegative().optional(),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "startTime must be in HH:mm 24-hour format")
      .optional(),
    endTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "endTime must be in HH:mm 24-hour format")
      .optional(),
    dayOfWeek: z
      .enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"])
      .optional(),
    recurrenceType: z.enum(["DAILY", "WEEKLY", "MONTHLY_DATE", "MONTHLY_WEEKDAY", "SPECIFIC_DATE"]).optional(),
    recurrencePattern: z.record(z.any()).optional(),
  })
  .refine((data) => data.email || data.phone, { message: "Email or phone number is required" })
  .refine((data) => {
    if (!data.startTime || !data.endTime) return true;
    return data.startTime !== data.endTime; 
  }, {
    message: "Start time and end time cannot be exactly the same",
    path: ["endTime"],
  });

export const updateDoctorSchema = z.object({
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "startTime must be in HH:mm 24-hour format")
    .optional(),
  specialization: z.string().optional(),
  specializationIds: z.array(z.string().uuid()).optional(),
  qualification: z.string().optional(),
  experience: z.number().int().nonnegative().optional(),
  fee: z.number().nonnegative().optional(),
  queueMode: z.enum(["LIVE", "PRIVATE", "TIME_SLOT"]).optional(),
  medicalSystem: z.enum(["ALLOPATHY", "HOMEOPATHY", "AYURVEDA"]).optional(),
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

// 🟢 FIX: This was causing the Backend Crash!
export const searchClinicsByNameSchema = z.object({
  name: z.string().optional().default(""), // Changed from .min(1) so empty searches don't crash the server
});

export const setWorkingHoursSchema = z.object({
  workingHours: z
    .array(
      z.object({
        dayOfWeek: z.string().transform((v) => v.toUpperCase()).pipe(
          z.enum([
            "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY",
          ])
        ),
        isClosed: z.boolean().default(false),
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
  date: z.string(), 
  reason: z.string().optional(),
});

export const toggleOnlineConsultationSchema = z.object({
  enabled: z.boolean(),
});

export const toggleAvailabilitySchema = z.object({
  isAvailableToday: z.boolean(),
});