export function getVehicleModelOrder(name: string) {
  if (/阿尔法|阿爾法|alphard/i.test(name)) return 0;
  if (/海狮|海獅|hiace/i.test(name)) return 1;
  if (/特斯拉|tesla/i.test(name)) return 2;
  return 3;
}

export function isOutsourcedVehicle(name: string) {
  return /外注/.test(name);
}

export function compareVehicleNames(first: string, second: string) {
  const priority = (name: string) => isOutsourcedVehicle(name) ? 4 : getVehicleModelOrder(name);
  return priority(first) - priority(second) ||
    first.localeCompare(second, "ja", { numeric: true });
}

type VehicleIdentity = { name: string; plate: string; regionId?: string };
type OrderVehicleRef = { regionId?: string; vehicle: string; vehiclePlate?: string };

/** Orders identify their vehicle by 車両番号; legacy orders without a plate fall back to the name. */
export function orderUsesVehicle(order: OrderVehicleRef, vehicle: VehicleIdentity) {
  if ((order.regionId ?? "") !== (vehicle.regionId ?? "")) return false;
  if (order.vehiclePlate) return order.vehiclePlate === vehicle.plate;
  return Boolean(order.vehicle) && order.vehicle === vehicle.name;
}

export function resolveOrderVehicle<T extends VehicleIdentity>(vehicles: T[], order: OrderVehicleRef) {
  const regionVehicles = vehicles.filter(
    (vehicle) => (vehicle.regionId ?? "") === (order.regionId ?? ""),
  );
  if (order.vehiclePlate) {
    const byPlate = regionVehicles.find((vehicle) => vehicle.plate === order.vehiclePlate);
    if (byPlate) return byPlate;
  }
  const byName = regionVehicles.filter((vehicle) => vehicle.name === order.vehicle);
  return byName.length === 1 ? byName[0] : undefined;
}

export function compareVehicles(
  first: { name: string; id: string },
  second: { name: string; id: string },
) {
  return compareVehicleNames(first.name, second.name) || first.id.localeCompare(second.id);
}

function getCalendarVehicleRank(name: string) {
  if (isOutsourcedVehicle(name)) return 7;
  const modelOrder = getVehicleModelOrder(name);
  if (modelOrder === 0) {
    if (/四代/.test(name)) return 0;
    if (/三代/.test(name)) return 1;
    if (/二代/.test(name)) return 4;
    return 2;
  }
  if (modelOrder === 1) return 3;
  if (modelOrder === 2) return 5;
  return 6;
}

/**
 * Calendar order: out-of-service vehicles always last; then the shared manual order
 * (vehicles never dragged follow those that were); otherwise
 * Alphard 四代 → 三代 → Alphard → Hiace → Alphard 二代 → Tesla → others → 外注.
 */
export function compareCalendarVehicles(
  first: { name: string; id: string; outOfService?: boolean; calendarOrder?: number | null },
  second: { name: string; id: string; outOfService?: boolean; calendarOrder?: number | null },
) {
  const firstOrder = first.calendarOrder ?? null;
  const secondOrder = second.calendarOrder ?? null;
  return Number(Boolean(first.outOfService)) - Number(Boolean(second.outOfService)) ||
    (firstOrder !== null && secondOrder !== null ? firstOrder - secondOrder : 0) ||
    Number(firstOrder === null) - Number(secondOrder === null) ||
    getCalendarVehicleRank(first.name) - getCalendarVehicleRank(second.name) ||
    compareVehicles(first, second);
}

/** Move `draggedId` before (or after) `targetId` in an ordered id list. */
export function moveCalendarVehicle(
  orderedIds: string[],
  draggedId: string,
  targetId: string,
  placeAfter: boolean,
) {
  if (draggedId === targetId || !orderedIds.includes(draggedId) || !orderedIds.includes(targetId)) {
    return orderedIds;
  }
  const remaining = orderedIds.filter((id) => id !== draggedId);
  const targetIndex = remaining.indexOf(targetId) + (placeAfter ? 1 : 0);
  return [...remaining.slice(0, targetIndex), draggedId, ...remaining.slice(targetIndex)];
}
