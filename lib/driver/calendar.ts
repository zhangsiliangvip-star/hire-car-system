import { z } from "zod";
import { shiftMonthSchema } from "@/lib/driver/shifts";

export const driverCalendarEntrySchema = z.object({
  orderId: z.uuid(),
  date: z.iso.date(),
  time: z.string(),
  orderName: z.string(),
  status: z.string(),
  vehicle: z.string(),
  vehicleNumber: z.string(),
  tripSummary: z.string(),
}).strict();
export const driverCalendarSchema = z.object({
  month: shiftMonthSchema,
  entries: z.array(driverCalendarEntrySchema).max(2000),
}).strict().refine(value => value.entries.every(entry => entry.date.startsWith(`${value.month}-`)));
export type DriverCalendarEntry = z.infer<typeof driverCalendarEntrySchema>;

export function driverCalendarRange(month: string) {
  const parsed = shiftMonthSchema.parse(month);
  const [year, monthIndex] = parsed.split("-").map(Number);
  const days = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return { start: `${parsed}-01`, end: `${parsed}-${String(days).padStart(2, "0")}`, days };
}

export function projectDriverCalendarRow(row: {
  order_id: string; service_date: string; departure_time: string; order_name: string;
  order_status: string; vehicle: string; vehicle_number: string; trip_summary: string;
}): DriverCalendarEntry {
  return driverCalendarEntrySchema.parse({
    orderId: row.order_id, date: row.service_date, time: row.departure_time,
    orderName: row.order_name, status: row.order_status, vehicle: row.vehicle,
    vehicleNumber: row.vehicle_number, tripSummary: row.trip_summary,
  });
}

export type DriverCalendarSegment = {
  orderId: string; start: number; end: number; lane: number;
  orderName: string; time: string; status: string; summaries: string[];
};
export type DriverCalendarVehicle = {
  key: string; vehicle: string; vehicleNumber: string; lanes: number; segments: DriverCalendarSegment[];
};

// Groups the driver's own service days into per-vehicle rows of consecutive-day order bars.
export function buildDriverCalendar(entries: DriverCalendarEntry[], dates: string[]): DriverCalendarVehicle[] {
  const dateIndex = new Map(dates.map((date, index) => [date, index]));
  const vehicles = new Map<string, DriverCalendarVehicle & { days: Map<string, DriverCalendarEntry[]> }>();
  for (const entry of entries) {
    if (!dateIndex.has(entry.date)) continue;
    const key = entry.vehicleNumber.trim() || entry.vehicle.trim() || "未指定車両";
    const row = vehicles.get(key) ?? { key, vehicle: entry.vehicle, vehicleNumber: entry.vehicleNumber,
      lanes: 1, segments: [], days: new Map() };
    if (!row.vehicle && entry.vehicle) row.vehicle = entry.vehicle;
    row.days.set(entry.orderId, [...(row.days.get(entry.orderId) ?? []), entry]);
    vehicles.set(key, row);
  }
  return [...vehicles.values()].sort((a, b) => a.key.localeCompare(b.key, "ja")).map(({ days, ...row }) => {
    const segments: DriverCalendarSegment[] = [];
    for (const items of days.values()) {
      const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
      let current: DriverCalendarSegment | null = null;
      for (const item of sorted) {
        const index = dateIndex.get(item.date)!;
        if (current && index === current.end) {
          current.end += 1;
          current.summaries.push(item.tripSummary.trim());
          continue;
        }
        if (current && index < current.end) continue;
        current = { orderId: item.orderId, start: index, end: index + 1, lane: 0,
          orderName: item.orderName, time: item.time, status: item.status, summaries: [item.tripSummary.trim()] };
        segments.push(current);
      }
    }
    segments.sort((a, b) => a.start - b.start || a.time.localeCompare(b.time) || a.orderId.localeCompare(b.orderId));
    const laneEnds: number[] = [];
    for (const segment of segments) {
      const free = laneEnds.findIndex(end => end <= segment.start);
      segment.lane = free === -1 ? laneEnds.length : free;
      laneEnds[segment.lane] = segment.end;
    }
    return { ...row, lanes: Math.max(1, laneEnds.length), segments };
  });
}
