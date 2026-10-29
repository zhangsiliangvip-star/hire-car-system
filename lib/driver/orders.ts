import { z } from "zod";

export const assignmentIdSchema = z.uuid();
export const driverNotesSchema = z.object({
  expectedNotes: z.string(),
  notes: z.string().max(5000),
}).strict();
export const acknowledgeSchema = z.object({
  expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  requestId: z.uuid(),
}).strict();
export const tripEventSchema = acknowledgeSchema.extend({
  state: z.enum(["assigned", "acknowledged", "en_route", "arrived", "in_service", "completed"]),
}).strict();
export const tripStates = ["assigned", "acknowledged", "en_route", "arrived", "in_service", "completed"] as const;
export type TripState = typeof tripStates[number];
export const tripStatusLabels: Record<TripState, string> = {
  assigned: "待确认", acknowledged: "已确认", en_route: "已出发",
  arrived: "已到达", in_service: "服务中", completed: "已完成",
};
export const tripActions: Partial<Record<TripState, { state: Exclude<TripState, "assigned">; label: string }>> = {
  assigned: { state: "acknowledged", label: "确认接单" },
  acknowledged: { state: "en_route", label: "出发前往上車地点" },
  en_route: { state: "arrived", label: "已到达上車地点" },
  arrived: { state: "in_service", label: "开始服务" },
  in_service: { state: "completed", label: "完成行程" },
};
export const tripPreviousStates: Partial<Record<TripState, TripState>> = {
  acknowledged: "assigned", en_route: "acknowledged", arrived: "en_route",
  in_service: "arrived", completed: "in_service",
};
export const serviceDateSchema = z.iso.date();
export function tripNavigationUrl(address: string) {
  const destination = address.trim();
  return destination ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving` : null;
}

export type DriverTrip = {
  assignmentId: string;
  orderId: string;
  date: string;
  time: string;
  pickup: string;
  destination: string;
  vehicle: string;
  vehicleNumber?: string;
  status: TripState;
  version: number;
  details?: { orderName: string; tripSummary: string; notes: string };
};

export const historicalDriverTripSchema = z.object({
  order_id: z.uuid(),
  service_date: z.iso.date(),
  departure_time: z.string(),
  pickup: z.string(),
  destination: z.string(),
  vehicle: z.string(),
  vehicle_number: z.string(),
  order_name: z.string(),
  trip_summary: z.string(),
  notes: z.string(),
}).strict();

export type HistoricalDriverTrip = Omit<DriverTrip, "assignmentId" | "status" | "version"> & {
  assignmentId: null;
  status: "historical";
  version: 0;
  historical: true;
};

export type DriverTripItem = DriverTrip | HistoricalDriverTrip;

export function projectHistoricalDriverTrip(row: unknown): HistoricalDriverTrip {
  const parsed = historicalDriverTripSchema.parse(row);
  return {
    assignmentId: null,
    orderId: parsed.order_id,
    date: parsed.service_date,
    time: parsed.departure_time,
    pickup: parsed.pickup,
    destination: parsed.destination,
    vehicle: parsed.vehicle,
    vehicleNumber: parsed.vehicle_number,
    status: "historical",
    version: 0,
    historical: true,
    details: {
      orderName: parsed.order_name,
      tripSummary: parsed.trip_summary,
      notes: parsed.notes,
    },
  };
}

export function projectDriverTripDetail(row: Parameters<typeof projectDriverTrip>[0] & {
  order_name: string; trip_summary: string; notes: string;
}): DriverTrip {
  const details = z.object({ orderName: z.string(), tripSummary: z.string(), notes: z.string() }).parse({
    orderName: row.order_name, tripSummary: row.trip_summary, notes: row.notes,
  });
  return { ...projectDriverTrip(row), details };
}

export function projectDriverTrip(row: {
  assignment_id: string; order_id: string; service_date: string;
  departure_time: string; pickup: string; destination: string;
  vehicle: string; status: string; version: number;
}): DriverTrip {
  const status = z.enum(tripStates).safeParse(row.status);
  if (!status.success) {
    throw new Error("Unexpected driver assignment state.");
  }
  return {
    assignmentId: row.assignment_id, orderId: row.order_id, date: row.service_date,
    time: row.departure_time, pickup: row.pickup, destination: row.destination,
    vehicle: row.vehicle, status: status.data, version: row.version,
  };
}

export function japanDate(offsetDays = 0, now = new Date()) {
  const date = new Date(now.getTime() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function createDriverRequestId() {
  // LAN HTTP previews lack randomUUID, but getRandomValues remains available.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
