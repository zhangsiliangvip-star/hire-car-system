import { z } from "zod";

export const fuelReceiptPath = z.string().regex(/^[0-9a-f-]{36}\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/);
export const fuelSubmissionSchema = z.object({
  date: z.iso.date(), assignmentId: z.uuid(), expectedVersion: z.number().int().nonnegative(), requestId: z.uuid(),
  amount: z.number().int().positive().max(99999999999999),
  receipts: z.array(fuelReceiptPath).max(5),
}).strict();
export const fuelClaimSchema = z.object({
  id: z.uuid(), date: z.iso.date(), assignmentId: z.uuid(), version: z.number().int().positive(),
  status: z.enum(["pending", "approved", "rejected"]),
  amount: z.number().int().positive().max(99999999999999),
  receipts: z.array(fuelReceiptPath).max(5), reviewNote: z.string(),
}).strict();
export const fuelReviewSchema = z.object({
  fuelId: z.uuid(), expectedVersion: z.number().int().positive(),
  decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(500),
}).strict().refine(value => value.decision !== "rejected" || value.note.length > 0);
export const fuelReviewRowSchema = z.object({
  driverName: z.string(), pickup: z.string(), destination: z.string(), claim: fuelClaimSchema,
}).strict();
export type FuelClaim = z.infer<typeof fuelClaimSchema>;
