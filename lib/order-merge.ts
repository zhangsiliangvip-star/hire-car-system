import type { Order } from "@/lib/domain";

export const mergeSharedFields = [
  "customer", "phone", "pickup", "destination", "time", "status", "notes",
  "orderSource", "company", "salesRep", "accountingStatus", "invoiceStatus",
  "invoiceSentDate", "depositMethod", "depositDate", "accountingAssignee", "financeNote",
] as const satisfies readonly (keyof Order)[];

export function getOrderMergeError(first: Order, second: Order): string | null {
  if (first.id === second.id) return "请选择另一段订单。";
  if (!first.splitGroupId || first.splitGroupId !== second.splitGroupId)
    return "只能合并同一原订单拆出的订单段。";
  if (!first.regionId || first.regionId !== second.regionId) return "只能合并同一地域的订单。";
  if (mergeSharedFields.some(field => first[field] !== second[field]) ||
    (first.importBatchId || null) !== (second.importBatchId || null) ||
    (first.importBatchIndex ?? null) !== (second.importBatchIndex ?? null))
    return "订单基本信息、备注、结算或請求書状态不同，请先核对一致。";
  const [before, after] = first.date < second.date ? [first, second] : [second, first];
  if (Date.parse(`${after.date}T00:00:00Z`) - Date.parse(`${before.endDate || before.date}T00:00:00Z`) !== 86400000)
    return "只能合并日期相邻且不重叠的订单段。";
  if (Date.parse(`${after.endDate || after.date}T00:00:00Z`) - Date.parse(`${before.date}T00:00:00Z`) > 3659 * 86400000)
    return "合并后的日期跨度不能超过3660天。";
  if (Object.keys(first.financeByDate).some(date => Object.hasOwn(second.financeByDate, date) ||
      (date >= second.date && date <= (second.endDate || second.date))) ||
    Object.keys(second.financeByDate).some(date => date >= first.date && date <= (first.endDate || first.date)))
    return "两段订单存在相同日期的财务记录，不能自动覆盖。";
  return null;
}
