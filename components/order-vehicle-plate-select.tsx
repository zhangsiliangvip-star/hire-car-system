"use client";

import type { Vehicle, VehicleDisplayStatus } from "@/lib/domain";

export function OrderVehiclePlateSelect({
  vehicles,
  vehicleName,
  getStatus,
  onSelect,
  financeMode = false,
}: {
  vehicles: Vehicle[];
  vehicleName: string;
  getStatus: (vehicle: Vehicle) => VehicleDisplayStatus;
  onSelect: (name: string) => void;
  financeMode?: boolean;
}) {
  const matches = vehicles.filter((vehicle) => vehicle.name === vehicleName);
  const selected = matches.length === 1 ? matches[0] : undefined;
  const hasAmbiguousNames = vehicles.some((vehicle) =>
    vehicle.plate && vehicles.filter((other) => other.name === vehicle.name).length > 1,
  );

  return (
    <div>
      <label className="block text-sm font-medium">
        {financeMode ? "当日車両番号" : "車両番号"}
        <select
          className="mt-1 w-full rounded border p-2"
          value={selected?.plate ? selected.id : ""}
          onChange={(event) => {
            if (financeMode && event.target.value === "") {
              onSelect("");
              return;
            }
            const vehicle = vehicles.find((item) => item.id === event.target.value);
            if (!vehicle || (!financeMode && getStatus(vehicle) !== "运营中") ||
              vehicles.filter((item) => item.name === vehicle.name).length !== 1) {
              console.error("Rejected unavailable or ambiguous reservation vehicle plate selection.");
              return;
            }
            onSelect(vehicle.name);
          }}
        >
          <option value="" disabled={!financeMode}>
            {matches.length > 1 ? "当前车名存在重名，无法确定番号"
              : selected ? "当前车辆未登记番号"
              : vehicleName ? "当前车辆未登记或已删除" : financeMode ? "未设置" : "请选择車両番号"}
          </option>
          {vehicles.filter((vehicle) => vehicle.plate).map((vehicle) => {
            const ambiguous = vehicles.filter((item) => item.name === vehicle.name).length > 1;
            const unavailable = !financeMode && getStatus(vehicle) !== "运营中";
            return (
              <option key={vehicle.id} value={vehicle.id} disabled={ambiguous || unavailable}>
                {vehicle.plate}
                {ambiguous ? "（车名重复，请先修改）" : unavailable ? "（不可用于新予約）" : ""}
              </option>
            );
          })}
        </select>
      </label>
      {!financeMode && <p className="mt-1 text-xs text-gray-500">选择番号会同步切换上方车辆；未登记番号的车辆请在上方选择。</p>}
      {hasAmbiguousNames && (
        <p role="alert" className="mt-1 text-xs text-amber-800">
          当前地域存在同名车辆，订单无法区分；请在车辆管理中设置不同车名后再选择番号。
        </p>
      )}
    </div>
  );
}
