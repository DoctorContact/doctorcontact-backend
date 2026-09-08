import { z } from "zod";

export const createReferralSchema = z.object({
  patientId: z.string().uuid(),
  appointmentId: z.string().uuid().optional(),
  diagnosticCenterId: z.string().uuid(),
  testNames: z.array(z.string().min(1)).min(1, "At least one test is required"),
  notes: z.string().max(500).optional(),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
});

export const updateReferralStatusSchema = z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  resultNotes: z.string().max(2000).optional(),
});