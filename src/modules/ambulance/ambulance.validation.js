import { z } from "zod";

export const addAmbulanceSchema = z.object({
  type: z.string().min(1, "Ambulance type is required"),
  hospitalName: z.string().min(1, "Hospital name is required"),
  location: z.string().min(1, "Location is required"),
  vehicleNumber: z.string().min(1, "Vehicle number is required"),
  mobileNumber: z
    .string()
    .min(3, "Mobile number must be at least 3 digits") // 🟢 Changed from 10 to 3 to support special helpline numbers
    .regex(/^[0-9\s\-\+]+$/, "Mobile number can only contain digits, spaces, +, or -"), // 🟢 Added regex to allow spaces or '+' for country codes
  services: z.array(z.string()).min(1, "At least one service is required"),
  is24x7Available: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});

export const updateAmbulanceSchema = z.object({
  type: z.string().min(1).optional(),
  hospitalName: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  vehicleNumber: z.string().min(1).optional(),
  mobileNumber: z
    .string()
    .min(3)
    .regex(/^[0-9\s\-\+]+$/)
    .optional(),
  services: z.array(z.string()).min(1).optional(),
  is24x7Available: z.boolean().optional(),
  isActive: z.boolean().optional(),
});