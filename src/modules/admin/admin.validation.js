import { z } from "zod";

const booleanQueryParam = z
  .enum(["true", "false"])
  .optional()
  .transform((val) => (val === undefined ? undefined : val === "true"));

export const listUsersQuerySchema = z.object({
  role: z.enum(["SUPER_ADMIN", "ADMIN", "CLINIC", "RECEPTIONIST", "DOCTOR", "PATIENT"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const toggleUserStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listClinicsQuerySchema = z.object({
  isApproved: booleanQueryParam,
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const updateSettingsSchema = z.object({
  bookingWindowMinutes: z.number().int().positive("Must be a positive number of minutes"),
});

// superadmin create admin

export const createAdminSchema = z
  .object({
    name: z.string().min(2, "Name is required"),
    email: z.string().email("Invalid email").optional(),
    phone: z.string().min(10, "Invalid phone number").optional(),
    password: z.string().min(6, "Password must be at least 6 characters"),
  })
  .refine((data) => data.email || data.phone, { message: "Email or phone number is required" });

export const createClinicSchema = z
  .object({
    name: z.string().min(2, "Name is required"),
    email: z.string().email("Invalid email").optional(),
    phone: z.string().min(10, "Invalid phone number").optional(),
    password: z.string().min(6, "Password must be at least 6 characters"),
    clinicName: z.string().min(2, "Clinic name is required"),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
  })
  .refine((data) => data.email || data.phone, { message: "Email or phone number is required" });

export const createDiagnosticCenterSchema = z.object({
  name: z.string().min(2, "Name is required"),
  email: z.string().email("Invalid email format"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  phone: z.string().optional(),
  centerName: z.string().min(2, "Center name is required"),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  hasHomeService: z.boolean().optional(), // 🟢 নতুন ফিল্ড
});

// Admin onboards a doctor. clinicId is intentionally OPTIONAL — an Admin can
// add a doctor who is not attached to any clinic yet.
export const createDoctorSchema = z
  .object({
    name: z.string().min(2, "Name is required"),
    email: z.string().email("Invalid email").optional(),
    phone: z.string().min(10, "Phone number is required").max(15).optional(),
    password: z.string().min(6, "Password must be at least 6 characters"),
    clinicId: z.string().uuid().optional(),
    specialization: z.string().optional(),
    specializationIds: z.array(z.string().uuid()).optional(),
    qualification: z.string().optional(),
    experience: z.coerce.number().int().min(0).optional(),
    fee: z.coerce.number().min(0).optional(),
  })
  .refine((d) => d.email || d.phone, {
    message: "Either email or phone is required",
    path: ["email"],
  });

export const setFeaturedDoctorSchema = z.object({
  isFeatured: z.boolean(),
  featuredOrder: z.number().int().nonnegative().optional(),
});

export const updateClinicAdminSchema = z.object({
  clinicName: z.string().min(2, "Clinic name is required").optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
});