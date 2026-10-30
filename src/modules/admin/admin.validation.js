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
  limit: z.coerce.number().int().positive().max(1000).default(20),
});

export const updateSettingsSchema = z.object({
  bookingWindowMinutes: z.number().int().positive("Must be a positive number of minutes"),
});

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
  whatsapp: z.string().optional(),
  googleMapsUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  hasHomeService: z.boolean().optional(), 
});

// specializationIds can arrive as a real array (JSON request) OR as a string
// (multipart/form-data): a JSON string '["id1","id2"]', a comma list, or a single id.
// An empty string / "[]" means "no specializations".
const specializationIdsField = z.preprocess((val) => {
  if (val === undefined || val === null) return undefined;
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    const t = val.trim();
    if (t === "") return [];
    if (t.startsWith("[")) {
      try { return JSON.parse(t); } catch { return val; }
    }
    return t.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return val;
}, z.array(z.string().uuid()).optional());

export const createDoctorSchema = z
  .object({
    name: z.string().min(2, "Name is required"),
    email: z.string().email("Invalid email").optional(),
    phone: z.string().min(10, "Phone number is required").max(15).optional(),
    password: z.string().min(6, "Password must be at least 6 characters"),
    clinicId: z.string().uuid().optional(),
    medicalSystem: z.enum(["ALLOPATHY", "HOMEOPATHY", "AYURVEDA"]).optional(),
    specialization: z.string().optional(),
    specializationIds: specializationIdsField,
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

export const updateDoctorAdminSchema = z.object({
  name: z.string().min(2, "Name is required").optional(),
  specialization: z.string().optional(),
  specializationIds: specializationIdsField,
  qualification: z.string().optional(),
  experience: z.coerce.number().int().min(0).optional(),
  fee: z.coerce.number().min(0).optional(),
  removePhoto: z.string().optional(), 
});

export const updateClinicDetailsAdminSchema = z.object({
  clinicName: z.string().min(2, "Clinic name is required").optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  removeLogo: z.string().optional(), 
});

export const assignDoctorSchema = z.object({
  doctorId: z.string().uuid(),
  fee: z.coerce.number().min(0).optional(),
  dayOfWeek: z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]).default("MONDAY"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "startTime must be HH:mm").default("09:00"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "endTime must be HH:mm").default("17:00"),
  maxPatients: z.number().int().positive().default(20),
  recurrenceType: z.enum(["DAILY", "WEEKLY", "MONTHLY_DATE", "MONTHLY_WEEKDAY", "SPECIFIC_DATE"]).default("WEEKLY"),
  recurrencePattern: z.any().optional(),
});