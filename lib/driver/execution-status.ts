import { z } from "zod";

export const activeExecutionStates = ["assigned", "acknowledged", "en_route", "arrived", "in_service", "completed"] as const;
export const executionStatusDataSchema = z.object({
  enabled: z.boolean(), date: z.iso.date(),
  rows: z.array(z.object({
    orderId: z.uuid(), date: z.iso.date(), status: z.enum(activeExecutionStates), version: z.number().int().positive(),
  }).strict()),
}).strict();
export type ExecutionStatusData = z.infer<typeof executionStatusDataSchema>;
