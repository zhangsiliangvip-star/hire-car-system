import { z } from "zod";

export const shiftMonthSchema = z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/);
const restDatesSchema = z.array(z.iso.date()).max(31).refine(dates => new Set(dates).size === dates.length);
export const shiftDataSchema = z.object({
  month: shiftMonthSchema, version: z.number().int().nonnegative(),
  dates: restDatesSchema, note: z.string().max(1000),
}).strict().refine(value => value.dates.every(date => date.startsWith(`${value.month}-`)));
export const shiftSubmissionSchema = z.object({
  month: shiftMonthSchema, expectedVersion: z.number().int().nonnegative(),
  requestId: z.uuid(), dates: restDatesSchema, note: z.string().trim().max(1000),
}).strict().refine(value => value.dates.every(date => date.startsWith(`${value.month}-`)));
export const shiftStatusQuerySchema = z.object({ dates: z.array(z.iso.date()).min(1).max(3660) }).strict();
export const shiftStatusSchema = z.object({
  enabled: z.boolean(),
  days: z.array(z.object({ driverId: z.uuid(), date: z.iso.date() }).strict()),
}).strict();
export type ShiftData = z.infer<typeof shiftDataSchema>;

export function shiftMonthDays(month: string) {
  const parsed = shiftMonthSchema.parse(month);
  const start = new Date(`${parsed}-01T00:00:00Z`);
  const count = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    offset: start.getUTCDay(),
    dates: Array.from({ length: count }, (_, index) => `${parsed}-${String(index + 1).padStart(2, "0")}`),
  };
}
