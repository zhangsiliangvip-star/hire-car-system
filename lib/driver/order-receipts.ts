import { z } from "zod";

export const orderReceiptQuerySchema = z.object({ orderId: z.uuid(), date: z.iso.date() }).strict();
export const orderReceiptSchema = z.object({
  bucket: z.enum(["driver-finance-receipts", "driver-fuel-receipts"]),
  path: z.string().min(1).max(300),
  category: z.enum(["company", "trip", "fuel"]),
  detail: z.string().max(200),
}).strict();
export const orderReceiptDataSchema = z.object({
  enabled: z.boolean(),
  receipts: z.array(orderReceiptSchema.extend({ url: z.url() }).strict()),
}).strict();
export const orderReceiptLabels = { company: "社報立替", trip: "旅報立替", fuel: "燃油費" };
