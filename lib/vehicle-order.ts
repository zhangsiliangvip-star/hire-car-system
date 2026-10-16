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

export function compareVehicles(
  first: { name: string; id: string },
  second: { name: string; id: string },
) {
  return compareVehicleNames(first.name, second.name) || first.id.localeCompare(second.id);
}
