import type { Driver, Order } from "@/lib/domain";
import { getServiceDriver } from "@/lib/order-drivers";

export function rankDriversByRecentService(
  drivers: Driver[],
  orders: Order[],
  today: string,
) {
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - index);
    return date.toISOString().slice(0, 10);
  });
  const serviceDays = new Map<string, Set<string>>();
  const keyFor = (regionId: string | undefined, name: string) =>
    JSON.stringify([regionId, name]);
  for (const order of orders) {
    if (order.status === "キャンセル") continue;
    for (const day of days) {
      if (day < order.date || day > (order.endDate || order.date) || order.offDates.includes(day)) continue;
      const name = getServiceDriver(order, day);
      if (!name) continue;
      const key = keyFor(order.regionId, name);
      const dates = serviceDays.get(key) || new Set<string>();
      dates.add(day);
      serviceDays.set(key, dates);
    }
  }
  return drivers.map((driver) => ({
    ...driver,
    serviceDays: serviceDays.get(keyFor(driver.regionId, driver.name))?.size || 0,
  })).sort((first, second) =>
    second.serviceDays - first.serviceDays ||
    first.name.localeCompare(second.name, "ja") ||
    first.id.localeCompare(second.id));
}
