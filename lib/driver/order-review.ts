import { z } from "zod";
import { financeClaimSchema } from "./finance";
import { fuelClaimSchema } from "./fuel";

const row = { orderId: z.uuid(), date: z.iso.date(), driverName: z.string() };
export const orderReviewRowSchema = z.discriminatedUnion("kind", [
  z.object({ ...row, kind: z.literal("finance"),
    claim: financeClaimSchema.extend({ status: z.literal("pending") }) }).strict(),
  z.object({ ...row, kind: z.literal("fuel"),
    claim: fuelClaimSchema.extend({ status: z.literal("pending") }) }).strict(),
]);
export const orderReviewDataSchema = z.object({
  enabled: z.boolean(), rows: z.array(orderReviewRowSchema),
}).strict();
export type OrderReviewRow = z.infer<typeof orderReviewRowSchema>;
export function orderReviewKey(row: OrderReviewRow) {
  return row.kind === "fuel" ? `fuel-${row.claim.id}` : `${row.claim.assignmentId}-${row.claim.category}`;
}
