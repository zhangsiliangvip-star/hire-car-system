import type { Vehicle, VehicleMonthlyFinance } from "@/lib/domain";
import { compareVehicleNames } from "@/lib/vehicle-order";

type VehicleDailyTotals = {
  regionId?: string;
  vehicleName: string;
  vehicleId?: string;
  requestAmount: number;
  driverAdvances: number;
  companyExpenses: number;
  driverWages: number;
};

export type VehicleMonthlySummary = {
  key: string;
  month: string;
  regionId?: string;
  vehicleNumber: string;
  requestAmount: number;
  driverAdvances: number;
  companyExpenses: number;
  driverWages: number;
  fixedExpenses: number;
  profit: number;
};

export function getVehicleFixedExpenses(vehicle: Vehicle, record?: VehicleMonthlyFinance) {
  return record
    ? record.parkingFee + record.insuranceFee + record.inspectionFee + record.repairFee +
      record.supplies.reduce((total, supply) => total + supply.amount, 0)
    : vehicle.defaultParkingFee + vehicle.defaultInsuranceFee;
}

export function summarizeVehicles(
  month: string,
  vehicles: Vehicle[],
  monthlyRecords: VehicleMonthlyFinance[],
  details: VehicleDailyTotals[],
): VehicleMonthlySummary[] {
  const keyFor = (regionId: string | undefined, name: string) => JSON.stringify([regionId, name]);
  const vehiclesByName = new Map<string, Vehicle[]>();
  const recordsByVehicle = new Map(
    monthlyRecords.filter((record) => record.month === month).map((record) => [record.vehicleId, record]),
  );
  const groups = new Map<string, VehicleMonthlySummary>();
  const namesByKey = new Map<string, string>();
  for (const vehicle of vehicles) {
    const nameKey = keyFor(vehicle.regionId, vehicle.name);
    vehiclesByName.set(nameKey, [...(vehiclesByName.get(nameKey) || []), vehicle]);
    const record = recordsByVehicle.get(vehicle.id);
    const fixedExpenses = getVehicleFixedExpenses(vehicle, record);
    namesByKey.set(vehicle.id, vehicle.name);
    groups.set(vehicle.id, {
      key: vehicle.id, month, regionId: vehicle.regionId,
      vehicleNumber: vehicle.name.includes("外注")
        ? `外注 · ${vehicle.plate || "未填写番号"}`
        : vehicle.plate || "未填写番号",
      requestAmount: 0, driverAdvances: 0, companyExpenses: 0, driverWages: 0,
      fixedExpenses, profit: 0 - fixedExpenses,
    });
  }
  for (const detail of details) {
    const nameKey = keyFor(detail.regionId, detail.vehicleName);
    const matches = vehiclesByName.get(nameKey) || [];
    const ambiguous = !detail.vehicleId && matches.length > 1;
    const key = (detail.vehicleId && groups.has(detail.vehicleId) ? detail.vehicleId : "") ||
      (matches.length === 1 ? matches[0].id : nameKey);
    namesByKey.set(key, detail.vehicleName);
    const unknownLabel = ambiguous
      ? `番号未指定（${detail.vehicleName} 有多台，請在予約中選択車両番号）`
      : "番号未知（車両資料未找到）";
    const group = groups.get(key) || {
      key, month, regionId: detail.regionId,
      vehicleNumber: detail.vehicleName.includes("外注") ? `外注 · ${unknownLabel}` : unknownLabel,
      requestAmount: 0, driverAdvances: 0, companyExpenses: 0, driverWages: 0,
      fixedExpenses: 0, profit: 0,
    };
    group.requestAmount += detail.requestAmount;
    group.driverAdvances += detail.driverAdvances;
    group.companyExpenses += detail.companyExpenses;
    group.driverWages += detail.driverWages;
    group.profit = group.requestAmount - group.driverAdvances - group.companyExpenses -
      group.driverWages - group.fixedExpenses;
    groups.set(key, group);
  }
  return [...groups.values()].sort((first, second) =>
    compareVehicleNames(namesByKey.get(first.key) || "", namesByKey.get(second.key) || "") ||
    (first.regionId || "").localeCompare(second.regionId || "") ||
    first.vehicleNumber.localeCompare(second.vehicleNumber) || first.key.localeCompare(second.key));
}

export function totalVehicleSummaries(rows: VehicleMonthlySummary[]) {
  return rows.reduce((total, row) => ({
    requestAmount: total.requestAmount + row.requestAmount,
    driverAdvances: total.driverAdvances + row.driverAdvances,
    companyExpenses: total.companyExpenses + row.companyExpenses,
    driverWages: total.driverWages + row.driverWages,
    fixedExpenses: total.fixedExpenses + row.fixedExpenses,
    profit: total.profit + row.profit,
  }), { requestAmount: 0, driverAdvances: 0, companyExpenses: 0, driverWages: 0, fixedExpenses: 0, profit: 0 });
}
