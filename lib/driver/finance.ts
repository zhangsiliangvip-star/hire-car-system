import { z } from "zod";
import { fuelClaimSchema } from "./fuel";

export const financeCategorySchema = z.enum(["company", "trip", "overtime"]);
export type FinanceCategory = z.infer<typeof financeCategorySchema>;
export const financeCategoryLabels = { company: "社报立替", trip: "旅报立替", overtime: "超时申报" };
export const receiptPath = z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/(?:(?:company|trip)\/)?[0-9a-f-]{36}\.(jpg|png|webp)$/);
export const expenseSchema = z.object({
  id: z.uuid(), type: z.enum(["company", "trip"]),
  detail: z.string().trim().min(1).max(200),
  amount: z.number().int().positive().max(99999999999999),
  receipts: z.array(receiptPath).max(5),
}).strict();
export const financeSubmissionSchema = z.object({
  assignmentId: z.uuid(), expectedVersion: z.number().int().nonnegative(),
  historical: z.boolean().optional(),
  category: financeCategorySchema,
  requestId: z.uuid(), expenses: z.array(expenseSchema).max(50),
  overtimeHours: z.number().min(0).max(999).multipleOf(0.01),
}).strict().refine(value =>
  new Set(value.expenses.map(item => item.id)).size === value.expenses.length &&
  value.expenses.reduce((total, item) => total + item.amount, 0) <= 99999999999999 &&
  (value.category === "overtime" ? value.expenses.length === 0 :
    value.overtimeHours === 0 && value.expenses.length > 0 && value.expenses.every(item => item.type === value.category)));
export const financeClaimSchema = z.object({
  assignmentId: z.uuid(), version: z.number().int().positive(),
  historical: z.boolean().optional(),
  category: financeCategorySchema,
  status: z.enum(["pending", "approved", "rejected"]),
  expenses: z.array(expenseSchema).max(50), overtimeHours: z.number(),
  reviewNote: z.string(), submittedAt: z.string(),
}).strict();
export const financeTripSchema = z.object({
  assignmentId: z.uuid(), date: z.iso.date(), pickup: z.string(), destination: z.string(),
  historical: z.boolean().optional(),
  existingOvertimeHours: z.number().nonnegative(),
  claims: z.array(financeClaimSchema).max(3),
}).strict();
export const financeDataSchema = z.object({
  fuelClaims: z.array(fuelClaimSchema),
  trips: z.array(financeTripSchema),
  manualItems: z.array(z.object({ name: z.string(), amount: z.number() }).strict()),
  wages: z.array(z.object({
    date: z.iso.date(), base: z.number(), bonus: z.number(), overtime: z.number(),
    advances: z.number(),
  }).strict()),
}).strict();
export const financeReviewSchema = z.object({
  assignmentId: z.uuid(), expectedVersion: z.number().int().positive(),
  category: financeCategorySchema,
  decision: z.enum(["approved", "rejected"]), note: z.string().trim().max(500),
}).strict().refine(value => value.decision !== "rejected" || value.note.length > 0);
export type Expense = z.infer<typeof expenseSchema>;
export type FinanceData = z.infer<typeof financeDataSchema>;
export function expenseTotals(expenses: Expense[]) {
  return expenses.reduce((total, item) => ({
    company: total.company + (item.type === "company" ? item.amount : 0),
    trip: total.trip + (item.type === "trip" ? item.amount : 0),
  }), { company: 0, trip: 0 });
}
