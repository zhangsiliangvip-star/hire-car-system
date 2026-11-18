import type { Vehicle, VehicleStatus } from "@/lib/domain";

export type VehicleExpiryState = "normal" | "warning" | "expired";

export function getJapanDate(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

export function getVehicleExpiryState(expiry: string, today = getJapanDate()): VehicleExpiryState {
  if (!expiry) return "normal";
  const date = new Date(`${expiry}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== expiry) throw new RangeError("Invalid vehicle expiry date.");
  if (expiry < today) return "expired";
  const day = date.getUTCDate();
  date.setUTCDate(0);
  date.setUTCDate(Math.min(day, date.getUTCDate()));
  return today >= date.toISOString().slice(0, 10) ? "warning" : "normal";
}

export function getEffectiveVehicleStatus(
  vehicle: Pick<Vehicle, "status" | "inspectionExpiry" | "liabilityExpiry">,
  today = getJapanDate(),
): VehicleStatus {
  return [vehicle.inspectionExpiry, vehicle.liabilityExpiry].some(expiry =>
    getVehicleExpiryState(expiry, today) === "expired") ? "停运中" : vehicle.status;
}

export function splitVehicleOwner(owner: string): { company: string; office: string } {
  const name = owner.trim();
  const match = name.match(/^([\s\S]*\S)[\s\u3000]+([^\s\u3000]*営業所)$/u);
  return match ? { company: match[1], office: match[2] } : { company: name, office: "" };
}
