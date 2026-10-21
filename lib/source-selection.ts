import type { Order, OrderSource } from "@/lib/domain";

export function rankSourcesByUsage(sources: OrderSource[], orders: Order[]) {
  const usage = new Map<string, number>();
  const keyFor = (regionId: string | undefined, name: string) =>
    JSON.stringify([regionId, name]);
  for (const order of orders) {
    if (order.status === "キャンセル" || !order.orderSource) continue;
    const key = keyFor(order.regionId, order.orderSource);
    usage.set(key, (usage.get(key) || 0) + 1);
  }
  return sources.map((source) => ({
    ...source,
    orderCount: usage.get(keyFor(source.regionId, source.companyName)) || 0,
  })).sort((first, second) =>
    second.orderCount - first.orderCount ||
    first.companyName.localeCompare(second.companyName, "ja") ||
    first.id.localeCompare(second.id));
}
