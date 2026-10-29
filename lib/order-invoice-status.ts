import type { Order } from "@/lib/domain";

type OrderMonthScope = Pick<Order, "id" | "regionId" | "date" | "endDate" | "orderSource">;

export function getMonthlySameSourceOrders<T extends OrderMonthScope>(
  orders: T[],
  selectedOrder: OrderMonthScope,
  month: string,
) {
  if (!selectedOrder.orderSource.trim()) return [];

  const monthStart = `${month}-01`;
  const monthEnd = `${month}-31`;
  return orders.filter((order) =>
    order.regionId === selectedOrder.regionId &&
    order.orderSource === selectedOrder.orderSource &&
    order.date <= monthEnd &&
    (order.endDate || order.date) >= monthStart
  );
}
