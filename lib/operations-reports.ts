import { z } from "zod";
import { fromJapanInput, reportSchema, reportTime, toJapanInput } from "@/lib/driver/reports";

export const operationRowSchema = z.object({
  regionId: z.uuid(), driverName: z.string(), company: z.string().nullable(),
  operationsManager: z.string().nullable(),
  report: reportSchema,
}).strict();
export type OperationRow = z.infer<typeof operationRowSchema>;
export const operationDataSchema = z.object({ enabled: z.boolean(), rows: z.array(operationRowSchema) }).strict();
export const operationQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine(v => !v.startsWith("0000")),
  region: z.uuid().optional(),
}).strict();
export const operationCommandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), requestId: z.uuid(), report: reportSchema.extend({
    header: reportSchema.shape.header.unwrap().extend({ vehicleBaseline: z.string().max(100).optional() }),
  }), reason: z.string().trim().min(1).max(300) }).strict(),
  z.object({ action: z.literal("delete"), reportId: z.uuid(), expectedVersion: z.number().int().positive(),
  }).strict(),
]);
export const operationResultSchema = z.union([
  z.object({ action: z.literal("edit"), report: reportSchema }).strict(),
  z.object({ action: z.literal("delete"), deletedId: z.uuid() }).strict(),
]);

export function filterOperationRows(rows: OperationRow[], company: string, vehicle: string, date: string) {
  return rows.filter(row => (!company || row.company === company) &&
    (!vehicle || row.report.header?.vehicleNumber === vehicle) && (!date || row.report.serviceDate === date));
}
export function operationInstant(value: string, original: string | null = null) {
  return original && value === toJapanInput(original) ? original : fromJapanInput(value);
}
export function operationDateLabel(value: string) {
  return value.slice(5, 10).replace("-", "/");
}
export function operationTimeLabel(value: string | null) {
  return value ? reportTime(value).slice(11, 16) : "—";
}
