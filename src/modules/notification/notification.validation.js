import { z } from "zod";

export const listNotificationsQuerySchema = z.object({
  page: z.preprocess((val) => (val ? parseInt(val, 10) : 1), z.number().positive().default(1)),
  limit: z.preprocess((val) => (val ? parseInt(val, 10) : 20), z.number().positive().max(100).default(20)),
});