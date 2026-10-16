
"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type {
  ActiveView,
  AccountProfile,
  BalanceExpenseItem,
  BatchAddType,
  CalendarVehicleFilter,
  Company,
  CompanyDraft,
  Driver,
  DriverDraft,
  LoginAccount,
  Order,
  OrderFinance,
  OrderDraft,
  OrderSource,
  OrderSourceDraft,
  OrderStatus,
  Region,
  Vehicle,
  VehicleDisplayStatus,
  VehicleDraft,
  VehicleMonthlyFinance,
  VehicleStatus,
} from "@/lib/domain";
import { buildApiErrorMessage, readJsonSafely } from "@/lib/api-client";
import { usePersistedCollection } from "@/lib/use-persisted-collection";
import { createClient as createSupabaseClient } from "@/lib/supabase/browser";
import { printOrderExpenses } from "@/lib/order-expense-print";
import { printOrderFinance } from "@/lib/order-finance-print";
import { printInvoice } from "@/lib/invoice-print";
import { printVehicleFinance, printVehicleSummary } from "@/lib/vehicle-finance-print";
import { summarizeVehicles, totalVehicleSummaries, type VehicleMonthlySummary } from "@/lib/vehicle-finance-summary";
import { printCompanyWages, printDriverWages } from "@/lib/driver-wage-print";
import { DriverSelectionDialog } from "@/components/driver-selection-dialog";
import { rankDriversByRecentService } from "@/lib/driver-selection";
import Image from "next/image";
import { CompanySealUpload } from "@/components/company-seal-upload";
import { isCompanySealDataUrl } from "@/lib/company-seal";
import { printBalance } from "@/lib/balance-print";
import { getBalanceServiceMonth, summarizeBalance } from "@/lib/balance-summary";
import { compareVehicles, getVehicleModelOrder, isOutsourcedVehicle } from "@/lib/vehicle-order";
import { LastOperation } from "@/components/last-operation";
import { AuditHistory } from "@/components/audit-history";
import { DEFAULT_VEHICLE_NAME_OPTIONS as vehicleNameOptions, MANUAL_VEHICLE_NAME, VehicleNameSelect } from "@/components/vehicle-name-select";
import { OrderVehiclePlateSelect } from "@/components/order-vehicle-plate-select";
import { FinanceDriverSelect } from "@/components/finance-driver-select";
import { getAccountingAssigneeName } from "@/lib/accounting-assignee";
import { findOrderConflicts, type OrderConflict } from "@/lib/order-conflicts";

const DEFAULT_VEHICLE_NAME = "Alphard 01";
const ALL_REGIONS_ID = "__all_regions__";
const DATA_SYNC_INTERVAL_MS = 10_000;
const TOKYO_REGION_ID = "60000000-0000-4000-8000-000000000001";
const LOGIN_ACCOUNT_POSITIONS = ["役员", "操作", "会计"] as const;

const fuelTypes = ["レギュラー", "ディーゼル"];
type VehicleMonthlyFinanceForm = {
  parkingFee: string;
  insuranceFee: string;
  inspectionFee: string;
  repairFee: string;
  supplies: { description: string; amount: string }[];
  startOdometer: string;
  endOdometer: string;
};

function parseNonNegativeInteger(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}


function getDistinctSourceColor(index: number) {
  const hue = (index % 16) * 22.5;
  const variants = [
    { saturation: 0.82, lightness: 0.43 },
    { saturation: 0.72, lightness: 0.58 },
    { saturation: 0.92, lightness: 0.66 },
    { saturation: 0.62, lightness: 0.34 },
  ];
  const { saturation, lightness } = variants[Math.floor(index / 16)];
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const hueSection = hue / 60;
  const secondary = chroma * (1 - Math.abs((hueSection % 2) - 1));
  const [red, green, blue] =
    hueSection < 1
      ? [chroma, secondary, 0]
      : hueSection < 2
        ? [secondary, chroma, 0]
        : hueSection < 3
          ? [0, chroma, secondary]
          : hueSection < 4
            ? [0, secondary, chroma]
            : hueSection < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const offset = lightness - chroma / 2;
  const toHex = (channel: number) =>
    Math.round((channel + offset) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

const sourceColorOptions = Array.from({ length: 64 }, (_, index) =>
  getDistinctSourceColor(index),
);

function SourceColorPicker({
  color,
  sourceName,
  onSelect,
}: {
  color: string;
  sourceName: string;
  onSelect: (color: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [palettePosition, setPalettePosition] = useState({ left: 0, top: 12 });
  const pickerRef = useRef<HTMLSpanElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  function togglePalette() {
    if (!isOpen && pickerRef.current) {
      const bounds = pickerRef.current.getBoundingClientRect();
      const paletteWidth = 188;
      const paletteHeight = 188;
      setPalettePosition({
        left: Math.max(
          8,
          Math.min(bounds.right + 8, window.innerWidth - paletteWidth - 8),
        ),
        top: Math.max(
          8,
          Math.min(
            bounds.top + bounds.height / 2 - paletteHeight / 2,
            window.innerHeight - paletteHeight - 8,
          ),
        ),
      });
    }
    setIsOpen((open) => !open);
  }

  useEffect(() => {
    if (!isOpen) return;

    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (
        !pickerRef.current?.contains(target) &&
        !paletteRef.current?.contains(target)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [isOpen]);

  return (
    <span ref={pickerRef} className="inline-flex items-center gap-2">
      <button
        type="button"
        aria-label={`选择${sourceName}的颜色`}
        aria-expanded={isOpen}
        onClick={togglePalette}
        className="h-5 w-5 rounded-full border border-black/10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        style={{ backgroundColor: color || "#94a3b8" }}
      />
      {sourceName}
      {isOpen &&
        createPortal(
          <div
            ref={paletteRef}
            role="group"
            aria-label="固定颜色选项"
            className="fixed z-[100] grid w-[188px] grid-cols-8 gap-0.5 rounded-lg border bg-white p-1.5 shadow-lg"
            style={{ left: palettePosition.left, top: palettePosition.top }}
          >
            {sourceColorOptions.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={`选择颜色 ${option}`}
                aria-pressed={color.toLowerCase() === option}
                onClick={() => {
                  onSelect(option);
                  setIsOpen(false);
                }}
                className={`h-5 w-5 rounded-full border border-black/10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${color.toLowerCase() === option ? "ring-2 ring-blue-600 ring-offset-2" : ""}`}
                style={{ backgroundColor: option }}
              />
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}

const CUSTOM_SOURCE = "__custom_source__";
const UNSOURCED_ORDER = "__unsourced_order__";

function toDateKey(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function getVehicleDisplayStatus(vehicle: Vehicle): VehicleDisplayStatus {
  const today = toDateKey(new Date());
  const isExpired = [vehicle.inspectionExpiry, vehicle.liabilityExpiry].some(
    (expiryDate) => expiryDate !== "" && expiryDate < today,
  );

  return isExpired ? "休運" : vehicle.status;
}

function isDriverLicenseExpired(driver: Pick<Driver, "licenseExpiry">) {
  return driver.licenseExpiry !== "" && driver.licenseExpiry < toDateKey(new Date());
}

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number) {
  const firstWeekday = new Date(year, month, 1).getDay();
  return 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7;
}

function getJapaneseHolidays(year: number) {
  const vernalEquinox = Math.floor(
    20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4),
  );
  const autumnEquinox = Math.floor(
    23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4),
  );
  const holidays = new Set([
    `${year}-01-01`,
    toDateKey(new Date(year, 0, nthWeekdayOfMonth(year, 0, 1, 2))),
    `${year}-02-11`,
    `${year}-02-23`,
    toDateKey(new Date(year, 2, vernalEquinox)),
    `${year}-04-29`,
    `${year}-05-03`,
    `${year}-05-04`,
    `${year}-05-05`,
    toDateKey(new Date(year, 6, nthWeekdayOfMonth(year, 6, 1, 3))),
    `${year}-08-11`,
    toDateKey(new Date(year, 8, nthWeekdayOfMonth(year, 8, 1, 3))),
    toDateKey(new Date(year, 8, autumnEquinox)),
    toDateKey(new Date(year, 9, nthWeekdayOfMonth(year, 9, 1, 2))),
    `${year}-11-03`,
    `${year}-11-23`,
  ]);

  for (const holiday of [...holidays]) {
    const date = new Date(`${holiday}T00:00:00`);
    if (date.getDay() !== 0) continue;

    const substitute = new Date(date);
    do {
      substitute.setDate(substitute.getDate() + 1);
    } while (holidays.has(toDateKey(substitute)));
    holidays.add(toDateKey(substitute));
  }

  const daysInYear =
    (new Date(year + 1, 0, 1).getTime() - new Date(year, 0, 1).getTime()) /
    86400000;
  for (let day = 2; day < daysInYear; day += 1) {
    const date = new Date(year, 0, day);
    const previousDate = new Date(year, 0, day - 1);
    const nextDate = new Date(year, 0, day + 1);
    if (
      date.getDay() !== 0 &&
      holidays.has(toDateKey(previousDate)) &&
      holidays.has(toDateKey(nextDate))
    ) {
      holidays.add(toDateKey(date));
    }
  }

  return holidays;
}

function createSlidingDates(centerDate: Date, dayCount = 11) {
  const startDate = new Date(
    centerDate.getFullYear(),
    centerDate.getMonth(),
    centerDate.getDate() - 2,
  );

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);

    const holiday = getJapaneseHolidays(date.getFullYear()).has(toDateKey(date));
    const weekend = date.getDay() === 0 || date.getDay() === 6;

    return {
      date: toDateKey(date),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      day: new Intl.DateTimeFormat("ja-JP", { weekday: "narrow" }).format(date),
      isRedDay: weekend || holiday,
      isHoliday: holiday,
      isToday: toDateKey(date) === toDateKey(new Date()),
    };
  });
}

function getCenteredTodayDate() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function formatCalendarDate(date: Date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatOrderDate(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${date}T00:00:00`));
}

function getCurrentMonthKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function createId() {
  return crypto.randomUUID();
}

type ImportedOrderDetails = {
  time: string;
  pickup: string;
  destination: string;
};

function parseImportedOrderDetails(input: string): ImportedOrderDetails[] {
  const timeAndLocations = /\b([01]?\d|2[0-3]):([0-5]\d)\b\s+(\S+)\s+(\S+)/g;
  const orders: ImportedOrderDetails[] = [];

  for (const match of input.matchAll(timeAndLocations)) {
    orders.push({
      time: `${match[1].padStart(2, "0")}:${match[2]}`,
      pickup: match[3],
      destination: match[4],
    });
  }

  return orders;
}

const statusStyles: Record<OrderStatus, string> = {
  仮予約: "border-amber-200 bg-amber-50 text-amber-800",
  予約確定: "border-blue-200 bg-blue-50 text-blue-800",
  運行中: "border-violet-200 bg-violet-50 text-violet-800",
  完了: "border-emerald-200 bg-emerald-50 text-emerald-800",
  キャンセル: "border-rose-200 bg-rose-50 text-rose-800",
};

const orderFinanceSections: {
  title: string;
  fields: {
    key: keyof OrderFinance;
    label: string;
    unit: "JPY" | "L" | "h" | "JPY/h";
    readOnly?: boolean;
  }[];
}[] = [
  {
    title: "ETC 与燃油",
    fields: [
      { key: "etcCompanyReport", label: "ETC（社报）", unit: "JPY" },
      { key: "etcTripReport", label: "ETC（旅报）", unit: "JPY" },
      { key: "fuelCost", label: "燃油费", unit: "JPY" },
      { key: "fuelConsumption", label: "燃油消耗", unit: "L" },
    ],
  },
  {
    title: "立替费用",
    fields: [
      { key: "driverAdvanceCompanyReport", label: "司机立替（社报）", unit: "JPY" },
      { key: "driverAdvanceTripReport", label: "司机立替（旅报）", unit: "JPY" },
      { key: "companyAdvanceCompanyReport", label: "会社立替（社报）", unit: "JPY" },
      { key: "companyAdvanceTripReport", label: "会社立替（旅报）", unit: "JPY" },
    ],
  },
  {
    title: "司机费用",
    fields: [
      { key: "driverOvertimeHours", label: "超时时间", unit: "h" },
      { key: "driverOvertimeRate", label: "超时费用", unit: "JPY/h" },
      { key: "driverOvertimeFee", label: "司机超时费", unit: "JPY", readOnly: true },
    ],
  },
];

const emptyOrderFinance: OrderFinance = {
  driver: "",
  vehicle: "",
  etcCompanyReport: 0,
  etcTripReport: 0,
  fuelCost: 0,
  fuelConsumption: 0,
  driverAdvanceCompanyReport: 0,
  driverAdvanceTripReport: 0,
  companyAdvanceCompanyReport: 0,
  companyAdvanceTripReport: 0,
  driverOvertimeHours: 0,
  driverOvertimeRate: 0,
  driverOvertimeFee: 0,
  driverWageMode: "fixed",
  driverWagePercentage: 50,
  driverWage: 0,
  driverBonusWage: 0,
};

function createEmptyDraft(
  vehicle: string = DEFAULT_VEHICLE_NAME,
  date: string = "2026-09-29",
): OrderDraft {
  return {
    vehicle,
    date,
    endDate: date,
    offDates: [],
    time: "",
    customer: "",
    phone: "",
    pickup: "",
    destination: "",
    status: "仮予約",
    notes: "",
    driver: "",
    orderSource: "",
    company: "",
    salesRep: "",
    orderPrice: 0,
    accountingStatus: "未完成",
    invoiceStatus: "未完成",
    invoiceSentDate: "",
    depositMethod: "",
    depositDate: "",
    accountingAssignee: "",
    financeNote: "",
    financeByDate: {},
  };
}

type FinanceTotals = {
  requestAmount: number;
  driverAdvances: number;
  companyExpenses: number;
  driverWages: number;
  fuelConsumption: number;
  profit: number;
};

function formatYen(amount: number) {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return `¥${safeAmount.toLocaleString("ja-JP")}`;
}

function getOrderFinanceAmount(
  order: Partial<OrderFinance>,
  field: Exclude<keyof OrderFinance, "driver" | "vehicle">,
) {
  const amount = order[field];
  return typeof amount === "number" && Number.isFinite(amount) && amount >= 0
    ? amount
    : 0;
}

function getDriverOvertimeFee(order: Partial<OrderFinance>) {
  const hours = getOrderFinanceAmount(order, "driverOvertimeHours");
  const rate = getOrderFinanceAmount(order, "driverOvertimeRate");
  if (rate === 0) {
    return getOrderFinanceAmount(order, "driverOvertimeFee");
  }
  return Math.round(hours * rate);
}

function normalizeOrderFinance(order: Partial<OrderFinance>): OrderFinance {
  return {
    driver: typeof order.driver === "string" ? order.driver : "",
    vehicle: typeof order.vehicle === "string" ? order.vehicle : "",
    etcCompanyReport: getOrderFinanceAmount(order, "etcCompanyReport"),
    etcTripReport: getOrderFinanceAmount(order, "etcTripReport"),
    fuelCost: getOrderFinanceAmount(order, "fuelCost"),
    fuelConsumption: getOrderFinanceAmount(order, "fuelConsumption"),
    driverAdvanceCompanyReport: getOrderFinanceAmount(order, "driverAdvanceCompanyReport"),
    driverAdvanceTripReport: getOrderFinanceAmount(order, "driverAdvanceTripReport"),
    companyAdvanceCompanyReport: getOrderFinanceAmount(order, "companyAdvanceCompanyReport"),
    companyAdvanceTripReport: getOrderFinanceAmount(order, "companyAdvanceTripReport"),
    driverOvertimeHours: getOrderFinanceAmount(order, "driverOvertimeHours"),
    driverOvertimeRate: getOrderFinanceAmount(order, "driverOvertimeRate"),
    driverOvertimeFee: getOrderFinanceAmount(order, "driverOvertimeFee"),
    driverWageMode: order.driverWageMode === "percentage" ? "percentage" : "fixed",
    driverWagePercentage:
      order.driverWagePercentage === 60 || order.driverWagePercentage === 70
        ? order.driverWagePercentage
        : 50,
    driverWage: getOrderFinanceAmount(order, "driverWage"),
    driverBonusWage: getOrderFinanceAmount(order, "driverBonusWage"),
  };
}

function calculateOrderFinance(
  order: Partial<OrderFinance>,
  orderPrice = 0,
): FinanceTotals {
  const requestAmount =
    orderPrice +
    getOrderFinanceAmount(order, "etcTripReport") +
    getOrderFinanceAmount(order, "driverAdvanceTripReport") +
    getOrderFinanceAmount(order, "companyAdvanceTripReport") +
    getDriverOvertimeFee(order);
  const driverAdvances =
    getOrderFinanceAmount(order, "driverAdvanceTripReport") +
    getOrderFinanceAmount(order, "driverAdvanceCompanyReport");
  const companyExpenses =
    getOrderFinanceAmount(order, "etcCompanyReport") +
    getOrderFinanceAmount(order, "fuelCost") +
    getOrderFinanceAmount(order, "companyAdvanceCompanyReport");
  const driverWageBase = requestAmount - companyExpenses - driverAdvances;
  const driverBaseWage = order.driverWageMode === "percentage"
    ? Math.max(0, Math.round(
        driverWageBase * (order.driverWagePercentage ?? 50) / 100,
      ))
    : getOrderFinanceAmount(order, "driverWage");
  const driverWages =
    getDriverOvertimeFee(order) +
    driverBaseWage +
    getOrderFinanceAmount(order, "driverBonusWage");

  return {
    requestAmount,
    driverAdvances,
    companyExpenses,
    driverWages,
    fuelConsumption: getOrderFinanceAmount(order, "fuelConsumption"),
    profit: requestAmount - companyExpenses - driverAdvances - driverWages,
  };
}

function getOrderDateKeys(order: Pick<Order, "date" | "endDate">): string[] {
  const startTime = new Date(`${order.date}T00:00:00Z`).getTime();
  const endTime = new Date(`${order.endDate || order.date}T00:00:00Z`).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    return [order.date];
  }

  const dayCount = Math.floor((endTime - startTime) / 86_400_000) + 1;
  if (dayCount > 3660) return [];

  return Array.from({ length: dayCount }, (_, index) =>
    new Date(startTime + index * 86_400_000).toISOString().slice(0, 10),
  );
}

function shiftFinanceDates(
  financeByDate: Order["financeByDate"],
  dateOffset: number,
  includeDate: (date: string) => boolean = () => true,
): Order["financeByDate"] {
  return Object.fromEntries(
    Object.entries(financeByDate || {})
      .filter(([date]) => includeDate(date))
      .map(([date, finance]) => [shiftDateKey(date, dateOffset), finance]),
  );
}

function getOrderFinanceForOrder(order: Order, month?: string): FinanceTotals {
  const entries = Object.entries(order.financeByDate || {})
    .filter(([date]) => !month || date.startsWith(`${month}-`));
  return entries.reduce(
    (current, [date, finance]) => {
      const totals = calculateOrderFinance(
        finance,
        date === order.date && (!month || date.startsWith(`${month}-`))
          ? order.orderPrice
          : 0,
      );
      return {
        requestAmount: current.requestAmount + totals.requestAmount,
        driverAdvances: current.driverAdvances + totals.driverAdvances,
        companyExpenses: current.companyExpenses + totals.companyExpenses,
        driverWages: current.driverWages + totals.driverWages,
        fuelConsumption:
          Math.round((current.fuelConsumption + totals.fuelConsumption) * 100) / 100,
        profit: current.profit + totals.profit,
      };
    },
    {
      requestAmount: 0,
      driverAdvances: 0,
      companyExpenses: 0,
      driverWages: 0,
      fuelConsumption: 0,
      profit: 0,
    },
  );
}

function summarizeFinanceEntries(
  entries: readonly (Partial<OrderFinance> & { orderPrice?: number })[],
): FinanceTotals {
  return entries.reduce<FinanceTotals>(
    (current, order) => {
      const totals = calculateOrderFinance(order, order.orderPrice || 0);
      return {
        requestAmount: current.requestAmount + totals.requestAmount,
        driverAdvances: current.driverAdvances + totals.driverAdvances,
        companyExpenses: current.companyExpenses + totals.companyExpenses,
        driverWages: current.driverWages + totals.driverWages,
        fuelConsumption:
          Math.round((current.fuelConsumption + totals.fuelConsumption) * 100) / 100,
        profit: current.profit + totals.profit,
      };
    },
    {
      requestAmount: 0,
      driverAdvances: 0,
      companyExpenses: 0,
      driverWages: 0,
      fuelConsumption: 0,
      profit: 0,
    },
  );
}

function summarizeFinance(orders: readonly Order[]): FinanceTotals {
  return orders.reduce((current, order) => {
    const totals = getOrderFinanceForOrder(order);
    return {
      requestAmount: current.requestAmount + totals.requestAmount,
      driverAdvances: current.driverAdvances + totals.driverAdvances,
      companyExpenses: current.companyExpenses + totals.companyExpenses,
      driverWages: current.driverWages + totals.driverWages,
      fuelConsumption:
        Math.round((current.fuelConsumption + totals.fuelConsumption) * 100) / 100,
      profit: current.profit + totals.profit,
    };
  }, {
    requestAmount: 0,
    driverAdvances: 0,
    companyExpenses: 0,
    driverWages: 0,
    fuelConsumption: 0,
    profit: 0,
  });
}

function FinanceSummaryPanel({
  title,
  month,
  onMonthChange,
  headerActions,
  trailingHeaderActions,
  children,
}: {
  title: string;
  month: string;
  onMonthChange: (month: string) => void;
  headerActions?: ReactNode;
  trailingHeaderActions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {headerActions}
          <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
            统计月份
            <input
              type="month"
              value={month}
              onChange={(event) => onMonthChange(event.target.value)}
              className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
            />
          </label>
          {trailingHeaderActions}
        </div>
      </div>
      <p className="mb-4 text-sm text-gray-600">
        按每日财务明细日期按月汇总，包含取消订单及休运日；金额单位为日元（JPY）。
        订单总利润 = 请求金额 - 会社总支出 - 司机总立替 - 司机总工资。
      </p>
      {children}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [calendarCenterDate, setCalendarCenterDate] = useState(() => getCenteredTodayDate());
  const [calendarVehicleFilter, setCalendarVehicleFilter] =
    useState<CalendarVehicleFilter>("all");
  const dates = createSlidingDates(calendarCenterDate, 11);
  const calendarDaysInMonth = new Date(
    calendarCenterDate.getFullYear(),
    calendarCenterDate.getMonth() + 1,
    0,
  ).getDate();
  const calendarStartDate = new Date(
    calendarCenterDate.getFullYear(),
    calendarCenterDate.getMonth(),
    1,
  );
  const calendarEndDate = new Date(
    calendarCenterDate.getFullYear(),
    calendarCenterDate.getMonth() + 1,
    0,
  );
  const [isDataReady, setIsDataReady] = useState(false);
  const [dataLoadError, setDataLoadError] = useState("");
  const [vehicleMonthlyFinanceMigrationPending, setVehicleMonthlyFinanceMigrationPending] =
    useState(false);
  const [balanceExpensesMigrationPending, setBalanceExpensesMigrationPending] =
    useState(false);
  const [balanceExpenseNameDraft, setBalanceExpenseNameDraft] = useState({ expense: "", income: "" });
  const [balanceExpenseAmountDrafts, setBalanceExpenseAmountDrafts] =
    useState<Record<string, string>>({});
  const [balanceExpenseError, setBalanceExpenseError] = useState("");
  const [persistenceError, setPersistenceError] = useState("");
  const [pendingSaveCount, setPendingSaveCount] = useState(0);
  const [accountError, setAccountError] = useState("");
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<AccountProfile | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [activeRegionId, setActiveRegionId] = useState("");
  const getRegionForNewRecords = useCallback(
    () => activeRegionId && activeRegionId !== ALL_REGIONS_ID ? activeRegionId : null,
    [activeRegionId],
  );
  const [deletePassword, setDeletePassword] = useState("");
  const deletePasswordRef = useRef(deletePassword);
  useLayoutEffect(() => {
    deletePasswordRef.current = deletePassword;
  }, [deletePassword]);
  const getDeletePassword = useCallback(() => deletePasswordRef.current, []);
  const reportPersistenceError = useCallback((message: string) => {
    setPersistenceError(message);
  }, []);
  const reportPendingSave = useCallback((change: number) => {
    setPendingSaveCount((count) => Math.max(0, count + change));
  }, []);
  const {
    items: allOrders,
    updateItems: setOrders,
    replaceItems: replaceOrders,
    syncItems: syncOrders,
    getChangeVersion: getVersionOrders,
  } = usePersistedCollection<Order>(
    "orders",
    reportPersistenceError,
    reportPendingSave,
    getDeletePassword,
    getRegionForNewRecords,
  );
  const {
    items: allOrderSourceRecords,
    updateItems: setOrderSourceRecords,
    replaceItems: replaceOrderSourceRecords,
    syncItems: syncOrderSourceRecords,
    getChangeVersion: getVersionOrderSourceRecords,
  } = usePersistedCollection<OrderSource>(
    "orderSources",
    reportPersistenceError,
    reportPendingSave,
    getDeletePassword,
    getRegionForNewRecords,
  );
  const {
    items: allCompanyRecords,
    updateItems: setCompanyRecords,
    replaceItems: replaceCompanyRecords,
    syncItems: syncCompanyRecords,
    getChangeVersion: getVersionCompanyRecords,
  } = usePersistedCollection<Company>(
    "companies",
    reportPersistenceError,
    reportPendingSave,
    getDeletePassword,
    getRegionForNewRecords,
  );
  const {
    items: allDriverRecords,
    updateItems: setDriverRecords,
    replaceItems: replaceDriverRecords,
    syncItems: syncDriverRecords,
    getChangeVersion: getVersionDriverRecords,
  } = usePersistedCollection<Driver>(
    "drivers",
    reportPersistenceError,
    reportPendingSave,
    getDeletePassword,
    getRegionForNewRecords,
  );
  const {
    items: allVehicleRecords,
    updateItems: setVehicleRecords,
    replaceItems: replaceVehicleRecords,
    syncItems: syncVehicleRecords,
    getChangeVersion: getVersionVehicleRecords,
  } = usePersistedCollection<Vehicle>(
    "vehicles",
    reportPersistenceError,
    reportPendingSave,
    getDeletePassword,
    getRegionForNewRecords,
  );
  const {
    items: allVehicleMonthlyFinanceRecords,
    updateItems: setVehicleMonthlyFinanceRecords,
    replaceItems: replaceVehicleMonthlyFinanceRecords,
    syncItems: syncVehicleMonthlyFinanceRecords,
    getChangeVersion: getVersionVehicleMonthlyFinanceRecords,
  } = usePersistedCollection<VehicleMonthlyFinance>(
    "vehicleMonthlyFinances",
    reportPersistenceError,
    reportPendingSave,
    getDeletePassword,
    getRegionForNewRecords,
  );
  const {
    items: allBalanceExpenseItems,
    updateItems: setBalanceExpenseItems,
    replaceItems: replaceBalanceExpenseItems,
    syncItems: syncBalanceExpenseItems,
    getChangeVersion: getVersionBalanceExpenseItems,
  } = usePersistedCollection<BalanceExpenseItem>(
    "balanceExpenseItems",
    reportPersistenceError,
    reportPendingSave,
    getDeletePassword,
    getRegionForNewRecords,
  );
  const filterByActiveRegion = <T extends { regionId?: string }>(items: T[]) =>
    activeRegionId === ALL_REGIONS_ID
      ? items
      : items.filter((item) => item.regionId === activeRegionId);
  const orders = filterByActiveRegion(allOrders);
  const orderSourceRecords = filterByActiveRegion(allOrderSourceRecords);
  const companyRecords = filterByActiveRegion(allCompanyRecords);
  const driverRecords = filterByActiveRegion(allDriverRecords);
  const vehicleRecords = filterByActiveRegion(allVehicleRecords).slice().sort(compareVehicles);
  const vehicleMonthlyFinanceRecords = filterByActiveRegion(allVehicleMonthlyFinanceRecords);
  const balanceExpenseItems = filterByActiveRegion(allBalanceExpenseItems);
  const regionNameById = new Map(regions.map((region) => [region.id, region.name]));
  const [vehicleMonthlyFinanceForm, setVehicleMonthlyFinanceForm] =
    useState<VehicleMonthlyFinanceForm>({
      parkingFee: "",
      insuranceFee: "",
      inspectionFee: "",
      repairFee: "",
      supplies: [],
      startOdometer: "",
      endOdometer: "",
    });
  const [vehicleMonthlyFinanceError, setVehicleMonthlyFinanceError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [pendingOrderConflicts, setPendingOrderConflicts] = useState<OrderConflict<Order>[]>([]);
  const [showBatchOrderForm, setShowBatchOrderForm] = useState(false);
  const [batchOrderInput, setBatchOrderInput] = useState("");
  const [batchOrderDate, setBatchOrderDate] = useState("");
  const [batchOrderVehicle, setBatchOrderVehicle] = useState("");
  const [batchOrderSource, setBatchOrderSource] = useState("");
  const [batchOrderCompany, setBatchOrderCompany] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{
    message: string;
    action: (password: string) => void | Promise<void>;
  } | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [batchAddType, setBatchAddType] = useState<BatchAddType | null>(null);
  const [batchInput, setBatchInput] = useState("");
  const [draggingOrderId, setDraggingOrderId] = useState<string | null>(null);
  const [dragTargetKey, setDragTargetKey] = useState<string | null>(null);
  const [splitSelection, setSplitSelection] = useState<{
    orderId: string;
    startDate: string | null;
    endDate: string | null;
  } | null>(null);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<Order | null>(null);
  const [orderDetailsMode, setOrderDetailsMode] = useState<"itinerary" | "vehicle">("itinerary");
  const [accountingPreviewOrder, setAccountingPreviewOrder] = useState<Order | null>(null);
  const [accountingForm, setAccountingForm] = useState<Record<string, OrderFinance>>({});
  const [accountingOrderPriceInput, setAccountingOrderPriceInput] = useState("0");
  const [accountingStatus, setAccountingStatus] = useState<Order["accountingStatus"]>("未完成");
  const [accountingInvoiceStatus, setAccountingInvoiceStatus] = useState<Order["invoiceStatus"]>("未完成");
  const [accountingInvoiceSentDate, setAccountingInvoiceSentDate] = useState("");
  const [accountingDepositMethod, setAccountingDepositMethod] = useState<Order["depositMethod"]>("");
  const [accountingDepositDate, setAccountingDepositDate] = useState("");
  const [accountingAssignee, setAccountingAssignee] = useState("");
  const [accountingFinanceNote, setAccountingFinanceNote] = useState("");
  const [activeView, setActiveView] = useState<ActiveView>("calendar");
  const [orderMonth, setOrderMonth] = useState(getCurrentMonthKey);
  const [financeMonth, setFinanceMonth] = useState(getCurrentMonthKey);
  const [balanceMonth, setBalanceMonth] = useState(getCurrentMonthKey);
  const [balanceCompanyFilter, setBalanceCompanyFilter] = useState("");
  const [financeSourceFilter, setFinanceSourceFilter] = useState("");
  const [financeCompanyFilter, setFinanceCompanyFilter] = useState("");
  const [financeDepositStatusFilter, setFinanceDepositStatusFilter] = useState("");
  const [financeInvoiceStatusFilter, setFinanceInvoiceStatusFilter] = useState("");
  const [driverFinanceDriverFilter, setDriverFinanceDriverFilter] = useState("");
  const [driverFinanceCompanyFilter, setDriverFinanceCompanyFilter] = useState("");
  const [vehicleFinanceVehicleFilter, setVehicleFinanceVehicleFilter] = useState("");
  const [orderSourceFilter, setOrderSourceFilter] = useState("");
  const [orderCompanyFilter, setOrderCompanyFilter] = useState("");
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editingSourceName, setEditingSourceName] = useState<string | null>(null);
  const [sourceForm, setSourceForm] = useState<OrderSourceDraft>({
    companyName: "",
    contactName: "",
    contactInfo: "",
    address: "",
    color: "#2563eb",
  });
  const [loginAccounts, setLoginAccounts] = useState<LoginAccount[]>([]);
  const [showLoginAccountForm, setShowLoginAccountForm] = useState(false);
  const [editingLoginAccountId, setEditingLoginAccountId] = useState<string | null>(null);
  const [accountPassword, setAccountPassword] = useState("");
  const [accountPasswordConfirmation, setAccountPasswordConfirmation] = useState("");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountMessage, setAccountMessage] = useState("");
  const [loginAccountForm, setLoginAccountForm] = useState({
    fullName: "",
    email: "",
    company: "",
    position: "",
    regionId: "",
    role: "user" as LoginAccount["role"],
  });
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingCompanyName, setEditingCompanyName] = useState<string | null>(null);
  const [companySealBusy, setCompanySealBusy] = useState(false);
  const [companyForm, setCompanyForm] = useState<CompanyDraft>({
    name: "",
    operationsManager: "",
    maintenanceManager: "",
    phone: "",
    rollCallAddress: "",
    garageAddress: "",
    bankAccount: "",
    taxRegistrationNumber: "",
    sealImage: "",
  });
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [showDriverForm, setShowDriverForm] = useState(false);
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [editingDriverName, setEditingDriverName] = useState<string | null>(null);
  const [driverForm, setDriverForm] = useState<DriverDraft>({
    name: "",
    phone: "",
    wechat: "",
    whatsapp: "",
    licenseExpiry: "",
  });
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [editingVehicleName, setEditingVehicleName] = useState<string | null>(null);
  const [vehicleForm, setVehicleForm] = useState<VehicleDraft>({
    name: "",
    plate: "",
    defaultParkingFee: 0,
    defaultInsuranceFee: 0,
    ownerCompany: "",
    seats: "",
    fuelType: "",
    inspectionExpiry: "",
    liabilityExpiry: "",
    notes: "",
    status: "运营中",
  });
  const [vehicleNameMode, setVehicleNameMode] = useState("");
  const [form, setForm] = useState<OrderDraft>(() => createEmptyDraft());
  const [offDateInput, setOffDateInput] = useState("");
  const [customDriverMode, setCustomDriverMode] = useState(false);
  const [driverSelectionTarget, setDriverSelectionTarget] = useState<string | null>(null);
  const [customSourceMode, setCustomSourceMode] = useState(false);
  const [customCompanyMode, setCustomCompanyMode] = useState(false);
  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        const response = await fetch("/api/data", { cache: "no-store" });
        const payload = await readJsonSafely(response);
        if (!response.ok) {
          throw new Error(buildApiErrorMessage(response, payload, "无法载入业务数据。"));
        }
        if (!payload || typeof payload !== "object") {
          throw new Error("服务器返回的业务数据格式无效。");
        }
        const dashboard = payload as {
          profile: AccountProfile;
          regions: Region[];
          orders: Order[];
          drivers: Driver[];
          vehicles: Vehicle[];
          orderSources: OrderSource[];
          companies: Company[];
          vehicleMonthlyFinances: VehicleMonthlyFinance[];
          vehicleMonthlyFinanceMigrationPending?: boolean;
          balanceExpenseItems?: BalanceExpenseItem[];
          balanceExpensesMigrationPending?: boolean;
        };
        if (cancelled) return;

        replaceOrders(dashboard.orders);
        replaceDriverRecords(dashboard.drivers);
        replaceVehicleRecords(dashboard.vehicles);
        replaceVehicleMonthlyFinanceRecords(dashboard.vehicleMonthlyFinances);
        setVehicleMonthlyFinanceMigrationPending(
          dashboard.vehicleMonthlyFinanceMigrationPending === true,
        );
        replaceBalanceExpenseItems(dashboard.balanceExpenseItems ?? []);
        setBalanceExpensesMigrationPending(
          dashboard.balanceExpensesMigrationPending === true,
        );
        replaceOrderSourceRecords(dashboard.orderSources);
        replaceCompanyRecords(dashboard.companies);
        setCurrentProfile(dashboard.profile);
        setRegions(dashboard.regions);
        setActiveRegionId(
          dashboard.profile.role === "admin"
            ? dashboard.regions.find((region) => region.id === TOKYO_REGION_ID)?.id ?? dashboard.regions[0]?.id ?? ""
            : dashboard.profile.regionId,
        );
        setIsDataReady(true);

        if (dashboard.profile.role === "admin") {
          setIsLoadingAccounts(true);
          try {
            const accountsResponse = await fetch("/api/admin/accounts", {
              cache: "no-store",
            });
            const accountsPayload = await readJsonSafely(accountsResponse);
            if (!accountsResponse.ok) {
              throw new Error(
                buildApiErrorMessage(accountsResponse, accountsPayload, "无法读取账号列表。"),
              );
            }
            if (!Array.isArray(accountsPayload)) {
              throw new Error("服务器返回的账号列表格式无效。");
            }
            if (!cancelled) setLoginAccounts(accountsPayload);
          } catch (error) {
            console.error("Failed to load user accounts.", error);
            if (!cancelled) {
              setAccountError(
                error instanceof Error ? error.message : "无法读取账号列表。",
              );
            }
          } finally {
            if (!cancelled) setIsLoadingAccounts(false);
          }
        }
      } catch (error) {
        console.error("Failed to initialize dashboard.", error);
        if (!cancelled) {
          setDataLoadError(
            error instanceof Error ? error.message : "无法载入业务数据。",
          );
        }
      }
    }

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [
    replaceCompanyRecords,
    replaceDriverRecords,
    replaceOrderSourceRecords,
    replaceOrders,
    replaceVehicleRecords,
    replaceVehicleMonthlyFinanceRecords,
    replaceBalanceExpenseItems,
  ]);
  useEffect(() => {
    if (!isDataReady) return;
    let disposed = false;
    let inFlight = false;
    const collections = [
      { key: "orders", sync: syncOrders, version: getVersionOrders },
      { key: "drivers", sync: syncDriverRecords, version: getVersionDriverRecords },
      { key: "vehicles", sync: syncVehicleRecords, version: getVersionVehicleRecords },
      { key: "orderSources", sync: syncOrderSourceRecords, version: getVersionOrderSourceRecords },
      { key: "companies", sync: syncCompanyRecords, version: getVersionCompanyRecords },
      {
        key: "vehicleMonthlyFinances",
        sync: syncVehicleMonthlyFinanceRecords,
        version: getVersionVehicleMonthlyFinanceRecords,
      },
      { key: "balanceExpenseItems", sync: syncBalanceExpenseItems, version: getVersionBalanceExpenseItems },
    ] as const;

    async function syncFromServer() {
      if (disposed || inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      const startedVersions = collections.map(({ version }) => version());
      try {
        const response = await fetch("/api/data", { cache: "no-store" });
        if (!response.ok || disposed) return;
        const payload = (await readJsonSafely(response)) as Record<string, unknown> | null;
        if (!payload || typeof payload !== "object" || disposed) return;
        collections.forEach(({ key, sync }, index) => {
          const serverItems = payload[key];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (Array.isArray(serverItems)) sync(serverItems as any[], startedVersions[index]);
        });
      } catch (error) {
        console.warn("Background data sync failed; will retry.", error);
      } finally {
        inFlight = false;
      }
    }

    const intervalId = window.setInterval(() => void syncFromServer(), DATA_SYNC_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncFromServer();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [
    isDataReady,
    syncOrders,
    syncDriverRecords,
    syncVehicleRecords,
    syncOrderSourceRecords,
    syncCompanyRecords,
    syncVehicleMonthlyFinanceRecords,
    syncBalanceExpenseItems,
    getVersionOrders,
    getVersionDriverRecords,
    getVersionVehicleRecords,
    getVersionOrderSourceRecords,
    getVersionCompanyRecords,
    getVersionVehicleMonthlyFinanceRecords,
    getVersionBalanceExpenseItems,
  ]);
  const orderSources = orderSourceRecords.map((source) => source.companyName);
  const orderSourceColorByRegion = new Map(
    orderSourceRecords.map((source) => [`${source.regionId}:${source.companyName}`, source.color]),
  );
  const unregisteredSourceNames = Array.from(
    new Set(orders.map((order) => order.orderSource).filter(Boolean)),
  ).filter((name) => !orderSourceRecords.some((source) => source.companyName === name));
  const sourceRows = [
    ...orderSourceRecords,
    ...unregisteredSourceNames.map((name, index) => ({
      id: `unregistered-source-${index}`,
      regionId: activeRegionId === ALL_REGIONS_ID ? undefined : activeRegionId,
      companyName: name,
      contactName: "",
      contactInfo: "",
      address: "",
      color: "",
    })),
  ];
  const companies = companyRecords.map((company) => company.name);
  const unregisteredCompanyNames = Array.from(
    new Set(orders.map((order) => order.company).filter(Boolean)),
  ).filter((name) => !companyRecords.some((company) => company.name === name));
  const companyRows = [
    ...companyRecords,
    ...unregisteredCompanyNames.map((name, index) => ({
      id: `unregistered-company-${index}`,
      name,
      operationsManager: "",
      maintenanceManager: "",
      phone: "",
      rollCallAddress: "",
      garageAddress: "",
      bankAccount: "",
      taxRegistrationNumber: "",
      sealImage: "",
    })),
  ];
  const balanceCompanyOptions = Array.from(
    new Set([
      ...companyRows.map((company) => company.name),
      ...balanceExpenseItems.map((item) => item.companyName).filter(Boolean),
    ]),
  ).sort((first, second) => first.localeCompare(second));
  const accountingAccounts =
    currentProfile && !loginAccounts.some((account) => account.id === currentProfile.id)
      ? [...loginAccounts, currentProfile]
      : loginAccounts;
  const unregisteredDriverNames = Array.from(
    new Set(orders.map((order) => order.driver).filter(Boolean)),
  ).filter((name) => !driverRecords.some((driver) => driver.name === name));
  const driverRows = [
    ...driverRecords,
    ...unregisteredDriverNames.map((name, index) => ({
      id: `unregistered-driver-${index}`,
      name,
      phone: "",
      wechat: "",
      whatsapp: "",
      licenseExpiry: "",
    })),
  ];
  const unregisteredVehicleNames = Array.from(
    new Set(orders.map((order) => order.vehicle).filter(Boolean)),
  ).filter((name) => !vehicleRecords.some((vehicle) => vehicle.name === name));
  const vehicleRows = [
    ...vehicleRecords,
    ...unregisteredVehicleNames.map((name, index) => ({
      id: `unregistered-vehicle-${index}`,
      name,
      plate: "",
      defaultParkingFee: 0,
      defaultInsuranceFee: 0,
      ownerCompany: "",
      seats: "",
      fuelType: "",
      inspectionExpiry: "",
      liabilityExpiry: "",
      notes: "",
      status: "运营中" as const,
    })),
  ].sort(compareVehicles);
  const vehicles = vehicleRecords.map((vehicle) => vehicle.name);
  const filteredCalendarVehicles = vehicles.filter((vehicle) => {
    const modelOrder = getVehicleModelOrder(vehicle);
    const isOutsourced = isOutsourcedVehicle(vehicle);
    if (calendarVehicleFilter === "all") return true;
    if (calendarVehicleFilter === "alphard") return !isOutsourced && modelOrder === 0;
    if (calendarVehicleFilter === "hiace") return !isOutsourced && modelOrder === 1;
    if (calendarVehicleFilter === "tesla") return !isOutsourced && modelOrder === 2;
    return isOutsourced;
  });
  const vehicleStatusByName = new Map(
    vehicleRecords.map((vehicle) => [vehicle.name, getVehicleDisplayStatus(vehicle)]),
  );
  const availableVehicles = vehicles.filter(
    (vehicle) => vehicleStatusByName.get(vehicle) === "运营中",
  );
  const orderFormRegionId = editingOrderId === null ? getRegionForNewRecords() : form.regionId;
  const orderFormVehicles = allVehicleRecords
    .filter((vehicle) => Boolean(orderFormRegionId) && vehicle.regionId === orderFormRegionId)
    .slice().sort(compareVehicles);
  const orderFormVehicleStatusByName = new Map(
    orderFormVehicles.map((vehicle) => [vehicle.name, getVehicleDisplayStatus(vehicle)]),
  );
  const orderFormAvailableVehicles = orderFormVehicles
    .filter((vehicle) => getVehicleDisplayStatus(vehicle) === "运营中")
    .map((vehicle) => vehicle.name);
  const selectedOrderVehicle = selectedOrderDetails
    ? vehicleRecords.find((vehicle) => vehicle.name === selectedOrderDetails.vehicle)
    : undefined;
  const selectedOrderVehicleCompany = selectedOrderVehicle
    ? companyRecords.find((company) => company.name === selectedOrderVehicle.ownerCompany)
    : undefined;
  const selectedOrderSource = selectedOrderDetails
    ? orderSourceRecords.find(
        (source) => source.companyName === selectedOrderDetails.orderSource,
      )
    : undefined;
  const selectedOrderDriver = selectedOrderDetails
    ? driverRecords.find((driver) => driver.name === selectedOrderDetails.driver)
    : undefined;
  const monthlyOrders = orders.filter(
    (order) =>
      order.date <= `${orderMonth}-31` &&
      (order.endDate || order.date) >= `${orderMonth}-01` &&
      (orderSourceFilter === "" ||
        (orderSourceFilter === UNSOURCED_ORDER
          ? !order.orderSource
          : order.orderSource === orderSourceFilter)) &&
      (orderCompanyFilter === "" ||
        (orderCompanyFilter === "__unassigned_company__"
          ? !order.company
          : order.company === orderCompanyFilter)),
  );
  const monthlyFinanceOrders = orders
    .filter(
      (order) =>
        (order.date <= `${financeMonth}-31` &&
          (order.endDate || order.date) >= `${financeMonth}-01`) ||
        Object.keys(order.financeByDate || {}).some((date) =>
          date.startsWith(`${financeMonth}-`),
        ),
    )
    .map((order) => ({
      ...order,
      financeByDate: Object.fromEntries(
        Object.entries(order.financeByDate || {}).filter(([date]) =>
          date.startsWith(`${financeMonth}-`),
        ),
      ),
    }));
  const filteredOrderFinanceOrders = monthlyFinanceOrders.filter((order) =>
    (financeSourceFilter === "" ||
      (financeSourceFilter === UNSOURCED_ORDER
        ? !order.orderSource
        : order.orderSource === financeSourceFilter)) &&
    (financeCompanyFilter === "" ||
      (financeCompanyFilter === "__unassigned_company__"
        ? !order.company
        : order.company === financeCompanyFilter)) &&
    (financeInvoiceStatusFilter === "" || order.invoiceStatus === financeInvoiceStatusFilter) &&
    (financeDepositStatusFilter === "" ||
      (financeDepositStatusFilter === "paid"
        ? Boolean(order.depositDate)
        : !order.depositDate)),
  );
  const balanceVisibleExpenseItems = balanceExpenseItems
    .filter((item) =>
      balanceCompanyFilter === ""
        ? true
        : balanceCompanyFilter === "__unassigned_company__"
          ? item.companyName === ""
          : item.companyName === balanceCompanyFilter,
    )
    .slice()
    .sort(
      (first, second) =>
        first.companyName.localeCompare(second.companyName) ||
        first.name.localeCompare(second.name),
    );
  const getBalanceExpenseAmount = (item: BalanceExpenseItem) => {
    const draftKey = `${item.id}:${balanceMonth}`;
    const draftAmount = balanceExpenseAmountDrafts[draftKey];
    if (draftAmount === undefined) return item.monthlyAmounts[balanceMonth] ?? 0;
    if (draftAmount.trim() === "") return 0;
    const amount = Number(draftAmount);
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > 99_999_999_999_999) {
      throw new Error(`收支项目「${item.name}」金额必须是0至99999999999999的整数。`);
    }
    return amount;
  };
  const balanceResult = (() => {
    try {
      if (balanceExpensesMigrationPending) {
        throw new Error("手动收支数据尚未就绪，请先完成相关数据库迁移。");
      }
      const orderTotals = orders.flatMap((order) => {
        if (getBalanceServiceMonth(order, getOrderDateKeys(order)) !== balanceMonth) return [];
        if (!Number.isSafeInteger(order.orderPrice) || order.orderPrice < 0) {
          throw new Error(`订单「${order.customer}」价格须为非负日元整数。`);
        }
        return [{
          companyName: order.company || "",
          requestAmount: Object.values(order.financeByDate || {}).reduce(
            (total, finance) => total + calculateOrderFinance(finance, 0).requestAmount,
            order.orderPrice,
          ),
        }];
      });
      return {
        summary: summarizeBalance(
          balanceCompanyFilter, companyRows.map((company) => company.name), orderTotals,
          balanceVisibleExpenseItems.filter((item) => item.kind === "expense").map((item) => ({
            companyName: item.companyName, name: item.name, amount: getBalanceExpenseAmount(item),
          })),
          balanceVisibleExpenseItems.filter((item) => item.kind === "income").map((item) => ({
            companyName: item.companyName, name: item.name, amount: getBalanceExpenseAmount(item),
          })),
        ),
        error: "",
      };
    } catch (error) {
      return { summary: null, error: error instanceof Error ? error.message : "收支汇总失败，请刷新后重试。" };
    }
  })();
  const sortedFinanceOrders = [...filteredOrderFinanceOrders].sort((first, second) =>
    `${second.date} ${second.time}`.localeCompare(`${first.date} ${first.time}`),
  );
  const filteredFinanceTotals = summarizeFinance(filteredOrderFinanceOrders);
  const filteredFinanceProfitRate =
    filteredFinanceTotals.requestAmount === 0
      ? 0
      : (filteredFinanceTotals.profit / filteredFinanceTotals.requestAmount) * 100;
  function getOrderVehicleNumber(order: Order) {
    return vehicleRecords.find(
      (vehicle) => vehicle.regionId === order.regionId && vehicle.name === order.vehicle,
    )?.plate || "-";
  }
  async function exportOrderFinance() {
    if (sortedFinanceOrders.length === 0) {
      alert("当前筛选范围暂无订单财务记录。");
      return;
    }
    try {
      await printOrderFinance({
        month: financeMonth,
        region: activeRegionId === ALL_REGIONS_ID ? "全部分区" : regionNameById.get(activeRegionId) || "未知地域",
        source: financeSourceFilter === UNSOURCED_ORDER ? "未填写" : financeSourceFilter || "全部来源",
        company: financeCompanyFilter === "__unassigned_company__" ? "未填写" : financeCompanyFilter || "全部会社",
        depositStatus: financeDepositStatusFilter === "paid" ? "入金済み" : financeDepositStatusFilter === "unpaid" ? "未入金" : "全部状态",
        invoiceStatus: financeInvoiceStatusFilter || "全部状态",
        rows: sortedFinanceOrders.map((order) => ({
          date: order.date,
          customer: order.customer,
          source: order.orderSource,
          driver: order.driver,
          vehicleNumber: getOrderVehicleNumber(order),
          invoiceStatus: order.invoiceStatus,
          paid: Boolean(order.depositDate),
          ...getOrderFinanceForOrder(order),
        })),
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "财务表导出失败，请重试。");
    }
  }
  const [driverFinanceYear] = financeMonth.split("-").map(Number);
  const driverFinanceHolidays = getJapaneseHolidays(driverFinanceYear);
  const driverFinanceCompanies = [...new Set([
    ...companyRecords.map((company) => company.name),
    ...monthlyFinanceOrders.map((order) => order.company).filter(Boolean),
  ])].sort((first, second) => first.localeCompare(second));
  const companyDriverFinanceDetails = monthlyFinanceOrders
    .filter((order) => driverFinanceCompanyFilter === "" ||
      (driverFinanceCompanyFilter === "__unassigned_company__"
        ? !order.company
        : order.company === driverFinanceCompanyFilter))
    .flatMap((order) =>
      Object.entries(order.financeByDate || {})
        .filter(
          ([, finance]) =>
            finance.driver,
        )
        .map(([serviceDate, finance]) => {
          const totals = calculateOrderFinance(
            finance,
            serviceDate === order.date ? order.orderPrice : 0,
          );
          const overtimeFee = getDriverOvertimeFee(finance);
          const bonusWage = getOrderFinanceAmount(finance, "driverBonusWage");
          const baseWage = Math.max(
            0,
            totals.driverWages - overtimeFee - bonusWage,
          );

          return {
            id: `${order.id}-${serviceDate}`,
            orderId: order.id,
            regionId: order.regionId,
            company: order.company,
            regionName: regionNameById.get(order.regionId || "") || "未知地域",
            serviceDate,
            isRedDay: (() => {
              const weekday = new Date(`${serviceDate}T00:00:00Z`).getUTCDay();
              return (
                weekday === 0 ||
                weekday === 6 ||
                driverFinanceHolidays.has(serviceDate)
              );
            })(),
            customer: order.customer || "未填写",
            vehicleNumber:
              getOrderVehicleNumber({ ...order, vehicle: finance.vehicle || order.vehicle }),
            time: order.time,
            driver: finance.driver,
            requestAmount: totals.requestAmount,
            driverAdvances: totals.driverAdvances,
            companyExpenses: totals.companyExpenses,
            driverWages: totals.driverWages,
            profit: totals.profit,
            overtimeHours: getOrderFinanceAmount(finance, "driverOvertimeHours"),
            overtimeFee,
            percentageWage:
              finance.driverWageMode === "percentage" ? baseWage : 0,
            fixedWage:
              finance.driverWageMode === "percentage"
                ? 0
                : getOrderFinanceAmount(finance, "driverWage"),
            bonusWage,
            accountingAssignee: getAccountingAssigneeName(order.accountingAssignee || "", accountingAccounts),
            totalWage: totals.driverWages,
          };
        }),
    )
    .sort((first, second) =>
      `${second.serviceDate} ${second.time}`.localeCompare(
        `${first.serviceDate} ${first.time}`,
      ),
    );
  const filteredDriverFinanceDetails = companyDriverFinanceDetails.filter(
    (row) => !driverFinanceDriverFilter || row.driver === driverFinanceDriverFilter,
  );
  const driverFinanceCompanyLabel = driverFinanceCompanyFilter === "__unassigned_company__"
    ? "未设置所属会社"
    : driverFinanceCompanyFilter || "全部所属会社";
  const driverFinanceTotalWage = filteredDriverFinanceDetails.reduce(
    (total, row) => total + row.driverWages,
    0,
  );
  const driverFinanceTotalAdvances = filteredDriverFinanceDetails.reduce(
    (total, row) => total + row.driverAdvances, 0,
  );
  async function exportCompanyWages() {
    if (companyDriverFinanceDetails.length === 0) {
      alert("所选月份及所属会社暂无司机工资记录。");
      return;
    }
    try {
      await printCompanyWages({
        month: financeMonth,
        company: driverFinanceCompanyLabel,
        region: activeRegionId === ALL_REGIONS_ID ? "全部分区" : regionNameById.get(activeRegionId) || "未知地域",
        rows: companyDriverFinanceDetails,
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "会社工资总表导出失败，请重试。");
    }
  }
  const filteredVehicleFinanceDetails = monthlyFinanceOrders
    .flatMap((order) =>
      Object.entries(order.financeByDate || {})
        .filter(([, finance]) => {
          const vehicleName = finance.vehicle || order.vehicle;
          return (
            vehicleName &&
            (vehicleFinanceVehicleFilter === "" ||
              vehicleName === vehicleFinanceVehicleFilter)
          );
        })
        .map(([serviceDate, finance]) => {
          const totals = calculateOrderFinance(
            finance,
            serviceDate === order.date ? order.orderPrice : 0,
          );
          return {
            id: `${order.id}-${serviceDate}`,
            serviceDate,
            customer: order.customer || "未填写",
            driver: finance.driver || "未安排",
            vehicleName: finance.vehicle || order.vehicle,
            regionId: order.regionId,
            vehicleNumber: getOrderVehicleNumber({ ...order, vehicle: finance.vehicle || order.vehicle }),
            time: order.time,
            ...totals,
          };
        }),
    )
    .sort((first, second) =>
      `${second.serviceDate} ${second.time}`.localeCompare(
        `${first.serviceDate} ${first.time}`,
      ),
    );
  const vehicleSummaryResult: { rows: VehicleMonthlySummary[]; error: string } = (() => {
    if (vehicleFinanceVehicleFilter) return { rows: [], error: "" };
    try {
      return {
        rows: summarizeVehicles(financeMonth, vehicleRecords, vehicleMonthlyFinanceRecords, filteredVehicleFinanceDetails),
        error: "",
      };
    } catch (error) {
      return { rows: [], error: error instanceof Error ? error.message : "车辆月度汇总失败，请刷新后重试。" };
    }
  })();
  const vehicleSummaryTotals = totalVehicleSummaries(vehicleSummaryResult.rows);
  const selectedVehicleForFinance = vehicleRecords.find(
    (vehicle) => vehicle.name === vehicleFinanceVehicleFilter,
  );
  const selectedVehicleMonthlyFinance = selectedVehicleForFinance
    ? vehicleMonthlyFinanceRecords.find(
        (record) =>
          record.vehicleId === selectedVehicleForFinance.id &&
          record.month === financeMonth,
      )
    : undefined;

  function getVehicleMonthlyFinanceForm(vehicleName: string, month: string) {
    const vehicle = vehicleRecords.find((item) => item.name === vehicleName);
    if (!vehicle) {
      return {
        parkingFee: "",
        insuranceFee: "",
        inspectionFee: "",
        repairFee: "",
        supplies: [],
        startOdometer: "",
        endOdometer: "",
      };
    }
    const record = vehicleMonthlyFinanceRecords.find(
      (item) => item.vehicleId === vehicle.id && item.month === month,
    );
    return {
      parkingFee: String(
        record?.parkingFee ??
          vehicle.defaultParkingFee ??
          0,
      ),
      insuranceFee: String(
        record?.insuranceFee ??
          vehicle.defaultInsuranceFee ??
          0,
      ),
      inspectionFee: String(record?.inspectionFee ?? 0),
      repairFee: String(record?.repairFee ?? 0),
      supplies:
        record?.supplies.map((supply) => ({
          description: supply.description,
          amount: String(supply.amount),
        })) ?? [],
      startOdometer:
        record?.startOdometer === null ||
        record?.startOdometer === undefined
          ? ""
          : String(record.startOdometer),
      endOdometer:
        record?.endOdometer === null ||
        record?.endOdometer === undefined
          ? ""
          : String(record.endOdometer),
    };
  }

  const readMonthlyAmount = (value: string) =>
    value.trim() === "" ? 0 : parseNonNegativeInteger(value);
  const monthlyParkingFee =
    readMonthlyAmount(vehicleMonthlyFinanceForm.parkingFee) ?? 0;
  const monthlyInsuranceFee =
    readMonthlyAmount(vehicleMonthlyFinanceForm.insuranceFee) ?? 0;
  const monthlyInspectionFee =
    readMonthlyAmount(vehicleMonthlyFinanceForm.inspectionFee) ?? 0;
  const monthlyRepairFee =
    readMonthlyAmount(vehicleMonthlyFinanceForm.repairFee) ?? 0;
  const monthlySupplies = vehicleMonthlyFinanceForm.supplies.reduce(
    (total, supply) => total + (readMonthlyAmount(supply.amount) ?? 0),
    0,
  );
  const vehicleMonthlyExpenses =
    monthlyParkingFee +
    monthlyInsuranceFee +
    monthlyInspectionFee +
    monthlyRepairFee +
    monthlySupplies;
  const startOdometer = parseNonNegativeInteger(
    vehicleMonthlyFinanceForm.startOdometer,
  );
  const endOdometer = parseNonNegativeInteger(
    vehicleMonthlyFinanceForm.endOdometer,
  );
  const monthlyDistance =
    startOdometer !== null &&
    endOdometer !== null &&
    endOdometer >= startOdometer
      ? endOdometer - startOdometer
      : null;
  const vehicleOrderProfit = filteredVehicleFinanceDetails.reduce(
    (total, row) => total + row.profit,
    0,
  );
  const vehicleNetProfit = vehicleOrderProfit - vehicleMonthlyExpenses;
  const vehicleProfitPerKilometer =
    monthlyDistance !== null && monthlyDistance > 0
      ? vehicleNetProfit / monthlyDistance
      : null;

  function saveVehicleMonthlyFinance() {
    if (!selectedVehicleForFinance) return;
    const parkingFee = readMonthlyAmount(vehicleMonthlyFinanceForm.parkingFee);
    const insuranceFee = readMonthlyAmount(vehicleMonthlyFinanceForm.insuranceFee);
    const inspectionFee = readMonthlyAmount(vehicleMonthlyFinanceForm.inspectionFee);
    const repairFee = readMonthlyAmount(vehicleMonthlyFinanceForm.repairFee);
    const parsedStartOdometer = parseNonNegativeInteger(
      vehicleMonthlyFinanceForm.startOdometer,
    );
    const parsedEndOdometer = parseNonNegativeInteger(
      vehicleMonthlyFinanceForm.endOdometer,
    );
    const supplies: { description: string; amount: number }[] = [];

    for (const supply of vehicleMonthlyFinanceForm.supplies) {
      const description = supply.description.trim();
      const amount =
        supply.amount.trim() === ""
          ? null
          : parseNonNegativeInteger(supply.amount);
      if (!description && supply.amount.trim() === "") continue;
      if (!description || amount === null) {
        setVehicleMonthlyFinanceError(
          "请为每条备品明细填写名称和非负整数金额。",
        );
        return;
      }
      if (description.length > 300 || amount > 99_999_999_999_999) {
        setVehicleMonthlyFinanceError("备品名称最多 300 个字符，金额不能超过 99999999999999 日元。");
        return;
      }
      if (supplies.length >= 100) {
        setVehicleMonthlyFinanceError("每月最多可登记 100 条备品费用。");
        return;
      }
      supplies.push({ description, amount });
    }

    if (
      parkingFee === null ||
      parkingFee > 99_999_999_999_999 ||
      insuranceFee === null ||
      insuranceFee > 99_999_999_999_999 ||
      inspectionFee === null ||
      inspectionFee > 99_999_999_999_999 ||
      repairFee === null ||
      repairFee > 99_999_999_999_999 ||
      (vehicleMonthlyFinanceForm.startOdometer.trim() !== "" &&
        (parsedStartOdometer === null || parsedStartOdometer > 99_999_999_999)) ||
      (vehicleMonthlyFinanceForm.endOdometer.trim() !== "" &&
        (parsedEndOdometer === null || parsedEndOdometer > 99_999_999_999)) ||
      !Number.isSafeInteger(
        parkingFee +
          insuranceFee +
          inspectionFee +
          repairFee +
          supplies.reduce((sum, supply) => sum + supply.amount, 0),
      )
    ) {
      setVehicleMonthlyFinanceError("费用、备品金额和公里数必须在有效范围内。");
      return;
    }
    if (
      parsedStartOdometer !== null &&
      parsedEndOdometer !== null &&
      parsedEndOdometer < parsedStartOdometer
    ) {
      setVehicleMonthlyFinanceError("月末公里数不能小于月初公里数。");
      return;
    }

    const current = selectedVehicleMonthlyFinance;
    const nextRecord: VehicleMonthlyFinance = {
      id: current?.id ?? createId(),
      regionId: selectedVehicleForFinance.regionId,
      vehicleId: selectedVehicleForFinance.id,
      month: financeMonth,
      parkingFee,
      insuranceFee,
      inspectionFee,
      repairFee,
      supplies,
      startOdometer: parsedStartOdometer,
      endOdometer: parsedEndOdometer,
    };
    setVehicleMonthlyFinanceRecords((records) =>
      current
        ? records.map((record) =>
            record.id === current.id ? nextRecord : record,
          )
        : [...records, nextRecord],
    );
    setVehicleMonthlyFinanceError("");
  }
  async function exportVehicleFinance() {
    if (!vehicleFinanceVehicleFilter) {
      if (vehicleSummaryResult.error) {
        alert(vehicleSummaryResult.error);
        return;
      }
      if (vehicleSummaryResult.rows.length === 0) {
        alert("当前分区暂无车辆或财务记录。");
        return;
      }
      try {
        await printVehicleSummary({
          month: financeMonth,
          region: activeRegionId === ALL_REGIONS_ID ? "全部分区" : regionNameById.get(activeRegionId) || "未知地域",
          rows: vehicleSummaryResult.rows,
          regionNames: Object.fromEntries(regionNameById),
        });
      } catch (error) {
        alert(error instanceof Error ? error.message : "车辆月度汇总导出失败，请重试。");
      }
      return;
    }
    if (!selectedVehicleForFinance && filteredVehicleFinanceDetails.length === 0) {
      alert("当前月份及分区暂无车辆财务记录。");
      return;
    }
    if (vehicleFinanceVehicleFilter && (
      !selectedVehicleForFinance || vehicleRecords.filter(
        (vehicle) => vehicle.name === vehicleFinanceVehicleFilter,
      ).length !== 1
    )) {
      alert("无法唯一识别车辆，请先选择具体分区后重新选择车辆。");
      return;
    }
    try {
      await printVehicleFinance({
        month: financeMonth,
        region: activeRegionId === ALL_REGIONS_ID ? "全部分区" : regionNameById.get(activeRegionId) || "未知地域",
        vehicleNumber: selectedVehicleForFinance?.plate || "未填写番号",
        rows: filteredVehicleFinanceDetails,
        monthly: selectedVehicleForFinance ? vehicleMonthlyFinanceForm : null,
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "车辆财务表导出失败，请重试。");
    }
  }
  const todayDateKey = toDateKey(new Date());
  const driverSelectionOrder = driverSelectionTarget && driverSelectionTarget !== "form"
    ? orders.find((order) => order.id === driverSelectionTarget)
    : undefined;
  const driverSelectionRegionId = driverSelectionTarget === "form"
    ? form.regionId || getRegionForNewRecords()
    : driverSelectionOrder?.regionId;
  const driverSelectionCandidates = driverSelectionTarget ? rankDriversByRecentService(
    driverRecords.filter((driver) => driver.regionId === driverSelectionRegionId),
    orders,
    todayDateKey,
  ) : [];
  const isUpcomingOrder = (order: Order) => order.date > todayDateKey;

  function requestDelete(
    message: string,
    action: (password: string) => void | Promise<void>,
  ) {
    setDeleteError("");
    setDeletePassword("");
    setPendingDelete({ message, action });
  }

  async function confirmPendingDelete() {
    if (!pendingDelete || isDeleting || !deletePassword) return;
    setDeleteError("");
    setIsDeleting(true);
    try {
      await pendingDelete.action(deletePassword);
      setPendingDelete(null);
      setDeletePassword("");
    } catch (error) {
      console.error("Failed to complete a confirmed deletion.", error);
      setDeleteError(
        error instanceof Error ? error.message : "删除失败，请稍后重试。",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  function addBalanceExpenseItem(kind: BalanceExpenseItem["kind"]) {
    if (balanceExpensesMigrationPending) return;
    if (!requireSpecificRegionForNewData()) return;
    if (
      balanceCompanyFilter === "" ||
      balanceCompanyFilter === "__unassigned_company__"
    ) {
      setBalanceExpenseError("请先选择具体所属会社，再添加收支项目。");
      return;
    }
    const name = balanceExpenseNameDraft[kind].trim();
    if (!name || name.length > 200) {
      setBalanceExpenseError("收支项目名称不能为空，且不能超过 200 个字符。");
      return;
    }
    if (
      balanceExpenseItems.some(
        (item) =>
          item.companyName === balanceCompanyFilter &&
          item.kind === kind &&
          item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      setBalanceExpenseError("该会社已存在同类同名收支项目。");
      return;
    }
    setBalanceExpenseItems((items) => [
      ...items,
      {
        id: createId(),
        kind,
        companyName: balanceCompanyFilter,
        name,
        monthlyAmounts: {},
      },
    ]);
    setBalanceExpenseNameDraft((drafts) => ({ ...drafts, [kind]: "" }));
    setBalanceExpenseError("");
  }

  function saveBalanceExpenseAmounts(kind: BalanceExpenseItem["kind"]) {
    if (balanceExpensesMigrationPending) return;
    if (
      balanceCompanyFilter === "" ||
      balanceCompanyFilter === "__unassigned_company__"
    ) {
      setBalanceExpenseError("请选择具体所属会社后再保存收支金额。");
      return;
    }
    const items = balanceExpenseItems.filter(
      (item) => item.companyName === balanceCompanyFilter && item.kind === kind,
    );
    const amounts = new Map<string, number>();
    for (const item of items) {
      const draft = balanceExpenseAmountDrafts[`${item.id}:${balanceMonth}`];
      if (draft === undefined) continue;
      const value = draft.trim() === "" ? 0 : Number(draft);
      if (
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > 99_999_999_999_999
      ) {
        setBalanceExpenseError("每项收支金额必须是 0 至 99999999999999 的整数。");
        return;
      }
      amounts.set(item.id, value);
    }
    if (amounts.size === 0) {
      setBalanceExpenseError("没有需要保存的金额变更。");
      return;
    }
    setBalanceExpenseItems((records) =>
      records.map((item) => {
        const amount = amounts.get(item.id);
        return amount === undefined
          ? item
          : {
              ...item,
              monthlyAmounts: {
                ...item.monthlyAmounts,
                [balanceMonth]: amount,
              },
            };
      }),
    );
    setBalanceExpenseAmountDrafts((drafts) => {
      const next = { ...drafts };
      for (const item of items) delete next[`${item.id}:${balanceMonth}`];
      return next;
    });
    setBalanceExpenseError("");
  }

  function deleteBalanceExpenseItem(item: BalanceExpenseItem) {
    requestDelete(
      `确定删除「${item.companyName || "未填写会社"}」的${item.kind === "income" ? "收入" : "支出"}项目「${item.name}」及其所有月份金额吗？`,
      () =>
        setBalanceExpenseItems((items) =>
          items.filter((current) => current.id !== item.id),
        ),
    );
  }

  async function exportBalance() {
    if (!balanceResult.summary) {
      alert(balanceResult.error);
      return;
    }
    try {
      await printBalance({
        month: balanceMonth,
        region: activeRegionId === ALL_REGIONS_ID ? "全部分区" : regionNameById.get(activeRegionId) || "未知地域",
        company: balanceCompanyFilter === "__unassigned_company__" ? "未填写" : balanceCompanyFilter || "全部会社",
        summary: balanceResult.summary,
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "收支平衡报表导出失败，请重试。");
    }
  }

  async function loadLoginAccounts() {
    setIsLoadingAccounts(true);
    try {
      const response = await fetch("/api/admin/accounts", { cache: "no-store" });
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        throw new Error(buildApiErrorMessage(response, payload, "无法读取账号列表。"));
      }
      if (!Array.isArray(payload)) {
        throw new Error("服务器返回的账号列表格式无效。");
      }
      setLoginAccounts(payload);
      setAccountError("");
    } finally {
      setIsLoadingAccounts(false);
    }
  }

  async function saveLoginAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (accountBusy) return;
    const fullName = loginAccountForm.fullName.trim();
    const email = loginAccountForm.email.trim().toLowerCase();
    const position = loginAccountForm.position.trim();
    if (!fullName || !email || !loginAccountForm.company || !position || !loginAccountForm.regionId) {
      alert("请填写用户姓名、邮箱、所属会社、职位和地域。");
      return;
    }
    const directCreation = editingLoginAccountId === null;
    if (directCreation && !validateAccountPassword()) return;

    setAccountError("");
    setAccountMessage("");
    setAccountBusy(true);
    try {
      const response = await fetch("/api/admin/accounts", {
        method: editingLoginAccountId === null ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingLoginAccountId === null
            ? {
                email,
                fullName,
                company: loginAccountForm.company,
                position,
                regionId: loginAccountForm.regionId,
                role: loginAccountForm.role,
                ...(directCreation ? { password: accountPassword } : {}),
              }
            : {
                userId: editingLoginAccountId,
                fullName,
                company: loginAccountForm.company,
                position,
                regionId: loginAccountForm.regionId,
                role: loginAccountForm.role,
              },
        ),
      });
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        throw new Error(buildApiErrorMessage(response, payload, "保存账号失败。"));
      }
      setAccountPassword("");
      setAccountPasswordConfirmation("");
      setAccountMessage(editingLoginAccountId !== null ? "账号资料已保存。"
        : "账号已创建，可直接使用邮箱和设置的密码登录，无需邮件验证。");
      await loadLoginAccounts();
    } catch (error) {
      console.error("Failed to save a user account.", error);
      setAccountError(error instanceof Error ? error.message : "保存账号失败。");
      return;
    } finally {
      setAccountBusy(false);
    }

    setEditingLoginAccountId(null);
    setLoginAccountForm({
      fullName: "",
      email: "",
      company: "",
      position: "",
      regionId: getRegionForNewRecords() ?? regions.find((region) => region.id === TOKYO_REGION_ID)?.id ?? regions[0]?.id ?? "",
      role: "user",
    });
    setShowLoginAccountForm(false);
  }

  function openLoginAccountForm(account?: LoginAccount) {
    setAccountPassword("");
    setAccountPasswordConfirmation("");
    setAccountMessage("");
    setAccountError("");
    setEditingLoginAccountId(account?.id ?? null);
    setLoginAccountForm({
      fullName: account?.fullName ?? "",
      email: account?.email ?? "",
      company: account?.company ?? "",
      position: account?.position ?? "",
      regionId: account?.regionId ?? getRegionForNewRecords() ?? regions.find((region) => region.id === TOKYO_REGION_ID)?.id ?? regions[0]?.id ?? "",
      role: account?.role ?? "user",
    });
    setShowLoginAccountForm(true);
  }

  function validateAccountPassword() {
    if (accountPassword.length < 8 || accountPassword.length > 128) {
      setAccountError("密码需要 8 至 128 个字符。");
      return false;
    }
    if (accountPassword !== accountPasswordConfirmation) {
      setAccountError("两次输入的密码不一致。");
      return false;
    }
    return true;
  }

  async function setLoginAccountPassword() {
    if (accountBusy || !editingLoginAccountId || !validateAccountPassword()) return;
    if (!window.confirm(`确定为「${loginAccountForm.email}」设置新密码？旧密码将无法用于新登录，待确认邮箱也将被确认。`)) return;
    setAccountBusy(true);
    setAccountError("");
    setAccountMessage("");
    try {
      const response = await fetch("/api/admin/accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: editingLoginAccountId, password: accountPassword }),
      });
      const payload = await readJsonSafely(response);
      if (!response.ok) throw new Error(buildApiErrorMessage(response, payload, "设置密码失败。"));
      setAccountPassword("");
      setAccountPasswordConfirmation("");
      setAccountMessage("新密码已设置，用户可直接登录。此操作不会保存尚未提交的账号资料。");
      await loadLoginAccounts();
    } catch (error) {
      console.error("Failed to set account password.", { name: error instanceof Error ? error.name : "UnknownError" });
      setAccountError(error instanceof Error ? error.message : "设置密码失败。");
    } finally {
      setAccountBusy(false);
    }
  }

  function deleteLoginAccount(account: LoginAccount) {
    requestDelete(`确定要删除登录账号「${account.email}」吗？`, async (password) => {
      const response = await fetch("/api/admin/accounts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: account.id, deletePassword: password }),
      });
      const payload = await readJsonSafely(response);
      if (!response.ok) {
        throw new Error(buildApiErrorMessage(response, payload, "删除账号失败。"));
      }
      await loadLoginAccounts();
    });
  }

  async function copyCalendarVehicleField(value: string, fieldName: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch (error) {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) {
        console.error(`复制${fieldName}失败。`, error);
        alert(`复制${fieldName}失败，请检查浏览器剪贴板权限。`);
      }
    }
  }

  function moveOrderToCell(orderId: string, vehicle: string, targetDate: string) {
    setOrders((currentOrders) =>
      currentOrders.map((order) => {
        if (order.id !== orderId) return order;

        const originalEndDate = order.endDate || order.date;
        const dateOffset = Math.round(
          (new Date(`${targetDate}T00:00:00`).getTime() -
            new Date(`${order.date}T00:00:00`).getTime()) /
            86400000,
        );
        const duration = Math.round(
          (new Date(`${originalEndDate}T00:00:00`).getTime() -
            new Date(`${order.date}T00:00:00`).getTime()) /
            86400000,
        );

        return {
          ...order,
          vehicle,
          date: targetDate,
          endDate: shiftDateKey(targetDate, duration),
          offDates: (order.offDates || []).map((offDate) =>
            shiftDateKey(offDate, dateOffset),
          ),
          financeByDate: shiftFinanceDates(order.financeByDate, dateOffset),
        };
      }),
    );
    setDraggingOrderId(null);
    setDragTargetKey(null);
  }

  function moveSplitRangeToVehicle(
    orderId: string,
    vehicle: string,
    startDate: string,
    endDate: string,
  ) {
    setOrders((currentOrders) => {
      return currentOrders.flatMap((order) => {
        if (order.id !== orderId || order.vehicle === vehicle) return [order];

        const orderEndDate = order.endDate || order.date;
        const movedOffDates = order.offDates.filter(
          (offDate) => offDate >= startDate && offDate <= endDate,
        );

        if (startDate <= order.date && endDate >= orderEndDate) {
          return [{ ...order, vehicle, offDates: movedOffDates }];
        }

        const hasBefore = order.date < startDate;
        const hasAfter = orderEndDate > endDate;
        const remainingOrders: Order[] = [];

        if (hasBefore) {
          remainingOrders.push({
            ...order,
            endDate: shiftDateKey(startDate, -1),
            orderPrice: order.orderPrice,
            offDates: order.offDates.filter((offDate) => offDate < startDate),
            financeByDate: shiftFinanceDates(
              order.financeByDate,
              0,
              (date) => date < startDate,
            ),
          });
        }

        if (hasAfter) {
          remainingOrders.push({
            ...order,
            id: hasBefore ? createId() : order.id,
            date: shiftDateKey(endDate, 1),
            endDate: orderEndDate,
            orderPrice: hasBefore ? 0 : order.orderPrice,
            offDates: order.offDates.filter((offDate) => offDate > endDate),
            financeByDate: shiftFinanceDates(
              order.financeByDate,
              0,
              (date) => date > endDate,
            ),
          });
        }

        remainingOrders.push({
          ...order,
          id: createId(),
          vehicle,
          date: startDate,
          endDate,
          orderPrice: hasBefore ? 0 : order.orderPrice,
          offDates: movedOffDates,
          financeByDate: shiftFinanceDates(
            order.financeByDate,
            0,
            (date) => date >= startDate && date <= endDate,
          ),
        });

        return remainingOrders;
      });
    });
    setSplitSelection(null);
    setDraggingOrderId(null);
    setDragTargetKey(null);
  }

  function selectSplitDate(orderId: string, date: string) {
    setSplitSelection((current) => {
      if (
        !current ||
        current.orderId !== orderId ||
        current.startDate === null ||
        current.endDate === null
      ) {
        return { orderId, startDate: date, endDate: date };
      }

      return {
        orderId,
        startDate: date < current.startDate ? date : current.startDate,
        endDate: date > current.endDate ? date : current.endDate,
      };
    });
  }

  function requireSpecificRegionForNewData() {
    if (!activeRegionId || activeRegionId === ALL_REGIONS_ID) {
      setPersistenceError("新增业务数据前，请先选择一个具体地域。");
      return false;
    }
    return true;
  }

  function openNewOrder(vehicle: string, date: string) {
    if (!requireSpecificRegionForNewData()) return;
    if (!vehicle || vehicleStatusByName.get(vehicle) !== "运营中") {
      alert(
        vehicle
          ? `车辆「${vehicle}」当前不可用，不能新增予約。`
          : "没有可用车辆，不能新增予約。",
      );
      return;
    }

    setEditingOrderId(null);
    setForm(createEmptyDraft(vehicle, date));
    setOffDateInput("");
    setCustomDriverMode(false);
    setCustomSourceMode(false);
    setCustomCompanyMode(false);
    setShowForm(true);
  }

  function openBatchOrderImport() {
    if (!requireSpecificRegionForNewData()) return;
    const vehicle = availableVehicles[0];
    if (!vehicle) {
      alert("没有可用车辆，不能批量新增预约。");
      return;
    }

    setBatchOrderInput("");
    setBatchOrderDate(toDateKey(calendarCenterDate));
    setBatchOrderVehicle(vehicle);
    setBatchOrderSource("");
    setBatchOrderCompany("");
    setShowBatchOrderForm(true);
  }

  function importBatchOrders() {
    if (!requireSpecificRegionForNewData()) return;
    const details = parseImportedOrderDetails(batchOrderInput);
    if (details.length === 0) {
      alert("未识别到预约信息。请按“06:30 上车地点 下车地点”的格式粘贴。");
      return;
    }
    if (details.length > 500) {
      alert("一次最多导入 500 条预约，请分批导入。");
      return;
    }
    if (!batchOrderDate || vehicleStatusByName.get(batchOrderVehicle) !== "运营中") {
      alert("请选择有效的日期和运营中的车辆。");
      return;
    }

    setOrders((currentOrders) => [
      ...currentOrders,
      ...details.map((detail) => ({
        ...createEmptyDraft(batchOrderVehicle, batchOrderDate),
        id: createId(),
        customer: `${detail.pickup} → ${detail.destination}`,
        time: detail.time,
        pickup: detail.pickup,
        destination: detail.destination,
        orderSource: batchOrderSource.trim(),
        company: batchOrderCompany.trim(),
      })),
    ]);
    setShowBatchOrderForm(false);
    setBatchOrderInput("");
    setBatchOrderSource("");
    setBatchOrderCompany("");
  }

  function openNewDriver() {
    if (!requireSpecificRegionForNewData()) return;
    setEditingDriverId(null);
    setEditingDriverName(null);
    setDriverForm({
      name: "",
      phone: "",
      wechat: "",
      whatsapp: "",
      licenseExpiry: "",
    });
    setShowDriverForm(true);
  }

  function openEditDriver(driver: Driver) {
    setEditingDriverId(driver.id.startsWith("unregistered-") ? null : driver.id);
    setEditingDriverName(driver.name);
    setDriverForm({
      name: driver.name,
      phone: driver.phone,
      wechat: driver.wechat,
      whatsapp: driver.whatsapp,
      licenseExpiry: driver.licenseExpiry || "",
    });
    setShowDriverForm(true);
  }

  function saveDriver() {
    if (editingDriverId === null && !requireSpecificRegionForNewData()) return;
    const driverRegionId = editingDriverId === null
      ? getRegionForNewRecords()
      : allDriverRecords.find((driver) => driver.id === editingDriverId)?.regionId;
    if (!driverRegionId) return;
    const savedDriver: DriverDraft = {
      name: driverForm.name.trim(),
      phone: driverForm.phone.trim(),
      wechat: driverForm.wechat.trim(),
      whatsapp: driverForm.whatsapp.trim(),
      licenseExpiry: driverForm.licenseExpiry,
    };

    if (!savedDriver.name) {
      alert("请填写運転士。");
      return;
    }

    if (
      driverRecords.some(
        (driver) =>
          driver.regionId === driverRegionId &&
          driver.name === savedDriver.name && driver.id !== editingDriverId,
      )
    ) {
      alert("该運転士已存在。");
      return;
    }

    if (editingDriverId === null) {
      setDriverRecords((current) => [...current, { id: createId(), ...savedDriver }]);
    } else {
      setDriverRecords((current) =>
        current.map((driver) =>
          driver.id === editingDriverId
            ? { id: driver.id, ...savedDriver }
            : driver,
        ),
      );
    }

    if (editingDriverName && editingDriverName !== savedDriver.name) {
      setOrders((current) =>
        current.map((order) =>
          order.regionId === driverRegionId && order.driver === editingDriverName
            ? { ...order, driver: savedDriver.name }
            : order,
        ),
      );
    }

    setShowDriverForm(false);
  }

  function deleteDriver(driver: Driver) {
    const linkedOrders = orders.filter(
      (order) => order.regionId === driver.regionId &&
        order.driver === driver.name && isUpcomingOrder(order),
    ).length;
    const linkedNotice = linkedOrders
      ? `将清空 ${linkedOrders} 笔未开始予約的運転士字段；已开始或过去的予約保留原信息。`
      : "";
    requestDelete(`确定删除運転士「${driver.name}」吗？${linkedNotice}`, () => {
      setDriverRecords((current) =>
        current.filter((record) => record.id !== driver.id),
      );
      setOrders((current) =>
        current.map((order) =>
          order.regionId === driver.regionId &&
          order.driver === driver.name &&
          isUpcomingOrder(order)
            ? { ...order, driver: "" }
            : order,
        ),
      );
    });
  }

  function openNewSource() {
    if (!requireSpecificRegionForNewData()) return;
    setEditingSourceId(null);
    setEditingSourceName(null);
    setSourceForm({
      companyName: "",
      contactName: "",
      contactInfo: "",
      address: "",
      color: "#2563eb",
    });
    setShowSourceForm(true);
  }

  function openEditSource(source: OrderSource) {
    setEditingSourceId(source.id.startsWith("unregistered-") ? null : source.id);
    setEditingSourceName(source.companyName);
    setSourceForm({
      companyName: source.companyName,
      contactName: source.contactName,
      contactInfo: source.contactInfo,
      address: source.address,
      color: source.color || "#2563eb",
    });
    setShowSourceForm(true);
  }

  function saveSource() {
    if (editingSourceId === null && !requireSpecificRegionForNewData()) return;
    const sourceRegionId = editingSourceId === null
      ? getRegionForNewRecords()
      : allOrderSourceRecords.find((source) => source.id === editingSourceId)?.regionId;
    if (!sourceRegionId) return;
    const savedSource: OrderSourceDraft = {
      companyName: sourceForm.companyName.trim(),
      contactName: sourceForm.contactName.trim(),
      contactInfo: sourceForm.contactInfo.trim(),
      address: sourceForm.address.trim(),
      color: sourceForm.color,
    };

    if (!savedSource.companyName) {
      alert("请填写来源。");
      return;
    }

    if (
      orderSourceRecords.some(
        (source) =>
          source.regionId === sourceRegionId &&
          source.companyName === savedSource.companyName &&
          source.id !== editingSourceId,
      )
    ) {
      alert("该来源已存在。");
      return;
    }

    if (editingSourceId === null) {
      setOrderSourceRecords((current) => [
        ...current,
        { id: createId(), ...savedSource },
      ]);
    } else {
      setOrderSourceRecords((current) =>
        current.map((source) =>
          source.id === editingSourceId
            ? { id: source.id, ...savedSource }
            : source,
        ),
      );
    }

    if (editingSourceName && editingSourceName !== savedSource.companyName) {
      setOrders((current) =>
        current.map((order) =>
          order.regionId === sourceRegionId && order.orderSource === editingSourceName
            ? { ...order, orderSource: savedSource.companyName }
            : order,
        ),
      );
    }

    setShowSourceForm(false);
  }

  function updateSourceColor(source: OrderSource, color: string) {
    if (!source.regionId) {
      requireSpecificRegionForNewData();
      return;
    }
    setOrderSourceRecords((current) => {
      if (current.some((record) => record.regionId === source.regionId && record.companyName === source.companyName)) {
        return current.map((record) =>
          record.regionId === source.regionId && record.companyName === source.companyName
            ? { ...record, color }
            : record,
        );
      }

      return [
        ...current,
        {
          id: createId(),
          regionId: source.regionId,
          companyName: source.companyName,
          contactName: source.contactName,
          contactInfo: source.contactInfo,
          address: source.address,
          color,
        },
      ];
    });
  }

  function deleteSource(source: OrderSource) {
    const linkedOrders = orders.filter(
      (order) =>
        order.regionId === source.regionId &&
        order.orderSource === source.companyName &&
        isUpcomingOrder(order),
    ).length;
    const linkedNotice = linkedOrders
      ? `将清空 ${linkedOrders} 笔未开始予約的来源字段；已开始或过去的予約保留原信息。`
      : "";

    requestDelete(`确定删除来源「${source.companyName}」吗？${linkedNotice}`, () => {
      setOrderSourceRecords((current) =>
        current.filter((record) => record.id !== source.id),
      );
      setOrders((current) =>
        current.map((order) =>
          order.regionId === source.regionId &&
          order.orderSource === source.companyName &&
          isUpcomingOrder(order)
            ? { ...order, orderSource: "" }
            : order,
        ),
      );
      if (orderSourceFilter === source.companyName) setOrderSourceFilter("");
    });
  }

  function openEditCompany(company: Company) {
    setEditingCompanyId(company.id.startsWith("unregistered-") ? null : company.id);
    setEditingCompanyName(company.name);
    setCompanyForm({
      name: company.name,
      operationsManager: company.operationsManager || "",
      maintenanceManager: company.maintenanceManager || "",
      phone: company.phone || "",
      rollCallAddress: company.rollCallAddress || "",
      garageAddress: company.garageAddress || "",
      bankAccount: company.bankAccount || "",
      taxRegistrationNumber: company.taxRegistrationNumber || "",
      sealImage: company.sealImage || "",
    });
    setShowCompanyForm(true);
  }

  function openNewCompany() {
    if (!requireSpecificRegionForNewData()) return;
    setEditingCompanyId(null);
    setEditingCompanyName(null);
    setCompanyForm({
      name: "",
      operationsManager: "",
      maintenanceManager: "",
      phone: "",
      rollCallAddress: "",
      garageAddress: "",
      bankAccount: "",
      taxRegistrationNumber: "",
      sealImage: "",
    });
    setShowCompanyForm(true);
  }

  function saveCompany() {
    if (companySealBusy) {
      alert("印章正在处理，请稍后再保存。");
      return;
    }
    if (!isCompanySealDataUrl(companyForm.sealImage)) {
      alert("印章图片无效，请重新上传。");
      return;
    }
    if (editingCompanyId === null && !requireSpecificRegionForNewData()) return;
    const companyRegionId = editingCompanyId === null
      ? getRegionForNewRecords()
      : allCompanyRecords.find((company) => company.id === editingCompanyId)?.regionId;
    if (!companyRegionId) return;
    const savedName = companyForm.name.trim();
    if (!/^(?:T[0-9]{13})?$/.test(companyForm.taxRegistrationNumber.trim().toUpperCase())) {
      alert("T番号须为 T 加13位数字。");
      return;
    }
    if (!savedName) {
      alert("请填写会社名。");
      return;
    }

    if (
      companyRecords.some(
        (company) =>
          company.regionId === companyRegionId &&
          company.name === savedName && company.id !== editingCompanyId,
      )
    ) {
      alert("该会社名已存在。");
      return;
    }

    const savedCompany: CompanyDraft = {
      name: savedName,
      operationsManager: companyForm.operationsManager.trim(),
      maintenanceManager: companyForm.maintenanceManager.trim(),
      phone: companyForm.phone.trim(),
      rollCallAddress: companyForm.rollCallAddress.trim(),
      garageAddress: companyForm.garageAddress.trim(),
      bankAccount: companyForm.bankAccount.trim(),
      taxRegistrationNumber: companyForm.taxRegistrationNumber.trim().toUpperCase(),
      sealImage: companyForm.sealImage,
    };

    if (editingCompanyId === null) {
      setCompanyRecords((current) => [
        ...current,
        { id: createId(), ...savedCompany },
      ]);
    } else {
      setCompanyRecords((current) =>
        current.map((company) =>
          company.id === editingCompanyId
            ? { id: company.id, ...savedCompany }
            : company,
        ),
      );
    }

    if (editingCompanyName && editingCompanyName !== savedName) {
      setOrders((current) =>
        current.map((order) =>
          order.regionId === companyRegionId && order.company === editingCompanyName
            ? { ...order, company: savedName }
            : order,
        ),
      );
      setVehicleRecords((current) =>
        current.map((vehicle) =>
          vehicle.regionId === companyRegionId && vehicle.ownerCompany === editingCompanyName
            ? { ...vehicle, ownerCompany: savedName }
            : vehicle,
        ),
      );
    }

    setShowCompanyForm(false);
  }

  function deleteCompany(company: Company) {
    const linkedOrders = orders.filter(
      (order) => order.regionId === company.regionId &&
        order.company === company.name && isUpcomingOrder(order),
    ).length;
    const linkedNotice = linkedOrders
      ? `将清空 ${linkedOrders} 笔未开始予約的会社字段；已开始或过去的予約保留原信息。`
      : "";
    requestDelete(
      `确定删除所属会社「${company.name}」吗？${linkedNotice}`,
      () => {
        setCompanyRecords((current) =>
          current.filter((record) => record.id !== company.id),
        );
        setOrders((current) =>
          current.map((order) =>
            order.regionId === company.regionId &&
            order.company === company.name &&
            isUpcomingOrder(order)
              ? { ...order, company: "" }
              : order,
          ),
        );
      },
    );
  }

  function openNewVehicle() {
    if (!requireSpecificRegionForNewData()) return;
    setEditingVehicleId(null);
    setEditingVehicleName(null);
    setVehicleNameMode(vehicleNameOptions[0]);
    setVehicleForm({
      name: vehicleNameOptions[0],
      plate: "",
      defaultParkingFee: 0,
      defaultInsuranceFee: 0,
      ownerCompany: "",
      seats: "",
      fuelType: "",
      inspectionExpiry: "",
      liabilityExpiry: "",
      notes: "",
      status: "运营中",
    });
    setShowVehicleForm(true);
  }

  function openEditVehicle(vehicle: Vehicle) {
    setEditingVehicleId(vehicle.id.startsWith("unregistered-") ? null : vehicle.id);
    setEditingVehicleName(vehicle.name);
    setVehicleNameMode(vehicle.name);
    setVehicleForm({
      name: vehicle.name,
      plate: vehicle.plate,
      defaultParkingFee: vehicle.defaultParkingFee || 0,
      defaultInsuranceFee: vehicle.defaultInsuranceFee || 0,
      ownerCompany: vehicle.ownerCompany || "",
      seats: vehicle.seats,
      fuelType: vehicle.fuelType,
      inspectionExpiry: vehicle.inspectionExpiry || "",
      liabilityExpiry: vehicle.liabilityExpiry || "",
      notes: vehicle.notes,
      status: vehicle.status,
    });
    setShowVehicleForm(true);
  }

  function saveVehicle() {
    if (editingVehicleId === null && !requireSpecificRegionForNewData()) return;
    const vehicleRegionId = editingVehicleId === null
      ? getRegionForNewRecords()
      : allVehicleRecords.find((vehicle) => vehicle.id === editingVehicleId)?.regionId;
    if (!vehicleRegionId) return;
    const existingVehicle = vehicleRecords.find(
      (vehicle) => vehicle.id === editingVehicleId,
    );
    const savedVehicle: VehicleDraft = {
      name: editingVehicleName === null
        ? vehicleForm.name.trim() || vehicleForm.plate.trim()
        : vehicleForm.name.trim(),
      plate: vehicleForm.plate.trim(),
      defaultParkingFee: vehicleForm.defaultParkingFee,
      defaultInsuranceFee: vehicleForm.defaultInsuranceFee,
      ownerCompany: vehicleForm.ownerCompany.trim(),
      seats: vehicleForm.seats.trim(),
      fuelType: vehicleForm.fuelType,
      inspectionExpiry: vehicleForm.inspectionExpiry,
      liabilityExpiry: vehicleForm.liabilityExpiry,
      notes: vehicleForm.notes.trim(),
      status: vehicleForm.status,
    };

    if (
      !Number.isSafeInteger(savedVehicle.defaultParkingFee) ||
      savedVehicle.defaultParkingFee < 0 ||
      savedVehicle.defaultParkingFee > 99_999_999_999_999 ||
      !Number.isSafeInteger(savedVehicle.defaultInsuranceFee) ||
      savedVehicle.defaultInsuranceFee < 0 ||
      savedVehicle.defaultInsuranceFee > 99_999_999_999_999
    ) {
      alert("默认停车场月费和保险月费必须为非负整数。");
      return;
    }

    if (!savedVehicle.name) {
      alert("请填写車名。");
      return;
    }

    const plateRequired =
      editingVehicleId === null && !isOutsourcedVehicle(savedVehicle.name);
    if (plateRequired && !savedVehicle.plate) {
      alert("请填写車両番号。");
      return;
    }

    if (
      savedVehicle.ownerCompany &&
      !allCompanyRecords.some((company) =>
        company.regionId === vehicleRegionId && company.name === savedVehicle.ownerCompany,
      ) &&
      savedVehicle.ownerCompany !== existingVehicle?.ownerCompany
    ) {
      alert("車両所属必须从所属会社列表中选择。");
      return;
    }

    if (
      vehicleRecords.some(
        (vehicle) =>
          vehicle.regionId === vehicleRegionId &&
          savedVehicle.plate && vehicle.plate === savedVehicle.plate &&
          vehicle.id !== editingVehicleId,
      )
    ) {
      alert("車両番号已存在。");
      return;
    }

    if (editingVehicleId === null) {
      setVehicleRecords((current) => [
        ...current,
        { id: createId(), ...savedVehicle },
      ]);
    } else {
      setVehicleRecords((current) =>
        current.map((vehicle) =>
          vehicle.id === editingVehicleId
            ? { id: vehicle.id, ...savedVehicle }
            : vehicle,
        ),
      );
    }

    if (editingVehicleName && editingVehicleName !== savedVehicle.name) {
      setOrders((current) =>
        current.map((order) =>
          order.regionId === vehicleRegionId && order.vehicle === editingVehicleName
            ? { ...order, vehicle: savedVehicle.name }
            : order,
        ),
      );
    }

    setShowVehicleForm(false);
  }

  function deleteVehicle(vehicle: Vehicle) {
    const linkedOrders = orders.filter(
      (order) => order.regionId === vehicle.regionId &&
        order.vehicle === vehicle.name && isUpcomingOrder(order),
    ).length;
    const linkedNotice = linkedOrders
      ? `将清空 ${linkedOrders} 笔未开始予約的車両字段；已开始或过去的予約保留原信息。`
      : "";
    requestDelete(`确定删除車両「${vehicle.name}」吗？${linkedNotice}`, () => {
      setVehicleRecords((current) =>
        current.filter((record) => record.id !== vehicle.id),
      );
      setOrders((current) =>
        current.map((order) =>
          order.regionId === vehicle.regionId &&
          order.vehicle === vehicle.name &&
          isUpcomingOrder(order)
            ? { ...order, vehicle: "" }
            : order,
        ),
      );
    });
  }

  function openBatchAdd(type: BatchAddType) {
    if (!requireSpecificRegionForNewData()) return;
    setBatchInput("");
    setBatchAddType(type);
  }

  function saveBatchAdd() {
    if (!requireSpecificRegionForNewData()) return;
    const lines = batchInput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!batchAddType || lines.length === 0) {
      alert("请先填写要新增的内容。");
      return;
    }

    const splitColumns = (line: string) =>
      line.split(line.includes("\\t") ? "\\t" : /[,，]/).map((value) => value.trim());

    if (batchAddType === "drivers") {
      const records = lines.map((line) => {
        const [name, phone = "", wechat = "", whatsapp = "", licenseExpiry = ""] = splitColumns(line);
        return { name, phone, wechat, whatsapp, licenseExpiry };
      });
      const names = records.map((record) => record.name);
      if (records.some((record) => !record.name)) {
        alert("運転士每行至少填写運転士；連絡先和有效期可选。");
        return;
      }
      if (
        new Set(names).size !== names.length ||
        names.some((name) => driverRecords.some((driver) => driver.name === name))
      ) {
        alert("運転士不能重复，请检查批量内容。");
        return;
      }
      setDriverRecords((current) => [
        ...current,
        ...records.map((record) => ({ id: createId(), ...record })),
      ]);
    }

    if (batchAddType === "vehicles") {
      const records = lines.map((line) => {
        const [name, plate, seats, fuelType, fifth = "", sixth = "", seventh = "", eighth = ""] = splitColumns(line);
        const hasExpiryColumns =
          /^\d{4}-\d{2}-\d{2}$/.test(fifth) ||
          /^\d{4}-\d{2}-\d{2}$/.test(sixth) ||
          Boolean(seventh);
        return {
          name,
          plate,
          ownerCompany: eighth,
          seats,
          fuelType,
          inspectionExpiry: /^\d{4}-\d{2}-\d{2}$/.test(fifth) ? fifth : "",
          liabilityExpiry: /^\d{4}-\d{2}-\d{2}$/.test(sixth) ? sixth : "",
          notes: hasExpiryColumns ? seventh : fifth,
        };
      });
      const plates = records.map((record) => record.plate);
      if (
        records.some(
          (record) =>
            !record.name ||
            !record.plate ||
            !["5", "7", "8", "10"].includes(record.seats) ||
            !fuelTypes.includes(record.fuelType),
        )
      ) {
        alert("車両每行请按顺序填写：車名、車両番号、座位数（5/7/8/10）、燃油类型、車検有効期限、自賠責有効期限、備考、車両所属（后4项可选）。");
        return;
      }
      if (
        records.some(
          (record) =>
            record.ownerCompany &&
            !companyRecords.some((company) => company.name === record.ownerCompany),
        )
      ) {
        alert("車両所属必须填写所属会社列表中的名称，请检查批量内容。");
        return;
      }
      if (
        new Set(plates).size !== plates.length ||
        plates.some((plate) => vehicleRecords.some((vehicle) => vehicle.plate === plate))
      ) {
        alert("車両番号不能重复，请检查批量内容。");
        return;
      }
      setVehicleRecords((current) => [
        ...current,
        ...records.map((record) => ({
          id: createId(),
          ...record,
          defaultParkingFee: 0,
          defaultInsuranceFee: 0,
          status: "运营中" as const,
        })),
      ]);
    }

    if (batchAddType === "sources") {
      const records = lines.map((line) => {
        const [companyName, contactName = "", contactInfo = "", color = "#2563eb"] = splitColumns(line);
        return { companyName, contactName, contactInfo, address: "", color };
      });
      const names = records.map((record) => record.companyName);
      if (names.some((name) => !name)) {
        alert("来源每行至少填写来源。");
        return;
      }
      if (
        new Set(names).size !== names.length ||
        names.some((name) => orderSourceRecords.some((source) => source.companyName === name))
      ) {
        alert("来源不能重复，请检查批量内容。");
        return;
      }
      setOrderSourceRecords((current) => [
        ...current,
        ...records.map((record) => ({ id: createId(), ...record })),
      ]);
    }

    if (batchAddType === "companies") {
      const records = lines.map((line) => {
        const [
          name,
          operationsManager = "",
          maintenanceManager = "",
          phone = "",
          rollCallAddress = "",
          garageAddress = "",
        ] = splitColumns(line);
        return {
          name,
          operationsManager,
          maintenanceManager,
          phone,
          rollCallAddress,
          garageAddress,
          bankAccount: "",
          taxRegistrationNumber: "",
          sealImage: "",
        };
      });
      const names = records.map((record) => record.name);
      if (names.some((name) => !name)) {
        alert("所属会社每行至少填写会社名称。");
        return;
      }
      if (
        new Set(names).size !== names.length ||
        names.some((name) => companyRecords.some((company) => company.name === name))
      ) {
        alert("所属会社名称不能重复，请检查批量内容。");
        return;
      }
      setCompanyRecords((current) => [
        ...current,
        ...records.map((record) => ({ id: createId(), ...record })),
      ]);
    }

    setBatchAddType(null);
    setBatchInput("");
  }

  function openEditOrder(order: Order) {
    setEditingOrderId(order.id);

    setForm({
      regionId: order.regionId,
      vehicle: order.vehicle,
      date: order.date,
      endDate: order.endDate || order.date,
      offDates: order.offDates || [],
      time: order.time,
      customer: order.customer,
      phone: order.phone,
      pickup: order.pickup,
      destination: order.destination,
      status: order.status,
      notes: order.notes,
      driver: order.driver || "",
      orderSource: order.orderSource || "",
      company: order.company || "",
      salesRep: order.salesRep || "",
      orderPrice: order.orderPrice || 0,
      accountingStatus: order.accountingStatus || "未完成",
      invoiceStatus: order.invoiceStatus,
      invoiceSentDate: order.invoiceSentDate,
      depositMethod: order.depositMethod || "",
      depositDate: order.depositDate || "",
      accountingAssignee: order.accountingAssignee || "",
      financeNote: order.financeNote || "",
      financeByDate: order.financeByDate || {},
    });
    setOffDateInput("");

    setCustomDriverMode(
      Boolean(order.driver) &&
        !driverRecords.some((driver) => driver.name === order.driver),
    );

    setCustomSourceMode(
      Boolean(order.orderSource) &&
        !orderSources.includes(order.orderSource),
    );

    setCustomCompanyMode(
      Boolean(order.company) &&
        !companies.includes(order.company),
    );

    setShowForm(true);
  }

  function openAccounting(order: Order) {
    const dates = [
      ...new Set([
        ...getOrderDateKeys(order),
        ...Object.keys(order.financeByDate || {}),
      ]),
    ].sort();
    if (dates.length === 0 || dates.length > 3660) {
      alert("单笔订单财务明细最多支持 3660 个日历日。");
      return;
    }
    setAccountingPreviewOrder(order);
    setAccountingForm(
      Object.fromEntries(
        dates.map((date) => [
          date,
          normalizeOrderFinance(
            order.financeByDate?.[date] || {
              ...emptyOrderFinance,
              driver: order.driver,
              vehicle: order.vehicle,
            },
          ),
        ]),
      ),
    );
    setAccountingOrderPriceInput(String(order.orderPrice || 0));
    setAccountingStatus(order.accountingStatus || "未完成");
    setAccountingInvoiceStatus(order.invoiceStatus);
    setAccountingInvoiceSentDate(order.invoiceSentDate);
    setAccountingDepositMethod(order.depositMethod || "");
    setAccountingDepositDate(order.depositDate || "");
    setAccountingAssignee(order.accountingAssignee || "");
    setAccountingFinanceNote(order.financeNote || "");
  }

  function saveAccounting() {
    if (!accountingPreviewOrder) return;

    const orderPrice = Number(accountingOrderPriceInput);
    const validOrderPrice =
      Number.isSafeInteger(orderPrice) &&
      orderPrice >= 0 &&
      orderPrice <= 99_999_999_999_999;
    const validFinance = Object.entries(accountingForm).every(([date, finance]) => {
      const validAmounts = (Object.keys(emptyOrderFinance) as (keyof OrderFinance)[])
      .filter((key) =>
        key !== "fuelConsumption" &&
        key !== "driverOvertimeHours" &&
        key !== "driverWageMode" &&
        key !== "driverWagePercentage" &&
        key !== "driver" &&
        key !== "vehicle",
      )
        .every((key) => {
          const amount = finance[key];
          return Number.isSafeInteger(amount) &&
            amount >= 0 &&
            amount <= 99_999_999_999_999;
        });
      const fuelConsumption = finance.fuelConsumption;
      const driverOvertimeHours = finance.driverOvertimeHours;
      return validAmounts &&
        Number.isFinite(fuelConsumption) &&
        fuelConsumption >= 0 &&
        fuelConsumption <= 99_999_999.99 &&
        Number(fuelConsumption.toFixed(2)) === fuelConsumption &&
        Number.isFinite(driverOvertimeHours) &&
        driverOvertimeHours >= 0 &&
        driverOvertimeHours <= 99_999_999.99 &&
        Number(driverOvertimeHours.toFixed(2)) === driverOvertimeHours &&
        Number.isSafeInteger(getDriverOvertimeFee(finance)) &&
        getDriverOvertimeFee(finance) <= 99_999_999_999_999 &&
        calculateOrderFinance(
          finance,
          date === accountingPreviewOrder.date ? orderPrice : 0,
        ).driverWages <= 99_999_999_999_999;
    });
    if (!validOrderPrice || !validFinance) {
      alert("日元金额请输入不超过 99,999,999,999,999 的非负整数，燃油消耗和超时时间最多填写两位小数，超时计算金额不得超出限额。");
      return;
    }

    const orderId = accountingPreviewOrder.id;
    const financeByDate = Object.fromEntries(
      Object.entries(accountingForm).map(([date, finance]) => [
        date,
        {
          ...finance,
          driverOvertimeFee: getDriverOvertimeFee(finance),
        },
      ]),
    );
    setOrders((currentOrders) =>
      currentOrders.map((order) =>
        order.id === orderId
          ? {
              ...order,
              orderPrice,
              accountingStatus,
              invoiceStatus: accountingInvoiceStatus,
              invoiceSentDate: accountingInvoiceSentDate,
              depositMethod: accountingDepositMethod,
              depositDate: accountingDepositDate,
              accountingAssignee: accountingAssignee.trim(),
              financeNote: accountingFinanceNote.trim(),
              financeByDate,
            }
          : order,
      ),
    );
    setAccountingPreviewOrder(null);
  }

  function closeForm() {
    setDriverSelectionTarget(null);
    setShowForm(false);
    setDriverSelectionTarget(null);
    setEditingOrderId(null);
    setPendingOrderConflicts([]);
    setOffDateInput("");
    setCustomDriverMode(false);
    setCustomSourceMode(false);
    setCustomCompanyMode(false);
  }

  function addOrder(skipConflictCheck = false) {
    const targetRegionId = editingOrderId === null
      ? getRegionForNewRecords()
      : form.regionId;
    if (editingOrderId === null && !targetRegionId) {
      requireSpecificRegionForNewData();
      return;
    }
    if (
      editingOrderId === null &&
      vehicleStatusByName.get(form.vehicle) !== "运营中"
    ) {
      alert(`车辆「${form.vehicle}」当前不可用，不能新增予約。`);
      return;
    }

    if (!form.customer.trim()) {
      alert("请填写订单名称。");
      return;
    }


    const previousOrder =
      editingOrderId === null
        ? undefined
        : orders.find((order) => order.id === editingOrderId);
    const dateOffset = previousOrder
      ? Math.round(
          (new Date(`${form.date}T00:00:00Z`).getTime() -
            new Date(`${previousOrder.date}T00:00:00Z`).getTime()) /
            86_400_000,
        )
      : 0;
    const savedForm: OrderDraft = {
      ...form,
      financeByDate: dateOffset
        ? shiftFinanceDates(form.financeByDate, dateOffset)
        : form.financeByDate,
      driver: form.driver.trim(),
      orderSource: form.orderSource.trim(),
      company: form.company.trim(),
      salesRep: form.salesRep.trim(),
    };
    if (!skipConflictCheck) {
      const conflicts = findOrderConflicts(
        { ...savedForm, regionId: targetRegionId },
        orders,
        editingOrderId,
      );

      if (conflicts.length > 0) {
        setPendingOrderConflicts(conflicts);
        return;
      }
    }

    if (editingOrderId === null) {
      setOrders((currentOrders) => [
        ...currentOrders,
        { id: createId(), ...savedForm },
      ]);
    } else {
      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.id === editingOrderId
            ? { id: order.id, ...savedForm }
            : order,
        ),
      );
    }

    closeForm();
  }

  function requestOrderDeletion(order: Order) {
    requestDelete(`确定要删除予約「${order.customer || order.id}」吗？`, () => {
      setOrders((currentOrders) =>
        currentOrders.filter((currentOrder) => currentOrder.id !== order.id),
      );
      if (editingOrderId === order.id) closeForm();
      if (selectedOrderDetails?.id === order.id) setSelectedOrderDetails(null);
    });
  }

  function deleteOrder() {
    if (editingOrderId === null) return;
    const order = orders.find((currentOrder) => currentOrder.id === editingOrderId);
    if (order) requestOrderDeletion(order);
  }

  async function signOut() {
    try {
      const supabase = createSupabaseClient();
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      router.replace("/login");
    } catch (error) {
      console.error("Failed to sign out.", error);
      setPersistenceError(
        error instanceof Error ? error.message : "退出登录失败，请重试。",
      );
    }
  }

  if (!isDataReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
        <div className="w-full max-w-lg rounded-xl border bg-white p-6 text-center shadow-sm">
          {dataLoadError ? (
            <>
              <h1 className="text-lg font-bold text-rose-800">无法载入业务数据</h1>
              <p role="alert" className="mt-2 text-sm text-gray-700">{dataLoadError}</p>
              <p className="mt-2 text-sm text-gray-600">
                请检查 Supabase 环境变量、数据库迁移和当前账号的激活状态。
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-4 rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
              >
                重新尝试
              </button>
            </>
          ) : (
            <p role="status" className="text-sm text-gray-700">正在安全载入数据…</p>
          )}
        </div>
      </main>
    );
  }

  if (!currentProfile) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
        <p role="alert" className="rounded border bg-white p-6 text-sm text-rose-800">
          当前账号没有用户资料。请联系系统管理员。
        </p>
      </main>
    );
  }

  const accountingTotals = accountingPreviewOrder
    ? summarizeFinanceEntries(
        Object.entries(accountingForm).map(([date, finance]) => ({
          ...finance,
          orderPrice:
            date === accountingPreviewOrder.date
              ? Number(accountingOrderPriceInput) || 0
              : 0,
        })),
      )
    : null;
  const canViewVehicleAndBalanceReports =
      currentProfile.role === "admin";

  return (
    <main className="dashboard min-h-screen bg-gray-100 text-gray-900">
      {/* 顶部 */}
      <header className="dashboard-header flex flex-wrap items-center justify-between gap-3 bg-slate-900 px-4 py-3 text-white sm:px-6 sm:py-4">
        <div>
          <h1 className="text-xl font-bold">ハイヤー配車管理</h1>
        </div>

        <div className="dashboard-actions flex flex-wrap items-center gap-2 sm:gap-3">
          {currentProfile.role === "admin" && (
            <label className="flex items-center gap-2 text-sm font-medium">
              <span>地域</span>
              <select
                aria-label="查看地域"
                value={activeRegionId}
                onChange={(event) => {
                  setActiveRegionId(event.target.value);
                  setPersistenceError("");
                  setVehicleFinanceVehicleFilter("");
                  setVehicleMonthlyFinanceForm(getVehicleMonthlyFinanceForm("", financeMonth));
                  setVehicleMonthlyFinanceError("");
                  setBalanceCompanyFilter("");
                  setBalanceExpenseAmountDrafts({});
                  setBalanceExpenseError("");
                  setFinanceSourceFilter("");
                  setFinanceCompanyFilter("");
                  setFinanceInvoiceStatusFilter("");
                  setDriverFinanceDriverFilter("");
                  setDriverFinanceCompanyFilter("");
                  setShowForm(false);
                  setShowDriverForm(false);
                  setShowVehicleForm(false);
                  setShowSourceForm(false);
                  setShowCompanyForm(false);
                  setShowBatchOrderForm(false);
                  setBatchAddType(null);
                  setAccountingPreviewOrder(null);
                  setShowLoginAccountForm(false);
                }}
                className="max-w-36 rounded border border-slate-600 bg-slate-800 px-2 py-2 text-white"
              >
                <option value={ALL_REGIONS_ID}>全部地域</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>{region.name}</option>
                ))}
              </select>
            </label>
          )}
          <div className="hidden text-right text-xs sm:block">
            <p className="font-semibold">{currentProfile.fullName.trim() || "未填写姓名"}</p>
            <p className="text-slate-300">
              {currentProfile.role === "admin" ? "管理员" : "普通用户"} · {regionNameById.get(currentProfile.regionId) ?? "未知地域"}
            </p>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="rounded border border-slate-500 px-3 py-2 text-sm font-semibold hover:bg-slate-800"
          >
            退出
          </button>
          <button
            type="button"
            onClick={openBatchOrderImport}
            disabled={activeRegionId === ALL_REGIONS_ID || availableVehicles.length === 0}
            className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-bold text-blue-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            批量导入
          </button>
          <button
            onClick={() => openNewOrder(availableVehicles[0] ?? "", toDateKey(calendarCenterDate))}
            disabled={activeRegionId === ALL_REGIONS_ID || availableVehicles.length === 0}
            className="rounded-lg bg-blue-600 px-5 py-2 font-bold hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ＋ 新建订单
          </button>
        </div>
      </header>

      {persistenceError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <span>保存错误：{persistenceError} 本地显示可能尚未同步到服务器，请重新载入后核对数据。</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="shrink-0 rounded border border-rose-400 px-3 py-1 font-semibold hover:bg-rose-100"
          >
            重新载入
          </button>
        </div>
      )}
      {vehicleMonthlyFinanceMigrationPending && (
        <p role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          车辆月度费用功能尚未启用：请数据库管理员应用
          {" "}
          <code>supabase/migrations/20261018000000_vehicle_monthly_finance.sql</code>
          {" "}后再录入月度费用或车辆固定月费；其余业务数据已正常载入。
        </p>
      )}
      {balanceExpensesMigrationPending && (
        <p role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          收支平衡支出项目尚未启用：请数据库管理员应用
          {" "}
          <code>supabase/migrations/20261019000000_balance_expenses.sql</code>
          {" "}后再新增项目或保存金额；其余业务数据已正常载入。
        </p>
      )}
      {pendingSaveCount > 0 && !persistenceError && (
        <p role="status" className="border-b bg-blue-50 px-4 py-2 text-sm text-blue-900">
          正在保存到服务器…
        </p>
      )}

      <div className="flex min-h-[calc(100vh-76px)] flex-col lg:flex-row">
        <aside className="dashboard-sidebar w-full min-w-0 shrink-0 border-b bg-white p-3 lg:w-[180px] lg:border-b-0 lg:border-r">
          <p className="mb-3 px-3 text-xs font-semibold text-gray-500">工作台</p>
          <nav aria-label="主菜单" className="flex gap-2 overflow-x-auto lg:flex-col">
            {[
              { id: "calendar", label: "カレンダー", icon: "▦" },
              { id: "orders", label: "予約管理", icon: "≡" },
              { id: "drivers", label: "運転士", icon: "♙" },
              { id: "vehicles", label: "車両", icon: "▰" },
              { id: "sources", label: "来源", icon: "↗" },
              { id: "companies", label: "所属会社", icon: "▣" },
              { id: "orderFinance", label: "経理統計", icon: "¥" },
              { id: "driverFinance", label: "給料統計", icon: "¥" },
              ...(canViewVehicleAndBalanceReports
                ? [
                    { id: "vehicleFinance" as const, label: "車両統計", icon: "¥" },
                    { id: "balance" as const, label: "收支平衡", icon: "¥" },
                  ]
                : []),
              ...(currentProfile.role === "admin"
                ? [
                    { id: "login" as const, label: "ログイン管理", icon: "♙" },
                    { id: "audit" as const, label: "操作记录", icon: "≡" },
                  ]
                : []),
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id === "orders" && activeView !== "orders") {
                    setOrderMonth(getCurrentMonthKey());
                    setOrderSourceFilter("");
                    setOrderCompanyFilter("");
                  }
                  setActiveView(item.id as ActiveView);
                }}
                aria-current={activeView === item.id ? "page" : undefined}
                className={`flex shrink-0 items-center gap-3 rounded px-3 py-2.5 text-left text-sm font-medium transition-colors ${activeView === item.id ? "bg-slate-900 text-white" : "text-gray-700 hover:bg-gray-100"}`}
              >
                <span aria-hidden="true" className="w-5 text-center text-base">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <section className="workspace-content min-w-0 flex-1">
          {activeView === "audit" && currentProfile.role === "admin" && (
            <AuditHistory key={activeRegionId} regions={regions}
              regionId={activeRegionId === ALL_REGIONS_ID ? "" : activeRegionId} />
          )}
          {activeView === "login" && currentProfile?.role === "admin" && (
            <div className="p-4 md:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold">ログイン管理</h2>
                <button
                  type="button"
                  disabled={accountBusy}
                  onClick={() => {
                    if (showLoginAccountForm) {
                      setAccountPassword("");
                      setAccountPasswordConfirmation("");
                      setShowLoginAccountForm(false);
                      setEditingLoginAccountId(null);
                    } else {
                      setAccountError("");
                      openLoginAccountForm();
                    }
                  }}
                  className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                >
                  {showLoginAccountForm ? "取消" : "+ 新增账号"}
                </button>
              </div>
              <p className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                账号由管理员直接创建并设置初始密码，无需邮件邀请。普通用户只能管理所属地域的数据；管理员可以查看并管理全部地域。
              </p>
              {accountMessage && <p role="status" className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{accountMessage}</p>}
              {accountError && (
                <p role="alert" className="mb-4 rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
                  {accountError}
                </p>
              )}
              {showLoginAccountForm && (
                <form onSubmit={saveLoginAccount} className="mb-5 grid gap-4 rounded border bg-white p-4 sm:grid-cols-2 xl:grid-cols-3">
                  <fieldset disabled={accountBusy} className="contents">
                  <label className="text-sm font-medium">
                    用户姓名
                    <input required value={loginAccountForm.fullName} onChange={(event) => setLoginAccountForm((current) => ({ ...current, fullName: event.target.value }))} className="mt-1 w-full rounded border p-2" />
                  </label>
                  <label className="text-sm font-medium">
                    登录邮箱
                    <input required type="email" autoComplete="email" disabled={editingLoginAccountId !== null} value={loginAccountForm.email} onChange={(event) => setLoginAccountForm((current) => ({ ...current, email: event.target.value }))} className="mt-1 w-full rounded border p-2 disabled:bg-gray-100" />
                  </label>
                  <label className="text-sm font-medium">
                    所属会社
                    <select required value={loginAccountForm.company} onChange={(event) => setLoginAccountForm((current) => ({ ...current, company: event.target.value }))} className="mt-1 w-full rounded border bg-white p-2">
                      <option value="">选择会社</option>
                      {[...new Set(allCompanyRecords.map((company) => company.name))].map((company) => <option key={company} value={company}>{company}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-medium">
                    职位
                    <select
                      required
                      value={loginAccountForm.position}
                      onChange={(event) => setLoginAccountForm((current) => ({
                        ...current,
                        position: event.target.value,
                      }))}
                      className="mt-1 w-full rounded border bg-white p-2"
                    >
                      <option value="">选择职位</option>
                      {loginAccountForm.position &&
                        !LOGIN_ACCOUNT_POSITIONS.some(
                          (position) => position === loginAccountForm.position,
                        ) && (
                          <option value={loginAccountForm.position}>
                            {loginAccountForm.position}（现有职位）
                          </option>
                        )}
                      {LOGIN_ACCOUNT_POSITIONS.map((position) => (
                        <option key={position} value={position}>{position}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm font-medium">
                    管理地域
                    <select required value={loginAccountForm.regionId} onChange={(event) => setLoginAccountForm((current) => ({ ...current, regionId: event.target.value }))} className="mt-1 w-full rounded border bg-white p-2">
                      <option value="">选择地域</option>
                      {regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-medium">
                    角色
                    <select
                      value={loginAccountForm.role}
                      disabled={editingLoginAccountId === currentProfile.id}
                      onChange={(event) => {
                        setAccountPassword("");
                        setAccountPasswordConfirmation("");
                        setLoginAccountForm((current) => ({
                          ...current,
                          role: event.target.value === "admin" ? "admin" : "user",
                        }));
                      }}
                      className="mt-1 w-full rounded border bg-white p-2 disabled:bg-gray-100"
                    >
                      <option value="user">普通用户</option>
                      <option value="admin">管理员</option>
                    </select>
                  </label>
                  {(editingLoginAccountId === null ||
                    (loginAccountForm.role === "user" &&
                      loginAccounts.find((account) => account.id === editingLoginAccountId)?.role === "user")) && (
                    <div className="rounded border bg-slate-50 p-3 sm:col-span-2 xl:col-span-3">
                      <p className="mb-2 text-sm text-gray-600">
                        {editingLoginAccountId === null
                          ? "设置初始登录密码（8 至 128 个字符），请通过安全方式告知用户。"
                          : "如需重设密码，请填写两次并单独点击“设置新密码”。仅保存资料不会修改密码；设置密码会同时确认该用户邮箱。"}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-sm font-medium">
                          {editingLoginAccountId === null ? "登录密码" : "新密码"}
                          <input type="password" autoComplete="new-password" minLength={8} maxLength={128}
                            required={editingLoginAccountId === null}
                            value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)}
                            className="mt-1 w-full rounded border p-2" />
                        </label>
                        <label className="text-sm font-medium">
                          确认密码
                          <input type="password" autoComplete="new-password" minLength={8} maxLength={128}
                            required={editingLoginAccountId === null}
                            value={accountPasswordConfirmation} onChange={(event) => setAccountPasswordConfirmation(event.target.value)}
                            className="mt-1 w-full rounded border p-2" />
                        </label>
                      </div>
                      {editingLoginAccountId !== null && (
                        <button type="button" disabled={accountBusy} onClick={setLoginAccountPassword}
                          className="mt-3 rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                          设置新密码
                        </button>
                      )}
                    </div>
                  )}
                  <div className="flex items-end">
                    <button type="submit" disabled={accountBusy} className="w-full rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">
                      {accountBusy ? "正在处理…" : editingLoginAccountId === null
                        ? "创建账号"
                        : "保存资料"}
                    </button>
                  </div>
                  </fieldset>
                </form>
              )}
              <div className="overflow-x-auto border bg-white">
                <table className="w-full min-w-[1150px] text-left text-sm">
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">用户姓名</th>
                      <th className="px-4 py-3 font-semibold">登录邮箱</th>
                      <th className="px-4 py-3 font-semibold">所属会社</th>
                      <th className="px-4 py-3 font-semibold">职位</th>
                      <th className="px-4 py-3 font-semibold">地域</th>
                      <th className="px-4 py-3 font-semibold">账号状态</th>
                      <th className="px-4 py-3 font-semibold">角色</th>
                      <th className="px-4 py-3 font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingAccounts && loginAccounts.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">正在读取账号…</td></tr>
                    ) : loginAccounts.length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">暂无登录账号</td></tr>
                    ) : loginAccounts.map((account) => (
                      <tr key={account.id} className="border-t">
                        <td className="px-4 py-3 font-medium">{account.fullName}</td>
                        <td className="px-4 py-3">{account.email}</td>
                        <td className="px-4 py-3">{account.company}</td>
                        <td className="px-4 py-3">{account.position}</td>
                        <td className="px-4 py-3">{regionNameById.get(account.regionId) || "未知地域"}</td>
                        <td className="px-4 py-3">{account.emailConfirmed ? "已激活" : "待激活"}</td>
                        <td className="px-4 py-3">{account.role === "admin" ? "管理员" : "普通用户"}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-3">
                            <button type="button" disabled={accountBusy} onClick={() => openLoginAccountForm(account)} className="font-medium text-blue-700 hover:underline">编辑</button>
                            <button type="button" disabled={accountBusy || account.id === currentProfile.id} onClick={() => deleteLoginAccount(account)} className="font-medium text-rose-700 hover:underline disabled:cursor-not-allowed disabled:opacity-40" title={account.id === currentProfile.id ? "不能删除当前账号" : undefined}>删除</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeView === "orderFinance" && (
            <FinanceSummaryPanel
              title="経理統計"
              month={financeMonth}
              onMonthChange={setFinanceMonth}
              headerActions={
                <button
                  type="button"
                  onClick={exportOrderFinance}
                  className="rounded bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                >
                  导出财务表（A4）
                </button>
              }
              trailingHeaderActions={
                <>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
                    来源
                    <select
                      value={financeSourceFilter}
                      onChange={(event) => setFinanceSourceFilter(event.target.value)}
                      className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
                    >
                      <option value="">全部来源</option>
                      <option value={UNSOURCED_ORDER}>未填写</option>
                      {sourceRows.map((source) => (
                        <option key={source.id} value={source.companyName}>
                          {source.companyName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
                    所属会社
                    <select
                      value={financeCompanyFilter}
                      onChange={(event) => setFinanceCompanyFilter(event.target.value)}
                      className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
                    >
                      <option value="">全部会社</option>
                      <option value="__unassigned_company__">未填写</option>
                      {companyRows.map((company) => (
                        <option key={company.id} value={company.name}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
                    请求书状态
                    <select
                      value={financeInvoiceStatusFilter}
                      onChange={(event) => setFinanceInvoiceStatusFilter(event.target.value)}
                      className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
                    >
                      <option value="">全部状态</option>
                      <option value="未完成">未完成</option>
                      <option value="已完成">已完成</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
                    入金状态
                    <select
                      value={financeDepositStatusFilter}
                      onChange={(event) => setFinanceDepositStatusFilter(event.target.value)}
                      className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
                    >
                      <option value="">全部状态</option>
                      <option value="paid">入金済み</option>
                      <option value="unpaid">未入金</option>
                    </select>
                  </label>
                </>
              }
            >
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-4">
                  <p className="text-sm font-semibold text-blue-800">总卖上</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-blue-950">
                    {formatYen(filteredFinanceTotals.requestAmount)}
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4">
                  <p className="text-sm font-semibold text-emerald-800">利润总和</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-950">
                    {formatYen(filteredFinanceTotals.profit)}
                  </p>
                </div>
                <div className="rounded-lg border border-violet-200 bg-violet-50 px-5 py-4">
                  <p className="text-sm font-semibold text-violet-800">利润率</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-violet-950">
                    {filteredFinanceProfitRate.toLocaleString("ja-JP", {
                      maximumFractionDigits: 2,
                    })}
                    %
                  </p>
                </div>
              </div>
              <div className="overflow-x-auto border bg-white">
                <table className="w-full min-w-[1500px] table-fixed text-left text-sm">
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">订单日期</th>
                      <th className="px-4 py-3 font-semibold">订单名称</th>
                      <th className="px-4 py-3 font-semibold">来源</th>
                      <th className="px-4 py-3 font-semibold">司机</th>
                      <th className="px-4 py-3 font-semibold">車両番号</th>
                      <th className="px-4 py-3 text-right font-semibold">请求书状态</th>
                      <th className="px-4 py-3 text-right font-semibold">入金状态</th>
                      <th className="px-4 py-3 text-right font-semibold">请求金额</th>
                      <th className="px-4 py-3 text-right font-semibold">司机总立替</th>
                      <th className="px-4 py-3 text-right font-semibold">会社总支出</th>
                      <th className="px-4 py-3 text-right font-semibold">司机总工资</th>
                      <th className="px-4 py-3 text-right font-semibold">订单总利润</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedFinanceOrders.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="px-4 py-8 text-center text-gray-500">
                          该月份暂无订单财务记录
                        </td>
                      </tr>
                    ) : (
                      sortedFinanceOrders.map((order) => {
                        const totals = getOrderFinanceForOrder(order);
                        return (
                          <tr key={order.id} className="border-t hover:bg-gray-50">
                          <td className="whitespace-nowrap px-4 py-3">
                            {formatOrderDate(order.date)}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => openAccounting(order)}
                              aria-haspopup="dialog"
                              className="text-left font-medium text-blue-700 hover:underline"
                            >
                              {order.customer || "未填写"}
                            </button>
                          </td>
                          <td className="px-4 py-3">{order.orderSource || "未填写"}</td>
                          <td className="px-4 py-3">
                            <button type="button" onClick={() => setDriverSelectionTarget(order.id)}
                              className="font-medium text-blue-700 hover:underline">
                              {order.driver || "未安排"}
                            </button>
                          </td>
                          <td className="px-4 py-3">{getOrderVehicleNumber(order)}</td>
                          <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold ${order.invoiceStatus === "已完成" ? "text-green-600" : "text-red-600"}`}>
                            {order.invoiceStatus}
                          </td>
                          <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold ${order.depositDate ? "text-green-600" : "text-red-600"}`}>
                            {order.depositDate ? "入金済み" : "未入金"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatYen(totals.requestAmount)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatYen(totals.driverAdvances)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatYen(totals.companyExpenses)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatYen(totals.driverWages)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{formatYen(totals.profit)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </FinanceSummaryPanel>
          )}

          {activeView === "driverFinance" && (
            <FinanceSummaryPanel
              title="給料統計"
              month={financeMonth}
              onMonthChange={setFinanceMonth}
              headerActions={
                <>
                <button
                  type="button"
                  onClick={async () => {
                    if (activeRegionId === ALL_REGIONS_ID || !driverFinanceDriverFilter) {
                      alert("请先选择一个分区和一位司机，再导出月度工资表。");
                      return;
                    }
                    if (filteredDriverFinanceDetails.length === 0) {
                      alert("该司机本月暂无工资记录。");
                      return;
                    }
                    try {
                      await printDriverWages({
                        driver: `${driverFinanceDriverFilter} ／ ${driverFinanceCompanyLabel}`,
                        month: financeMonth,
                        region: regionNameById.get(activeRegionId) || "",
                        rows: filteredDriverFinanceDetails,
                      });
                    } catch (error) {
                      alert(error instanceof Error ? error.message : "工资表导出失败，请重试。");
                    }
                  }}
                  className="rounded border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
                >
                  导出工资表（A4）
                </button>
                <button
                  type="button"
                  onClick={exportCompanyWages}
                  className="rounded bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                >
                  会社全员工资总表（A4）
                </button>
                </>
              }
              trailingHeaderActions={
                <>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
                    所属会社
                    <select
                      value={driverFinanceCompanyFilter}
                      onChange={(event) => {
                        setDriverFinanceCompanyFilter(event.target.value);
                        setDriverFinanceDriverFilter("");
                      }}
                      className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
                    >
                      <option value="">全部所属会社</option>
                      <option value="__unassigned_company__">未设置所属会社</option>
                      {driverFinanceCompanies.map((company) => (
                        <option key={company} value={company}>{company}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
                    運転士
                    <select
                      value={driverFinanceDriverFilter}
                      onChange={(event) => setDriverFinanceDriverFilter(event.target.value)}
                      className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
                    >
                      <option value="">全部運転士</option>
                      {driverRecords.map((driver) => (
                        <option key={driver.id} value={driver.name}>
                          {driver.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              }
            >
              <div className="mb-2 flex flex-wrap justify-end gap-2">
                <div className="rounded border px-4 py-2 text-right">
                  <span className="mr-3 text-sm font-semibold">司机立替</span>
                  <span className="text-lg font-bold tabular-nums">{formatYen(driverFinanceTotalAdvances)}</span>
                </div>
                <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-right">
                  <span className="mr-3 text-sm font-semibold text-emerald-800">
                    工资总额
                  </span>
                  <span className="text-lg font-bold tabular-nums text-emerald-950">
                    {formatYen(driverFinanceTotalWage)}
                  </span>
                </div>
                <div className="rounded border border-blue-200 bg-blue-50 px-4 py-2 text-right">
                  <span className="mr-3 text-sm font-semibold text-blue-800">支付总额</span>
                  <span className="text-lg font-bold tabular-nums text-blue-950">{formatYen(driverFinanceTotalAdvances + driverFinanceTotalWage)}</span>
                </div>
              </div>
              <div className="overflow-x-auto border bg-white">
                <table className="w-full min-w-[1550px] text-left text-xs">
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">服务日期</th>
                      <th className="px-4 py-3 font-semibold">订单名称</th>
                      <th className="px-4 py-3 font-semibold">車輌番号</th>
                      <th className="px-4 py-3 font-semibold">司机姓名</th>
                      <th className="px-4 py-3 font-semibold">所属会社</th>
                      <th className="px-4 py-3 font-semibold">核算担当</th>
                      <th className="px-4 py-3 text-right font-semibold">司机立替</th>
                      <th className="px-4 py-3 text-right font-semibold">超时时间</th>
                      <th className="px-4 py-3 text-right font-semibold">司机超时费</th>
                      <th className="px-4 py-3 text-right font-semibold">奖励工资</th>
                      <th className="px-4 py-3 text-right font-semibold">司机比例工资</th>
                      <th className="px-4 py-3 text-right font-semibold">司机固定工资</th>
                      <th className="px-4 py-3 text-right font-semibold">工资总额</th>
                      <th className="px-4 py-3 text-right font-semibold">支付总额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDriverFinanceDetails.length === 0 ? (
                      <tr>
                        <td colSpan={14} className="px-4 py-8 text-center text-gray-500">
                          暂无司机工资记录
                        </td>
                      </tr>
                    ) : (
                      filteredDriverFinanceDetails.map((row) => (
                      <tr key={row.id} className="border-t hover:bg-gray-50">
                        <td
                          className="whitespace-nowrap px-4 py-3 font-medium"
                          style={row.isRedDay ? { color: "#dc2626" } : undefined}
                        >
                          {formatOrderDate(row.serviceDate)}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          <button
                            type="button"
                            aria-haspopup="dialog"
                            className="text-left text-blue-700 hover:underline"
                            onClick={() => {
                              const order = orders.find((item) => item.id === row.orderId);
                              if (!order) {
                                alert("未找到对应订单，请刷新后重试。");
                                return;
                              }
                              openAccounting(order);
                            }}
                          >
                            {row.customer}
                          </button>
                        </td>
                        <td className="px-4 py-3">{row.vehicleNumber || "—"}</td>
                        <td className="px-4 py-3">{row.driver}</td>
                        <td className="px-4 py-3">{row.company || "未设置"}</td>
                        <td className="px-4 py-3">{row.accountingAssignee || "—"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatYen(row.driverAdvances)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{row.overtimeHours.toLocaleString("ja-JP")} h</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatYen(row.overtimeFee)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatYen(row.bonusWage)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatYen(row.percentageWage)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatYen(row.fixedWage)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{formatYen(row.totalWage)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-blue-800">{formatYen(row.driverAdvances + row.totalWage)}</td>
                      </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </FinanceSummaryPanel>
          )}

          {activeView === "vehicleFinance" && canViewVehicleAndBalanceReports && (
            <FinanceSummaryPanel
              title="車両統計"
              month={financeMonth}
              onMonthChange={(month) => {
                setFinanceMonth(month);
                setVehicleMonthlyFinanceForm(
                  getVehicleMonthlyFinanceForm(vehicleFinanceVehicleFilter, month),
                );
                setVehicleMonthlyFinanceError("");
              }}
              headerActions={
                <button
                  type="button"
                  onClick={exportVehicleFinance}
                  className="rounded bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                >
                  导出车辆财务表（A4）
                </button>
              }
              trailingHeaderActions={
                <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
                  車両番号
                  <select
                    value={vehicleFinanceVehicleFilter}
                    onChange={(event) => {
                      const vehicleName = event.target.value;
                      setVehicleFinanceVehicleFilter(vehicleName);
                      setVehicleMonthlyFinanceForm(
                        getVehicleMonthlyFinanceForm(vehicleName, financeMonth),
                      );
                      setVehicleMonthlyFinanceError("");
                    }}
                    className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
                  >
                    <option value="">全部車両番号</option>
                    {vehicleRecords.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.name}>
                        {vehicle.plate || "未登记番号"}
                      </option>
                    ))}
                  </select>
                </label>
              }
            >
              <section className="mb-4 min-w-0 rounded-lg border bg-white p-4">
                {selectedVehicleForFinance ? (
                  <>
                    <div className="mb-4">
                      <h3 className="min-w-0 break-words font-bold [overflow-wrap:anywhere]">
                        車両番号：{selectedVehicleForFinance.plate || selectedVehicleForFinance.name}
                        {" · "}
                        {financeMonth} 月度费用与里程
                      </h3>
                      <p className="mt-1 text-xs text-gray-500">
                        停车场费和保险费默认使用車両资料中的固定月额；保存过的月份金额不会随默认值变更。
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {([
                        ["parkingFee", "停车场费用（JPY）"],
                        ["insuranceFee", "保险费用（JPY）"],
                        ["inspectionFee", "点检/车检费用（JPY）"],
                        ["repairFee", "维修费用（JPY）"],
                      ] as const).map(([field, label]) => (
                        <label key={field} className="block text-sm font-medium text-gray-700">
                          {label}
                          <input
                            type="number"
                            min="0"
                            max="99999999999999"
                            step="1"
                            value={vehicleMonthlyFinanceForm[field]}
                            onChange={(event) =>
                              setVehicleMonthlyFinanceForm({
                                ...vehicleMonthlyFinanceForm,
                                [field]: event.target.value,
                              })
                            }
                            className="mt-1 w-full rounded border px-3 py-2"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-sm font-semibold">备品费用明细</h4>
                        <button
                          type="button"
                          onClick={() =>
                            setVehicleMonthlyFinanceForm({
                              ...vehicleMonthlyFinanceForm,
                              supplies: [
                                ...vehicleMonthlyFinanceForm.supplies,
                                { description: "", amount: "" },
                              ],
                            })
                          }
                          className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
                        >
                          添加备品
                        </button>
                      </div>
                      {vehicleMonthlyFinanceForm.supplies.length === 0 ? (
                        <p className="text-sm text-gray-500">尚未添加备品费用。</p>
                      ) : (
                        <div className="space-y-2">
                          {vehicleMonthlyFinanceForm.supplies.map((supply, index) => (
                            <div key={index} className="flex flex-wrap gap-2">
                              <input
                                type="text"
                                aria-label={`备品名称 ${index + 1}`}
                                placeholder="备品名称"
                                value={supply.description}
                                onChange={(event) =>
                                  setVehicleMonthlyFinanceForm({
                                    ...vehicleMonthlyFinanceForm,
                                    supplies: vehicleMonthlyFinanceForm.supplies.map(
                                      (item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, description: event.target.value }
                                          : item,
                                    ),
                                  })
                                }
                                className="min-w-[180px] flex-1 rounded border px-3 py-2 text-sm"
                              />
                              <input
                                type="number"
                                min="0"
                                max="99999999999999"
                                step="1"
                                aria-label={`备品金额 ${index + 1}`}
                                placeholder="金额（JPY）"
                                value={supply.amount}
                                onChange={(event) =>
                                  setVehicleMonthlyFinanceForm({
                                    ...vehicleMonthlyFinanceForm,
                                    supplies: vehicleMonthlyFinanceForm.supplies.map(
                                      (item, itemIndex) =>
                                        itemIndex === index
                                          ? { ...item, amount: event.target.value }
                                          : item,
                                    ),
                                  })
                                }
                                className="w-40 rounded border px-3 py-2 text-sm"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  setVehicleMonthlyFinanceForm({
                                    ...vehicleMonthlyFinanceForm,
                                    supplies: vehicleMonthlyFinanceForm.supplies.filter(
                                      (_, itemIndex) => itemIndex !== index,
                                    ),
                                  })
                                }
                                className="rounded border border-rose-200 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
                              >
                                删除
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm font-medium text-gray-700">
                        月初公里数
                        <input
                          type="number"
                          min="0"
                          max="99999999999"
                          step="1"
                          value={vehicleMonthlyFinanceForm.startOdometer}
                          onChange={(event) =>
                            setVehicleMonthlyFinanceForm({
                              ...vehicleMonthlyFinanceForm,
                              startOdometer: event.target.value,
                            })
                          }
                          className="mt-1 w-full rounded border px-3 py-2"
                        />
                      </label>
                      <label className="block text-sm font-medium text-gray-700">
                        月末公里数
                        <input
                          type="number"
                          min="0"
                          max="99999999999"
                          step="1"
                          value={vehicleMonthlyFinanceForm.endOdometer}
                          onChange={(event) =>
                            setVehicleMonthlyFinanceForm({
                              ...vehicleMonthlyFinanceForm,
                              endOdometer: event.target.value,
                            })
                          }
                          className="mt-1 w-full rounded border px-3 py-2"
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-gray-600">
                        当月走行公里数：
                        <span className="font-semibold tabular-nums">
                          {monthlyDistance !== null && monthlyDistance >= 0
                            ? `${monthlyDistance.toLocaleString("ja-JP")} km`
                            : "待填写有效的月初和月末公里数"}
                        </span>
                      </p>
                      <button
                        type="button"
                        onClick={saveVehicleMonthlyFinance}
                        className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                      >
                        保存月度费用与里程
                      </button>
                    </div>
                    {vehicleMonthlyFinanceError && (
                      <p role="alert" className="mt-2 text-sm text-rose-700">
                        {vehicleMonthlyFinanceError}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-600">
                    请先在右上角选择車両番号，再录入该车辆的月度费用和公里数。
                  </p>
                )}
              </section>
              {selectedVehicleForFinance && (
                <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                  {[
                    ["订单利润总和", formatYen(vehicleOrderProfit)],
                    ["各种费用支出", formatYen(vehicleMonthlyExpenses)],
                    ["扣除费用后利润", formatYen(vehicleNetProfit)],
                    [
                      "当月走行公里数",
                      monthlyDistance !== null && monthlyDistance >= 0
                        ? `${monthlyDistance.toLocaleString("ja-JP")} km`
                        : "—",
                    ],
                    [
                      "每公里利润",
                      vehicleProfitPerKilometer === null
                        ? "—"
                        : `¥${vehicleProfitPerKilometer.toLocaleString("ja-JP", {
                            maximumFractionDigits: 2,
                          })}`,
                    ],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
                      <p className="text-xs font-semibold text-blue-800">{label}</p>
                      <p className="mt-1 text-lg font-bold tabular-nums text-blue-950">{value}</p>
                    </div>
                  ))}
                </div>
              )}
              {!vehicleFinanceVehicleFilter ? (
                <div>
                  <p className="mb-3 text-sm text-gray-600">
                    每车一行，包含外注车辆（标注“外注”，未登记番号时明确提示）。订单利润已扣除固定费用与备品。月度费用使用已保存记录；未登记月份使用默认停车场费及保险费。无运营记录的车辆也计入固定成本。
                  </p>
                  {vehicleSummaryResult.error ? (
                    <p role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{vehicleSummaryResult.error}</p>
                  ) : (
                    <div className="overflow-x-auto border bg-white">
                      <table className="w-full min-w-[1100px] text-left text-sm">
                        <thead className="bg-gray-100 text-gray-600">
                          <tr>
                            <th className="px-4 py-3 font-semibold">服务月份</th>
                            <th className="px-4 py-3 font-semibold">車両番号</th>
                            <th className="px-4 py-3 text-right font-semibold">请求总金额</th>
                            <th className="px-4 py-3 text-right font-semibold">司机立替</th>
                            <th className="px-4 py-3 text-right font-semibold">会社支付</th>
                            <th className="px-4 py-3 text-right font-semibold">司机工资</th>
                            <th className="px-4 py-3 text-right font-semibold">固定费用与备品</th>
                            <th className="px-4 py-3 text-right font-semibold">订单利润（扣费后）</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vehicleSummaryResult.rows.length === 0 ? (
                            <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">暂无车辆或财务记录</td></tr>
                          ) : vehicleSummaryResult.rows.map((row) => (
                            <tr key={row.key} className="border-t hover:bg-gray-50">
                              <td className="px-4 py-3">{row.month}</td>
                              <td className="px-4 py-3 font-medium">
                                {row.vehicleNumber}
                                <span className="block text-xs text-gray-500">{regionNameById.get(row.regionId || "") || "未知地域"}</span>
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatYen(row.requestAmount)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatYen(row.driverAdvances)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatYen(row.companyExpenses)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatYen(row.driverWages)}</td>
                              <td className="px-4 py-3 text-right tabular-nums">{formatYen(row.fixedExpenses)}</td>
                              <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatYen(row.profit)}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t bg-blue-50 font-semibold">
                          <tr>
                            <td colSpan={2} className="px-4 py-3">合计／利润汇总</td>
                            <td className="px-4 py-3 text-right tabular-nums">{formatYen(vehicleSummaryTotals.requestAmount)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{formatYen(vehicleSummaryTotals.driverAdvances)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{formatYen(vehicleSummaryTotals.companyExpenses)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{formatYen(vehicleSummaryTotals.driverWages)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{formatYen(vehicleSummaryTotals.fixedExpenses)}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{formatYen(vehicleSummaryTotals.profit)}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
              <div className="overflow-x-auto border bg-white">
                <table className="w-full min-w-[1250px] text-left text-sm">
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">服务日期</th>
                      <th className="px-4 py-3 font-semibold">订单名称</th>
                      <th className="px-4 py-3 font-semibold">運転士</th>
                      <th className="px-4 py-3 text-right font-semibold">请求金额</th>
                      <th className="px-4 py-3 text-right font-semibold">司机总立替</th>
                      <th className="px-4 py-3 text-right font-semibold">会社总支出</th>
                      <th className="px-4 py-3 text-right font-semibold">司机总工资</th>
                      <th className="px-4 py-3 text-right font-semibold">订单总利润</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVehicleFinanceDetails.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                          暂无车辆财务记录
                        </td>
                      </tr>
                    ) : (
                      filteredVehicleFinanceDetails.map((row) => (
                        <tr key={row.id} className="border-t hover:bg-gray-50">
                          <td className="whitespace-nowrap px-4 py-3">{formatOrderDate(row.serviceDate)}</td>
                          <td className="px-4 py-3 font-medium">{row.customer}</td>
                          <td className="px-4 py-3">{row.driver}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatYen(row.requestAmount)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatYen(row.driverAdvances)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatYen(row.companyExpenses)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatYen(row.driverWages)}</td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums">{formatYen(row.profit)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              )}
            </FinanceSummaryPanel>
          )}

          {activeView === "balance" && canViewVehicleAndBalanceReports && (
            <div className="p-4 md:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold">收支平衡</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={exportBalance}
                    className="rounded bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                  >
                    导出收支报表（A4）
                  </button>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
                    月份
                    <input
                      type="month"
                      value={balanceMonth}
                      onChange={(event) => setBalanceMonth(event.target.value)}
                      className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
                    所属会社
                    <select
                      value={balanceCompanyFilter}
                      onChange={(event) => setBalanceCompanyFilter(event.target.value)}
                      className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
                    >
                      <option value="">全部会社</option>
                      <option value="__unassigned_company__">未填写</option>
                      {balanceCompanyOptions.map((companyName) => (
                        <option key={companyName} value={companyName}>
                          {companyName}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <p className="mb-4 text-sm text-gray-600">
                当月利润＝请求总金额＋手动输入的其他收入－下方手动输入的支出总和。不自动扣除车辆费用、司机工资、立替或其他运营支出。
                整单请求金额（订单价格及全日期的ETC旅报、司机立替旅报、会社立替旅报、超时费）按首个服务日所在月份计入，不按天分摊。
                首个服务日排除休运日；请求按订单所属会社归集，其他收入和支出按手动项目所属会社及录入月份归集。
              </p>
              {balanceResult.summary ? (
              <>
              <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <section className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-4 shadow-sm">
                  <p className="text-sm font-semibold text-blue-800">请求总和</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-blue-950">
                    {formatYen(balanceResult.summary.totals.requestAmount)}
                  </p>
                  <p className="mt-1 text-xs text-blue-800">
                    整单请求金额归首个服务日所在月份
                  </p>
                </section>
                <section className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 shadow-sm">
                  <p className="text-sm font-semibold text-emerald-800">其他收入总和</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-950">
                    {formatYen(balanceResult.summary.totals.incomeTotal)}
                  </p>
                  <p className="mt-1 text-xs text-emerald-800">手动输入的其他收入当月金额合计</p>
                </section>
                <section className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 shadow-sm">
                  <p className="text-sm font-semibold text-emerald-800">支出总和</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-950">
                    {formatYen(balanceResult.summary.totals.expenseTotal)}
                  </p>
                  <p className="mt-1 text-xs text-emerald-800">仅下方手动输入项目的当月金额合计</p>
                </section>
                <section className="rounded-lg border border-violet-200 bg-violet-50 px-5 py-4 shadow-sm">
                  <p className={`text-sm font-semibold ${balanceResult.summary.totals.net < 0 ? "text-red-600" : "text-black"}`}>
                    {balanceResult.summary.totals.net < 0 ? "当月亏损" : "当月利润"}
                  </p>
                  <p className={`mt-2 text-2xl font-bold tabular-nums ${balanceResult.summary.totals.net < 0 ? "text-red-600" : "text-black"}`}>
                    {formatYen(balanceResult.summary.totals.net)}
                  </p>
                  <p className="mt-1 text-xs text-violet-800">请求总和 + 其他收入 - 支出总和</p>
                </section>
              </div>
              <div className="mb-5 overflow-x-auto rounded-lg border bg-white">
                <table className="w-full min-w-[650px] text-left text-sm">
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3">所属会社</th>
                      {["请求总和", "其他收入（手动）", "支出总和（手动）", "当月利润／亏损"].map((label) => (
                        <th key={label} className="px-4 py-3 text-right">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {balanceResult.summary.rows.map((row) => (
                      <tr key={row.companyName} className="border-t">
                        <td className="px-4 py-3">{row.companyName || "未填写"}</td>
                        {[row.requestAmount, row.incomeTotal, row.expenseTotal].map((amount, index) => (
                          <td key={index} className="px-4 py-3 text-right tabular-nums">{formatYen(amount)}</td>
                        ))}
                        <td className={`px-4 py-3 text-right font-semibold tabular-nums ${row.net < 0 ? "text-red-600" : "text-black"}`}>{formatYen(row.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t bg-gray-50 font-semibold">
                    <tr>
                      <td className="px-4 py-3">合计</td>
                      {[
                        balanceResult.summary.totals.requestAmount, balanceResult.summary.totals.incomeTotal, balanceResult.summary.totals.expenseTotal,
                      ].map((amount, index) => <td key={index} className="px-4 py-3 text-right tabular-nums">{formatYen(amount)}</td>)}
                      <td className={`px-4 py-3 text-right tabular-nums ${balanceResult.summary.totals.net < 0 ? "text-red-600" : "text-black"}`}>{formatYen(balanceResult.summary.totals.net)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              </>
              ) : <p role="alert" className="mb-5 rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{balanceResult.error}</p>}
              {(["income", "expense"] as const).map((kind) => {
                const label = kind === "income" ? "其他收入" : "支出";
                const visibleItems = balanceVisibleExpenseItems.filter((item) => item.kind === kind);
                return (
              <section key={kind} className="mb-5 overflow-hidden rounded-lg border bg-white">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b bg-gray-50 p-4">
                  <div>
                    <h3 className="font-bold">手动{label}项目</h3>
                    <p className="mt-1 text-xs text-gray-600">
                      {kind === "income" ? "这里的其他收入计入利润。" : "收支平衡仅扣除这里手动输入的费用。"}项目名称按会社长期保留；每月金额需单独录入并保存。
                    </p>
                  </div>
                  {balanceCompanyFilter !== "" && (
                    <form
                      className="flex flex-wrap items-end gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        addBalanceExpenseItem(kind);
                      }}
                    >
                      <label className="text-sm font-medium text-gray-700">
                        新{label}项目
                        <input
                          type="text"
                          maxLength={200}
                          value={balanceExpenseNameDraft[kind]}
                          onChange={(event) => setBalanceExpenseNameDraft((drafts) => ({ ...drafts, [kind]: event.target.value }))}
                          placeholder={kind === "income" ? "例如：停车场收入" : "例如：办公用品"}
                          disabled={balanceExpensesMigrationPending}
                          className="mt-1 block w-52 rounded border bg-white px-3 py-2"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={balanceExpensesMigrationPending}
                        className="rounded border px-3 py-2 text-sm font-semibold hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        添加项目
                      </button>
                    </form>
                  )}
                </div>
                {balanceCompanyFilter === "" && (
                  <p className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    请选择具体所属会社后添加项目或录入金额；全部会社视图仅用于查看汇总。
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[600px] text-left text-sm">
                    <thead className="bg-gray-100 text-gray-600">
                      <tr>
                        <th className="px-4 py-3 font-semibold">所属会社</th>
                        <th className="px-4 py-3 font-semibold">{label}项目</th>
                        <th className="px-4 py-3 text-right font-semibold">
                          {balanceMonth} 金额（JPY）
                        </th>
                        <th className="px-4 py-3 text-right font-semibold">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleItems.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                            {balanceCompanyFilter === ""
                              ? `尚未添加${label}项目`
                              : `该会社尚未添加${label}项目`}
                          </td>
                        </tr>
                      ) : (
                        visibleItems.map((item) => {
                          const draftKey = `${item.id}:${balanceMonth}`;
                          return (
                            <tr key={item.id} className="border-t">
                              <td className="px-4 py-3">
                                {item.companyName || "未填写"}
                              </td>
                              <td className="px-4 py-3 font-medium">{item.name}</td>
                              <td className="px-4 py-3 text-right">
                                <input
                                  type="number"
                                  min="0"
                                  max="99999999999999"
                                  step="1"
                                  aria-label={`${item.name} ${balanceMonth} 金额`}
                                  value={
                                    balanceExpenseAmountDrafts[draftKey] ??
                                    (item.monthlyAmounts[balanceMonth] === undefined
                                      ? ""
                                      : String(item.monthlyAmounts[balanceMonth]))
                                  }
                                  onChange={(event) =>
                                    setBalanceExpenseAmountDrafts((drafts) => ({
                                      ...drafts,
                                      [draftKey]: event.target.value,
                                    }))
                                  }
                                  disabled={
                                    balanceCompanyFilter === "" ||
                                    balanceCompanyFilter === "__unassigned_company__" ||
                                    balanceExpensesMigrationPending
                                  }
                                  className="w-44 rounded border px-3 py-2 text-right tabular-nums disabled:bg-gray-100"
                                />
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => deleteBalanceExpenseItem(item)}
                                  disabled={balanceExpensesMigrationPending}
                                  className="rounded border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  删除
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                    <tfoot className="border-t bg-gray-50">
                      <tr>
                        <th colSpan={2} className="px-4 py-3 text-left">
                          手动{label}合计
                        </th>
                        <th className="px-4 py-3 text-right tabular-nums">
                          {balanceResult.summary ? formatYen(kind === "income" ? balanceResult.summary.totals.incomeTotal : balanceResult.summary.totals.expenseTotal) : "金额无效／数据未就绪"}
                        </th>
                        <th />
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
                  {balanceExpenseError ? (
                    <p role="alert" className="text-sm text-rose-700">
                      {balanceExpenseError}
                    </p>
                  ) : (
                    <span className="text-xs text-gray-500">
                      新月份沿用已登记的{label}项目，金额默认空白。
                    </span>
                  )}
                  {balanceCompanyFilter !== "" &&
                    balanceCompanyFilter !== "__unassigned_company__" && (
                      <button
                        type="button"
                        onClick={() => saveBalanceExpenseAmounts(kind)}
                        disabled={balanceExpensesMigrationPending}
                        className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        保存本月{label}金额
                      </button>
                    )}
                </div>
              </section>
                );
              })}
            </div>
          )}

          {activeView === "calendar" && (
            <>
      <div className="flex flex-wrap gap-2 border-b bg-white px-4 pt-4">
        {([
          ["all", "全体车辆"],
          ["alphard", "Alphard"],
          ["hiace", "Hiace"],
          ["tesla", "Tesla"],
          ["external", "外注"],
        ] as const).map(([filter, label]) => (
          <button
            key={filter}
            type="button"
            aria-pressed={calendarVehicleFilter === filter}
            onClick={() => setCalendarVehicleFilter(filter)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              calendarVehicleFilter === filter
                ? "border-blue-700 bg-blue-700 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* 日期控制 */}
      <div className="border-b bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const today = new Date();
                setCalendarCenterDate(today);
              }}
              className="rounded border border-blue-200 bg-blue-50 px-4 py-1.5 font-medium text-blue-700"
            >
              今天
            </button>
            <span className="text-sm font-medium text-gray-600">查看前后共 11 天</span>
          </div>

          <span className="font-bold text-slate-800">
            {formatCalendarDate(calendarStartDate)} ～ {formatCalendarDate(calendarEndDate)}
          </span>
        </div>

        <div className="calendar-date-controls mt-3 flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-1.5 shadow-sm">
          <button
            type="button"
            onClick={() => setCalendarCenterDate((date) => new Date(date.getFullYear(), date.getMonth() - 1, date.getDate()))}
            className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
            aria-label="上一月"
          >
            ←
          </button>

          <label className="flex items-center gap-1 text-xs text-slate-600">
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">Y</span>
            <input
              type="number"
              min={2020}
              max={2100}
              value={calendarCenterDate.getFullYear()}
              onChange={(event) => {
                const nextYear = Number(event.target.value || new Date().getFullYear());
                setCalendarCenterDate(
                  (date) =>
                    new Date(
                      nextYear,
                      date.getMonth(),
                      Math.min(date.getDate(), new Date(nextYear, date.getMonth() + 1, 0).getDate()),
                    ),
                );
              }}
              className="w-15 rounded-full border border-slate-200 bg-white px-1.5 py-1 text-center text-xs outline-none ring-0"
            />
          </label>

          <label className="flex items-center gap-1 text-xs text-slate-600">
            <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">M</span>
            <select
              value={calendarCenterDate.getMonth()}
              onChange={(event) => {
                const nextMonth = Number(event.target.value);
                setCalendarCenterDate(
                  (date) =>
                    new Date(
                      date.getFullYear(),
                      nextMonth,
                      Math.min(date.getDate(), new Date(date.getFullYear(), nextMonth + 1, 0).getDate()),
                    ),
                );
              }}
              className="rounded-full border border-slate-200 bg-white px-1.5 py-1 text-xs outline-none"
            >
              {Array.from({ length: 12 }, (_, index) => (
                <option key={index} value={index}>
                  {index + 1}月
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => setCalendarCenterDate((date) => new Date(date.getFullYear(), date.getMonth() + 1, date.getDate()))}
            className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
            aria-label="下一月"
          >
            →
          </button>
        </div>

        <div className="calendar-day-slider fixed bottom-4 left-1/2 z-40 w-[calc(100%-2rem)] max-w-[640px] -translate-x-1/2 rounded-full border border-slate-200 bg-white/95 px-5 py-3 shadow-lg backdrop-blur">
          <input
            type="range"
            min={1}
            max={calendarDaysInMonth}
            value={calendarCenterDate.getDate()}
            aria-label="选择本月日期"
            aria-valuetext={`${calendarCenterDate.getMonth() + 1}月${calendarCenterDate.getDate()}日`}
            onChange={(event) => {
              const selectedDay = Number(event.target.value);
              setCalendarCenterDate(
                (date) => new Date(date.getFullYear(), date.getMonth(), selectedDay),
              );
            }}
            className="h-2 w-full cursor-ew-resize accent-blue-600"
          />
        </div>
      </div>

      {/* 排班表 */}
      <div
        className="max-h-[75vh] overflow-auto px-4 pb-24 pt-4"
      >
        <div className="min-w-[1320px] rounded-2xl border bg-white shadow-sm">
          <div
            className="sticky top-0 z-20 grid bg-gray-100 shadow-sm"
            style={{
              gridTemplateColumns: `135px repeat(${dates.length}, minmax(130px, 1fr))`,
            }}
          >
            <div className="border-b border-r bg-gray-100 p-4 font-bold">
              車両
            </div>

            {dates.map((d) => (
              <div
                key={d.date}
                className={`border-b border-r p-3 text-center ${d.isToday ? "bg-blue-50" : "bg-gray-100"}`}
              >
                <div className={`font-bold ${d.isRedDay ? "text-red-600" : ""}`}>
                  {d.label}
                </div>
                <div className={`text-sm ${d.isRedDay ? "text-red-600" : "text-gray-500"}`}>
                  {d.day}
                </div>
                {d.isHoliday && <div className="text-xs text-red-600">休日</div>}
              </div>
            ))}
          </div>

          {filteredCalendarVehicles.map((vehicle) => {
            const isOutsourced = isOutsourcedVehicle(vehicle);
            const visibleOrders = orders
              .filter(
                (order) =>
                  order.vehicle === vehicle &&
                  order.date <= dates[dates.length - 1].date &&
                  (order.endDate || order.date) >= dates[0].date,
              )
              .sort((first, second) => first.date.localeCompare(second.date));
            const dailyOrderCounts = new Map(
              dates.map((day) => [
                day.date,
                visibleOrders.filter(
                  (order) =>
                    order.date <= day.date &&
                    (order.endDate || order.date) >= day.date,
                ).length,
              ]),
            );
            const orderLanes = new Map<string, number>();
            const laneEndDates: string[] = [];

            for (const order of visibleOrders) {
              const lane = laneEndDates.findIndex(
                (endDate) => endDate < order.date,
              );
              const laneIndex = lane === -1 ? laneEndDates.length : lane;
              laneEndDates[laneIndex] = order.endDate || order.date;
              orderLanes.set(order.id, laneIndex);
            }
            const singleDayCellHeights = new Map(
              dates.map((day) => {
                const orderCount = dailyOrderCounts.get(day.date) ?? 0;
                const baseHeight = orderCount === 2
                  ? 48
                  : orderCount >= 3
                    ? 30
                    : 76;
                const lastSingleDayLane = visibleOrders.reduce((lastLane, order) => {
                  if (
                    order.date !== day.date ||
                    (order.endDate || order.date) !== day.date
                  ) {
                    return lastLane;
                  }
                  return Math.max(lastLane, orderLanes.get(order.id) ?? 0);
                }, -1);
                const singleDayCardHeight = orderCount >= 3 ? 22 : orderCount === 2 ? 24 : 56;
                const stackedHeight = (lastSingleDayLane + 1) * singleDayCardHeight;

                return [day.date, `${Math.max(baseHeight, stackedHeight)}px`];
              }),
            );

            return (
              <div
                key={vehicle}
                className="grid auto-rows-min"
                onDragOver={(event) => {
                  event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const dayWidth = (bounds.width - 135) / dates.length;
                  const dateIndex = Math.max(
                    0,
                    Math.min(
                      dates.length - 1,
                      Math.floor((event.clientX - bounds.left - 135) / dayWidth),
                    ),
                  );
                  setDragTargetKey(`${vehicle}::${dates[dateIndex].date}`);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const dayWidth = (bounds.width - 180) / dates.length;
                  const dateIndex = Math.max(
                    0,
                    Math.min(
                      dates.length - 1,
                      Math.floor((event.clientX - bounds.left - 180) / dayWidth),
                    ),
                  );
                  const dragData = event.dataTransfer.getData("text/plain");
                  if (dragData.startsWith("{")) {
                    try {
                      const splitData = JSON.parse(dragData) as {
                        type?: string;
                        orderId?: string;
                        startDate?: string;
                        endDate?: string;
                      };
                      if (
                        splitData.type === "split" &&
                        splitData.orderId !== undefined &&
                        splitData.startDate &&
                        splitData.endDate
                      ) {
                        moveSplitRangeToVehicle(
                          splitData.orderId,
                          vehicle,
                          splitData.startDate,
                          splitData.endDate,
                        );
                        return;
                      }
                    } catch {
                      return;
                    }
                  }

                  if (dragData) {
                    moveOrderToCell(dragData, vehicle, dates[dateIndex].date);
                  }
                }}
                style={{
                  gridTemplateColumns: `135px repeat(${dates.length}, minmax(130px, 1fr))`,
                }}
              >
                <div className="row-start-1 flex min-h-[72px] items-center border-b border-r bg-slate-50 p-2">
                  {(() => {
                    const vehicleRecord = vehicleRecords.find(
                      (record) => record.name === vehicle,
                    );
                    const plate = vehicleRecord?.plate || "-";
                    const notes = vehicleRecord?.notes || "-";
                    const status = vehicleStatusByName.get(vehicle) ?? "运营中";
                    return (
                      <div className="flex min-w-0 flex-col items-center text-center">
                        <button
                          type="button"
                          onClick={() => copyCalendarVehicleField(vehicle, "車名")}
                          title="点击复制車名"
                          aria-label={`复制車名 ${vehicle}`}
                          className="max-w-full truncate text-center font-bold hover:text-blue-700 focus:outline-none focus:underline"
                        >
                          {vehicle}
                        </button>
                        <button
                          type="button"
                          onClick={() => copyCalendarVehicleField(plate, "车牌号")}
                          title="点击复制车牌号"
                          aria-label={`复制车牌号 ${plate}`}
                          className="mt-1 max-w-full truncate text-center text-xs text-slate-600 hover:text-blue-700 focus:outline-none focus:underline"
                        >
                          {plate}
                        </button>
                        <button
                          type="button"
                          onClick={() => copyCalendarVehicleField(notes, "備考")}
                          title="点击复制備考"
                          aria-label={`复制備考 ${notes}`}
                          className="mt-1 max-w-full break-words text-center text-xs text-gray-500 hover:text-blue-700 focus:outline-none focus:underline"
                        >
                          {notes}
                        </button>
                        <button
                          type="button"
                          onClick={() => copyCalendarVehicleField(status, "運行状態")}
                          title="点击复制運行状態"
                          aria-label={`复制運行状態 ${status}`}
                          className={`mt-1 max-w-full truncate text-center text-xs hover:opacity-75 focus:outline-none focus:underline ${status === "运营中" ? "text-emerald-700" : "text-red-700"}`}
                        >
                          {status}
                        </button>
                      </div>
                    );
                  })()}
                </div>

                {dates.map((d, index) => (
                  <div
                    key={d.date}
                    style={{
                      gridColumn: index + 2,
                      gridRow: 1,
                      minHeight: `${
                        Number.parseFloat(singleDayCellHeights.get(d.date) ?? "0") *
                        (isOutsourced ? 2 : 1)
                      }px`,
                    }}
                    onClick={() => {
                      if (splitSelection) {
                        const selectedOrder = orders.find(
                          (order) => order.id === splitSelection.orderId,
                        );
                        if (
                          selectedOrder &&
                          d.date >= selectedOrder.date &&
                          d.date <= (selectedOrder.endDate || selectedOrder.date)
                        ) {
                          selectSplitDate(selectedOrder.id, d.date);
                        }
                        return;
                      }
                      openNewOrder(vehicle, d.date);
                    }}
                    className={`min-h-[96px] border-b border-r p-2 transition-colors ${vehicleStatusByName.get(vehicle) === "运营中" ? "cursor-pointer" : "cursor-not-allowed bg-gray-50"} ${dragTargetKey === `${vehicle}::${d.date}` ? "bg-blue-100 ring-2 ring-inset ring-blue-400" : ""}`}
                  />
                ))}

                {visibleOrders.map((order) => {
                  const startIndex = Math.max(
                    0,
                    dates.findIndex((day) => day.date >= order.date),
                  );
                  const firstDayAfterOrder = dates.findIndex(
                    (day) => day.date > (order.endDate || order.date),
                  );
                  const endIndex = firstDayAfterOrder === -1
                    ? dates.length - 1
                    : firstDayAfterOrder - 1;
                  const barDates = dates.slice(startIndex, endIndex + 1);
                  const isSplittable = (order.endDate || order.date) > order.date;
                  let infoSegmentStart = -1;
                  let infoSegmentEnd = -1;
                  let currentSegmentStart = -1;
                  for (let index = 0; index <= barDates.length; index += 1) {
                    const isWorkingDate =
                      index < barDates.length &&
                      !order.offDates.includes(barDates[index].date);
                    if (isWorkingDate && currentSegmentStart === -1) {
                      currentSegmentStart = index;
                    } else if (!isWorkingDate && currentSegmentStart !== -1) {
                      if (
                        infoSegmentStart === -1 ||
                        index - currentSegmentStart > infoSegmentEnd - infoSegmentStart
                      ) {
                        infoSegmentStart = currentSegmentStart;
                        infoSegmentEnd = index;
                      }
                      currentSegmentStart = -1;
                    }
                  }
                  const cardFontSize = dailyOrderCounts.get(barDates[0]?.date ?? "") === 1
                    ? 12
                    : 10;
                  const infoSegmentWidth = (infoSegmentEnd - infoSegmentStart) * 130 - 34;
                  const showStatusOnTitleLine =
                    infoSegmentStart !== -1 &&
                    order.customer.length * cardFontSize +
                      order.status.length * cardFontSize +
                      8 <= infoSegmentWidth;
                  const maxDailyOrderCount = Math.max(
                    1,
                    ...barDates.map((day) => dailyOrderCounts.get(day.date) ?? 1),
                  );
                  const isSingleDayOrder = (order.endDate || order.date) === order.date;
                  const orderLane = orderLanes.get(order.id) ?? 0;
                  const orderCardHeight = maxDailyOrderCount >= 3
                    ? 22
                    : maxDailyOrderCount === 2
                      ? 24
                      : 56;
                  const laneOffset = isSingleDayOrder ? orderLane * orderCardHeight : 0;
                  const centerOffset = maxDailyOrderCount === 1
                    ? (76 - orderCardHeight) / 2 - (isSingleDayOrder ? 0 : 4)
                    : 0;
                  const isSelectingSplit =
                    isSplittable && splitSelection?.orderId === order.id;
                  const selectedStartDate = isSelectingSplit ? splitSelection.startDate : null;
                  const selectedEndDate = isSelectingSplit ? splitSelection.endDate : null;
                  const selectedStartIndex = barDates.findIndex(
                    (day) => day.date === selectedStartDate,
                  );
                  const selectedEndIndex = barDates.findIndex(
                    (day) => day.date === selectedEndDate,
                  );
                  const orderDriverExpired = driverRecords.some(
                    (driver) =>
                      driver.name === order.driver && isDriverLicenseExpired(driver),
                  );

                  return (
                    <div
                      key={order.id}
                      style={{
                        gridColumn: `${startIndex + 2} / ${endIndex + 3}`,
                        gridRow: isSingleDayOrder ? 1 : orderLane + 1,
                        transform: laneOffset + centerOffset > 0
                          ? `translateY(${laneOffset + centerOffset}px)`
                          : undefined,
                        height: `${orderCardHeight}px`,
                        minHeight: 0,
                        zIndex: 1,
                        backgroundColor: orderSourceColorByRegion.has(`${order.regionId}:${order.orderSource}`)
                          ? `color-mix(in srgb, ${orderSourceColorByRegion.get(`${order.regionId}:${order.orderSource}`)} 18%, white)`
                          : undefined,
                      }}
                      draggable={!isSelectingSplit}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", String(order.id));
                        setDraggingOrderId(order.id);
                      }}
                      onDragEnd={() => {
                        setDraggingOrderId(null);
                        setDragTargetKey(null);
                      }}
                      onClick={(event) => {
                        if (
                          isSelectingSplit ||
                          (event.target as HTMLElement).closest("button")
                        ) {
                          return;
                        }
                        openEditOrder(order);
                      }}
                      className={`relative mx-1 ${isSingleDayOrder ? "my-0" : "my-1"} cursor-grab overflow-hidden rounded-lg border px-2 text-center shadow-sm active:cursor-grabbing ${maxDailyOrderCount >= 2 ? "py-0 text-[10px] leading-[10px]" : "py-1 text-xs leading-3"} ${statusStyles[order.status]} ${draggingOrderId === order.id ? "opacity-50" : ""}`}
                    >
                      <div
                        aria-hidden={!isSelectingSplit}
                        className={`absolute inset-0 grid ${isSelectingSplit ? "pointer-events-auto" : "pointer-events-none"}`}
                        style={{ gridTemplateColumns: `repeat(${barDates.length}, minmax(0, 1fr))` }}
                      >
                        {barDates.map((day) => {
                          const isOffDate = order.offDates.includes(day.date);
                          const isSelected =
                            selectedStartDate !== null &&
                            selectedEndDate !== null &&
                            day.date >= selectedStartDate &&
                            day.date <= selectedEndDate;

                          return (
                            <div
                              key={day.date}
                              onClick={(event) => {
                                if (!isSelectingSplit) return;
                                event.stopPropagation();
                                selectSplitDate(order.id, day.date);
                              }}
                              className={`flex items-center justify-center ${isOffDate ? "border-x border-orange-400 bg-orange-300/80 text-orange-950" : ""} ${isSelected ? "outline outline-2 -outline-offset-2 outline-cyan-700" : ""} ${isSelectingSplit ? "cursor-crosshair" : ""}`}
                            >
                              {isOffDate && <span className="text-xs font-bold">休運</span>}
                            </div>
                          );
                        })}
                      </div>

                      {isSplittable && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSplitSelection((current) =>
                              current?.orderId === order.id
                                ? null
                                : { orderId: order.id, startDate: null, endDate: null },
                            );
                          }}
                          className="absolute right-2 top-1 z-20 rounded border border-slate-300 bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-white"
                        >
                          {isSelectingSplit ? "取消拆分" : "拆分"}
                        </button>
                      )}

                      {isSelectingSplit && selectedStartDate && selectedEndDate && (
                        <div
                          draggable
                          onDragStart={(event) => {
                            event.stopPropagation();
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData(
                              "text/plain",
                              JSON.stringify({
                                type: "split",
                                orderId: order.id,
                                startDate: selectedStartDate,
                                endDate: selectedEndDate,
                              }),
                            );
                          }}
                          onClick={(event) => event.stopPropagation()}
                          style={{
                            left: `${(selectedStartIndex / barDates.length) * 100}%`,
                            width: `${((selectedEndIndex - selectedStartIndex + 1) / barDates.length) * 100}%`,
                          }}
                          className="absolute bottom-0 z-30 flex h-5 cursor-grab items-center justify-center truncate rounded bg-cyan-800 px-1 text-[10px] font-bold text-white active:cursor-grabbing"
                        >
                          拖到目标車両拆分
                        </div>
                      )}

                      {infoSegmentStart !== -1 && (
                        <div
                          style={{
                            left: `${(infoSegmentStart / barDates.length) * 100}%`,
                            width: `${((infoSegmentEnd - infoSegmentStart) / barDates.length) * 100}%`,
                          }}
                          className={`absolute inset-y-0 z-10 flex flex-col items-center justify-center gap-0 px-1 ${isSelectingSplit ? "pointer-events-none pb-5" : ""}`}
                        >
                          <div className="flex w-full items-center justify-center gap-2">
                            {order.time && (
                              <span className="shrink-0 font-medium">{order.time}</span>
                            )}
                            <span className="min-w-0 truncate font-bold" title={order.customer}>
                              {order.customer}
                            </span>
                            {showStatusOnTitleLine && (
                              <span className="shrink-0 font-medium">{order.status}</span>
                            )}
                          </div>
                          {(order.orderSource || order.driver) && (
                            <div className="grid w-full grid-cols-2 gap-1">
                              <div
                                className="min-w-0 truncate"
                                title={order.orderSource || "未填写"}
                              >
                                {order.orderSource || "未填写"}
                              </div>
                              <div
                                className={`min-w-0 truncate ${orderDriverExpired ? "font-semibold text-red-600" : ""}`}
                                title={order.driver || "未安排"}
                              >
                                {order.driver || "未安排"}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
            </>
          )}

          {activeView === "orders" && (
            <div className="p-4 md:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">予約管理</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <label htmlFor="order-month" className="text-sm font-medium text-gray-600">
                    月份
                  </label>
                  <input
                    id="order-month"
                    type="month"
                    value={orderMonth}
                    onChange={(event) => setOrderMonth(event.target.value)}
                    className="rounded border bg-white px-3 py-2 text-sm"
                  />
                  <label htmlFor="order-source-filter" className="text-sm font-medium text-gray-600">
                    来源
                  </label>
                  <select
                    id="order-source-filter"
                    value={orderSourceFilter}
                    onChange={(event) => setOrderSourceFilter(event.target.value)}
                    className="rounded border bg-white px-3 py-2 text-sm"
                  >
                    <option value="">全部来源</option>
                    <option value={UNSOURCED_ORDER}>未填写</option>
                    {sourceRows.map((source) => (
                      <option key={source.id} value={source.companyName}>
                        {source.companyName}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="order-company-filter" className="text-sm font-medium text-gray-600">
                    所属会社
                  </label>
                  <select
                    id="order-company-filter"
                    value={orderCompanyFilter}
                    onChange={(event) => setOrderCompanyFilter(event.target.value)}
                    className="rounded border bg-white px-3 py-2 text-sm"
                  >
                    <option value="">全部会社</option>
                    <option value="__unassigned_company__">未填写</option>
                    {companyRows.map((company) => (
                      <option key={company.id} value={company.name}>
                        {company.name}
                      </option>
                    ))}
                  </select>
                  <span className="whitespace-nowrap text-sm text-gray-500">
                    共 {monthlyOrders.length} 笔
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto border bg-white">
                <table className="w-full min-w-[950px] text-left text-sm">
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">用车日期</th>
                      <th className="px-4 py-3 font-semibold">配車時間</th>
                      <th className="px-4 py-3 font-semibold">手配状態</th>
                      <th className="px-4 py-3 font-semibold">予約情報</th>
                      <th className="px-4 py-3 font-semibold">車両</th>
                      <th className="px-4 py-3 font-semibold">運転士</th>
                      <th className="px-4 py-3 font-semibold">来源</th>
                      <th className="px-4 py-3 font-semibold">状態</th>
                      <th className="px-4 py-3 font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...monthlyOrders]
                      .sort((first, second) =>
                        `${first.date} ${first.time}`.localeCompare(`${second.date} ${second.time}`),
                      )
                      .map((order) => (
                        <tr key={order.id} className="border-t hover:bg-gray-50">
                          <td className="whitespace-nowrap px-4 py-3">
                            {formatOrderDate(order.date)}
                            {order.endDate && order.endDate !== order.date && ` ～ ${formatOrderDate(order.endDate)}`}
                          </td>
                          <td className="px-4 py-3">{order.time}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`rounded border px-2 py-1 text-xs ${order.driver ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}
                            >
                              {order.driver ? "完成" : "未完成"}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => {
                                setOrderDetailsMode("itinerary");
                                setSelectedOrderDetails(order);
                              }}
                              className="font-medium text-blue-700 hover:underline"
                            >
                              {order.customer}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => {
                                setOrderDetailsMode("vehicle");
                                setSelectedOrderDetails(order);
                              }}
                              className="font-medium text-blue-700 hover:underline"
                            >
                              {order.vehicle}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              aria-haspopup="dialog"
                              aria-label={`选任司机：${order.customer}`}
                              onClick={() => setDriverSelectionTarget(order.id)}
                              className="font-medium text-blue-700 hover:underline"
                            >
                              {order.driver || "未安排"}
                            </button>
                          </td>
                          <td className="px-4 py-3">{order.orderSource || "未填写"}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded border px-2 py-1 text-xs ${statusStyles[order.status]}`}>
                              {order.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-3">
                              <button
                                type="button"
                                onClick={() => openEditOrder(order)}
                                className="font-medium text-blue-700 hover:underline"
                              >
                                编辑
                              </button>
                              <button
                                type="button"
                                onClick={() => openAccounting(order)}
                                className="font-medium text-emerald-700 hover:underline"
                              >
                                {order.accountingStatus === "完成核算" ? "核算完成" : "财务统计"}
                              </button>
                              <button
                                type="button"
                                onClick={() => requestOrderDeletion(order)}
                                className="font-medium text-rose-700 hover:underline"
                              >
                                删除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    {monthlyOrders.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-4 py-10 text-center text-gray-500">
                          该月份暂无予約
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeView === "drivers" && (
            <div className="p-4 md:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">運転士列表</h2>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="text-sm text-gray-500">共 {driverRows.length} 位</span>
                  <button
                    type="button"
                    onClick={() => openBatchAdd("drivers")}
                    className="rounded border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    批量新增
                  </button>
                  <button
                    type="button"
                    onClick={openNewDriver}
                    className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                  >
                    + 新增運転士
                  </button>
                </div>
              </div>
              <div className="overflow-hidden border bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">運転士</th>
                      <th className="px-4 py-3 font-semibold">携帯番号</th>
                      <th className="px-4 py-3 font-semibold">微信号</th>
                      <th className="px-4 py-3 font-semibold">WhatsApp</th>
                      <th className="px-4 py-3 font-semibold">免許有効期限</th>
                      <th className="px-4 py-3 font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driverRows.map((driver) => (
                      <tr key={driver.id} className="border-t">
                        <td className={`whitespace-nowrap px-4 py-3 font-medium ${isDriverLicenseExpired(driver) ? "text-red-600" : ""}`}>{driver.name}</td>
                        <td className="px-4 py-3">{driver.phone || "-"}</td>
                        <td className="px-4 py-3">{driver.wechat || "-"}</td>
                        <td className="px-4 py-3">{driver.whatsapp || "-"}</td>
                        <td className="whitespace-nowrap px-4 py-3">{driver.licenseExpiry || "-"}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-3">
                            <button
                              type="button"
                              onClick={() => openEditDriver(driver)}
                              className="font-medium text-blue-700 hover:underline"
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteDriver(driver)}
                              className="font-medium text-rose-700 hover:underline"
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeView === "vehicles" && (
            <div className="p-4 md:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">車両列表</h2>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="text-sm text-gray-500">共 {vehicleRows.length} 両</span>
                  <button
                    type="button"
                    onClick={() => openBatchAdd("vehicles")}
                    className="rounded border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    批量新增
                  </button>
                  <button
                    type="button"
                    onClick={openNewVehicle}
                    className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                  >
                    + 新增車両
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto border bg-white">
                <table className="w-full min-w-[1080px] text-left text-sm">
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">車名</th>
                      <th className="px-4 py-3 font-semibold">車両番号</th>
                      <th className="px-4 py-3 font-semibold">車両所属</th>
                      <th className="px-4 py-3 font-semibold">座位数</th>
                      <th className="px-4 py-3 font-semibold">燃油类型</th>
                      <th className="px-4 py-3 font-semibold">車検有効期限</th>
                      <th className="px-4 py-3 font-semibold">自賠責有効期限</th>
                      <th className="px-4 py-3 font-semibold">車両状態</th>
                      <th className="px-4 py-3 font-semibold">車両備考</th>
                      <th className="px-4 py-3 font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicleRows.map((vehicle) => (
                      <tr key={vehicle.id} className="border-t">
                        <td className="whitespace-nowrap px-4 py-3 font-medium">{vehicle.name}</td>
                        <td className="px-4 py-3">{vehicle.plate || "-"}</td>
                        <td className="px-4 py-3">{vehicle.ownerCompany || "-"}</td>
                        <td className="px-4 py-3">{vehicle.seats || "-"}</td>
                        <td className="px-4 py-3">{vehicle.fuelType || "-"}</td>
                        <td className="whitespace-nowrap px-4 py-3">{vehicle.inspectionExpiry || "-"}</td>
                        <td className="whitespace-nowrap px-4 py-3">{vehicle.liabilityExpiry || "-"}</td>
                        <td className="px-4 py-3">
                          {(() => {
                            const displayStatus = getVehicleDisplayStatus(vehicle);
                            return (
                          <span
                            className={`rounded border px-2 py-1 text-xs ${displayStatus === "运营中" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}
                          >
                            {displayStatus}
                          </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3">{vehicle.notes || "-"}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-3">
                            <button
                              type="button"
                              onClick={() => openEditVehicle(vehicle)}
                              className="font-medium text-blue-700 hover:underline"
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteVehicle(vehicle)}
                              className="font-medium text-rose-700 hover:underline"
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeView === "sources" && (
            <div className="p-4 md:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">来源列表</h2>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="text-sm text-gray-500">共 {sourceRows.length} 项</span>
                  <button
                    type="button"
                    onClick={() => openBatchAdd("sources")}
                    className="rounded border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    批量新增
                  </button>
                  <button
                    type="button"
                    onClick={openNewSource}
                    className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                  >
                    + 新增来源
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto border bg-white">
                <table className="w-full min-w-[1050px] text-left text-sm">
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">来源</th>
                      <th className="px-4 py-3 font-semibold">担当</th>
                      <th className="px-4 py-3 font-semibold">連絡先</th>
                      <th className="px-4 py-3 font-semibold">地址</th>
                      <th className="px-4 py-3 font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceRows.map((source) => (
                      <tr key={source.id} className="border-t">
                        <td className="whitespace-nowrap px-4 py-3 font-medium">
                          <SourceColorPicker
                            color={source.color || "#94a3b8"}
                            sourceName={source.companyName}
                            onSelect={(color) => updateSourceColor(source, color)}
                          />
                        </td>
                        <td className="px-4 py-3">{source.contactName || "-"}</td>
                        <td className="px-4 py-3">{source.contactInfo || "-"}</td>
                        <td className="px-4 py-3">{source.address || "-"}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-3">
                            <button
                              type="button"
                              onClick={() => openEditSource(source)}
                              className="font-medium text-blue-700 hover:underline"
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteSource(source)}
                              className="font-medium text-rose-700 hover:underline"
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeView === "companies" && (
            <div className="p-4 md:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">所属会社列表</h2>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span className="text-sm text-gray-500">共 {companyRows.length} 家</span>
                  <button
                    type="button"
                    onClick={() => openBatchAdd("companies")}
                    className="rounded border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
                  >
                    批量新增
                  </button>
                  <button
                    type="button"
                    onClick={openNewCompany}
                    className="rounded bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800"
                  >
                    + 新增会社
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto border bg-white">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">会社名称</th>
                      <th className="px-4 py-3 font-semibold">会社印章</th>
                      <th className="px-4 py-3 font-semibold">運行管理者</th>
                      <th className="px-4 py-3 font-semibold">整備管理者</th>
                      <th className="px-4 py-3 font-semibold">会社电话</th>
                      <th className="px-4 py-3 font-semibold">营业所地址</th>
                      <th className="px-4 py-3 font-semibold">車庫位置</th>
                      <th className="px-4 py-3 font-semibold">振込口座</th>
                      <th className="px-4 py-3 font-semibold">T番号</th>
                      <th className="px-4 py-3 font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companyRows.map((company) => (
                      <tr key={company.id} className="border-t">
                        <td className="px-4 py-3 font-medium">{company.name}</td>
                        <td className="px-4 py-3">
                          <button type="button" onClick={() => openEditCompany(company)}
                            className="rounded border px-2 py-1 text-blue-700 hover:bg-blue-50"
                            aria-label={`设置印章：${company.name}`}>
                            {company.sealImage
                              ? <Image src={company.sealImage} alt={`${company.name}印章`} width={48} height={48} unoptimized className="h-12 w-12 object-contain" />
                              : "上传印章"}
                          </button>
                        </td>
                        <td className="px-4 py-3">{company.operationsManager || "-"}</td>
                        <td className="px-4 py-3">{company.maintenanceManager || "-"}</td>
                        <td className="px-4 py-3">{company.phone || "-"}</td>
                        <td className="px-4 py-3">{company.rollCallAddress || "-"}</td>
                        <td className="px-4 py-3">{company.garageAddress || "-"}</td>
                        <td className="whitespace-pre-wrap px-4 py-3">{company.bankAccount || "-"}</td>
                        <td className="px-4 py-3">{company.taxRegistrationNumber || "-"}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-3">
                            <button
                              type="button"
                              onClick={() => openEditCompany(company)}
                              className="font-medium text-blue-700 hover:underline"
                            >
                              编辑
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteCompany(company)}
                              className="font-medium text-rose-700 hover:underline"
                            >
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      {showBatchOrderForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowBatchOrderForm(false);
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-bold">批量导入预约</h2>
              <button
                type="button"
                onClick={() => setShowBatchOrderForm(false)}
                className="text-2xl text-gray-500"
                aria-label="关闭批量导入窗口"
              >
                ×
              </button>
            </div>
            <p className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              系统会从每条信息中识别“配車時間、上车地点、下车地点”；以下来源和所属公司将应用于本批所有订单。
            </p>
            <div className="space-y-4">
              <label className="block text-sm font-medium">
                用车日期
                <input
                  type="date"
                  required
                  value={batchOrderDate}
                  onChange={(event) => setBatchOrderDate(event.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                />
              </label>
              <label className="block text-sm font-medium">
                車両
                <select
                  value={batchOrderVehicle}
                  onChange={(event) => setBatchOrderVehicle(event.target.value)}
                  className="mt-1 w-full rounded border px-3 py-2"
                >
                  {availableVehicles.map((vehicle) => (
                    <option key={vehicle} value={vehicle}>
                      {vehicle}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                来源
                <input
                  type="text"
                  list="batch-order-sources"
                  value={batchOrderSource}
                  onChange={(event) => setBatchOrderSource(event.target.value)}
                  placeholder="未填写"
                  className="mt-1 w-full rounded border px-3 py-2"
                />
                <datalist id="batch-order-sources">
                  {orderSources.map((source) => (
                    <option key={source} value={source} />
                  ))}
                </datalist>
              </label>
              <label className="block text-sm font-medium">
                所属公司
                <input
                  type="text"
                  list="batch-order-companies"
                  value={batchOrderCompany}
                  onChange={(event) => setBatchOrderCompany(event.target.value)}
                  placeholder="未填写"
                  className="mt-1 w-full rounded border px-3 py-2"
                />
                <datalist id="batch-order-companies">
                  {companies.map((company) => (
                    <option key={company} value={company} />
                  ))}
                </datalist>
              </label>
              <label className="block text-sm font-medium">
                预约信息
                <textarea
                  rows={8}
                  autoFocus
                  value={batchOrderInput}
                  onChange={(event) => setBatchOrderInput(event.target.value)}
                  placeholder={"06:30 出发地 结束地\n06:45 出发地 结束地"}
                  className="mt-1 w-full resize-y rounded border p-2 font-mono text-sm"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowBatchOrderForm(false)}
                className="rounded border px-5 py-2"
              >
                取消
              </button>
              <button
                type="button"
                onClick={importBatchOrders}
                className="rounded bg-blue-600 px-5 py-2 font-bold text-white hover:bg-blue-700"
              >
                生成订单
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新建 / 编辑予約窗口 */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeForm();
          }}
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-bold">
                {editingOrderId === null ? "新建订单" : "编辑予約"}
                {editingOrderId !== null && <LastOperation record={orders.find((order) => order.id === editingOrderId)} />}
              </h2>

              <button
                type="button"
                onClick={closeForm}
                className="text-2xl text-gray-500"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              {/* 订单名称 */}
              <label className="block text-sm font-medium">
                订单名称
                <input
                  type="text"
                  required
                  className="mt-1 w-full rounded border p-2"
                  value={form.customer}
                  onChange={(e) =>
                    setForm({ ...form, customer: e.target.value })
                  }
                />
              </label>

              {/* 来源 */}
              <label className="block text-sm font-medium">
                来源
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={
                    customSourceMode
                      ? CUSTOM_SOURCE
                      : form.orderSource
                  }
                  onChange={(e) => {
                    const value = e.target.value;

                    if (value === CUSTOM_SOURCE) {
                      setCustomSourceMode(true);
                      setForm({ ...form, orderSource: "" });
                    } else {
                      setCustomSourceMode(false);
                      setForm({ ...form, orderSource: value });
                    }
                  }}
                >
                  {orderSources.map((source) => (
                    <option key={source} value={source}>
                      {source}
                    </option>
                  ))}
                  <option value={CUSTOM_SOURCE}>
                    ＋ 手动输入新来源
                  </option>
                </select>
              </label>

              {customSourceMode && (
                <label className="block text-sm font-medium">
                  新来源
                  <input
                    type="text"
                    autoFocus
                    className="mt-1 w-full rounded border p-2"
                    value={form.orderSource}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        orderSource: e.target.value,
                      })
                    }
                    placeholder="请输入新的来源"
                  />
                </label>
              )}

              {/* 予約状態 */}
              <label className="block text-sm font-medium">
                予約状態
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={form.status}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      status: e.target.value as OrderStatus,
                    })
                  }
                >
                  <option value="仮予約">仮予約</option>
                  <option value="予約確定">予約確定</option>
                  <option value="運行中">運行中</option>
                  <option value="完了">完了</option>
                  <option value="キャンセル">キャンセル</option>
                </select>
              </label>

              {/* 车両 */}
              <label className="block text-sm font-medium">
                車両
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={form.vehicle}
                  onChange={(e) =>
                    setForm({ ...form, vehicle: e.target.value })
                  }
                >
                  {[...new Set([
                    ...orderFormAvailableVehicles,
                    ...(editingOrderId !== null &&
                    form.vehicle &&
                    !orderFormAvailableVehicles.includes(form.vehicle)
                      ? [form.vehicle]
                      : []),
                  ])].map((vehicle) => (
                    <option
                      key={vehicle}
                      value={vehicle}
                      disabled={orderFormVehicleStatusByName.get(vehicle) !== "运营中"}
                    >
                      {vehicle}{orderFormVehicleStatusByName.get(vehicle) !== "运营中" ? "（不可用于新予約）" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <OrderVehiclePlateSelect
                vehicles={orderFormVehicles}
                vehicleName={form.vehicle}
                getStatus={getVehicleDisplayStatus}
                onSelect={(vehicle) => setForm((current) => ({ ...current, vehicle }))}
              />

              {/* 運転士 */}
              <div className="block text-sm font-medium">
                運転士
                <button type="button" aria-haspopup="dialog"
                  onClick={() => setDriverSelectionTarget("form")}
                  className="mt-1 w-full rounded border p-2 text-left hover:bg-blue-50">
                  {form.driver || "未安排運転士"} · 点击选任
                </button>
              </div>

              {customDriverMode && (
                <label className="block text-sm font-medium">
                  新運転士
                  <input
                    type="text"
                    className="mt-1 w-full rounded border p-2"
                    value={form.driver}
                    onChange={(e) =>
                      setForm({ ...form, driver: e.target.value })
                    }
                    placeholder="请输入運転士"
                  />
                </label>
              )}

              {/* 开始日期 */}
              <label className="block text-sm font-medium">
                开始日期
                <input
                  type="date"
                  required
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={form.date}
                  onChange={(e) => {
                    const nextDate = e.target.value;
                    const nextEndDate = form.endDate < nextDate
                      ? nextDate
                      : form.endDate;
                    setForm({
                      ...form,
                      date: nextDate,
                      endDate: nextEndDate,
                      offDates: form.offDates.filter(
                        (offDate) => offDate >= nextDate && offDate <= nextEndDate,
                      ),
                    });
                  }}
                />
              </label>

              {/* 終了日期 */}
              <label className="block text-sm font-medium">
                終了日期
                <input
                  type="date"
                  required
                  min={form.date}
                  className="mt-1 w-full rounded border px-3 py-2"
                  value={form.endDate}
                  onChange={(e) => {
                    const nextEndDate = e.target.value;
                    setForm({
                      ...form,
                      endDate: nextEndDate,
                      offDates: form.offDates.filter(
                        (offDate) => offDate >= form.date && offDate <= nextEndDate,
                      ),
                    });
                  }}
                />
              </label>

              <div className="space-y-2">
                <label htmlFor="order-off-date" className="block text-sm font-medium">
                  休運日期
                </label>
                <div className="flex gap-2">
                  <input
                    id="order-off-date"
                    type="date"
                    min={form.date}
                    max={form.endDate}
                    value={offDateInput}
                    onChange={(event) => setOffDateInput(event.target.value)}
                    className="min-w-0 flex-1 rounded border px-3 py-2"
                  />
                  <button
                    type="button"
                    disabled={!offDateInput || form.offDates.includes(offDateInput)}
                    onClick={() => {
                      if (offDateInput < form.date || offDateInput > form.endDate) return;
                      setForm({
                        ...form,
                        offDates: [...new Set([...form.offDates, offDateInput])].sort(),
                      });
                      setOffDateInput("");
                    }}
                    className="shrink-0 rounded border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    添加
                  </button>
                </div>
                {form.offDates.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {form.offDates.map((offDate) => (
                      <button
                        key={offDate}
                        type="button"
                        aria-label={`移除休運日期 ${offDate}`}
                        onClick={() =>
                          setForm({
                            ...form,
                            offDates: form.offDates.filter((date) => date !== offDate),
                          })
                        }
                        className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs text-orange-800"
                      >
                        {formatOrderDate(offDate)} ×
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <label className="block text-sm font-medium">
                配車時間
                <input
                  type="time"
                  className="mt-1 w-full rounded border p-2"
                  value={form.time}
                  onChange={(event) => setForm({ ...form, time: event.target.value })}
                />
              </label>

              {/* 上车地点 */}
              <label className="block text-sm font-medium">
                上车地点
                <input
                  type="text"
                  className="mt-1 w-full rounded border p-2"
                  value={form.pickup}
                  onChange={(e) =>
                    setForm({ ...form, pickup: e.target.value })
                  }
                  placeholder="例如：羽田机场"
                />
              </label>

              {/* 下车地点 */}
              <label className="block text-sm font-medium">
                下车地点
                <input
                  type="text"
                  className="mt-1 w-full rounded border p-2"
                  value={form.destination}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      destination: e.target.value,
                    })
                  }
                  placeholder="例如：東京站"
                />
              </label>

              {/* 予約所属 */}
              <label className="block text-sm font-medium">
                予約所属
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={customCompanyMode ? "__custom_company__" : form.company}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === "__custom_company__") {
                      setCustomCompanyMode(true);
                      setForm({ ...form, company: "" });
                    } else {
                      setCustomCompanyMode(false);
                      setForm({ ...form, company: value });
                    }
                  }}
                >
                  {companies.map((company) => (
                    <option key={company} value={company}>{company}</option>
                  ))}
                  <option value="__custom_company__">＋ 手动输入新公司</option>
                </select>
              </label>

              {customCompanyMode && (
                <label className="block text-sm font-medium">
                  其他公司名称
                  <input
                    type="text"
                    autoFocus
                    className="mt-1 w-full rounded border p-2"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                    placeholder="请输入公司名称"
                  />
                </label>
              )}

              {/* 備考 */}
              <label className="block text-sm font-medium">
                備考
                <textarea
                  rows={3}
                  className="mt-1 w-full resize-y rounded border p-2"
                  value={form.notes}
                  onChange={(e) =>
                    setForm({ ...form, notes: e.target.value })
                  }
                  placeholder="交接事项等"
                />
              </label>
            </div>

            {/* 按钮 */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              {editingOrderId !== null && (
                <button
                  type="button"
                  onClick={deleteOrder}
                  className="rounded bg-red-600 px-4 py-2 font-bold text-white hover:bg-red-700"
                >
                  删除予約
                </button>
              )}

              <div className="ml-auto flex gap-3">
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded border px-5 py-2"
                >
                  取消
                </button>

                <button
                  type="button"
                  onClick={() => addOrder()}
                  className="rounded bg-blue-600 px-5 py-2 font-bold text-white"
                >
                  {editingOrderId === null ? "保存予約" : "保存修改"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingOrderConflicts.length > 0 && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPendingOrderConflicts([]);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-conflict-title"
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
          >
            <h2 id="order-conflict-title" className="text-lg font-bold">
              配车时间冲突
            </h2>
            <p className="mt-3 text-sm text-gray-700">
              以下予約在相同日期与本予約使用同一车辆或同一司机，且时间重复或相近（2小时内）：
            </p>
            <ul className="mt-2 space-y-2 text-sm text-gray-700">
              {pendingOrderConflicts.map(({ order, vehicles, drivers }) => (
                <li key={order.id}>
                  {order.date}
                  {order.endDate && order.endDate !== order.date ? ` ～ ${order.endDate}` : ""}
                  {" "}{order.time || "未填写时间"} · {order.customer || "未填写客户"}
                  <div className="text-xs font-bold text-red-600">
                    {vehicles.length > 0 && `车辆重复：${vehicles.join("、")}`}
                    {vehicles.length > 0 && drivers.length > 0 && "　"}
                    {drivers.length > 0 && `司机重复：${drivers.join("、")}`}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingOrderConflicts([])}
                className="rounded border px-4 py-2"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => addOrder(true)}
                className="rounded bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700"
              >
                {editingOrderId === null ? "仍然添加" : "仍然保存"}
              </button>
            </div>
          </section>
        </div>
      )}

      {showDriverForm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowDriverForm(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="driver-form-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 id="driver-form-title" className="text-xl font-bold">
                {editingDriverName ? "编辑運転士" : "新增運転士"}
              </h2>
              <button
                type="button"
                onClick={() => setShowDriverForm(false)}
                aria-label="关闭"
                className="text-2xl text-gray-500"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-medium">
                運転士
                <input
                  type="text"
                  required
                  className="mt-1 w-full rounded border p-2"
                  value={driverForm.name}
                  onChange={(event) =>
                    setDriverForm({ ...driverForm, name: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                携帯番号
                <input
                  type="tel"
                  className="mt-1 w-full rounded border p-2"
                  value={driverForm.phone}
                  onChange={(event) =>
                    setDriverForm({ ...driverForm, phone: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                微信号
                <input
                  type="text"
                  className="mt-1 w-full rounded border p-2"
                  value={driverForm.wechat}
                  onChange={(event) =>
                    setDriverForm({ ...driverForm, wechat: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                WhatsApp
                <input
                  type="text"
                  className="mt-1 w-full rounded border p-2"
                  value={driverForm.whatsapp}
                  onChange={(event) =>
                    setDriverForm({ ...driverForm, whatsapp: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                免許有効期限
                <input
                  type="date"
                  className="mt-1 w-full rounded border p-2"
                  value={driverForm.licenseExpiry}
                  onChange={(event) =>
                    setDriverForm({ ...driverForm, licenseExpiry: event.target.value })
                  }
                />
              </label>
            </div>

            <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex justify-end gap-3 border-t bg-white px-6 py-4">
              <button
                type="button"
                onClick={() => setShowDriverForm(false)}
                className="rounded border px-4 py-2"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveDriver}
                className="rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
              >
                保存運転士
              </button>
            </div>
          </section>
        </div>
      )}

      {showVehicleForm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowVehicleForm(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="vehicle-form-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 id="vehicle-form-title" className="text-xl font-bold">
                {editingVehicleName ? "编辑車両" : "新增車両"}
              </h2>
              <button
                type="button"
                onClick={() => setShowVehicleForm(false)}
                aria-label="关闭"
                className="text-2xl text-gray-500"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <VehicleNameSelect
                  value={vehicleNameMode}
                  manualName={vehicleForm.name}
                  onManualNameChange={(name) => setVehicleForm({ ...vehicleForm, name })}
                  onChange={(nextMode) => {
                    setVehicleNameMode(nextMode);
                    if (nextMode !== MANUAL_VEHICLE_NAME) {
                      setVehicleForm({ ...vehicleForm, name: nextMode });
                    } else if (editingVehicleName === null) {
                      setVehicleForm({ ...vehicleForm, name: "" });
                    }
                  }}
                  onDeleteSelected={() => setVehicleNameMode(MANUAL_VEHICLE_NAME)}
                />
              </div>
              <label className="block text-sm font-medium">
                車両番号{editingVehicleId === null && !isOutsourcedVehicle(vehicleForm.name) && <span className="ml-1 text-rose-600">（必须）</span>}
                <input
                  type="text"
                  required={editingVehicleId === null && !isOutsourcedVehicle(vehicleForm.name)}
                  className="mt-1 w-full rounded border p-2"
                  value={vehicleForm.plate}
                  onChange={(event) =>
                    setVehicleForm({ ...vehicleForm, plate: event.target.value })
                  }
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium">
                  默认停车场月费（JPY）
                  <input
                    type="number"
                    min="0"
                    max="99999999999999"
                    step="1"
                    className="mt-1 w-full rounded border p-2"
                    value={vehicleForm.defaultParkingFee}
                    onChange={(event) =>
                      setVehicleForm({
                        ...vehicleForm,
                        defaultParkingFee: Number(event.target.value || 0),
                      })
                    }
                  />
                </label>
                <label className="block text-sm font-medium">
                  默认保险月费（JPY）
                  <input
                    type="number"
                    min="0"
                    max="99999999999999"
                    step="1"
                    className="mt-1 w-full rounded border p-2"
                    value={vehicleForm.defaultInsuranceFee}
                    onChange={(event) =>
                      setVehicleForm({
                        ...vehicleForm,
                        defaultInsuranceFee: Number(event.target.value || 0),
                      })
                    }
                  />
                </label>
              </div>
              <label className="block text-sm font-medium">
                車両所属
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={vehicleForm.ownerCompany}
                  onChange={(event) =>
                    setVehicleForm({ ...vehicleForm, ownerCompany: event.target.value })
                  }
                >
                  {companyRecords.map((company) => (
                    <option key={company.id} value={company.name}>{company.name}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                車両座位数
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={vehicleForm.seats}
                  onChange={(event) =>
                    setVehicleForm({ ...vehicleForm, seats: event.target.value })
                  }
                >
                  {["5", "7", "8", "10"].map((seats) => (
                    <option key={seats} value={seats}>{seats}座</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                燃油类型
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={vehicleForm.fuelType}
                  onChange={(event) =>
                    setVehicleForm({ ...vehicleForm, fuelType: event.target.value })
                  }
                >
                  {fuelTypes.map((fuelType) => (
                    <option key={fuelType} value={fuelType}>
                      {fuelType}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                車検有効期限
                <input
                  type="date"
                  className="mt-1 w-full rounded border p-2"
                  value={vehicleForm.inspectionExpiry}
                  onChange={(event) =>
                    setVehicleForm({ ...vehicleForm, inspectionExpiry: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                自賠責有効期限
                <input
                  type="date"
                  className="mt-1 w-full rounded border p-2"
                  value={vehicleForm.liabilityExpiry}
                  onChange={(event) =>
                    setVehicleForm({ ...vehicleForm, liabilityExpiry: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                車両状態
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={vehicleForm.status}
                  onChange={(event) =>
                    setVehicleForm({
                      ...vehicleForm,
                      status: event.target.value as VehicleStatus,
                    })
                  }
                >
                  <option value="运营中">运营中</option>
                  <option value="停运中">停运中</option>
                </select>
              </label>
              <label className="block text-sm font-medium">
                車両備考
                <textarea
                  rows={3}
                  className="mt-1 w-full resize-y rounded border p-2"
                  value={vehicleForm.notes}
                  onChange={(event) =>
                    setVehicleForm({ ...vehicleForm, notes: event.target.value })
                  }
                />
              </label>
            </div>

            <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex justify-end gap-3 border-t bg-white px-6 py-4">
              <button
                type="button"
                onClick={() => setShowVehicleForm(false)}
                className="rounded border px-4 py-2"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveVehicle}
                className="rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
              >
                保存車両
              </button>
            </div>
          </section>
        </div>
      )}

      {showSourceForm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowSourceForm(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-form-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 id="source-form-title" className="text-xl font-bold">
                {editingSourceName ? "编辑来源" : "新增来源"}
              </h2>
              <button
                type="button"
                onClick={() => setShowSourceForm(false)}
                aria-label="关闭"
                className="text-2xl text-gray-500"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-medium">
                来源
                <input
                  type="text"
                  required
                  className="mt-1 w-full rounded border p-2"
                  value={sourceForm.companyName}
                  onChange={(event) =>
                    setSourceForm({ ...sourceForm, companyName: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                来源颜色
                <span className="mt-1 flex items-center gap-3">
                  <input
                    type="color"
                    aria-label="选择来源颜色"
                    value={sourceForm.color || "#2563eb"}
                    onChange={(event) =>
                      setSourceForm({ ...sourceForm, color: event.target.value })
                    }
                    className="h-10 w-14 cursor-pointer rounded border bg-white p-1"
                  />
                  <span className="font-mono text-xs text-gray-500">
                    {(sourceForm.color || "#2563eb").toUpperCase()}
                  </span>
                </span>
              </label>
              <label className="block text-sm font-medium">
                担当
                <input
                  type="text"
                  className="mt-1 w-full rounded border p-2"
                  value={sourceForm.contactName}
                  onChange={(event) =>
                    setSourceForm({ ...sourceForm, contactName: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                連絡先
                <input
                  type="text"
                  className="mt-1 w-full rounded border p-2"
                  value={sourceForm.contactInfo}
                  onChange={(event) =>
                    setSourceForm({ ...sourceForm, contactInfo: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                地址
                <input
                  type="text"
                  maxLength={500}
                  className="mt-1 w-full rounded border p-2"
                  value={sourceForm.address}
                  onChange={(event) =>
                    setSourceForm({ ...sourceForm, address: event.target.value })
                  }
                />
              </label>
            </div>

            <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex justify-end gap-3 border-t bg-white px-6 py-4">
              <button
                type="button"
                onClick={() => setShowSourceForm(false)}
                className="rounded border px-4 py-2"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveSource}
                className="rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
              >
                保存来源
              </button>
            </div>
          </section>
        </div>
      )}

      {showCompanyForm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowCompanyForm(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="company-form-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 id="company-form-title" className="text-xl font-bold">
                {editingCompanyName ? "编辑所属会社" : "新增所属会社"}
              </h2>
              <button
                type="button"
                onClick={() => setShowCompanyForm(false)}
                aria-label="关闭"
                className="text-2xl text-gray-500"
              >
                ×
              </button>
            </div>
            <div className="space-y-4">
              <label className="block text-sm font-medium">
                会社名
                <input
                  type="text"
                  required
                  className="mt-1 w-full rounded border p-2"
                  value={companyForm.name}
                  onChange={(event) =>
                    setCompanyForm({ ...companyForm, name: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                運行管理者
                <input
                  type="text"
                  className="mt-1 w-full rounded border p-2"
                  value={companyForm.operationsManager}
                  onChange={(event) =>
                    setCompanyForm({ ...companyForm, operationsManager: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                整備管理者
                <input
                  type="text"
                  className="mt-1 w-full rounded border p-2"
                  value={companyForm.maintenanceManager}
                  onChange={(event) =>
                    setCompanyForm({ ...companyForm, maintenanceManager: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                会社电话
                <input
                  type="tel"
                  className="mt-1 w-full rounded border p-2"
                  value={companyForm.phone}
                  onChange={(event) =>
                    setCompanyForm({ ...companyForm, phone: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                营业所地址
                <textarea
                  rows={2}
                  className="mt-1 w-full resize-y rounded border p-2"
                  value={companyForm.rollCallAddress}
                  onChange={(event) =>
                    setCompanyForm({ ...companyForm, rollCallAddress: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                車庫位置
                <textarea
                  rows={2}
                  className="mt-1 w-full resize-y rounded border p-2"
                  value={companyForm.garageAddress}
                  onChange={(event) =>
                    setCompanyForm({ ...companyForm, garageAddress: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                振込口座
                <textarea
                  rows={4}
                  maxLength={1000}
                  placeholder="銀行名・支店名・口座種別・口座番号・口座名義"
                  className="mt-1 w-full resize-y rounded border p-2"
                  value={companyForm.bankAccount}
                  onChange={(event) => setCompanyForm({ ...companyForm, bankAccount: event.target.value })}
                />
              </label>
              <label className="block text-sm font-medium">
                T番号（適格請求書発行事業者登録番号）
                <input
                  type="text"
                  maxLength={14}
                  placeholder="T1234567890123"
                  className="mt-1 w-full rounded border p-2"
                  value={companyForm.taxRegistrationNumber}
                  onChange={(event) => setCompanyForm({ ...companyForm, taxRegistrationNumber: event.target.value })}
                />
              </label>
              <CompanySealUpload
                value={companyForm.sealImage}
                onChange={(sealImage) => setCompanyForm((current) => ({ ...current, sealImage }))}
                onBusyChange={setCompanySealBusy}
              />
            </div>
            <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex justify-end gap-3 border-t bg-white px-6 py-4">
              <button
                type="button"
                onClick={() => setShowCompanyForm(false)}
                className="rounded border px-4 py-2"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveCompany}
                disabled={companySealBusy}
                className="rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-40"
              >
                保存会社
              </button>
            </div>
          </section>
        </div>
      )}

      {driverSelectionTarget && (
        <DriverSelectionDialog
          drivers={driverSelectionCandidates}
          selected={driverSelectionTarget === "form" ? form.driver : driverSelectionOrder?.driver || ""}
          onClose={() => setDriverSelectionTarget(null)}
          onSelect={(name, manual) => {
            if (driverSelectionTarget === "form") {
              setCustomDriverMode(manual);
              setForm((current) => ({ ...current, driver: name }));
            } else if (driverSelectionOrder) {
              setOrders((current) => current.map((order) =>
                order.id === driverSelectionOrder.id ? { ...order, driver: name } : order));
            } else {
              alert("订单已不存在，请刷新后重试。");
            }
            setDriverSelectionTarget(null);
          }}
        />
      )}

      {batchAddType && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setBatchAddType(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="batch-add-title"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 id="batch-add-title" className="text-xl font-bold">
                批量新增{batchAddType === "drivers"
                  ? "運転士"
                  : batchAddType === "vehicles"
                    ? "車両"
                    : batchAddType === "sources"
                      ? "来源"
                      : "所属会社"}
              </h2>
              <button
                type="button"
                onClick={() => setBatchAddType(null)}
                aria-label="关闭"
                className="text-2xl text-gray-500"
              >
                ×
              </button>
            </div>
            <textarea
              autoFocus
              rows={10}
              value={batchInput}
              onChange={(event) => setBatchInput(event.target.value)}
              placeholder={batchAddType === "drivers"
                ? "姓名,携帯番号（可选）,微信号（可选）,WhatsApp（可选）,免許有効期限（可选）"
                : batchAddType === "vehicles"
                  ? "車名,車両番号,座位数,燃油类型,車検有効期限,自賠責有効期限,備考,車両所属（可选）"
                  : batchAddType === "sources"
                    ? "来源,名（可选）,連絡先（可选）,颜色（可选）"
                    : "会社名称,運行管理者（可选）,整備管理者（可选）,会社电话（可选）,营业所地址（可选）,車庫位置（可选）"}
              className="w-full resize-y rounded border p-3 text-sm"
            />
            <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex justify-end gap-3 border-t bg-white px-6 py-4">
              <button
                type="button"
                onClick={() => setBatchAddType(null)}
                className="rounded border px-4 py-2"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveBatchAdd}
                className="rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
              >
                保存批量内容
              </button>
            </div>
          </section>
        </div>
      )}

      {accountingPreviewOrder && accountingTotals && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setAccountingPreviewOrder(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="accounting-preview-title"
            className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 id="accounting-preview-title" className="text-xl font-bold">
                订单财务统计
              </h2>
              <button
                type="button"
                className="ml-3 rounded border border-blue-700 px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50"
                onClick={async () => {
                  const source = orderSourceRecords.find((item) =>
                    item.regionId === accountingPreviewOrder.regionId && item.companyName === accountingPreviewOrder.orderSource);
                  const company = companyRecords.find((item) =>
                    item.regionId === accountingPreviewOrder.regionId && item.name === accountingPreviewOrder.company);
                  if (!source || !company) {
                    alert("请先为订单设置同分区的来源和所属会社，并保存订单。");
                    return;
                  }
                  if (!company.bankAccount || !/^T[0-9]{13}$/.test(company.taxRegistrationNumber) || !company.phone || !company.rollCallAddress) {
                    alert("请先在所属会社登记振込口座、有效T番号、电话和营业所地址。");
                    return;
                  }
                  const price = Number(accountingOrderPriceInput);
                  if (!Number.isSafeInteger(price) || price < 0) {
                    alert("请求书订单价格必须为非负日元整数。");
                    return;
                  }
                  const today = new Date();
                  const sum = (key: "etcTripReport" | "driverAdvanceTripReport" | "companyAdvanceTripReport") =>
                    Object.values(accountingForm).reduce((total, finance) => total + getOrderFinanceAmount(finance, key), 0);
                  try {
                    const response = await fetch("/api/invoices/number", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ orderId: accountingPreviewOrder.id, companyId: company.id }),
                    });
                    const payload = await readJsonSafely(response);
                    if (!response.ok) throw new Error(buildApiErrorMessage(response, payload, "请求书编号分配失败。"));
                    if (!payload || typeof payload !== "object" || !("number" in payload) ||
                      typeof payload.number !== "string" || !/^INV-\d{6,}$/.test(payload.number)) {
                      throw new Error("服务器返回的请求书编号格式不正确。");
                    }
                    await printInvoice({
                      number: payload.number,
                      issuedDate: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`,
                      startDate: accountingPreviewOrder.date,
                      endDate: accountingPreviewOrder.endDate || accountingPreviewOrder.date,
                      customer: accountingPreviewOrder.customer,
                      recipient: source.companyName,
                      contact: source.contactName,
                      recipientAddress: source.address,
                      company: company.name,
                      phone: company.phone,
                      address: company.rollCallAddress,
                      bankAccount: company.bankAccount,
                      taxRegistrationNumber: company.taxRegistrationNumber,
                      sealImage: company.sealImage,
                      orderPrice: price,
                      etcTrip: sum("etcTripReport"),
                      driverAdvanceTrip: sum("driverAdvanceTripReport"),
                      companyAdvanceTrip: sum("companyAdvanceTripReport"),
                    });
                  } catch (error) {
                    alert(error instanceof Error ? error.message : "请求书导出失败，请重试。");
                  }
                }}
              >
                請求書导出（A4）
              </button>
              <button
                type="button"
                className="ml-auto mr-4 rounded border border-emerald-700 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50"
                onClick={async () => {
                  try {
                    await printOrderExpenses({
                      name: accountingPreviewOrder.customer,
                      period: `${accountingPreviewOrder.date} ～ ${accountingPreviewOrder.endDate || accountingPreviewOrder.date}`,
                      note: accountingFinanceNote,
                      rows: Object.entries(accountingForm).sort(([first], [second]) => first.localeCompare(second)).map(([date, finance]) => {
                        const totals = calculateOrderFinance(finance, date === accountingPreviewOrder.date ? Number(accountingOrderPriceInput) || 0 : 0);
                        return {
                          date,
                          driver: finance.driver,
                          vehicleNumber: getOrderVehicleNumber({ ...accountingPreviewOrder, vehicle: finance.vehicle }),
                          offDate: accountingPreviewOrder.offDates.includes(date),
                          etcCompany: getOrderFinanceAmount(finance, "etcCompanyReport"),
                          etcTrip: getOrderFinanceAmount(finance, "etcTripReport"),
                          fuelCost: getOrderFinanceAmount(finance, "fuelCost"),
                          fuelLiters: getOrderFinanceAmount(finance, "fuelConsumption"),
                          driverAdvanceCompany: getOrderFinanceAmount(finance, "driverAdvanceCompanyReport"),
                          driverAdvanceTrip: getOrderFinanceAmount(finance, "driverAdvanceTripReport"),
                          companyAdvanceCompany: getOrderFinanceAmount(finance, "companyAdvanceCompanyReport"),
                          companyAdvanceTrip: getOrderFinanceAmount(finance, "companyAdvanceTripReport"),
                          overtime: getDriverOvertimeFee(finance),
                          wages: totals.driverWages,
                        };
                      }),
                    });
                  } catch (error) {
                    alert(error instanceof Error ? error.message : "导出失败，请重试。");
                  }
                }}
              >
                一键导出／打印（A4）
              </button>
              <button
                type="button"
                onClick={() => setAccountingPreviewOrder(null)}
                aria-label="关闭"
                className="text-2xl text-gray-500"
              >
                ×
              </button>
            </div>
            <div className="grid gap-3 rounded border bg-gray-50 p-4 text-sm sm:grid-cols-3">
              <p>
                <span className="text-gray-500">用车日期：</span>
                {formatOrderDate(accountingPreviewOrder.date)}
                {accountingPreviewOrder.endDate !== accountingPreviewOrder.date &&
                  ` ～ ${formatOrderDate(accountingPreviewOrder.endDate)}`}
              </p>
              <p>
                <span className="text-gray-500">車両番号：</span>
                {getOrderVehicleNumber(accountingPreviewOrder)}
              </p>
              <p>
                <span className="text-gray-500">司机：</span>
                {accountingPreviewOrder.driver || "未安排"}
              </p>
              <p>
                <span className="text-gray-500">来源：</span>
                {accountingPreviewOrder.orderSource || "未填写"}
              </p>
              <p>
                <span className="text-gray-500">所属会社：</span>
                {accountingPreviewOrder.company || "未设置"}
              </p>
            </div>
            <label className="mt-5 block max-w-sm text-sm font-semibold">
              订单价格（整笔订单总额，JPY）
              <input
                type="number"
                min="0"
                max="99999999999999"
                step="1"
                inputMode="numeric"
                className="mt-1 w-full rounded border p-2"
                value={accountingOrderPriceInput === "0" ? "" : accountingOrderPriceInput}
                onChange={(event) =>
                  setAccountingOrderPriceInput(event.target.value)
                }
              />
            </label>
            <div className="mt-5 space-y-4">
              {Object.entries(accountingForm).map(([date, finance]) => {
                const isOffDate = accountingPreviewOrder.offDates.includes(date);
                const isOutsideOrderDates =
                  date < accountingPreviewOrder.date ||
                  date > (accountingPreviewOrder.endDate || accountingPreviewOrder.date);
                const dailyTotals = calculateOrderFinance(
                  finance,
                  date === accountingPreviewOrder.date
                    ? Number(accountingOrderPriceInput) || 0
                    : 0,
                );
                const dailyEtcTotal =
                  getOrderFinanceAmount(finance, "etcCompanyReport") +
                  getOrderFinanceAmount(finance, "etcTripReport");
                const dailyFuelCost = getOrderFinanceAmount(finance, "fuelCost");
                const dailyFuelPrice = dailyTotals.fuelConsumption > 0
                  ? dailyFuelCost / dailyTotals.fuelConsumption
                  : null;
                const isMultiDayOrder =
                  (accountingPreviewOrder.endDate || accountingPreviewOrder.date) >
                  accountingPreviewOrder.date;

                return (
                  <section key={date} className="rounded-lg border bg-white p-4">
                    <div className="mb-4 grid grid-cols-1 gap-2 border-b pb-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h3 className="font-semibold">{formatOrderDate(date)}</h3>
                        {isOutsideOrderDates && (
                          <span className="ml-2 rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
                            订单日期外
                          </span>
                        )}
                        {isOffDate && (
                          <span className="ml-2 rounded bg-orange-100 px-2 py-1 text-xs text-orange-800">
                            休运日
                          </span>
                        )}
                      </div>
                      {date === accountingPreviewOrder.date && (
                        <span className="min-w-0 text-center text-lg font-bold text-gray-900">
                          {accountingPreviewOrder.customer || "未填写"}
                        </span>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 md:justify-end">
                        {!isMultiDayOrder && (
                          <span>当日请求 {formatYen(dailyTotals.requestAmount)}</span>
                        )}
                        <span>ETC总额 {formatYen(dailyEtcTotal)}</span>
                        <span>燃油费 {formatYen(dailyFuelCost)}</span>
                        <span>燃油消耗 {dailyTotals.fuelConsumption.toLocaleString("ja-JP")} L</span>
                        <span>
                          油价 {dailyFuelPrice === null
                            ? "—"
                            : `${dailyFuelPrice.toLocaleString("ja-JP", { maximumFractionDigits: 2 })} JPY/L`}
                        </span>
                        {!isMultiDayOrder && (
                          <span>利润 {formatYen(dailyTotals.profit)}</span>
                        )}
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <FinanceDriverSelect
                          drivers={allDriverRecords}
                          regionId={accountingPreviewOrder.regionId}
                          value={finance.driver}
                          onChange={(driver) =>
                            setAccountingForm((current) => ({
                              ...current,
                              [date]: {
                                ...(current[date] || emptyOrderFinance),
                                driver,
                              },
                            }))
                          }
                      />
                      <OrderVehiclePlateSelect
                        financeMode
                        vehicles={allVehicleRecords.filter((vehicle) =>
                          Boolean(accountingPreviewOrder.regionId) &&
                          vehicle.regionId === accountingPreviewOrder.regionId,
                        ).slice().sort(compareVehicles)}
                        vehicleName={finance.vehicle}
                        getStatus={getVehicleDisplayStatus}
                        onSelect={(vehicle) =>
                            setAccountingForm((current) => ({
                              ...current,
                              [date]: {
                                ...(current[date] || emptyOrderFinance),
                                vehicle,
                              },
                            }))
                        }
                      />
                      {orderFinanceSections.map((section) => (
                        <fieldset key={section.title} className="rounded border p-4">
                          <legend className="px-1 text-sm font-semibold">{section.title}</legend>
                          <div className="grid gap-3 sm:grid-cols-2">
                            {section.fields.map((field) => (
                              <label key={field.key} className="block text-sm font-medium">
                                {field.label}
                                <div className="relative mt-1">
                                  <input
                                    type="number"
                                    min="0"
                                    max={field.unit === "JPY" || field.unit === "JPY/h" ? "99999999999999" : "99999999.99"}
                                    step={field.unit === "JPY" || field.unit === "JPY/h" ? "1" : "0.01"}
                                    inputMode={field.unit === "JPY" || field.unit === "JPY/h" ? "numeric" : "decimal"}
                                    readOnly={field.readOnly}
                                    className={`w-full rounded border p-2 pr-12 ${field.readOnly ? "bg-gray-100 text-gray-700" : ""}`}
                                    value={
                                      field.key === "driverOvertimeFee"
                                        ? getDriverOvertimeFee(finance) || ""
                                        : finance[field.key] || ""
                                    }
                                    onChange={(event) =>
                                      setAccountingForm((current) => ({
                                        ...current,
                                        [date]: {
                                          ...(current[date] || emptyOrderFinance),
                                          [field.key]:
                                            event.target.value === ""
                                              ? 0
                                              : Number(event.target.value),
                                        },
                                      }))
                                    }
                                  />
                                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-500">
                                    {field.unit}
                                  </span>
                                </div>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                      ))}
                      <fieldset className="rounded border p-4">
                        <legend className="px-1 text-sm font-semibold">司机工资</legend>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="block text-sm font-medium">
                            司机工资方式
                            <select
                              className="mt-1 w-full rounded border p-2"
                              value={finance.driverWageMode}
                              onChange={(event) =>
                                setAccountingForm((current) => ({
                                  ...current,
                                  [date]: {
                                    ...(current[date] || emptyOrderFinance),
                                    driverWageMode:
                                      event.target.value === "percentage"
                                        ? "percentage"
                                        : "fixed",
                                  },
                                }))
                              }
                            >
                              <option value="fixed">司机固定工资</option>
                              <option value="percentage">司机比例工资</option>
                            </select>
                          </label>
                          {finance.driverWageMode === "percentage" ? (
                            <>
                              <label className="block text-sm font-medium">
                                司机比例工资
                                <select
                                  className="mt-1 w-full rounded border p-2"
                                  value={finance.driverWagePercentage}
                                  onChange={(event) =>
                                    setAccountingForm((current) => ({
                                      ...current,
                                      [date]: {
                                        ...(current[date] || emptyOrderFinance),
                                        driverWagePercentage:
                                          event.target.value === "70"
                                            ? 70
                                            : event.target.value === "60"
                                              ? 60
                                              : 50,
                                      },
                                    }))
                                  }
                                >
                                  <option value={50}>50%</option>
                                  <option value={60}>60%</option>
                                  <option value={70}>70%</option>
                                </select>
                              </label>
                              <label className="block text-sm font-medium">
                                计算司机比例工资
                                <div className="relative mt-1">
                                  <input
                                    type="number"
                                    readOnly
                                    className="w-full rounded border bg-gray-100 p-2 pr-12 text-gray-700"
                                    value={Math.max(
                                      0,
                                      dailyTotals.driverWages -
                                        getDriverOvertimeFee(finance) -
                                        finance.driverBonusWage,
                                    ) || ""}
                                  />
                                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-500">
                                    JPY
                                  </span>
                                </div>
                              </label>
                            </>
                          ) : (
                            <label className="block text-sm font-medium">
                              司机固定工资
                              <div className="relative mt-1">
                                <input
                                  type="number"
                                  min="0"
                                  max="99999999999999"
                                  step="1"
                                  inputMode="numeric"
                                  className="w-full rounded border p-2 pr-12"
                                  value={finance.driverWage || ""}
                                  onChange={(event) =>
                                    setAccountingForm((current) => ({
                                      ...current,
                                      [date]: {
                                        ...(current[date] || emptyOrderFinance),
                                        driverWage:
                                          event.target.value === ""
                                            ? 0
                                            : Number(event.target.value),
                                      },
                                    }))
                                  }
                                />
                                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-500">
                                  JPY
                                </span>
                              </div>
                            </label>
                          )}
                          <label className="block text-sm font-medium">
                            司机奖励工资
                            <div className="relative mt-1">
                              <input
                                type="number"
                                min="0"
                                max="99999999999999"
                                step="1"
                                inputMode="numeric"
                                className="w-full rounded border p-2 pr-12"
                                value={finance.driverBonusWage || ""}
                                onChange={(event) =>
                                  setAccountingForm((current) => ({
                                    ...current,
                                    [date]: {
                                      ...(current[date] || emptyOrderFinance),
                                      driverBonusWage:
                                        event.target.value === ""
                                          ? 0
                                          : Number(event.target.value),
                                    },
                                  }))
                                }
                              />
                              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-500">
                                JPY
                              </span>
                            </div>
                          </label>
                        </div>
                      </fieldset>
                    </div>
                  </section>
                );
              })}
            </div>
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold">自动统计</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                {[
                  { label: "请求金额", amount: accountingTotals.requestAmount },
                  { label: "司机总立替", amount: accountingTotals.driverAdvances },
                  { label: "会社总支出", amount: accountingTotals.companyExpenses },
                  { label: "司机总工资", amount: accountingTotals.driverWages },
                  { label: "订单总利润", amount: accountingTotals.profit },
                ].map((item) => (
                  <div key={item.label} className="rounded border bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">{item.label}</p>
                    <p className="mt-1 font-bold tabular-nums">{formatYen(item.amount)}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-gray-500">
                请求金额 = 订单价格 + ETC（旅报）+ 司机立替（旅报）+ 会社立替（旅报）+ 司机超时费；
                比例工资 =（请求金额 - 司机总立替 - 会社总支出）× 50% / 60% / 70%；
                司机总工资 = 司机超时费 + 固定工资或比例工资 + 奖励工资；
                订单总利润 = 请求金额 - 会社总支出 - 司机总立替 - 司机总工资。
              </p>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold">
                核算担当
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={accountingAssignee}
                  onChange={(event) => setAccountingAssignee(event.target.value)}
                >
                  <option value="">请选择核算担当</option>
                  {accountingAccounts.map((account) => (
                    <option key={account.id} value={account.email}>
                      {account.fullName.trim() || "未填写姓名"}
                    </option>
                  ))}
                  {accountingAssignee &&
                    !accountingAccounts.some((account) => account.email === accountingAssignee) && (
                      <option value={accountingAssignee}>
                        {getAccountingAssigneeName(accountingAssignee, accountingAccounts)}（历史记录）
                      </option>
                    )}
                </select>
              </label>
              <label className="block text-sm font-semibold">
                核算状态
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={accountingStatus}
                  onChange={(event) =>
                    setAccountingStatus(event.target.value as Order["accountingStatus"])
                  }
                >
                  <option value="未完成">未完成</option>
                  <option value="完成核算">完成核算</option>
                </select>
              </label>
              <label className="block text-sm font-semibold">
                请求书状态
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={accountingInvoiceStatus}
                  onChange={(event) =>
                    setAccountingInvoiceStatus(
                      event.target.value === "已完成" ? "已完成" : "未完成",
                    )
                  }
                >
                  <option value="未完成">未完成</option>
                  <option value="已完成">已完成</option>
                </select>
              </label>
              <label className="block text-sm font-semibold">
                请求书发送日
                <input
                  type="date"
                  className="mt-1 w-full rounded border p-2"
                  value={accountingInvoiceSentDate}
                  onChange={(event) => setAccountingInvoiceSentDate(event.target.value)}
                />
              </label>
              <label className="block text-sm font-semibold">
                入金方式
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={accountingDepositMethod}
                  onChange={(event) =>
                    setAccountingDepositMethod(event.target.value as Order["depositMethod"])
                  }
                >
                  <option value="">未选择</option>
                  <option value="口座入金">口座入金</option>
                  <option value="现金入金">现金入金</option>
                </select>
              </label>
              <label className="block text-sm font-semibold">
                入金日期
                <input
                  type="date"
                  className="mt-1 w-full rounded border p-2"
                  value={accountingDepositDate}
                  onChange={(event) => setAccountingDepositDate(event.target.value)}
                />
              </label>
            </div>
            <label className="mt-5 block text-sm font-semibold">
              财务备注
              <textarea
                rows={3}
                maxLength={5000}
                className="mt-1 w-full rounded border p-3 font-normal"
                placeholder="填写整笔订单的财务备注"
                value={accountingFinanceNote}
                onChange={(event) => setAccountingFinanceNote(event.target.value)}
              />
            </label>
            <div className="mt-6 flex justify-end gap-3 border-t pt-4">
              <button
                type="button"
                onClick={() => setAccountingPreviewOrder(null)}
                className="rounded border px-4 py-2 text-sm font-semibold"
              >
                取消
              </button>
              <button
                type="button"
                onClick={saveAccounting}
                className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                保存财务数据
              </button>
            </div>
          </section>
        </div>
      )}

      {selectedOrderDetails && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelectedOrderDetails(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-details-title"
            className={`max-h-[90vh] w-full overflow-y-auto rounded-lg bg-white p-6 shadow-xl ${orderDetailsMode === "itinerary" ? "max-w-4xl" : "max-w-md"}`}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 id="order-details-title" className="text-xl font-bold">
                {orderDetailsMode === "itinerary" ? "行程指示書" : selectedOrderDetails.vehicle}
                <LastOperation record={orders.find((order) => order.id === selectedOrderDetails.id)} />
              </h2>
              <button
                type="button"
                onClick={() => setSelectedOrderDetails(null)}
                aria-label="关闭"
                className="text-2xl text-gray-500"
              >
                ×
              </button>
            </div>
            {orderDetailsMode === "itinerary" ? (
              <div className="grid grid-cols-1 gap-x-10 gap-y-6 text-sm md:grid-cols-2">
                <dl className="space-y-3">
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">車両番号</dt>
                    <dd className="break-words font-medium">{selectedOrderVehicle?.plate || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">運転士</dt>
                    <dd className="break-words font-medium">{selectedOrderDetails.driver || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">免許有効期限</dt>
                    <dd className="break-words font-medium">{selectedOrderDriver?.licenseExpiry || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">携帯番号</dt>
                    <dd className="break-words font-medium">{selectedOrderDriver?.phone || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">来源</dt>
                    <dd className="break-words font-medium">{selectedOrderDetails.orderSource || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">担当</dt>
                    <dd className="break-words font-medium">{selectedOrderSource?.contactName || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">連絡先</dt>
                    <dd className="break-words font-medium">{selectedOrderSource?.contactInfo || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">来源地址</dt>
                    <dd className="break-words font-medium">{selectedOrderSource?.address || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">予約情報</dt>
                    <dd className="break-words font-medium">{selectedOrderDetails.customer || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">开始日期</dt>
                    <dd className="break-words font-medium">{formatOrderDate(selectedOrderDetails.date)}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">配車時間</dt>
                    <dd className="break-words font-medium">{selectedOrderDetails.time || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">开始地点</dt>
                    <dd className="break-words font-medium">{selectedOrderDetails.pickup || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">終了日期</dt>
                    <dd className="break-words font-medium">
                      {formatOrderDate(selectedOrderDetails.endDate || selectedOrderDetails.date)}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3">
                    <dt className="text-gray-500">終了地点</dt>
                    <dd className="break-words font-medium">{selectedOrderDetails.destination || "-"}</dd>
                  </div>
                </dl>
                <dl className="space-y-3">
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">車両所属</dt>
                    <dd className="break-words font-medium">{selectedOrderVehicle?.ownerCompany || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">車検有効期限</dt>
                    <dd className="break-words font-medium">{selectedOrderVehicle?.inspectionExpiry || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">自賠責有効期限</dt>
                    <dd className="break-words font-medium">{selectedOrderVehicle?.liabilityExpiry || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">運行管理者</dt>
                    <dd className="break-words font-medium">{selectedOrderVehicleCompany?.operationsManager || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">整備管理者</dt>
                    <dd className="break-words font-medium">{selectedOrderVehicleCompany?.maintenanceManager || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">营业所地址</dt>
                    <dd className="break-words whitespace-pre-wrap font-medium">{selectedOrderVehicleCompany?.rollCallAddress || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">車庫位置</dt>
                    <dd className="break-words whitespace-pre-wrap font-medium">{selectedOrderVehicleCompany?.garageAddress || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3">
                    <dt className="text-gray-500">会社电话</dt>
                    <dd className="break-words font-medium">{selectedOrderVehicleCompany?.phone || "-"}</dd>
                  </div>
                </dl>
                <dl className="col-span-full border-t pt-4 text-sm">
                  <div className="grid grid-cols-[120px_1fr] gap-3">
                    <dt className="text-gray-500">備考</dt>
                    <dd className="break-words whitespace-pre-wrap font-medium">
                      {selectedOrderDetails.notes || "-"}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : (
              <dl className="space-y-3 text-sm">
                <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                  <dt className="text-gray-500">車両番号</dt>
                  <dd className="break-words font-medium">{selectedOrderVehicle?.plate || "-"}</dd>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                  <dt className="text-gray-500">運転士</dt>
                  <dd className="break-words font-medium">{selectedOrderDetails.driver || "-"}</dd>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                  <dt className="text-gray-500">携帯番号</dt>
                  <dd className="break-words font-medium">{selectedOrderDriver?.phone || "-"}</dd>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                  <dt className="text-gray-500">WhatsApp</dt>
                  <dd className="break-words font-medium">{selectedOrderDriver?.whatsapp || "-"}</dd>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-3">
                  <dt className="text-gray-500">微信</dt>
                  <dd className="break-words font-medium">{selectedOrderDriver?.wechat || "-"}</dd>
                </div>
              </dl>
            )}
          </section>
        </div>
      )}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget && !isDeleting) {
              setPendingDelete(null);
              setDeletePassword("");
              setDeleteError("");
            }
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              confirmPendingDelete();
            }}
            className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-lg font-bold">确认删除</h2>
            <p className="mt-3 text-sm text-gray-700">{pendingDelete.message}</p>
            <label className="mt-4 block text-sm font-medium">
              删除密码
              <input
                autoComplete="current-password"
                autoFocus
                required
                type="password"
                value={deletePassword}
                onChange={(event) => setDeletePassword(event.target.value)}
                disabled={isDeleting}
                className="mt-1 w-full rounded border p-2"
              />
            </label>
            {deleteError && (
              <p role="alert" className="mt-2 text-sm text-rose-700">
                {deleteError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingDelete(null);
                  setDeletePassword("");
                  setDeleteError("");
                }}
                disabled={isDeleting}
                className="rounded border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isDeleting || !deletePassword}
                className="rounded bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-50"
              >
                {isDeleting ? "正在删除…" : "确认删除"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}