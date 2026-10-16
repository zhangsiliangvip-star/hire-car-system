"use client";

import type { Driver } from "@/lib/domain";

export function FinanceDriverSelect({
  drivers,
  regionId,
  value,
  onChange,
}: {
  drivers: Driver[];
  regionId: string | undefined;
  value: string;
  onChange: (name: string) => void;
}) {
  const names = [...new Set(drivers
    .filter((driver) => Boolean(regionId) && driver.regionId === regionId)
    .map((driver) => driver.name))]
    .sort((first, second) => first.localeCompare(second, "ja"));

  return (
    <div>
      <label className="block text-sm font-medium">
        当日司机
        <select className="mt-1 w-full rounded border p-2" value={value}
          onChange={(event) => onChange(event.target.value)}>
          <option value="">未安排司机</option>
          {value && !names.includes(value) && <option value={value}>{value}（现有记录）</option>}
          {names.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <label className="mt-2 block text-xs text-gray-600">
        手动输入司机姓名
        <input type="text" className="mt-1 w-full rounded border p-2 text-sm"
          value={value} onChange={(event) => onChange(event.target.value)} />
      </label>
    </div>
  );
}
