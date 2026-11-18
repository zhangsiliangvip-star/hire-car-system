"use client";

import { useState } from "react";
import type { Driver, Order } from "@/lib/domain";
import { rankDriversByMonthlyAttendance } from "@/lib/driver-selection";
import { DriverSelectionDialog } from "@/components/driver-selection-dialog";
import { getJapanDate } from "@/lib/vehicle-compliance";

export function FinanceDriverSelect({
  drivers,
  orders,
  regionId,
  today,
  serviceDate,
  value,
  onChange,
}: {
  drivers: Driver[];
  orders: Order[];
  regionId: string | undefined;
  today: string;
  serviceDate: string;
  value: string;
  onChange: (name: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const licenseToday = getJapanDate();
  const candidates = rankDriversByMonthlyAttendance(
    drivers.filter((driver) => Boolean(regionId) && driver.regionId === regionId),
    orders,
    today,
  );

  return (
    <div>
      <div className="block text-sm font-medium">
        当日運転士
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="mt-1 w-full rounded border p-2 text-left hover:bg-blue-50"
        >
          {value || "未安排運転士"} · 点击選任
        </button>
      </div>
      {isOpen && (
        <DriverSelectionDialog
          drivers={candidates}
          selected={value}
          serviceDates={[serviceDate]}
          today={licenseToday}
          enforceLicense={serviceDate >= licenseToday}
          onSelect={(name) => {
            onChange(name);
          }}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
