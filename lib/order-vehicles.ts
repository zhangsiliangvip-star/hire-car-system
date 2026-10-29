import type { Order, OrderFinance, Vehicle } from "@/lib/domain";
import { orderUsesVehicle } from "@/lib/vehicle-order";

type VehicleOrder = {
  vehicle: string;
  vehiclePlate?: string | null;
  financeByDate?: Record<string, { vehicle?: string | null; vehiclePlate?: string | null } | undefined> | null;
};

export function getServiceVehicle(order: VehicleOrder, date: string) {
  const finance = order.financeByDate?.[date];
  return finance?.vehicle
    ? { vehicle: finance.vehicle, vehiclePlate: finance.vehiclePlate || "" }
    : { vehicle: order.vehicle, vehiclePlate: order.vehiclePlate || "" };
}

export function getOrderVehiclePlates(
  order: Pick<Order, "date" | "endDate" | "offDates" | "vehicle" | "vehiclePlate" | "financeByDate">,
  includeDate: (date: string) => boolean = () => true,
) {
  const start = Date.parse(`${order.date}T00:00:00Z`);
  const count = Math.min((Date.parse(`${order.endDate || order.date}T00:00:00Z`) - start) / 86400000 + 1, 3660);
  const plates = new Set<string>();
  for (let index = 0; index < count; index++) {
    const date = new Date(start + index * 86400000).toISOString().slice(0, 10);
    if (!order.offDates.includes(date) && includeDate(date)) plates.add(getServiceVehicle(order, date).vehiclePlate);
  }
  return [...plates];
}

export function getVehicleSegments(
  order: VehicleOrder & { regionId?: string },
  dates: string[],
  vehicle: { name: string; plate: string; regionId?: string },
) {
  const segments: { start: number; end: number }[] = [];
  dates.forEach((date, index) => {
    if (!date) return;
    const selected = getServiceVehicle(order, date);
    if (!selected.vehiclePlate && vehicle.plate) return;
    if (!orderUsesVehicle({ ...selected, vehicle: selected.vehicle || "未安排車両", regionId: order.regionId }, vehicle)) return;
    const previous = segments[segments.length - 1];
    if (previous?.end === index) previous.end++;
    else segments.push({ start: index, end: index + 1 });
  });
  return segments;
}

export function getCalendarVehicleRows(vehicles: Vehicle[], orders: Order[], dates: string[]) {
  const rows: (Vehicle & { calendarOnly?: true })[] = [...vehicles];
  for (const order of orders) for (const date of dates) {
    if (date < order.date || date > (order.endDate || order.date)) continue;
    const selected = getServiceVehicle(order, date);
    if (rows.some(row => row.regionId === order.regionId && (selected.vehiclePlate
      ? row.plate === selected.vehiclePlate : !row.plate && row.name === selected.vehicle))) continue;
    rows.push({
      id: `calendar-only:${JSON.stringify([order.regionId, selected.vehicle, selected.vehiclePlate])}`,
      regionId: order.regionId, name: selected.vehicle || "未安排車両", plate: selected.vehiclePlate,
      calendarOnly: true, status: "停运中", calendarOrder: null,
      defaultParkingFee: 0, defaultInsuranceFee: 0, ownerCompany: "", seats: "", fuelType: "",
      inspectionExpiry: "", liabilityExpiry: "", notes: "訂単車牌未登记或未指定，请選択已登记車両番号",
    });
  }
  return rows;
}

export function changeOrderVehicle<T extends VehicleOrder & {
  date?: string; endDate?: string; financeByDate: Record<string, OrderFinance>;
}>(
  order: T, vehicle: { name: string; plate: string }, replaceDailyOverrides = false,
): T {
  return {
    ...order, vehicle: vehicle.name, vehiclePlate: vehicle.plate,
    financeByDate: Object.fromEntries(Object.entries(order.financeByDate).map(([date, finance]) => [
      date, (!order.date || (date >= order.date && date <= (order.endDate || order.date))) &&
        (replaceDailyOverrides || (!finance.vehicleOverride && finance.vehicle === order.vehicle &&
        finance.vehiclePlate === (order.vehiclePlate || "")))
        ? { ...finance, vehicle: vehicle.name, vehiclePlate: vehicle.plate, vehicleOverride: false } : finance,
    ])),
  };
}
