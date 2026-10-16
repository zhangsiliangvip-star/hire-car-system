import type { Order } from "@/lib/domain";

export function summarizeRequestAmounts(
  rows: readonly { depositMethod: Order["depositMethod"]; requestAmount: number }[],
) {
  const totals = { bank: 0, cash: 0, unassigned: 0 };
  for (const row of rows) {
    if (row.depositMethod === "口座入金") totals.bank += row.requestAmount;
    else if (row.depositMethod === "现金入金") totals.cash += row.requestAmount;
    else if (row.depositMethod === "") totals.unassigned += row.requestAmount;
    else throw new Error("订单入金方式无效，请检查订单资料。");
  }
  return totals;
}
