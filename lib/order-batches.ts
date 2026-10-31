import type { Order } from "@/lib/domain";

function compareImportOrder(first: Order, second: Order) {
  return (first.importBatchIndex ?? 0) - (second.importBatchIndex ?? 0) ||
    first.id.localeCompare(second.id);
}

export function groupOrdersByImportBatch(orders: readonly Order[]) {
  const groups = new Map<string, Order[]>();
  for (const order of orders) {
    const key = order.importBatchId
      ? `${order.regionId || ""}:${order.importBatchId}`
      : `order:${order.id}`;
    const group = groups.get(key);
    if (group) group.push(order);
    else groups.set(key, [order]);
  }
  return [...groups.values()]
    .map((group) => group.sort(compareImportOrder))
    .sort((first, second) =>
      `${first[0].date} ${first[0].time}`.localeCompare(`${second[0].date} ${second[0].time}`),
    );
}

export function groupOrdersByImportBatchStartMonth(orders: readonly Order[], month: string) {
  return groupOrdersByImportBatch(orders).filter((batch) => {
    const firstServiceDate = batch.reduce(
      (earliest, order) => order.date < earliest ? order.date : earliest,
      batch[0].date,
    );
    return firstServiceDate.startsWith(`${month}-`);
  });
}

export function groupReservationOrders(orders: readonly Order[]) {
  const rows: { order: Order; count: number }[] = [];
  const batches = new Map<string, { order: Order; count: number }>();
  for (const order of orders) {
    if (!order.importBatchId) {
      rows.push({ order, count: 1 });
      continue;
    }
    const key = `${order.regionId || ""}:${order.importBatchId}`;
    const batch = batches.get(key);
    if (batch) {
      batch.count += 1;
      if (compareImportOrder(order, batch.order) < 0) batch.order = order;
    } else {
      const row = { order, count: 1 };
      batches.set(key, row);
      rows.push(row);
    }
  }
  return rows.sort((first, second) =>
    `${first.order.date} ${first.order.time}`.localeCompare(`${second.order.date} ${second.order.time}`),
  );
}

export function getAccountingBatchOrders(order: Order, candidates: readonly Order[]): Order[] {
  if (order.importBatchId) {
    return candidates
      .filter((item) =>
        item.regionId === order.regionId && item.importBatchId === order.importBatchId,
      )
      .sort(compareImportOrder);
  }

  // Older imports have no batch ID; preserve their existing same-day vehicle grouping.
  const isSingleDay = (item: Order) => (item.endDate || item.date) === item.date;
  if (!isSingleDay(order)) return [order];
  const batch = candidates.filter((item) =>
    item.id === order.id ||
    (!item.importBatchId &&
      isSingleDay(item) &&
      item.regionId === order.regionId &&
      item.date === order.date &&
      item.vehicle === order.vehicle &&
      (item.vehiclePlate || "") === (order.vehiclePlate || "")),
  );
  return batch.length > 1
    ? batch.slice().sort((first, second) =>
        (first.time || "99:99").localeCompare(second.time || "99:99") ||
        first.customer.localeCompare(second.customer),
      )
    : [order];
}
