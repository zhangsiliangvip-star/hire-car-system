import { z } from "zod";

export const orderReceiptQuerySchema = z.object({ orderId: z.uuid(), date: z.iso.date() }).strict();
export const orderReceiptSchema = z.object({
  bucket: z.enum(["driver-finance-receipts", "driver-fuel-receipts"]),
  path: z.string().min(1).max(300),
  category: z.enum(["company", "trip", "fuel"]),
  detail: z.string().max(200),
}).strict();
export const orderAdvanceSchema = z.object({
  claimId: z.uuid(), category: z.enum(["company", "trip"]),
  version: z.number().int().positive(), amount: z.number().int().min(0).max(99999999999999),
  detail: z.string(),
  expenses: z.array(z.object({
    id: z.uuid(), type: z.enum(["company", "trip"]), detail: z.string(),
    amount: z.number().int().positive().max(99999999999999), receipts: z.array(z.string()),
  }).strict()).optional(),
}).strict();
export const advanceSwitchSchema = orderReceiptQuerySchema.extend({
  claimId: z.uuid(), expectedVersion: z.number().int().positive(), category: z.enum(["company", "trip"]),
  expenseId: z.uuid().optional(),
}).strict();
export const advanceDeleteSchema = orderReceiptQuerySchema.extend({
  claimId: z.uuid(), expectedVersion: z.number().int().positive(),
  expenseId: z.uuid(), action: z.literal("delete"),
}).strict();
export const orderReceiptDataSchema = z.object({
  enabled: z.boolean(),
  receipts: z.array(orderReceiptSchema.extend({ url: z.url() }).strict()),
  advances: z.array(orderAdvanceSchema).optional(),
}).strict();
export const orderReceiptLabels = { company: "社報立替", trip: "旅報立替", fuel: "燃油費" };
