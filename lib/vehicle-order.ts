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

function isCalendarPinnedVehicle(name: string) {
  return /四代/.test(name) && !isOutsourcedVehicle(name);
}

/** Calendar order: non-outsourced 「四代」 vehicles first, then the normal vehicle order. */
export function compareCalendarVehicles(
  first: { name: string; id: string },
  second: { name: string; id: string },
) {
  return Number(isCalendarPinnedVehicle(second.name)) - Number(isCalendarPinnedVehicle(first.name)) ||
    compareVehicles(first, second);
}
