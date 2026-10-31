import type { Driver, Order } from "@/lib/domain";
import { getServiceDriver } from "@/lib/order-drivers";

const driverReadingCollator = new Intl.Collator("en", {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});

export function sortDriversByReading<T extends Pick<Driver, "id" | "name"> & { reading?: string | null }>(
  drivers: T[],
) {
  return drivers.slice().sort((first, second) =>
    driverReadingCollator.compare(first.reading?.trim() || first.name, second.reading?.trim() || second.name) ||
    driverReadingCollator.compare(first.name, second.name) ||
    first.id.localeCompare(second.id));
}

export function sortDriversByMonthlyAttendance<T extends Pick<Driver, "id" | "name"> & {
  reading?: string | null;
  attendanceDays?: number;
}>(
  drivers: T[],
) {
  return drivers.slice().sort((first, second) =>
    (second.attendanceDays ?? 0) - (first.attendanceDays ?? 0) ||
    driverReadingCollator.compare(first.reading?.trim() || first.name, second.reading?.trim() || second.name) ||
    driverReadingCollator.compare(first.name, second.name) ||
    first.id.localeCompare(second.id));
}

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

export function rankDriversByMonthlyAttendance<T extends Pick<Driver, "id" | "name"> & {
  regionId?: string | null;
  reading?: string | null;
}>(
  drivers: T[],
  orders: Order[],
  today: string,
) {
  const [year, month] = today.split("-").map(Number);
  const currentMonthStart = new Date(Date.UTC(year, month - 1, 1));
  currentMonthStart.setUTCMonth(currentMonthStart.getUTCMonth() - 1);
  const firstDay = currentMonthStart.toISOString().slice(0, 10);
  const serviceDays = new Map<string, Set<string>>();
  const keyFor = (regionId: string | undefined | null, name: string) =>
    JSON.stringify([regionId, name]);
  const allRegionServiceDays = new Map<string, Set<string>>();

  for (const order of orders) {
    if (order.status === "キャンセル") continue;
    const start = order.date < firstDay ? firstDay : order.date;
    const end = (order.endDate || order.date) > today ? today : order.endDate || order.date;
    for (let timestamp = Date.parse(`${start}T00:00:00Z`);
      timestamp <= Date.parse(`${end}T00:00:00Z`);
      timestamp += 86_400_000) {
      const date = new Date(timestamp).toISOString().slice(0, 10);
      if (order.offDates.includes(date)) continue;
      const name = getServiceDriver(order, date);
      if (!name) continue;

      const key = keyFor(order.regionId, name);
      const dates = serviceDays.get(key) ?? new Set<string>();
      dates.add(date);
      serviceDays.set(key, dates);

      const allRegionDates = allRegionServiceDays.get(name) ?? new Set<string>();
      allRegionDates.add(date);
      allRegionServiceDays.set(name, allRegionDates);
    }
  }

  return sortDriversByMonthlyAttendance(drivers.map((driver) => ({
    ...driver,
    attendanceDays: (driver.regionId
      ? serviceDays.get(keyFor(driver.regionId, driver.name))
      : allRegionServiceDays.get(driver.name))?.size ?? 0,
  })));
}
