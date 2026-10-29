"use client";

import type { Vehicle, VehicleDisplayStatus } from "@/lib/domain";
import { resolveOrderVehicle } from "@/lib/vehicle-order";

export function OrderVehiclePlateSelect({
  vehicles,
  vehicleName,
  vehiclePlate,
  getStatus,
  onSelect,
  financeMode = false,
}: {
  vehicles: Vehicle[];
  vehicleName: string;
  vehiclePlate: string;
  getStatus: (vehicle: Vehicle) => VehicleDisplayStatus;
  onSelect: (vehicle: { name: string; plate: string }) => void;
  financeMode?: boolean;
}) {
  const selected = vehiclePlate
    ? resolveOrderVehicle(vehicles, {
        regionId: vehicles[0]?.regionId,
        vehicle: vehicleName,
        vehiclePlate,
      })
    : undefined;
  const sameNameCount = vehicles.filter((vehicle) => vehicle.name === vehicleName).length;

  return (
    <div>
      <label className="block text-sm font-medium">
        {financeMode ? "当日車両番号" : "車両番号"}
        <select
          className="mt-1 w-full rounded border p-2"
          value={selected?.plate ? selected.id : ""}
          onChange={(event) => {
            if (financeMode && event.target.value === "") {
              onSelect({ name: "", plate: "" });
              return;
            }
            const vehicle = vehicles.find((item) => item.id === event.target.value);
            if (!vehicle || (!financeMode && getStatus(vehicle) !== "运营中")) {
              console.error("Rejected unavailable reservation vehicle plate selection.");
              return;
            }
            onSelect({ name: vehicle.name, plate: vehicle.plate });
          }}
        >
          <option value="" disabled={!financeMode}>
            {!selected && sameNameCount > 1 ? "同名車両有多台，请選択車両番号"
              : selected ? "当前車両未登记番号"
              : vehicleName ? "当前車両未登记或未指定番号" : financeMode ? "使用訂単默认車両" : "请選択車両番号"}
          </option>
          {vehicles.filter((vehicle) => vehicle.plate).map((vehicle) => {
            const unavailable = !financeMode && getStatus(vehicle) !== "运营中";
            return (
              <option key={vehicle.id} value={vehicle.id} disabled={unavailable}>
                {vehicle.plate}
                {unavailable ? "（不可用于新予約）" : ""}
              </option>
            );
          })}
        </select>
      </label>
      {!financeMode && <p className="mt-1 text-xs text-gray-500">選択番号会同步切换上方車両；未登记番号的車両请在上方選択。</p>}
      {!selected && sameNameCount > 1 && (
        <p role="alert" className="mt-1 text-xs text-amber-800">
          车名「{vehicleName}」有多台車両，请選択具体的車両番号。
        </p>
      )}
    </div>
  );
}