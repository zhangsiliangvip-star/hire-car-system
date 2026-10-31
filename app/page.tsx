
"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useCalendarZoom } from "@/lib/use-calendar-zoom";
import { useCalendarCardHeights } from "@/lib/use-calendar-card-heights";
import type {
  ActiveView,
  AccountProfile,
  DashboardData,
  BalanceExpenseItem,
  BatchAddType,
  CalendarVehicleFilter,
  Company,
  CompanyDraft,
  Driver,
  DriverDraft,
  DriverWageItem,
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
import { summarizeRequestAmounts } from "@/lib/request-amount-summary";
import { printInvoice } from "@/lib/invoice-print";
import { printVehicleFinance, printVehicleSummary } from "@/lib/vehicle-finance-print";
import { summarizeVehicles, totalVehicleSummaries, type VehicleMonthlySummary } from "@/lib/vehicle-finance-summary";
import { printCompanyWages, printDriverWages } from "@/lib/driver-wage-print";
import { groupDriverFinanceByBatch } from "@/lib/driver-finance-groups";
import { DriverSelectionDialog } from "@/components/driver-selection-dialog";
import { SourceSelectionDialog } from "@/components/source-selection-dialog";
import { OrderDateFilterDialog } from "@/components/order-date-filter-dialog";
import { rankDriversByMonthlyAttendance } from "@/lib/driver-selection";
import { getDriverSegments, getServiceDriver, getOrderDriverNames, getOrderDriverLabel } from "@/lib/order-drivers";
import { changeOrderVehicle, getServiceVehicle, getOrderVehiclePlates, getVehicleSegments, getCalendarVehicleRows } from "@/lib/order-vehicles";
import { hasValidDriverPayment, isDriverWageEntry, setReservationDriverPayment,
  withCompanyAdvanceDriver } from "@/lib/reservation-driver-payment";
import { rankSourcesByUsage } from "@/lib/source-selection";
import Image from "next/image";
import { CompanySealUpload } from "@/components/company-seal-upload";
import { isCompanySealDataUrl } from "@/lib/company-seal";
import { printBalance, printCompanyAdvances } from "@/lib/balance-print";
import { getBalanceServiceMonth, summarizeBalance } from "@/lib/balance-summary";
import {
  compareVehicles,
  compareCalendarVehicles,
  moveCalendarVehicle,
  getVehicleModelOrder,
  isOutsourcedVehicle,
  orderUsesVehicle,
  resolveOrderVehicle,
} from "@/lib/vehicle-order";
import { LastOperation } from "@/components/last-operation";
import { AuditHistory } from "@/components/audit-history";
import { DEFAULT_VEHICLE_NAME_OPTIONS as vehicleNameOptions, MANUAL_VEHICLE_NAME, VehicleNameSelect } from "@/components/vehicle-name-select";
import { OrderVehiclePlateSelect } from "@/components/order-vehicle-plate-select";
import { FinanceDriverSelect } from "@/components/finance-driver-select";
import { DriverLoginProvider, DriverMobileDialog } from "@/components/driver-login-fields";
import { OrderReceipts } from "@/components/order-receipts";
import { OrderFinanceReviewProvider } from "@/components/order-finance-review";
import { DriverExecutionBadge } from "@/components/driver-execution-badge";
import { DriverNameLabel, OrderDriverLabels } from "@/components/driver-name-label";
import { OperationsReports } from "@/components/operations-reports";
import { useDriverExecutionStatus } from "@/lib/use-driver-execution-status";
import { useDriverRestDays } from "@/lib/use-driver-rest-days";
import { getJapaneseHolidays } from "@/lib/japanese-holidays";
import { getAccountingAssigneeName } from "@/lib/accounting-assignee";
import { findOrderConflicts, type OrderConflict } from "@/lib/order-conflicts";
import { getAccountingBatchOrders, groupOrdersByImportBatch, groupOrdersByImportBatchStartMonth, groupReservationOrders } from "@/lib/order-batches";
import { getMonthlySameSourceOrders } from "@/lib/order-invoice-status";
import { normalizeOrderTimeInput } from "@/lib/order-time-input";

const DEFAULT_VEHICLE_NAME = "Alphard 01";
const ALL_REGIONS_ID = "__all_regions__";
const UNASSIGNED_ORDER_VEHICLE = "__unassigned_vehicle__";
const UNASSIGNED_ORDER_DRIVER = "__unassigned_driver__";
const DATA_SYNC_INTERVAL_MS = 10_000;
const TOKYO_REGION_ID = "60000000-0000-4000-8000-000000000001";
const LOGIN_ACCOUNT_POSITIONS = ["役员", "操作", "会计"] as const;

const fuelTypes = ["レギュラー", "ディーゼル"];

function SidebarIcon({ name }: { name: string }) {
  const icons: Record<string, ReactNode> = {
    calendar: <><rect x="3" y="4.5" width="18" height="17" rx="2" /><path d="M7.5 2.5v4M16.5 2.5v4M3 9.5h18M7.5 13h.01M12 13h.01M16.5 13h.01M7.5 17h.01M12 17h.01" /></>,
    orders: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>,
    operations: <><path d="M3 19.5h18M5 16V9l7-5 7 5v7" /><path d="M9 19.5v-6h6v6M12 4v4" /></>,
    driver: <><circle cx="12" cy="7" r="3.25" /><path d="M5 21v-2a7 7 0 0 1 14 0v2z" /></>,
    vehicle: <><path d="m5 11 1.5-5h11L19 11M3.5 11h17v8h-17zM6.5 19v2M17.5 19v2" /><path d="M7 15h.01M17 15h.01" /></>,
    source: <><path d="M7 17 17 7M8 7h9v9" /><circle cx="6" cy="18" r="2" /></>,
    company: <><path d="M4 21V5l8-3 8 3v16M2 21h20" /><path d="M8 8h1M15 8h1M8 12h1M15 12h1M10 21v-4h4v4" /></>,
    finance: <><path d="M5 7h14M5 12h14M5 17h14" /><path d="m9 4-2 16M17 4l-2 16" /></>,
    salary: <><path d="M12 3v18M17 7.5c0-1.7-1.9-3-4.5-3S8 5.7 8 7.5s1.9 3 4.5 3 4.5 1.3 4.5 3-1.9 3-4.5 3S8 15.7 8 14" /></>,
    vehicleFinance: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
    balance: <><path d="M12 3v18M5 7h14M6 7l-4 7h8L6 7ZM18 7l-4 7h8l-4-7ZM8 21h8" /></>,
    login: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M10 8h7M10 12h7M10 16h4M6.5 8h.01M6.5 12h.01M6.5 16h.01" /></>,
    audit: <><path d="M8 4h11v17H5V7zM8 4v4H5M9 12h6M9 16h6" /><path d="m15 3 3 3" /></>,
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
      {icons[name]}
    </svg>
  );
}

function preventNumberInputWheelChange(event: WheelEvent) {
  const input = event.target;
  if (
    input instanceof HTMLInputElement &&
    input.type === "number" &&
    !input.readOnly &&
    !input.disabled
  ) {
    input.blur();
  }
}

type VehicleMonthlyFinanceForm = {
  parkingFee: string;
  insuranceFee: string;
  inspectionFee: string;
  repairFee: string;
  supplies: { description: string; amount: string }[];
  startOdometer: string;
  endOdometer: string;
};

type DriverWageItemDraft = {
  id?: string;
  companyName?: string;
  name: string;
  amount: string;
};

function parseNonNegativeInteger(value: string) {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}


function getDistinctSourceColor(index: number) {
  const hue = (index % 12) * 30;
  const variants = [
    { saturation: 0.95, lightness: 0.38 },
    { saturation: 0.95, lightness: 0.5 },
    { saturation: 0.95, lightness: 0.62 },
    { saturation: 0.95, lightness: 0.74 },
    { saturation: 0.72, lightness: 0.36 },
    { saturation: 0.72, lightness: 0.48 },
    { saturation: 0.72, lightness: 0.6 },
    { saturation: 0.72, lightness: 0.72 },
  ];
  const { saturation, lightness } = variants[Math.floor(index / 12)];
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

function getSourceTextColor(color: string) {
  const channels = [1, 3, 5].map((offset) => {
    const channel = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
    ? "#000000"
    : "#ffffff";
}

const sourceColorOptions = Array.from({ length: 96 }, (_, index) =>
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
      const paletteWidth = 284;
      const paletteHeight = 228;
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
    <span ref={pickerRef} className="inline-flex items-center gap-4">
      <button
        type="button"
        aria-label={`選択${sourceName}的颜色`}
        aria-expanded={isOpen}
        onClick={togglePalette}
        className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-blue-500 hover:bg-blue-50 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
      >
        <span
          aria-hidden="true"
          className="h-4 w-4 rounded-full border border-black/20 shadow-inner"
          style={{ backgroundColor: color || "#94a3b8" }}
        />
        选颜色
      </button>
      {isOpen &&
        createPortal(
          <div
            ref={paletteRef}
            role="group"
            aria-label="来源颜色选项"
            className="fixed z-[100] grid w-[284px] grid-cols-12 gap-1 rounded-lg border bg-white p-2 shadow-lg"
            style={{ left: palettePosition.left, top: palettePosition.top }}
          >
            {sourceColorOptions.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={`選択颜色 ${option}`}
                aria-pressed={color.toLowerCase() === option}
                onClick={() => {
                  onSelect(option);
                  setIsOpen(false);
                }}
                className={`h-4 w-4 rounded-full border border-black/10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${color.toLowerCase() === option ? "ring-2 ring-blue-600 ring-offset-2" : ""}`}
                style={{ backgroundColor: option }}
              />
            ))}
            <label className="relative col-span-12 mt-1 flex h-8 cursor-pointer items-center justify-center rounded border border-dashed border-slate-300 text-xs font-medium text-slate-700 hover:border-blue-500 hover:bg-blue-50">
              自定义颜色
              <input
                type="color"
                aria-label={`自定义${sourceName}的颜色`}
                value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#94a3b8"}
                onChange={(event) => onSelect(event.target.value)}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
          </div>,
          document.body,
        )}
    </span>
  );
}

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

function createCalendarDates(startDate: Date, dayCount: number) {
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

function createSlidingDates(centerDate: Date, dayCount = 11) {
  return createCalendarDates(
    new Date(centerDate.getFullYear(), centerDate.getMonth(), centerDate.getDate() - 2),
    dayCount,
  );
}

function getCenteredTodayDate() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function createMobileCalendarDates(firstMonth: Date) {
  const end = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + 5, 1);
  const dayCount = Math.round((
    Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
    Date.UTC(firstMonth.getFullYear(), firstMonth.getMonth(), firstMonth.getDate())
  ) / 86_400_000);
  return createCalendarDates(firstMonth, dayCount);
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

function CalendarInvoiceStatus({ status }: { status: Order["invoiceStatus"] }) {
  if (status !== "已完成") return null;
  return (
    <span
      className="calendar-invoice-status border-emerald-600 bg-emerald-50 text-emerald-800"
      title="請求書已完成"
    >
      請求書已完成
    </span>
  );
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
    key: Exclude<keyof OrderFinance,
      "driver" | "driverPaymentType" | "vehicle" | "vehiclePlate" | "vehicleOverride" |
      "tripSummary" | "driverWageMode" | "driverWagePercentage" |
      "companyAdvancePaymentMethod" | "companyAdvancePaymentStatus" | "companyAdvancePaymentNote">;
    label: string;
    unit: "JPY" | "L" | "h" | "JPY/h";
    readOnly?: boolean;
  }[];
}[] = [
  {
    title: "ETC 与燃油",
    fields: [
      { key: "etcCompanyReport", label: "ETC（社報）", unit: "JPY" },
      { key: "etcTripReport", label: "ETC（旅報）", unit: "JPY" },
      { key: "fuelCost", label: "燃油費", unit: "JPY" },
      { key: "fuelConsumption", label: "燃油消耗", unit: "L" },
    ],
  },
  {
    title: "立替費用",
    fields: [
      { key: "driverAdvanceCompanyReport", label: "運転士立替（社報）", unit: "JPY" },
      { key: "driverAdvanceTripReport", label: "運転士立替（旅報）", unit: "JPY" },
      { key: "companyAdvanceCompanyReport", label: "会社立替（社報）", unit: "JPY" },
      { key: "companyAdvanceTripReport", label: "会社立替（旅報）", unit: "JPY" },
      { key: "externalDriverFee", label: "外注運転士費用", unit: "JPY", readOnly: true },
    ],
  },
  {
    title: "超時費用",
    fields: [
      { key: "driverOvertimeHours", label: "超時時間", unit: "h" },
      { key: "overtimeRequestRate", label: "超時費用（旅報）", unit: "JPY/h" },
      { key: "overtimeRequestAmount", label: "超時請求（旅報）", unit: "JPY", readOnly: true },
      { key: "driverOvertimeRate", label: "超時費用（工資）", unit: "JPY/h" },
      { key: "driverOvertimeFee", label: "超時工資", unit: "JPY", readOnly: true },
    ],
  },
];

const emptyOrderFinance: OrderFinance = {
  driver: "",
  vehicle: "",
  vehiclePlate: "",
  tripSummary: "",
  dailyFare: 0,
  etcCompanyReport: 0,
  etcTripReport: 0,
  fuelCost: 0,
  fuelConsumption: 0,
  driverAdvanceCompanyReport: 0,
  driverAdvanceTripReport: 0,
  companyAdvanceCompanyReport: 0,
  externalDriverFee: 0,
  companyAdvancePaymentMethod: "",
  companyAdvancePaymentStatus: "",
  companyAdvancePaymentNote: "",
  companyAdvanceTripReport: 0,
  driverOvertimeHours: 0,
  driverOvertimeRate: 4000,
  driverOvertimeFee: 0,
  overtimeRequestAmount: 0,
  overtimeRequestRate: 5000,
  driverWageMode: "fixed",
  driverWagePercentage: 50,
  driverWage: 0,
  driverBonusWage: 0,
};

function createEmptyDraft(
  vehicle: string = DEFAULT_VEHICLE_NAME,
  date: string = "2026-09-29",
  vehiclePlate = "",
): OrderDraft {
  return {
    vehicle,
    vehiclePlate,
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
  field: Exclude<keyof OrderFinance, "driver" | "vehicle" | "vehiclePlate" | "tripSummary">,
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

function getOvertimeRequestAmount(order: Partial<OrderFinance>) {
  if (order.overtimeRequestRate !== undefined) {
    return Math.round(
      getOrderFinanceAmount(order, "driverOvertimeHours") *
      getOrderFinanceAmount(order, "overtimeRequestRate"),
    );
  }
  return order.overtimeRequestAmount === undefined
    ? getDriverOvertimeFee(order)
    : getOrderFinanceAmount(order, "overtimeRequestAmount");
}

function normalizeOrderFinance(order: Partial<OrderFinance>): OrderFinance {
  const legacyExternalDriverFee = order.driverPaymentType === "company_advance" &&
    order.externalDriverFee === undefined;
  return {
    driver: typeof order.driver === "string" ? order.driver : "",
    ...(order.driverPaymentType ? { driverPaymentType: order.driverPaymentType } : {}),
    vehicle: typeof order.vehicle === "string" ? order.vehicle : "",
    vehiclePlate: typeof order.vehiclePlate === "string" ? order.vehiclePlate : "",
    ...(typeof order.vehicleOverride === "boolean" ? { vehicleOverride: order.vehicleOverride } : {}),
    tripSummary: typeof order.tripSummary === "string" ? order.tripSummary : "",
    dailyFare: getOrderFinanceAmount(order, "dailyFare"),
    etcCompanyReport: getOrderFinanceAmount(order, "etcCompanyReport"),
    etcTripReport: getOrderFinanceAmount(order, "etcTripReport"),
    fuelCost: getOrderFinanceAmount(order, "fuelCost"),
    fuelConsumption: getOrderFinanceAmount(order, "fuelConsumption"),
    driverAdvanceCompanyReport: getOrderFinanceAmount(order, "driverAdvanceCompanyReport"),
    driverAdvanceTripReport: getOrderFinanceAmount(order, "driverAdvanceTripReport"),
    companyAdvanceCompanyReport: legacyExternalDriverFee
      ? 0 : getOrderFinanceAmount(order, "companyAdvanceCompanyReport"),
    externalDriverFee: legacyExternalDriverFee
      ? getOrderFinanceAmount(order, "companyAdvanceCompanyReport")
      : getOrderFinanceAmount(order, "externalDriverFee"),
    companyAdvancePaymentMethod: order.companyAdvancePaymentMethod || "",
    companyAdvancePaymentStatus: order.companyAdvancePaymentStatus || "",
    companyAdvancePaymentNote: order.companyAdvancePaymentNote || "",
    companyAdvanceTripReport: getOrderFinanceAmount(order, "companyAdvanceTripReport"),
    driverOvertimeHours: getOrderFinanceAmount(order, "driverOvertimeHours"),
    driverOvertimeRate: getOrderFinanceAmount(order, "driverOvertimeRate"),
    driverOvertimeFee: getOrderFinanceAmount(order, "driverOvertimeFee"),
    overtimeRequestAmount: getOvertimeRequestAmount(order),
    ...(order.overtimeRequestRate === undefined
      ? {}
      : { overtimeRequestRate: getOrderFinanceAmount(order, "overtimeRequestRate") }),
    driverWageMode: order.driverWageMode === "percentage" ? "percentage" : "fixed",
    driverWagePercentage:
      order.driverWagePercentage === 60 || order.driverWagePercentage === 70
        ? order.driverWagePercentage
        : 50,
    driverWage: getOrderFinanceAmount(order, "driverWage"),
    driverBonusWage: getOrderFinanceAmount(order, "driverBonusWage"),
  };
}

function initializeAccountingFinance(order: Partial<OrderFinance>): OrderFinance {
  const finance = normalizeOrderFinance(order);
  if (finance.driverOvertimeHours === 0 &&
    getDriverOvertimeFee(finance) === 0 &&
    getOvertimeRequestAmount(finance) === 0) {
    return {
      ...finance,
      overtimeRequestRate: finance.overtimeRequestRate || emptyOrderFinance.overtimeRequestRate,
      driverOvertimeRate: finance.driverPaymentType === "company_advance" ? 0 :
        finance.driverOvertimeRate || emptyOrderFinance.driverOvertimeRate,
    };
  }
  return finance;
}

/** The order as seen on one service day, honouring a per-day vehicle override. */
type CalendarVehicleTarget = { name: string; plate: string };

function getFinanceDayOrder(order: Order, finance: Partial<OrderFinance>): Order {
  return { ...order, ...getServiceVehicle({ ...order, financeByDate: { day: finance } }, "day") };
}

function calculateOrderFinance(
  order: Partial<OrderFinance>,
  orderPrice = getOrderFinanceAmount(order, "dailyFare"),
): FinanceTotals {
  const requestAmount =
    orderPrice +
    getOrderFinanceAmount(order, "etcTripReport") +
    getOrderFinanceAmount(order, "driverAdvanceTripReport") +
    getOrderFinanceAmount(order, "companyAdvanceTripReport") +
    getOvertimeRequestAmount(order);
  const driverAdvances =
    getOrderFinanceAmount(order, "driverAdvanceTripReport") +
    getOrderFinanceAmount(order, "driverAdvanceCompanyReport");
  const companyExpenses =
    getOrderFinanceAmount(order, "etcCompanyReport") +
    getOrderFinanceAmount(order, "fuelCost") +
    getOrderFinanceAmount(order, "companyAdvanceCompanyReport") +
    getOrderFinanceAmount(order, "externalDriverFee");
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

function isRentalOrderSource(source: string) {
  return /租車|租車|レンタカー|レンタル/i.test(source || "");
}

function isOrderArranged(order: Pick<Order, "date" | "endDate" | "offDates" | "driver" | "financeByDate" | "orderSource">) {
  const drivers = getOrderDriverNames(order);
  return (drivers.length > 0 && drivers.every(Boolean)) || isRentalOrderSource(order.orderSource);
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

/** Accounting dialog rows are keyed by order and service date so a batch can be edited together. */
function toAccountingKey(orderId: string, date: string) {
  return `${orderId}|${date}`;
}

function parseAccountingKey(key: string) {
  const separator = key.lastIndexOf("|");
  return { orderId: key.slice(0, separator), date: key.slice(separator + 1) };
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

function getReservationFinance(order: Pick<Order, "financeByDate" | "orderPrice" | "date" | "driver">) {
  const financeByDate = { ...order.financeByDate };
  if (order.orderPrice > 0 && !hasDailyFares(financeByDate)) {
    financeByDate[order.date] = {
      ...(financeByDate[order.date] || emptyOrderFinance),
      ...(!financeByDate[order.date] ? { driver: order.driver || "" } : {}),
      dailyFare: order.orderPrice,
    };
  }
  return financeByDate;
}

function updateReservationFinance(
  draft: OrderDraft,
  date: string,
  patch: Partial<OrderFinance>,
): OrderDraft {
  const financeByDate = getReservationFinance(draft);
  financeByDate[date] = {
    ...(financeByDate[date] || { ...emptyOrderFinance, driver: draft.driver }),
    ...patch,
  };
  return { ...draft, financeByDate, orderPrice: sumDailyFares(financeByDate) };
}

function sumDailyFares(financeByDate: Order["financeByDate"]) {
  return Object.values(financeByDate || {}).reduce(
    (total, finance) => total + getOrderFinanceAmount(finance, "dailyFare"),
    0,
  );
}

function updateReservationDriver(draft: OrderDraft, name: string): OrderDraft {
  const financeByDate = getReservationFinance(draft);
  for (const date of getOrderDateKeys(draft).filter(date => !draft.offDates.includes(date))) {
    const finance = financeByDate[date] || emptyOrderFinance;
    financeByDate[date] = finance.driverPaymentType === "company_advance"
      ? { ...finance, driver: "" }
      : { ...finance, driver: name };
  }
  return { ...draft, driver: name, financeByDate };
}

function updateReservationDailyDriver(draft: OrderDraft, date: string, name: string): OrderDraft {
  const finance = getReservationFinance(draft)[date] || emptyOrderFinance;
  return updateReservationFinance(draft, date, setReservationDriverPayment(
    { ...finance, driver: name },
    name ? "wage" : "company_advance",
    name,
  ));
}

function hasDailyFares(financeByDate: Order["financeByDate"]) {
  return Object.values(financeByDate || {}).some(
    (finance) => getOrderFinanceAmount(finance, "dailyFare") > 0,
  );
}

function getOrderFinanceForOrder(order: Order, month?: string): FinanceTotals {
  const entries = Object.entries(order.financeByDate || {})
    .filter(([date]) => !month || date.startsWith(`${month}-`));
  return entries.reduce(
    (current, [, finance]) => {
      const totals = calculateOrderFinance(finance);
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
  entries: readonly Partial<OrderFinance>[],
): FinanceTotals {
  return entries.reduce<FinanceTotals>(
    (current, order) => {
      const totals = calculateOrderFinance(order);
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
        按每日财务明細日期按月汇総，包含取消訂単及休运日；金額单位为日元（JPY）。
        訂単総利润 = 請求金額 - 会社総支出 - 運転士総立替 - 運転士総工資。
      </p>
      {children}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    document.addEventListener("wheel", preventNumberInputWheelChange, true);
    return () => document.removeEventListener("wheel", preventNumberInputWheelChange, true);
  }, []);
  const [calendarCenterDate, setCalendarCenterDate] = useState(() => getCenteredTodayDate());
  const [yearPickerStart, setYearPickerStart] = useState<number | null>(null);
  const calendarScrollRef = useRef<HTMLDivElement>(null);
  const [isMobileCalendar, setIsMobileCalendar] = useState(false);
  const {
    ref: calendarZoomRef,
    scale: calendarScale,
    pinching: isCalendarPinching,
  } = useCalendarZoom(isMobileCalendar);
  const isCompactCalendar = isMobileCalendar;
  const mobileCalendarCardHeights = useCalendarCardHeights(calendarScrollRef, isMobileCalendar, calendarScale);
  const calendarTodayRequestedRef = useRef(false);
  const calendarQueryDateRef = useRef<string | null>(null);
  const [calendarQueryDate, setCalendarQueryDate] = useState("");
  const [calendarTodayRequest, setCalendarTodayRequest] = useState(0);
  const setCalendarScroller = useCallback((element: HTMLDivElement | null) => {
    calendarScrollRef.current = element;
    calendarZoomRef(element);
  }, [calendarZoomRef]);
  const [mobileCalendarVisibleRange, setMobileCalendarVisibleRange] = useState<{
    startDate: string;
    endDate: string;
  } | null>(null);
  const [mobileCalendarFirstMonth, setMobileCalendarFirstMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth() - 2, 1);
  });
  const calendarAnchorRef = useRef<{ date: string; left: number } | null>(null);
  const calendarCenteredRef = useRef(false);
  const updateMobileCalendarVisibleRange = useCallback(
    (scroller = calendarScrollRef.current) => {
      if (!isMobileCalendar || !scroller) return;
      const vehicleColumnWidth =
        scroller.querySelector<HTMLElement>(".calendar-vehicle-column")?.offsetWidth ?? 100 * calendarScale;
      const visibleDates = Array.from(
        scroller.querySelectorAll<HTMLElement>(".calendar-date-header [data-calendar-date]"),
      )
        .filter((cell) => {
          const left = cell.offsetLeft - scroller.scrollLeft;
          return (
            left + cell.offsetWidth > vehicleColumnWidth &&
            left < scroller.clientWidth
          );
        })
        .map((cell) => cell.dataset.calendarDate)
        .filter((date): date is string => Boolean(date));
      if (!visibleDates.length) return;
      const nextRange = {
        startDate: visibleDates[0],
        endDate: visibleDates[visibleDates.length - 1],
      };
      setMobileCalendarVisibleRange((current) =>
        current &&
        current.startDate === nextRange.startDate &&
        current.endDate === nextRange.endDate
          ? current
          : nextRange,
      );
    },
    [isMobileCalendar, calendarScale],
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px), (hover: none) and (pointer: coarse)");
    const update = () => setIsMobileCalendar(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const updateRange = () => updateMobileCalendarVisibleRange();
    window.addEventListener("resize", updateRange);
    return () => window.removeEventListener("resize", updateRange);
  }, [updateMobileCalendarVisibleRange]);
  const [calendarVehicleFilter, setCalendarVehicleFilter] =
    useState<CalendarVehicleFilter>("all");
  const [calendarSourceFilter, setCalendarSourceFilter] = useState("");
  const [vehicleOwnerFilter, setVehicleOwnerFilter] = useState<string | null>(null);
  const dates = useMemo(
    () => isMobileCalendar
      ? createMobileCalendarDates(mobileCalendarFirstMonth)
      : createSlidingDates(calendarCenterDate, 11),
    [isMobileCalendar, mobileCalendarFirstMonth, calendarCenterDate],
  );
  const calendarDaysInMonth = new Date(
    calendarCenterDate.getFullYear(),
    calendarCenterDate.getMonth() + 1,
    0,
  ).getDate();
  const [isDataReady, setIsDataReady] = useState(false);
  const [dataLoadError, setDataLoadError] = useState("");
  const [vehicleMonthlyFinanceMigrationPending, setVehicleMonthlyFinanceMigrationPending] =
    useState(false);
  const [balanceExpensesMigrationPending, setBalanceExpensesMigrationPending] =
    useState(false);
  const [driverWageItemsMigrationPending, setDriverWageItemsMigrationPending] =
    useState(false);
  const [driverWageItemDrafts, setDriverWageItemDrafts] = useState<DriverWageItemDraft[]>([]);
  const [balanceExpenseNameDraft, setBalanceExpenseNameDraft] = useState({ expense: "", income: "" });
  const [balanceExpenseAmountDrafts, setBalanceExpenseAmountDrafts] =
    useState<Record<string, string>>({});
  const [balanceExpenseError, setBalanceExpenseError] = useState("");
  const [persistenceError, setPersistenceError] = useState("");
  const [pendingSaveCount, setPendingSaveCount] = useState(0);
  const [dialogSaving, setDialogSaving] = useState(false);
  const dialogSavingRef = useRef(false);
  const [invoiceStatusSavingIds, setInvoiceStatusSavingIds] = useState<Set<string>>(new Set());
  const invoiceStatusSavingIdsRef = useRef<Set<string>>(new Set());
  const [invoiceStatusDialog, setInvoiceStatusDialog] = useState<{
    orderId: string;
    kind: "invoice" | "deposit";
    status: Order["invoiceStatus"] | "paid" | "unpaid";
    scope: "single" | "source";
    origin: "reservation" | "finance" | "finance-batch";
    month: string;
  } | null>(null);
  async function finishDialogSave(saves: Promise<boolean>[], close: () => void) {
    dialogSavingRef.current = true;
    setDialogSaving(true);
    try {
      if ((await Promise.all(saves)).every(Boolean)) close();
      else alert("保存未获服务器确认，窗口和输入内容已保留。請检查保存错误，重新载入后核对数据。");
    } catch (error) {
      console.error("Dialog save confirmation failed.", error);
      setPersistenceError(error instanceof Error ? error.message : "无法确认保存结果。");
      alert("无法确认保存结果，窗口和输入内容已保留，請重新载入后核对数据。");
    } finally {
      dialogSavingRef.current = false;
      setDialogSaving(false);
    }
  }
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
    waitForSave: waitForOrders,
  } = usePersistedCollection<Order>(
    "orders",
    reportPersistenceError,
    reportPendingSave,
    getDeletePassword,
    getRegionForNewRecords,
  );
  const refreshApprovedOrderFinance = useCallback(async (signal: AbortSignal) => {
    const version = getVersionOrders();
    const response = await fetch("/api/data", { cache: "no-store", signal });
    const payload = await readJsonSafely(response);
    if (!response.ok) throw new Error(buildApiErrorMessage(response, payload, "无法刷新訂単财务。"));
    if (!payload || typeof payload !== "object" || !("orders" in payload) || !Array.isArray(payload.orders))
      throw new Error("訂単财务返回格式无效。");
    if (signal.aborted) return;
    if (getVersionOrders() !== version) throw new Error("訂単有新的本地修改，請刷新核对已批准金額。");
    syncOrders((payload as DashboardData).orders, version);
  }, [getVersionOrders, syncOrders]);
  const {
    items: allOrderSourceRecords,
    updateItems: setOrderSourceRecords,
    replaceItems: replaceOrderSourceRecords,
    syncItems: syncOrderSourceRecords,
    getChangeVersion: getVersionOrderSourceRecords,
    waitForSave: waitForSources,
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
    waitForSave: waitForCompanies,
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
    waitForSave: waitForDrivers,
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
    waitForSave: waitForVehicles,
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
  const {
    items: allDriverWageItems,
    updateItems: setDriverWageItems,
    replaceItems: replaceDriverWageItems,
    syncItems: syncDriverWageItems,
    getChangeVersion: getVersionDriverWageItems,
  } = usePersistedCollection<DriverWageItem>(
    "driverWageItems",
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
  const driverWageItems = filterByActiveRegion(allDriverWageItems);
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
  const [batchOrderStatus, setBatchOrderStatus] = useState<OrderStatus>("仮予約");
  const [batchOrderDriver, setBatchOrderDriver] = useState("");
  const [batchOrderSource, setBatchOrderSource] = useState("");
  const [batchOrderCompany, setBatchOrderCompany] = useState("");
  const [batchOrderCustomCompanyMode, setBatchOrderCustomCompanyMode] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{
    message: string;
    action: (password: string) => void | Promise<void>;
  } | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteCompleted, setDeleteCompleted] = useState(false);
  const [batchAddType, setBatchAddType] = useState<BatchAddType | null>(null);
  const [batchInput, setBatchInput] = useState("");
  const [draggingOrderId, setDraggingOrderId] = useState<string | null>(null);
  const [dragTargetKey, setDragTargetKey] = useState<string | null>(null);
  const [draggingCalendarVehicleId, setDraggingCalendarVehicleId] = useState<string | null>(null);
  const [calendarVehicleDropTarget, setCalendarVehicleDropTarget] =
    useState<{ id: string; after: boolean } | null>(null);
  const [splitSelection, setSplitSelection] = useState<{
    orderId: string;
    startDate: string | null;
    endDate: string | null;
  } | null>(null);
  const [selectedOrderDetailsSnapshot, setSelectedOrderDetails] = useState<Order | null>(null);
  const selectedOrderDetails = selectedOrderDetailsSnapshot
    ? allOrders.find(order => order.id === selectedOrderDetailsSnapshot.id) || null : null;
  const [orderDetailsDate, setOrderDetailsDate] = useState("");
  const [orderDetailsMode, setOrderDetailsMode] = useState<"itinerary" | "vehicle">("itinerary");
  const [accountingPreviewOrder, setAccountingPreviewOrder] = useState<Order | null>(null);
  const [accountingForm, setAccountingForm] = useState<Record<string, OrderFinance>>({});
  const [accountingBatchOrders, setAccountingBatchOrders] = useState<Order[]>([]);
  const [accountingOrderMeta, setAccountingOrderMeta] = useState<
    Record<string, { orderSource: string; company: string; status: Order["status"] }>
  >({});
  const [accountingStatus, setAccountingStatus] = useState<Order["accountingStatus"]>("未完成");
  const [accountingInvoiceStatus, setAccountingInvoiceStatus] = useState<Order["invoiceStatus"]>("未完成");
  const [accountingInvoiceSentDate, setAccountingInvoiceSentDate] = useState("");
  const [accountingDepositMethod, setAccountingDepositMethod] = useState<Order["depositMethod"]>("");
  const [accountingDepositDate, setAccountingDepositDate] = useState("");
  const [accountingAssignee, setAccountingAssignee] = useState("");
  const [accountingFinanceNote, setAccountingFinanceNote] = useState("");
  const [activeView, setActiveView] = useState<ActiveView>("calendar");
  const driverExecution = useDriverExecutionStatus(Boolean(currentProfile) && (activeView === "calendar" || activeView === "orders"));
  const driverRestDays = useDriverRestDays(Boolean(currentProfile) && activeView === "calendar", dates.map(day => day.date));
  const restingDriverNamesByDate = new Map<string, string[]>();
  for (const day of driverRestDays) {
    const name = driverRecords.find(driver => driver.id === day.driverId)?.name;
    if (name) restingDriverNamesByDate.set(day.date, [...(restingDriverNamesByDate.get(day.date) ?? []), name]);
  }
  const driverExecutionByOrder = new Map(driverExecution.data?.rows.map(row => [row.orderId, row]));
  useLayoutEffect(() => {
    const scroller = calendarScrollRef.current;
    if (!isMobileCalendar || !scroller) {
      calendarCenteredRef.current = false;
      calendarAnchorRef.current = null;
      return;
    }
    const anchor = calendarAnchorRef.current;
    if (calendarTodayRequestedRef.current) {
      const today = scroller.querySelector<HTMLElement>(`[data-calendar-date="${calendarQueryDateRef.current || toDateKey(new Date())}"]`);
      if (today) {
        const vehicleWidth =
          scroller.querySelector<HTMLElement>(".calendar-vehicle-column")?.offsetWidth ?? 100 * calendarScale;
        scroller.scrollLeft = today.offsetLeft +
          today.offsetWidth / 2 -
          (vehicleWidth + (scroller.clientWidth - vehicleWidth) / 2);
        calendarTodayRequestedRef.current = false;
        calendarAnchorRef.current = null;
        calendarCenteredRef.current = true;
      }
    } else if (anchor) {
      const cell = scroller.querySelector<HTMLElement>(`[data-calendar-date="${anchor.date}"]`);
      if (cell) scroller.scrollLeft = cell.offsetLeft - anchor.left;
      calendarAnchorRef.current = null;
      updateMobileCalendarVisibleRange(scroller);
    } else if (!calendarCenteredRef.current) {
      const today = scroller.querySelector<HTMLElement>(`[data-calendar-date="${toDateKey(new Date())}"]`);
      if (today) {
        const vehicleColumnWidth =
          scroller.querySelector<HTMLElement>(".calendar-vehicle-column")?.offsetWidth ?? 135;
        scroller.scrollLeft = today.offsetLeft - vehicleColumnWidth;
        calendarCenteredRef.current = true;
        if (!isCalendarPinching) updateMobileCalendarVisibleRange(scroller);
      } else {
        const now = new Date();
        setMobileCalendarFirstMonth(new Date(now.getFullYear(), now.getMonth() - 2, 1));
      }
    }
    updateMobileCalendarVisibleRange(scroller);
  }, [
    isMobileCalendar,
    mobileCalendarFirstMonth,
    activeView,
    isDataReady,
    currentProfile,
    updateMobileCalendarVisibleRange,
    calendarScale,
    isCalendarPinching,
    calendarTodayRequest,
  ]);
  const [orderMonth, setOrderMonth] = useState(getCurrentMonthKey);
  const [orderYearPickerStart, setOrderYearPickerStart] = useState<number | null>(null);
  const [orderDateFilter, setOrderDateFilter] = useState("");
  const [orderVehicleFilter, setOrderVehicleFilter] = useState("");
  const [orderDriverFilter, setOrderDriverFilter] = useState("");
  const [showOrderDateFilter, setShowOrderDateFilter] = useState(false);
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
    shortName: "",
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
  const [sealCompany, setSealCompany] = useState<Company | null>(null);
  const [sealDraft, setSealDraft] = useState("");
  const [sealUploadBusy, setSealUploadBusy] = useState(false);
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
    reading: "",
    phone: "",
    wechat: "",
    whatsapp: "",
    licenseExpiry: "",
    personalSlogan: "",
  });
  const [driverSloganDrafts, setDriverSloganDrafts] = useState<Record<string, string>>({});
  const [driverGlobalSlogan, setDriverGlobalSlogan] = useState("");
  const [driverGlobalSloganLoaded, setDriverGlobalSloganLoaded] = useState(false);
  const [driverGlobalSloganLoading, setDriverGlobalSloganLoading] = useState(false);
  const [driverGlobalSloganSaving, setDriverGlobalSloganSaving] = useState(false);
  const [driverGlobalSloganError, setDriverGlobalSloganError] = useState("");
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
  const [driverSelectionTarget, setDriverSelectionTarget] = useState<string | null>(null);
  const [sourceSelectionOpen, setSourceSelectionOpen] = useState<
    "form" | "batch" | "accounting-batch" | "order-filter" | "finance-filter" | "calendar-filter" | `accounting-order:${string}` | null
  >(null);
  const [customCompanyMode, setCustomCompanyMode] = useState(false);
  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        const response = await fetch("/api/data", { cache: "no-store" });
        const payload = await readJsonSafely(response);
        if (!response.ok) {
          throw new Error(buildApiErrorMessage(response, payload, "无法载入業務数据。"));
        }
        if (!payload || typeof payload !== "object") {
          throw new Error("服务器返回的業務数据格式无效。");
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
          driverWageItems?: DriverWageItem[];
          driverWageItemsMigrationPending?: boolean;
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
        replaceDriverWageItems(dashboard.driverWageItems ?? []);
        setDriverWageItemsMigrationPending(
          dashboard.driverWageItemsMigrationPending === true,
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
            error instanceof Error ? error.message : "无法载入業務数据。",
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
    replaceDriverWageItems,
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
      { key: "driverWageItems", sync: syncDriverWageItems, version: getVersionDriverWageItems },
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
    syncDriverWageItems,
    getVersionOrders,
    getVersionDriverRecords,
    getVersionVehicleRecords,
    getVersionOrderSourceRecords,
    getVersionCompanyRecords,
    getVersionVehicleMonthlyFinanceRecords,
    getVersionBalanceExpenseItems,
    getVersionDriverWageItems,
  ]);
  useEffect(() => {
    if (!isDataReady || !currentProfile) return;
    const controller = new AbortController();
    let active = true;
    async function loadDriverSlogan() {
      setDriverGlobalSloganLoading(true);
      setDriverGlobalSloganLoaded(false);
      setDriverGlobalSloganError("");
      try {
        const response = await fetch("/api/admin/driver-greetings", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await readJsonSafely(response);
        if (!response.ok) throw new Error(buildApiErrorMessage(response, payload, "无法读取全体标语。"));
        if (typeof payload !== "object" || payload === null ||
          !("slogan" in payload) || typeof payload.slogan !== "string") {
          throw new Error("全体标语返回格式无效。");
        }
        if (active) {
          setDriverGlobalSlogan(payload.slogan);
          setDriverGlobalSloganLoaded(true);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("Driver global slogan load failed.", error);
        if (active) setDriverGlobalSloganError(error instanceof Error ? error.message : "无法读取全体标语。");
      } finally {
        if (active) setDriverGlobalSloganLoading(false);
      }
    }
    void loadDriverSlogan();
    return () => { active = false; controller.abort(); };
  }, [isDataReady, currentProfile]);
  const orderSourceColorByRegion = new Map(
    orderSourceRecords.map((source) => [`${source.regionId}:${source.companyName}`, source.color]),
  );
  const orderSourceShortNameByRegion = new Map(
    orderSourceRecords.map((source) => [`${source.regionId}:${source.companyName}`, source.shortName?.trim() || ""]),
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
      shortName: "",
      contactName: "",
      contactInfo: "",
      address: "",
      color: "",
    })),
  ];
  const getSourceDisplayName = (name: string, regionId?: string) => {
    const matchingSources = sourceRows.filter((source) => source.companyName === name);
    const source = (regionId
      ? matchingSources.find((item) => item.regionId === regionId)
      : undefined) || matchingSources[0];
    return source?.shortName?.trim() || name;
  };
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
    new Set(orders.flatMap(order => getOrderDriverNames(order)).filter(Boolean)),
  ).filter((name) => !driverRecords.some((driver) => driver.name === name));
  const driverRows = rankDriversByMonthlyAttendance([
    ...driverRecords,
    ...unregisteredDriverNames.map((name, index) => ({
      id: `unregistered-driver-${index}`,
      name,
      reading: "",
      phone: "",
      wechat: "",
      whatsapp: "",
      licenseExpiry: "",
      personalSlogan: "",
      regionId: undefined,
    })),
  ], orders, toDateKey(new Date()));
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
  const vehicleOwnerOptions = Array.from(
    new Set([
      ...companyRecords.map((company) => company.name),
      ...vehicleRows.map((vehicle) => vehicle.ownerCompany),
    ].filter(Boolean)),
  );
  const filteredVehicleRows = vehicleOwnerFilter === null
    ? vehicleRows
    : vehicleRows.filter((vehicle) => (vehicle.ownerCompany || "") === vehicleOwnerFilter);
  const calendarSortedVehicleRecords = getCalendarVehicleRows(vehicleRecords, orders, dates.map(day => day.date))
    .map((vehicle) => ({
      vehicle,
      outOfService: getVehicleDisplayStatus(vehicle) !== "运营中",
      name: vehicle.name,
      id: vehicle.id,
      calendarOrder: vehicle.calendarOrder,
    }))
    .sort(compareCalendarVehicles)
    .map(({ vehicle }) => vehicle);
  const filteredCalendarVehicleRecords = calendarSortedVehicleRecords.filter(({ name: vehicle }) => {
    const modelOrder = getVehicleModelOrder(vehicle);
    const isOutsourced = isOutsourcedVehicle(vehicle);
    if (calendarVehicleFilter === "all") return true;
    if (calendarVehicleFilter === "alphard") return !isOutsourced && modelOrder === 0;
    if (calendarVehicleFilter === "hiace") return !isOutsourced && modelOrder === 1;
    if (calendarVehicleFilter === "tesla") return !isOutsourced && modelOrder === 2;
    return isOutsourced;
  });
  const availableVehicleRecords = vehicleRecords.filter(
    (vehicle) => getVehicleDisplayStatus(vehicle) === "运营中",
  );
  const orderFormRegionId = editingOrderId === null ? getRegionForNewRecords() : form.regionId;
  const orderFormVehicles = allVehicleRecords
    .filter((vehicle) => Boolean(orderFormRegionId) && vehicle.regionId === orderFormRegionId)
    .slice().sort(compareVehicles);
  const orderFormVehicleAvailableByName = new Map(
    [...new Set(orderFormVehicles.map((vehicle) => vehicle.name))].map((name) => [
      name,
      orderFormVehicles.some((vehicle) =>
        vehicle.name === name && getVehicleDisplayStatus(vehicle) === "运营中"),
    ]),
  );
  const orderFormAvailableVehicles = orderFormVehicles
    .filter((vehicle) => getVehicleDisplayStatus(vehicle) === "运营中")
    .map((vehicle) => vehicle.name);
  const selectedOrderServiceDate = selectedOrderDetails && getOrderDateKeys(selectedOrderDetails).includes(orderDetailsDate)
    ? orderDetailsDate : selectedOrderDetails?.date || "";
  const selectedOrderVehicleRef = selectedOrderDetails ? getServiceVehicle(selectedOrderDetails, selectedOrderServiceDate) : null;
  const selectedOrderVehicle = selectedOrderDetails && selectedOrderVehicleRef?.vehiclePlate
    ? resolveOrderVehicle(vehicleRecords, { ...selectedOrderDetails, ...selectedOrderVehicleRef })
    : undefined;
  const selectedOrderVehicleCompany = selectedOrderVehicle
    ? companyRecords.find((company) => company.name === selectedOrderVehicle.ownerCompany)
    : undefined;
  const selectedOrderSource = selectedOrderDetails
    ? orderSourceRecords.find(
        (source) => source.companyName === selectedOrderDetails.orderSource,
      )
    : undefined;
  const selectedOrderDriverNames = selectedOrderDetails ? getOrderDriverNames(selectedOrderDetails).filter(Boolean) : [];
  function selectedDriverContact(field: "licenseExpiry" | "phone" | "whatsapp" | "wechat") {
    return selectedOrderDriverNames.map(name => {
      const value = driverRecords.find(driver => driver.name === name)?.[field] || "-";
      return selectedOrderDriverNames.length > 1 ? `${name}：${value}` : value;
    }).join("／") || "-";
  }
  const selectedOrderDriver = {
    licenseExpiry: selectedDriverContact("licenseExpiry"), phone: selectedDriverContact("phone"),
    whatsapp: selectedDriverContact("whatsapp"), wechat: selectedDriverContact("wechat"),
  };
  const ordersInSelectedMonth = orders.filter(
    (order) =>
      order.date <= `${orderMonth}-31` &&
      (order.endDate || order.date) >= `${orderMonth}-01`,
  );
  const orderVehicleFilterOptions = Array.from(
    new Set(
      ordersInSelectedMonth
        .flatMap((order) => getOrderVehiclePlates(order, date => date.startsWith(`${orderMonth}-`)))
        .filter(Boolean),
    ),
  ).sort((first, second) => first.localeCompare(second, "ja", { numeric: true }));
  const orderDriverFilterOptions = Array.from(
    new Set(ordersInSelectedMonth.flatMap(order => getOrderDriverNames(order,
      date => date.startsWith(`${orderMonth}-`))).filter(Boolean)),
  ).sort((first, second) => first.localeCompare(second, "ja"));
  const monthlyOrders = ordersInSelectedMonth.filter(
    (order) =>
      (!orderDateFilter ||
        (order.date <= orderDateFilter &&
          (order.endDate || order.date) >= orderDateFilter &&
          !order.offDates.includes(orderDateFilter))) &&
      (orderVehicleFilter === "" ||
        (orderVehicleFilter === UNASSIGNED_ORDER_VEHICLE
          ? getOrderVehiclePlates(order, date => orderDateFilter ? date === orderDateFilter : date.startsWith(`${orderMonth}-`)).includes("")
          : getOrderVehiclePlates(order, date => orderDateFilter ? date === orderDateFilter : date.startsWith(`${orderMonth}-`)).includes(orderVehicleFilter))) &&
      (orderDriverFilter === "" ||
        (orderDriverFilter === UNASSIGNED_ORDER_DRIVER
          ? getOrderDriverNames(order, date => orderDateFilter ? date === orderDateFilter : date.startsWith(`${orderMonth}-`)).includes("")
          : getOrderDriverNames(order, date => orderDateFilter ? date === orderDateFilter : date.startsWith(`${orderMonth}-`)).includes(orderDriverFilter))) &&
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
  const matchesFinanceFilters = (order: Order) =>
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
        : !order.depositDate));
  const filteredOrderFinanceOrders = groupOrdersByImportBatch(monthlyFinanceOrders)
    .filter((group) => group.some(matchesFinanceFilters))
    .flat();
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
      throw new Error(`收支项目「${item.name}」金額必须是0至99999999999999的整数。`);
    }
    return amount;
  };
  const balanceResult = (() => {
    try {
      if (balanceExpensesMigrationPending) {
        throw new Error("手動收支数据尚未就绪，請先完成相关数据库迁移。");
      }
      const orderTotals = orders.flatMap((order) => {
        if (getBalanceServiceMonth(order, getOrderDateKeys(order)) !== balanceMonth) return [];
        if (!Number.isSafeInteger(order.orderPrice) || order.orderPrice < 0) {
          throw new Error(`訂単「${order.customer}」价格须为非负日元整数。`);
        }
        return [{
          companyName: order.company || "",
          depositMethod: order.depositMethod,
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
          orders.filter((order) =>
            getBalanceServiceMonth(order, getOrderDateKeys(order)) === balanceMonth,
          ).flatMap((order) => Object.entries(order.financeByDate || {})
            .filter(([, finance]) => (finance.externalDriverFee ?? 0) > 0)
            .map(([date, finance]) => ({
              companyName: order.company || "",
              customer: order.customer,
              date,
              method: finance.companyAdvancePaymentMethod || "",
              status: finance.companyAdvancePaymentStatus || "",
              note: finance.companyAdvancePaymentNote || "",
              amount: finance.externalDriverFee ?? 0,
            }))),
        ),
        error: "",
      };
    } catch (error) {
      return { summary: null, error: error instanceof Error ? error.message : "收支汇総失败，請刷新后重试。" };
    }
  })();
  const sortedFinanceOrders = [...filteredOrderFinanceOrders].sort((first, second) =>
    `${first.date} ${first.time}`.localeCompare(`${second.date} ${second.time}`),
  );
  const financeDisplayGroups = groupOrdersByImportBatchStartMonth(orders, financeMonth)
    .filter((groupOrders) => groupOrders.some(matchesFinanceFilters))
    .map((groupOrders) => {
    const firstOrder = groupOrders[0];
    const totals = groupOrders.reduce((sum, order) => {
      const orderTotals = getOrderFinanceForOrder(order, financeMonth);
      return {
        requestAmount: sum.requestAmount + orderTotals.requestAmount,
        driverAdvances: sum.driverAdvances + orderTotals.driverAdvances,
        companyExpenses: sum.companyExpenses + orderTotals.companyExpenses,
        driverWages: sum.driverWages + orderTotals.driverWages,
        fuelConsumption: sum.fuelConsumption + orderTotals.fuelConsumption,
        profit: sum.profit + orderTotals.profit,
      };
    }, {
      requestAmount: 0, driverAdvances: 0, companyExpenses: 0,
      driverWages: 0, fuelConsumption: 0, profit: 0,
    });
    const invoiceCompletedCount = groupOrders.filter((order) => order.invoiceStatus === "已完成").length;
    const depositPaidCount = groupOrders.filter((order) => Boolean(order.depositDate)).length;
    const uniqueValues = (values: string[]) => [...new Set(values.filter(Boolean))];
    const startDate = groupOrders.reduce(
      (earliest, order) => order.date < earliest ? order.date : earliest,
      firstOrder.date,
    );
    const endDate = groupOrders.reduce((latest, order) => {
      const orderEndDate = order.endDate || order.date;
      return orderEndDate > latest ? orderEndDate : latest;
    }, firstOrder.endDate || firstOrder.date);
    return {
      key: firstOrder.id,
      orders: groupOrders,
      totals,
      customers: uniqueValues(groupOrders.map((order) => order.customer || "未填写")),
      dateRange: startDate === endDate
        ? formatOrderDate(startDate)
        : `${formatOrderDate(startDate)} ～ ${formatOrderDate(endDate)}`,
      sources: uniqueValues(groupOrders.map((order) => order.orderSource || "未填写")),
      invoiceStatus: invoiceCompletedCount === groupOrders.length
        ? groupOrders.length > 1 ? "全部已完成" : "已完成"
        : invoiceCompletedCount > 0 ? "部分完成"
          : groupOrders.length > 1 ? "全部未完成" : "未完成",
      depositStatus: depositPaidCount === groupOrders.length
        ? groupOrders.length > 1 ? "全部入金済み" : "入金済み"
        : depositPaidCount > 0 ? "部分入金"
          : groupOrders.length > 1 ? "全部未入金" : "未入金",
      allInvoicesComplete: invoiceCompletedCount === groupOrders.length,
      allDepositsPaid: depositPaidCount === groupOrders.length,
    };
  });
  const filteredFinanceTotals = summarizeFinance(filteredOrderFinanceOrders);
  const filteredFinanceRequestAmounts = summarizeRequestAmounts(
    filteredOrderFinanceOrders.map((order) => ({
      depositMethod: order.depositMethod,
      requestAmount: getOrderFinanceForOrder(order).requestAmount,
    })),
  );
  const filteredFinanceProfitRate =
    filteredFinanceTotals.requestAmount === 0
      ? 0
      : (filteredFinanceTotals.profit / filteredFinanceTotals.requestAmount) * 100;
  function getOrderVehicleNumber(order: Order, month?: string) {
    return getOrderVehiclePlates(order, date => !month || date.startsWith(`${month}-`))
      .map(plate => plate || "未填写").join("／") || "-";
  }
  async function exportOrderFinance() {
    if (financeDisplayGroups.length === 0) {
      alert("当前筛选范围暂无訂単财务記録。");
      return;
    }
    try {
      await printOrderFinance({
        month: financeMonth,
        region: activeRegionId === ALL_REGIONS_ID ? "全部分区" : regionNameById.get(activeRegionId) || "未知地域",
        source: financeSourceFilter === UNSOURCED_ORDER ? "未填写" : financeSourceFilter || "全部来源",
        company: financeCompanyFilter === "__unassigned_company__" ? "未填写" : financeCompanyFilter || "全部会社",
        depositStatus: financeDepositStatusFilter === "paid" ? "入金済み" : financeDepositStatusFilter === "unpaid" ? "未入金" : "全部状態",
        invoiceStatus: financeInvoiceStatusFilter || "全部状態",
        orderCount: sortedFinanceOrders.length,
        requestAmounts: filteredFinanceRequestAmounts,
        rows: financeDisplayGroups.map((group) => ({
          date: group.dateRange,
          customer: group.orders.map((order) => order.customer || "未填写").join("、"),
          source: group.sources.join("、"),
          invoiceStatus: group.invoiceStatus,
          paid: group.allDepositsPaid,
          depositStatus: group.depositStatus,
          depositMethod: group.orders[0].depositMethod,
          ...group.totals,
        })),
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "财务表导出失败，請重试。");
    }
  }
  const driverFinanceHolidayCache = new Map<number, Set<string>>();
  const isDriverFinanceRedDay = (serviceDate: string) => {
    const year = Number(serviceDate.slice(0, 4));
    let holidays = driverFinanceHolidayCache.get(year);
    if (!holidays) {
      holidays = getJapaneseHolidays(year);
      driverFinanceHolidayCache.set(year, holidays);
    }
    const weekday = new Date(`${serviceDate}T00:00:00Z`).getUTCDay();
    return weekday === 0 || weekday === 6 || holidays.has(serviceDate);
  };
  const driverFinanceCompanies = [...new Set([
    ...companyRecords.map((company) => company.name),
    ...monthlyFinanceOrders.map((order) => order.company).filter(Boolean),
    ...driverWageItems.map((item) => item.companyName).filter(Boolean),
  ])].sort((first, second) => first.localeCompare(second));
  const buildCompanyDriverFinanceDetails = (sourceOrders: readonly Order[]) => sourceOrders
    .filter((order) => driverFinanceCompanyFilter === "" ||
      (driverFinanceCompanyFilter === "__unassigned_company__"
        ? !order.company
        : order.company === driverFinanceCompanyFilter))
    .flatMap((order) =>
      Object.entries(order.financeByDate || {})
        .filter(
          ([, finance]) => isDriverWageEntry(finance),
        )
        .map(([serviceDate, finance]) => {
          const totals = calculateOrderFinance(finance);
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
            isRedDay: isDriverFinanceRedDay(serviceDate),
            customer: order.customer || "未填写",
            vehicleNumber:
              getServiceVehicle({ ...order, financeByDate: { day: finance } }, "day").vehiclePlate || "-",
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
      `${first.serviceDate} ${first.time}`.localeCompare(
        `${second.serviceDate} ${second.time}`,
      ),
    );
  const companyDriverFinanceDetails = buildCompanyDriverFinanceDetails(monthlyFinanceOrders);
  const driverFinanceGroupOrders = groupOrdersByImportBatch(orders).filter((batch) => {
    const startDate = batch.reduce(
      (earliest, order) => order.date < earliest ? order.date : earliest,
      batch[0].date,
    );
    return startDate.startsWith(`${financeMonth}-`);
  }).flat();
  const driverFinanceDisplayGroups = groupDriverFinanceByBatch(
    driverFinanceGroupOrders,
    buildCompanyDriverFinanceDetails(driverFinanceGroupOrders),
    financeMonth,
  );
  const monthDriverWageItems = driverWageItems.filter(
    (item) =>
        item.month === financeMonth &&
        (driverFinanceCompanyFilter === "" ||
          (driverFinanceCompanyFilter === "__unassigned_company__"
            ? !item.companyName
            : item.companyName === driverFinanceCompanyFilter)),
  );
  const driverFinanceDrivers = [...new Set(
    [
        ...companyDriverFinanceDetails.filter((row) => row.driverWages > 0).map((row) => row.driver),
        ...monthDriverWageItems.map((item) => item.driver),
        ...driverRecords.map((driver) => driver.name),
    ],
  )].sort((first, second) => first.localeCompare(second, "ja"));
  const selectedDriverFinanceDriver = driverFinanceDrivers.includes(driverFinanceDriverFilter)
    ? driverFinanceDriverFilter
    : "";
  const visibleDriverFinanceGroups = driverFinanceDisplayGroups
    .map((group) => ({
      ...group,
      drivers: group.drivers.filter((driverGroup) =>
        !selectedDriverFinanceDriver || driverGroup.driver === selectedDriverFinanceDriver,
      ),
    }))
    .filter((group) => group.drivers.length > 0);
  const filteredDriverFinanceDetails = companyDriverFinanceDetails.filter(
    (row) => !selectedDriverFinanceDriver || row.driver === selectedDriverFinanceDriver,
  );
  const selectedDriverWageItems = monthDriverWageItems.filter(
    (item) => item.driver === selectedDriverFinanceDriver,
  );
  const driverWageItemCompanyName =
    driverFinanceCompanyFilter === "__unassigned_company__" ? "" : driverFinanceCompanyFilter;
  function getDriverWageItemDrafts(driver: string) {
    if (!driver) return [];
    return allDriverWageItems
      .filter((item) =>
        (activeRegionId === ALL_REGIONS_ID || item.regionId === activeRegionId) &&
        item.month === financeMonth &&
        item.driver === driver &&
        (driverFinanceCompanyFilter === "" || item.companyName === driverWageItemCompanyName)
      )
      .map((item) => ({
        id: item.id,
        companyName: item.companyName,
        name: item.name,
        amount: String(item.amount),
      }));
  }
  const driverFinanceCompanyLabel = driverFinanceCompanyFilter === "__unassigned_company__"
    ? "未设置所属会社"
    : driverFinanceCompanyFilter || "全部所属会社";
  const driverFinanceManualWageTotal = selectedDriverWageItems.reduce(
    (total, item) => total + item.amount,
    0,
  );
  const driverFinanceTotalWage = filteredDriverFinanceDetails.reduce(
    (total, row) => total + row.driverWages,
    0,
  ) + driverFinanceManualWageTotal;
  const driverFinanceTotalAdvances = filteredDriverFinanceDetails.reduce(
    (total, row) => total + row.driverAdvances, 0,
  );
  function addDriverWageItemDraft() {
    if (driverWageItemsMigrationPending) return;
    if (currentProfile?.role !== "admin") {
      alert("仅管理员可以管理運転士工資手動项目。");
      return;
    }
    if (!requireSpecificRegionForNewData()) return;
    if (!selectedDriverFinanceDriver) {
      alert("請先選択一位運転士。");
      return;
    }
    setDriverWageItemDrafts((drafts) => [...drafts, {
      companyName: driverFinanceCompanyFilter === "" ? undefined : driverWageItemCompanyName,
      name: "",
      amount: "",
    }]);
  }
  function saveDriverWageItems() {
    if (driverWageItemsMigrationPending) return;
    if (currentProfile?.role !== "admin" || !requireSpecificRegionForNewData()) return;
    if (!selectedDriverFinanceDriver) {
      alert("請先選択一位運転士。");
      return;
    }
    if (driverWageItemDrafts.length === 0) {
      alert("請先添加工資项目。");
      return;
    }
    const updates = driverWageItemDrafts.map((draft) => ({
      draft,
      amount: Number(draft.amount),
    }));
    if (updates.some(({ draft, amount }) =>
      !draft.name.trim() ||
      draft.companyName === undefined ||
      !Number.isSafeInteger(amount) ||
      Math.abs(amount) > 99_999_999_999_999
    )) {
      alert("請填写所属会社、项目名称和有效的日元整数金額。");
      return;
    }
    const total = updates.reduce((sum, item) => sum + item.amount, 0);
    if (!Number.isSafeInteger(total)) {
      alert("手動工資项目合计超出安全金額范围，請分开录入或缩小金額。");
      return;
    }
    const saved = updates.map(({ draft, amount }) => ({
      id: draft.id || createId(),
      regionId: activeRegionId,
      month: financeMonth,
      driver: selectedDriverFinanceDriver,
      companyName: draft.companyName ?? "",
      name: draft.name.trim(),
      amount,
    }));
    setDriverWageItems((current) => {
      const existingById = new Map(current.map((item) => [item.id, item]));
      const savedRecords = saved.map((item) => ({
        ...existingById.get(item.id),
        ...item,
      }));
      const savedById = new Map(savedRecords.map((item) => [item.id, item]));
      const next = current.map((item) => savedById.get(item.id) || item);
      const existingIds = new Set(current.map((item) => item.id));
      return [...next, ...savedRecords.filter((item) => !existingIds.has(item.id))];
    });
    setDriverWageItemDrafts(saved.map((item) => ({
      id: item.id,
      name: item.name,
      amount: String(item.amount),
    })));
  }
  function deleteDriverWageItem(item: DriverWageItem) {
    requestDelete(
      `确定删除「${item.driver}」的工資项目「${item.name}」吗？`,
      () => {
        setDriverWageItems((current) => current.filter((record) => record.id !== item.id));
        setDriverWageItemDrafts((current) => current.filter((draft) => draft.id !== item.id));
      },
    );
  }
  async function exportCompanyWages() {
    if (companyDriverFinanceDetails.length === 0 && monthDriverWageItems.length === 0) {
      alert("所选月份及所属会社暂无運転士工資記録。");
      return;
    }
    try {
      await printCompanyWages({
        month: financeMonth,
        company: driverFinanceCompanyLabel,
        region: activeRegionId === ALL_REGIONS_ID ? "全部分区" : regionNameById.get(activeRegionId) || "未知地域",
        rows: companyDriverFinanceDetails,
        manualItems: monthDriverWageItems.map((item) => ({
          driver: item.driver,
          companyName: item.companyName,
          name: item.name,
          amount: item.amount,
        })),
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "会社工資総表导出失败，請重试。");
    }
  }
  const filteredVehicleFinanceDetails = monthlyFinanceOrders
    .flatMap((order) =>
      Object.entries(order.financeByDate || {})
        .map(([serviceDate, finance]) => {
          const dayOrder = getFinanceDayOrder(order, finance);
          return { serviceDate, finance, dayOrder, dayVehicle: resolveOrderVehicle(vehicleRecords, dayOrder) };
        })
        .filter(({ dayOrder, dayVehicle }) =>
          Boolean(dayOrder.vehicle) &&
          (vehicleFinanceVehicleFilter === "" || dayVehicle?.id === vehicleFinanceVehicleFilter),
        )
        .map(({ serviceDate, finance, dayOrder, dayVehicle }) => {
          const totals = calculateOrderFinance(finance);
          return {
            id: `${order.id}-${serviceDate}`,
            serviceDate,
            customer: order.customer || "未填写",
            driver: finance.driver || "未安排",
            vehicleName: dayOrder.vehicle,
            vehicleId: dayVehicle?.id,
            regionId: order.regionId,
            vehicleNumber: dayOrder.vehiclePlate || "-",
            time: order.time,
            ...totals,
          };
        }),
    )
    .sort((first, second) =>
      `${first.serviceDate} ${first.time}`.localeCompare(
        `${second.serviceDate} ${second.time}`,
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
      return { rows: [], error: error instanceof Error ? error.message : "車両月度汇総失败，請刷新后重试。" };
    }
  })();
  const vehicleSummaryTotals = totalVehicleSummaries(vehicleSummaryResult.rows);
  const selectedVehicleForFinance = vehicleRecords.find(
    (vehicle) => vehicle.id === vehicleFinanceVehicleFilter,
  );
  const selectedVehicleMonthlyFinance = selectedVehicleForFinance
    ? vehicleMonthlyFinanceRecords.find(
        (record) =>
          record.vehicleId === selectedVehicleForFinance.id &&
          record.month === financeMonth,
      )
    : undefined;

  function getVehicleMonthlyFinanceForm(vehicleId: string, month: string) {
    const vehicle = vehicleRecords.find((item) => item.id === vehicleId);
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
          "請为每条备品明細填写名称和非负整数金額。",
        );
        return;
      }
      if (description.length > 300 || amount > 99_999_999_999_999) {
        setVehicleMonthlyFinanceError("备品名称最多 300 个字符，金額不能超过 99999999999999 日元。");
        return;
      }
      if (supplies.length >= 100) {
        setVehicleMonthlyFinanceError("每月最多可登记 100 条备品費用。");
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
      setVehicleMonthlyFinanceError("費用、备品金額和公里数必须在有效范围内。");
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
        alert("当前分区暂无車両或财务記録。");
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
        alert(error instanceof Error ? error.message : "車両月度汇総导出失败，請重试。");
      }
      return;
    }
    if (!selectedVehicleForFinance && filteredVehicleFinanceDetails.length === 0) {
      alert("当前月份及分区暂无車両财务記録。");
      return;
    }
    if (vehicleFinanceVehicleFilter && !selectedVehicleForFinance) {
      alert("无法识别所选車両，請重新選択車両番号。");
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
      alert(error instanceof Error ? error.message : "車両财务表导出失败，請重试。");
    }
  }
  const todayDateKey = toDateKey(new Date());
  const driverSelectionOrder = driverSelectionTarget &&
    !["batch", "accounting-batch", "driver-finance-filter"].includes(driverSelectionTarget) &&
    !driverSelectionTarget.startsWith("accounting-finance:")
    ? orders.find((order) => order.id === driverSelectionTarget)
    : undefined;
  const driverSelectionRegionId = driverSelectionTarget === "batch"
      ? getRegionForNewRecords()
      : driverSelectionTarget === "accounting-batch" ||
          driverSelectionTarget?.startsWith("accounting-finance:")
        ? accountingPreviewOrder?.regionId
        : driverSelectionOrder?.regionId;
  const driverSelectionCandidates = driverSelectionTarget === "driver-finance-filter"
    ? rankDriversByMonthlyAttendance(driverFinanceDrivers.map((name) => {
        const driver = driverRecords.find((record) =>
          record.name === name && (activeRegionId === ALL_REGIONS_ID || record.regionId === activeRegionId));
        if (activeRegionId === ALL_REGIONS_ID) {
          return {
            id: driver?.id ?? name,
            name,
            regionId: undefined,
            reading: driver?.reading ?? "",
          };
        }
        return driver ?? {
          id: name,
          name,
          regionId: activeRegionId,
          reading: "",
        };
      }), orders, todayDateKey).map((driver) => ({ ...driver, serviceDays: 0 }))
    : driverSelectionTarget !== null ? rankDriversByMonthlyAttendance(
        driverRecords.filter((driver) => driver.regionId === driverSelectionRegionId),
        orders,
        todayDateKey,
      )
      : [];
  const driverSelectionDates = driverSelectionTarget === "driver-finance-filter" ? []
    : driverSelectionTarget === "batch" ? (batchOrderDate ? [batchOrderDate] : [])
    : driverSelectionTarget === "accounting-batch"
      ? [...new Set(Object.keys(accountingForm).flatMap(key => {
          const { orderId, date } = parseAccountingKey(key);
          const order = accountingBatchOrders.find(item => item.id === orderId) ?? accountingPreviewOrder;
          return order && date >= order.date && date <= (order.endDate || order.date) && !order.offDates.includes(date) ? [date] : [];
        }))]
    : driverSelectionTarget?.startsWith("accounting-finance:")
      ? [parseAccountingKey(driverSelectionTarget.slice("accounting-finance:".length)).date]
    : driverSelectionOrder ? getOrderDateKeys(driverSelectionOrder).filter(date => !driverSelectionOrder.offDates.includes(date)) : [];
  const isUpcomingOrder = (order: Order) => order.date > todayDateKey;

  function requestDelete(
    message: string,
    action: (password: string) => void | Promise<void>,
  ) {
    setDeleteError("");
    setDeletePassword("");
    setDeleteCompleted(false);
    setPendingDelete({ message, action });
  }

  async function confirmPendingDelete() {
    if (!pendingDelete || isDeleting || deleteCompleted || !deletePassword) return;
    setDeleteError("");
    setIsDeleting(true);
    try {
      await pendingDelete.action(deletePassword);
      setDeleteCompleted(true);
      setDeletePassword("");
    } catch (error) {
      console.error("Failed to complete a confirmed deletion.", error);
      setDeleteError(
        error instanceof Error ? error.message : "删除失败，請稍后重试。",
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
      setBalanceExpenseError("請先選択具体所属会社，再添加收支项目。");
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
      setBalanceExpenseError("請選択具体所属会社后再保存收支金額。");
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
        setBalanceExpenseError("每项收支金額必须是 0 至 99999999999999 的整数。");
        return;
      }
      amounts.set(item.id, value);
    }
    if (amounts.size === 0) {
      setBalanceExpenseError("没有需要保存的金額变更。");
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
      `确定删除「${item.companyName || "未填写会社"}」的${item.kind === "income" ? "收入" : "支出"}项目「${item.name}」及其所有月份金額吗？`,
      () =>
        setBalanceExpenseItems((items) =>
          items.filter((current) => current.id !== item.id),
        ),
    );
  }

  async function exportBalance(report: "balance" | "companyAdvances" = "balance") {
    if (!balanceResult.summary) {
      alert(balanceResult.error);
      return;
    }
    try {
      const print = report === "companyAdvances" ? printCompanyAdvances : printBalance;
      await print({
        month: balanceMonth,
        region: activeRegionId === ALL_REGIONS_ID ? "全部分区" : regionNameById.get(activeRegionId) || "未知地域",
        company: balanceCompanyFilter === "__unassigned_company__" ? "未填写" : balanceCompanyFilter || "全部会社",
        summary: balanceResult.summary,
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "财务報表导出失败，請重试。");
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
      alert("請填写用户姓名、邮箱、所属会社、职位和地域。");
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
      setAccountMessage(editingLoginAccountId !== null ? "账号資料已保存。"
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
      setAccountMessage("新密码已设置，用户可直接登录。此操作不会保存尚未提交的账号資料。");
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
        alert(`复制${fieldName}失败，請检查浏览器剪贴板权限。`);
      }
    }
  }

  function reorderCalendarVehicle(draggedId: string, targetId: string, placeAfter: boolean) {
    const currentIds = calendarSortedVehicleRecords.map((vehicle) => vehicle.id);
    const nextIds = moveCalendarVehicle(currentIds, draggedId, targetId, placeAfter);
    if (nextIds === currentIds) return;
    const positions = new Map(nextIds.map((id, index) => [id, index]));
    setVehicleRecords((current) =>
      current.map((vehicle) => {
        const position = positions.get(vehicle.id);
        return position === undefined || vehicle.calendarOrder === position
          ? vehicle
          : { ...vehicle, calendarOrder: position };
      }),
    );
  }

  function moveOrderToCell(orderId: string, target: CalendarVehicleTarget, targetDate: string) {
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
          ...changeOrderVehicle(order, target, true),
          date: targetDate,
          endDate: shiftDateKey(targetDate, duration),
          offDates: (order.offDates || []).map((offDate) =>
            shiftDateKey(offDate, dateOffset),
          ),
          financeByDate: shiftFinanceDates(changeOrderVehicle(order, target, true).financeByDate, dateOffset),
        };
      }),
    );
    setDraggingOrderId(null);
    setDragTargetKey(null);
  }

  function moveSplitRangeToVehicle(
    orderId: string,
    target: CalendarVehicleTarget,
    startDate: string,
    endDate: string,
  ) {
    setOrders((currentOrders) => {
      return currentOrders.flatMap((order) => {
        if (
          order.id !== orderId ||
          orderUsesVehicle(order, { ...target, regionId: order.regionId })
        ) return [order];

        const orderEndDate = order.endDate || order.date;
        const movedOffDates = order.offDates.filter(
          (offDate) => offDate >= startDate && offDate <= endDate,
        );

        if (startDate <= order.date && endDate >= orderEndDate) {
          return [{ ...changeOrderVehicle(order, target, true), offDates: movedOffDates }];
        }

        const hasBefore = order.date < startDate;
        const hasAfter = orderEndDate > endDate;
        const remainingOrders: Order[] = [];
        const usesDailyFares = hasDailyFares(order.financeByDate);
        const getPartPrice = (financeByDate: Order["financeByDate"], legacyPrice: number) =>
          usesDailyFares ? sumDailyFares(financeByDate) : legacyPrice;

        if (hasBefore) {
          const financeByDate = shiftFinanceDates(
            order.financeByDate,
            0,
            (date) => date < startDate,
          );
          remainingOrders.push({
            ...order,
            endDate: shiftDateKey(startDate, -1),
            orderPrice: getPartPrice(financeByDate, order.orderPrice),
            offDates: order.offDates.filter((offDate) => offDate < startDate),
            financeByDate,
          });
        }

        if (hasAfter) {
          const financeByDate = shiftFinanceDates(
            order.financeByDate,
            0,
            (date) => date > endDate,
          );
          remainingOrders.push({
            ...order,
            id: hasBefore ? createId() : order.id,
            date: shiftDateKey(endDate, 1),
            endDate: orderEndDate,
            orderPrice: getPartPrice(financeByDate, hasBefore ? 0 : order.orderPrice),
            offDates: order.offDates.filter((offDate) => offDate > endDate),
            financeByDate,
          });
        }

        const movedFinanceByDate = shiftFinanceDates(
          order.financeByDate,
          0,
          (date) => date >= startDate && date <= endDate,
        );
        remainingOrders.push({
          ...order,
          id: createId(),
          vehicle: target.name,
          vehiclePlate: target.plate,
          date: startDate,
          endDate,
          orderPrice: getPartPrice(movedFinanceByDate, hasBefore ? 0 : order.orderPrice),
          offDates: movedOffDates,
          financeByDate: changeOrderVehicle({ ...order, financeByDate: movedFinanceByDate }, target, true).financeByDate,
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
      setPersistenceError("新增業務数据前，請先選択一个具体地域。");
      return false;
    }
    return true;
  }

  function openNewOrder(vehicle: Vehicle | undefined, date: string) {
    if (!requireSpecificRegionForNewData()) return;
    if (!vehicle || getVehicleDisplayStatus(vehicle) !== "运营中") {
      alert(
        vehicle
          ? `車両「${vehicle.plate || vehicle.name}」当前不可用，不能新增予約。`
          : "没有可用車両，不能新增予約。",
      );
      return;
    }

    setEditingOrderId(null);
    setForm(createEmptyDraft(vehicle.name, date, vehicle.plate));
    setOffDateInput("");
    setCustomCompanyMode(false);
    setShowForm(true);
  }

  function openBatchOrderImport() {
    if (!requireSpecificRegionForNewData()) return;
    const vehicle = availableVehicleRecords[0];
    if (!vehicle) {
      alert("没有可用車両，不能批量新增预约。");
      return;
    }

    setBatchOrderInput("");
    setBatchOrderDate(toDateKey(calendarCenterDate));
    setBatchOrderVehicle(vehicle.id);
    setBatchOrderStatus("仮予約");
    setBatchOrderDriver("");
    setBatchOrderSource("");
    setBatchOrderCompany("");
    setBatchOrderCustomCompanyMode(false);
    setShowBatchOrderForm(true);
  }

  function importBatchOrders() {
    if (dialogSavingRef.current) return;
    if (!requireSpecificRegionForNewData()) return;
    const details = parseImportedOrderDetails(batchOrderInput);
    if (details.length === 0) {
      alert("未识别到预约信息。請按“06:30 上車地点 下車地点”的格式粘贴。");
      return;
    }
    if (details.length > 500) {
      alert("一次最多导入 500 条预约，請分批导入。");
      return;
    }
    const batchVehicle = availableVehicleRecords.find((vehicle) => vehicle.id === batchOrderVehicle);
    if (!batchOrderDate || !batchVehicle) {
      alert("請選択有效的日期和运营中的車両。");
      return;
    }

    const importBatchId = createId();
    setOrders((currentOrders) => [
      ...currentOrders,
      ...details.map((detail, importBatchIndex) => ({
        ...createEmptyDraft(batchVehicle.name, batchOrderDate, batchVehicle.plate),
        id: createId(),
        importBatchId,
        importBatchIndex,
        customer: `${detail.pickup} → ${detail.destination}`,
        time: detail.time,
        pickup: detail.pickup,
        destination: detail.destination,
        status: batchOrderStatus,
        driver: batchOrderDriver.trim(),
        orderSource: batchOrderSource.trim(),
        company: batchOrderCompany.trim(),
        financeByDate: {
          [batchOrderDate]: {
            ...emptyOrderFinance,
            driver: batchOrderDriver.trim(),
            vehicle: batchVehicle.name,
            vehiclePlate: batchVehicle.plate || "",
            tripSummary: `${detail.time} ${detail.pickup} → ${detail.destination}`.slice(0, 1000),
          },
        },
      })),
    ]);
    return finishDialogSave([waitForOrders()], () => {
      setBatchOrderInput("");
      setBatchOrderDriver("");
      setBatchOrderSource("");
      setBatchOrderCompany("");
      setBatchOrderCustomCompanyMode(false);
      setShowBatchOrderForm(false);
    });
  }

  function openNewDriver() {
    if (!requireSpecificRegionForNewData()) return;
    setEditingDriverId(null);
    setEditingDriverName(null);
    setDriverForm({
      name: "",
      reading: "",
      phone: "",
      wechat: "",
      whatsapp: "",
      licenseExpiry: "",
      personalSlogan: "",
    });
    setShowDriverForm(true);
  }

  function openEditDriver(driver: Driver) {
    setEditingDriverId(driver.id.startsWith("unregistered-") ? null : driver.id);
    setEditingDriverName(driver.name);
    setDriverForm({
      name: driver.name,
      reading: driver.reading || "",
      phone: driver.phone,
      wechat: driver.wechat,
      whatsapp: driver.whatsapp,
      licenseExpiry: driver.licenseExpiry || "",
      personalSlogan: driver.personalSlogan || "",
    });
    setShowDriverForm(true);
  }

  function saveDriver() {
    if (dialogSavingRef.current) return;
    if (editingDriverId === null && !requireSpecificRegionForNewData()) return;
    const driverRegionId = editingDriverId === null
      ? getRegionForNewRecords()
      : allDriverRecords.find((driver) => driver.id === editingDriverId)?.regionId;
    if (!driverRegionId) return;
    const savedDriver: DriverDraft = {
      name: driverForm.name.trim(),
      reading: driverForm.reading.trim(),
      phone: driverForm.phone.trim(),
      wechat: driverForm.wechat.trim(),
      whatsapp: driverForm.whatsapp.trim(),
      licenseExpiry: driverForm.licenseExpiry,
      personalSlogan: driverForm.personalSlogan.trim(),
    };

    if (!savedDriver.name) {
      alert("請填写運転士。");
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
      const id = createId();
      setDriverRecords((current) => [...current, { id, ...savedDriver }]);
      setEditingDriverId(id);
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

    setEditingDriverName(savedDriver.name);
    return finishDialogSave([waitForDrivers(), ...(editingDriverName && editingDriverName !== savedDriver.name
      ? [waitForOrders()] : [])], () => setShowDriverForm(false));
  }

  async function saveDriverGlobalSlogan() {
    if (!driverGlobalSloganLoaded || driverGlobalSloganLoading || driverGlobalSloganSaving) return;
    setDriverGlobalSloganSaving(true);
    setDriverGlobalSloganError("");
    try {
      const response = await fetch("/api/admin/driver-greetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slogan: driverGlobalSlogan }),
      });
      const payload = await readJsonSafely(response);
      if (!response.ok) throw new Error(buildApiErrorMessage(response, payload, "全体标语保存失败。"));
      if (typeof payload !== "object" || payload === null ||
        !("slogan" in payload) || typeof payload.slogan !== "string") {
        throw new Error("全体标语保存结果无效，請刷新核对。");
      }
      setDriverGlobalSlogan(payload.slogan);
    } catch (error) {
      console.error("Driver global slogan save failed.", error);
      setDriverGlobalSloganError(error instanceof Error ? error.message : "全体标语保存失败，請重试。");
    } finally {
      setDriverGlobalSloganSaving(false);
    }
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
      shortName: "",
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
      shortName: source.shortName || "",
      contactName: source.contactName,
      contactInfo: source.contactInfo,
      address: source.address,
      color: source.color || "#2563eb",
    });
    setShowSourceForm(true);
  }

  function saveSource() {
    if (dialogSavingRef.current) return;
    if (editingSourceId === null && !requireSpecificRegionForNewData()) return;
    const sourceRegionId = editingSourceId === null
      ? getRegionForNewRecords()
      : allOrderSourceRecords.find((source) => source.id === editingSourceId)?.regionId;
    if (!sourceRegionId) return;
    const savedSource: OrderSourceDraft = {
      companyName: sourceForm.companyName.trim(),
      shortName: (sourceForm.shortName || "").trim(),
      contactName: sourceForm.contactName.trim(),
      contactInfo: sourceForm.contactInfo.trim(),
      address: sourceForm.address.trim(),
      color: sourceForm.color,
    };

    if (!savedSource.companyName) {
      alert("請填写来源。");
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
      const id = createId();
      setOrderSourceRecords((current) => [
        ...current,
        { id, ...savedSource },
      ]);
      setEditingSourceId(id);
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

    setEditingSourceName(savedSource.companyName);
    return finishDialogSave([waitForSources(), ...(editingSourceName && editingSourceName !== savedSource.companyName
      ? [waitForOrders()] : [])], () => setShowSourceForm(false));
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
          shortName: source.shortName || "",
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
      if (calendarSourceFilter === source.companyName) setCalendarSourceFilter("");
    });
  }

  function openCompanySeal(company: Company) {
    setSealCompany(company);
    setSealDraft(company.sealImage || "");
  }

  function saveCompanySeal() {
    if (dialogSavingRef.current) return;
    if (!sealCompany) return;
    if (sealUploadBusy) {
      alert("印章正在处理，請稍后再保存。");
      return;
    }
    if (!isCompanySealDataUrl(sealDraft)) {
      alert("印章图片无效，請重新上传。");
      return;
    }
    if (sealCompany.id.startsWith("unregistered-")) {
      if (!requireSpecificRegionForNewData()) return;
      const company = { ...sealCompany, id: createId(), sealImage: sealDraft };
      setCompanyRecords((current) => [...current, company]);
      setSealCompany(company);
      return finishDialogSave([waitForCompanies()], () => setSealCompany(null));
    }
    if (!companyRecords.some((company) => company.id === sealCompany.id)) {
      alert("所属会社已不存在，請关闭窗口后刷新重试。");
      return;
    }
    setCompanyRecords((current) => current.map((company) =>
      company.id === sealCompany.id ? { ...company, sealImage: sealDraft } : company,
    ));
    return finishDialogSave([waitForCompanies()], () => setSealCompany(null));
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
    if (dialogSavingRef.current) return;
    if (companySealBusy) {
      alert("印章正在处理，請稍后再保存。");
      return;
    }
    if (!isCompanySealDataUrl(companyForm.sealImage)) {
      alert("印章图片无效，請重新上传。");
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
      alert("請填写会社名。");
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
      const id = createId();
      setCompanyRecords((current) => [
        ...current,
        { id, ...savedCompany },
      ]);
      setEditingCompanyId(id);
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

    setEditingCompanyName(savedName);
    return finishDialogSave([waitForCompanies(), ...(editingCompanyName && editingCompanyName !== savedName
      ? [waitForOrders(), waitForVehicles()] : [])], () => setShowCompanyForm(false));
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
    if (dialogSavingRef.current) return;
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
      alert("默认停車场月費和保险月費必须为非负整数。");
      return;
    }

    if (!savedVehicle.name) {
      alert("請填写車名。");
      return;
    }

    const plateRequired =
      editingVehicleId === null && !isOutsourcedVehicle(savedVehicle.name);
    if (plateRequired && !savedVehicle.plate) {
      alert("請填写車両番号。");
      return;
    }

    if (
      savedVehicle.ownerCompany &&
      !allCompanyRecords.some((company) =>
        company.regionId === vehicleRegionId && company.name === savedVehicle.ownerCompany,
      ) &&
      savedVehicle.ownerCompany !== existingVehicle?.ownerCompany
    ) {
      alert("車両所属必须从所属会社列表中選択。");
      return;
    }

    if (
      allVehicleRecords.some(
        (vehicle) =>
          vehicle.regionId === vehicleRegionId &&
          savedVehicle.plate && vehicle.plate === savedVehicle.plate &&
          vehicle.id !== editingVehicleId,
      )
    ) {
      const duplicate = allVehicleRecords.find(
        (vehicle) =>
          vehicle.regionId === vehicleRegionId &&
          vehicle.plate === savedVehicle.plate &&
          vehicle.id !== editingVehicleId,
      );
      alert(`車両番号「${savedVehicle.plate}」已存在（車名：${duplicate?.name || "-"}），車両番号不能重复。`);
      return;
    }

    if (editingVehicleId === null) {
      const id = createId();
      setVehicleRecords((current) => [
        ...current,
        { id, ...savedVehicle },
      ]);
      setEditingVehicleId(id);
    } else {
      setVehicleRecords((current) =>
        current.map((vehicle) =>
          vehicle.id === editingVehicleId
            ? { id: vehicle.id, ...savedVehicle, calendarOrder: vehicle.calendarOrder ?? null }
            : vehicle,
        ),
      );
    }

    const previousVehicle = existingVehicle ??
      (editingVehicleName ? { id: "", name: editingVehicleName, plate: "" } : undefined);
    if (
      previousVehicle &&
      (previousVehicle.name !== savedVehicle.name || previousVehicle.plate !== savedVehicle.plate)
    ) {
      // Legacy references without a plate can only be moved when the old name was unambiguous.
      const previousNameShared = allVehicleRecords.some(
        (vehicle) =>
          vehicle.regionId === vehicleRegionId &&
          vehicle.name === previousVehicle.name &&
          vehicle.id !== previousVehicle.id,
      );
      const belongsToVehicle = (name: string, plate: string) =>
        plate
          ? Boolean(previousVehicle.plate) && plate === previousVehicle.plate
          : !previousNameShared && name === previousVehicle.name;
      setOrders((current) =>
        current.map((order) => {
          if (order.regionId !== vehicleRegionId) return order;
          let changed = false;
          const financeByDate = Object.fromEntries(
            Object.entries(order.financeByDate || {}).map(([date, finance]) => {
              if (!finance.vehicle || !belongsToVehicle(finance.vehicle, finance.vehiclePlate || "")) {
                return [date, finance];
              }
              changed = true;
              return [date, { ...finance, vehicle: savedVehicle.name, vehiclePlate: savedVehicle.plate }];
            }),
          );
          const ownsOrder = belongsToVehicle(order.vehicle, order.vehiclePlate || "");
          if (!ownsOrder && !changed) return order;
          return {
            ...order,
            ...(ownsOrder ? { vehicle: savedVehicle.name, vehiclePlate: savedVehicle.plate } : {}),
            financeByDate,
          };
        }),
      );
    }

    setEditingVehicleName(savedVehicle.name);
    return finishDialogSave([waitForVehicles(), ...(previousVehicle &&
      (previousVehicle.name !== savedVehicle.name || previousVehicle.plate !== savedVehicle.plate)
      ? [waitForOrders()] : [])], () => setShowVehicleForm(false));
  }

  function deleteVehicle(vehicle: Vehicle) {
    const isLinked = (order: Order) =>
      isUpcomingOrder(order) &&
      orderUsesVehicle(order, vehicle) &&
      (Boolean(order.vehiclePlate) || allVehicleRecords.filter(
        (record) => record.regionId === vehicle.regionId && record.name === vehicle.name,
      ).length === 1);
    const linkedOrders = orders.filter(isLinked).length;
    const linkedNotice = linkedOrders
      ? `将清空 ${linkedOrders} 笔未开始予約的車両字段；已开始或过去的予約保留原信息。`
      : "";
    requestDelete(`确定删除車両「${vehicle.plate || vehicle.name}」吗？${linkedNotice}`, () => {
      setVehicleRecords((current) =>
        current.filter((record) => record.id !== vehicle.id),
      );
      setOrders((current) =>
        current.map((order) =>
          isLinked(order)
            ? { ...order, vehicle: "", vehiclePlate: "" }
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
    if (dialogSavingRef.current) return;
    if (!requireSpecificRegionForNewData()) return;
    const lines = batchInput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!batchAddType || lines.length === 0) {
      alert("請先填写要新增的内容。");
      return;
    }

    const splitColumns = (line: string) =>
      line.split(line.includes("\\t") ? "\\t" : /[,，]/).map((value) => value.trim());

    if (batchAddType === "drivers") {
      const records = lines.map((line) => {
        const [name, phone = "", wechat = "", whatsapp = "", licenseExpiry = "", personalSlogan = "", reading = ""] = splitColumns(line);
        return { name, phone, wechat, whatsapp, licenseExpiry, personalSlogan, reading };
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
        alert("運転士不能重复，請检查批量内容。");
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
        alert("車両每行請按顺序填写：車名、車両番号、座位数（5/7/8/10）、燃油类型、車検有効期限、自賠責有効期限、備考、車両所属（后4项可选）。");
        return;
      }
      if (
        records.some(
          (record) =>
            record.ownerCompany &&
            !companyRecords.some((company) => company.name === record.ownerCompany),
        )
      ) {
        alert("車両所属必须填写所属会社列表中的名称，請检查批量内容。");
        return;
      }
      const batchRegionId = getRegionForNewRecords();
      const duplicatePlates = plates.filter((plate, index) =>
        plates.indexOf(plate) !== index ||
        allVehicleRecords.some((vehicle) => vehicle.regionId === batchRegionId && vehicle.plate === plate),
      );
      if (duplicatePlates.length > 0) {
        alert(`車両番号不能重复：${[...new Set(duplicatePlates)].join("、")}`);
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
        alert("来源不能重复，請检查批量内容。");
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
        alert("所属会社名称不能重复，請检查批量内容。");
        return;
      }
      setCompanyRecords((current) => [
        ...current,
        ...records.map((record) => ({ id: createId(), ...record })),
      ]);
    }

    const waitForBatch = { drivers: waitForDrivers, vehicles: waitForVehicles,
      sources: waitForSources, companies: waitForCompanies }[batchAddType];
    return finishDialogSave([waitForBatch()], () => {
      setBatchInput("");
      setBatchAddType(null);
    });
  }

  function openEditOrder(order: Order) {
    setEditingOrderId(order.id);

    setForm({
      regionId: order.regionId,
      importBatchId: order.importBatchId,
      importBatchIndex: order.importBatchIndex,
      ...((order.endDate || order.date) === order.date ? getServiceVehicle(order, order.date)
        : { vehicle: order.vehicle, vehiclePlate: order.vehiclePlate || "" }),
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
      financeByDate: getReservationFinance(order),
    });
    setOffDateInput("");

    setCustomCompanyMode(
      Boolean(order.company) &&
        !companies.includes(order.company),
    );

    setShowForm(true);
  }

  function openAccounting(order: Order) {
    const batchOrders = getAccountingBatchOrders(order, allOrders);
    const form: Record<string, OrderFinance> = {};
    for (const batchOrder of batchOrders) {
      const dates = [
        ...new Set([
          ...getOrderDateKeys(batchOrder),
          ...Object.keys(batchOrder.financeByDate || {}),
        ]),
      ].sort();
      if (dates.length === 0 || dates.length > 3660) {
        alert("单笔訂単财务明細最多支持 3660 个日历日。");
        return;
      }
      const orderForm = Object.fromEntries(
        dates.map((date) => [
          date,
          initializeAccountingFinance(
            batchOrder.financeByDate?.[date] || {
              ...emptyOrderFinance,
              driver: batchOrder.driver,
              vehicle: batchOrder.vehicle,
              vehiclePlate: batchOrder.vehiclePlate || "",
            },
          ),
        ]),
      );
      // Legacy orders only stored a whole-order price; keep it by assigning it to the first day.
      if (batchOrder.orderPrice > 0 && !hasDailyFares(orderForm)) {
        const firstDate = orderForm[batchOrder.date] ? batchOrder.date : dates[0];
        orderForm[firstDate] = { ...orderForm[firstDate], dailyFare: batchOrder.orderPrice };
      }
      for (const [date, finance] of Object.entries(orderForm)) {
        form[toAccountingKey(batchOrder.id, date)] = finance;
      }
    }
    setAccountingPreviewOrder(order);
    setAccountingBatchOrders(batchOrders);
    setAccountingOrderMeta(
      Object.fromEntries(
        batchOrders.map((batchOrder) => [
          batchOrder.id,
          {
            orderSource: batchOrder.orderSource || order.orderSource || "",
            company: batchOrder.company || order.company || "",
            status: batchOrder.status,
          },
        ]),
      ),
    );
    setAccountingForm(form);
    setAccountingStatus(order.accountingStatus || "未完成");
    setAccountingInvoiceStatus(order.invoiceStatus);
    setAccountingInvoiceSentDate(order.invoiceSentDate);
    setAccountingDepositMethod(order.depositMethod || "");
    setAccountingDepositDate(order.depositDate || "");
    setAccountingAssignee(order.accountingAssignee || "");
    setAccountingFinanceNote(order.financeNote || "");
  }

  function saveAccounting() {
    if (dialogSavingRef.current) return;
    if (!accountingPreviewOrder) return;

    const financeByOrder = new Map<string, Order["financeByDate"]>(
      accountingBatchOrders.map((batchOrder) => [batchOrder.id, {}]),
    );
    for (const [key, finance] of Object.entries(accountingForm)) {
      const { orderId, date } = parseAccountingKey(key);
      const orderFinance = financeByOrder.get(orderId);
      if (!orderFinance) continue;
      orderFinance[date] = {
        ...finance,
        tripSummary: finance.tripSummary.trim(),
        driverOvertimeFee: getDriverOvertimeFee(finance),
        overtimeRequestAmount: getOvertimeRequestAmount(finance),
      };
    }
    const validOrderPrice = [...financeByOrder.values()].every((financeByDate) => {
      const orderPrice = sumDailyFares(financeByDate);
      return Number.isSafeInteger(orderPrice) &&
        orderPrice >= 0 &&
        orderPrice <= 99_999_999_999_999;
    });
    const validFinance = Object.values(accountingForm).every((finance) => {
      const validAmounts = (Object.keys(emptyOrderFinance) as (keyof OrderFinance)[])
      .filter((key) =>
        key !== "fuelConsumption" &&
        key !== "driverOvertimeHours" &&
        key !== "driverWageMode" &&
        key !== "driverWagePercentage" &&
        key !== "driverPaymentType" &&
        key !== "companyAdvancePaymentMethod" &&
        key !== "companyAdvancePaymentStatus" &&
        key !== "companyAdvancePaymentNote" &&
        key !== "driver" &&
        key !== "vehicle" &&
        key !== "vehiclePlate" &&
        key !== "tripSummary",
      )
        .every((key) => {
          const amount = key === "overtimeRequestRate"
            ? finance.overtimeRequestRate ?? 0
            : key === "overtimeRequestAmount"
            ? getOvertimeRequestAmount(finance)
            : finance[key];
          return typeof amount === "number" && Number.isSafeInteger(amount) &&
            amount >= 0 &&
            amount <= 99_999_999_999_999;
        });
      const fuelConsumption = finance.fuelConsumption;
      const driverOvertimeHours = finance.driverOvertimeHours;
      return validAmounts && hasValidDriverPayment(finance) &&
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
        Number.isSafeInteger(getOvertimeRequestAmount(finance)) &&
        getOvertimeRequestAmount(finance) <= 99_999_999_999_999 &&
        finance.tripSummary.length <= 1000 &&
        (finance.companyAdvancePaymentNote || "").length <= 1000 &&
        ["", "已完成", "未完成"].includes(finance.companyAdvancePaymentStatus || "") &&
        calculateOrderFinance(finance).driverWages <= 99_999_999_999_999;
    });
    if (!validOrderPrice || !validFinance) {
      alert("日元金額請输入不超过 99,999,999,999,999 的非负整数，燃油消耗和超時時間最多填写两位小数，超時计算金額不得超出限额，行程簡概及出金备注最多 1000 字，出金状態须为有效选项。");
      return;
    }

    const orderId = accountingPreviewOrder.id;
    setOrders((currentOrders) =>
      currentOrders.map((order) => {
        const financeByDate = financeByOrder.get(order.id);
        if (!financeByDate) return order;
        const meta = accountingOrderMeta[order.id];
        const updated: Order = {
          ...order,
          ...((order.endDate || order.date) === order.date
            ? getServiceVehicle({ ...order, financeByDate }, order.date) : {}),
          orderSource: meta ? meta.orderSource.trim() : order.orderSource,
          company: meta ? meta.company.trim() : order.company,
          status: meta?.status ?? order.status,
          orderPrice: sumDailyFares(financeByDate),
          financeByDate,
        };
        return order.id === orderId
          ? {
              ...updated,
              accountingStatus,
              invoiceStatus: accountingInvoiceStatus,
              invoiceSentDate: accountingInvoiceSentDate,
              depositMethod: accountingDepositMethod,
              depositDate: accountingDepositDate,
              accountingAssignee: accountingAssignee.trim(),
              financeNote: accountingFinanceNote.trim(),
            }
          : updated;
      }),
    );
    return finishDialogSave([waitForOrders()], () => setAccountingPreviewOrder(null));
  }

  function closeForm() {
    setDriverSelectionTarget(null);
    setShowForm(false);
    setDriverSelectionTarget(null);
    setEditingOrderId(null);
    setPendingOrderConflicts([]);
    setOffDateInput("");
    setCustomCompanyMode(false);
  }

  function addOrder(skipConflictCheck = false) {
    if (dialogSavingRef.current) return;
    if (editingOrderId !== null && !orders.some((order) => order.id === editingOrderId)) {
      alert("预约已删除，請关闭窗口后重新操作。");
      return;
    }
    const targetRegionId = editingOrderId === null
      ? getRegionForNewRecords()
      : form.regionId;
    if (editingOrderId === null && !targetRegionId) {
      requireSpecificRegionForNewData();
      return;
    }
    const formVehicle = resolveOrderVehicle(orderFormVehicles, { ...form, regionId: targetRegionId ?? undefined });
    if (
      !formVehicle &&
      orderFormVehicles.filter((vehicle) => vehicle.name === form.vehicle).length > 1
    ) {
      alert(`車名「${form.vehicle}」有多台車両，請選択具体的車両番号。`);
      return;
    }
    if (
      editingOrderId === null &&
      (!formVehicle || getVehicleDisplayStatus(formVehicle) !== "运营中")
    ) {
      alert(`車両「${form.vehicle}」当前不可用，不能新增予約。`);
      return;
    }

    if (!form.customer.trim()) {
      alert("請填写訂単名称。");
      return;
    }


    if (getOrderDateKeys(form).length === 0 ||
      !Number.isSafeInteger(form.orderPrice) || form.orderPrice < 0 ||
      form.orderPrice > 99_999_999_999_999 ||
      !Object.values(form.financeByDate).every((finance) =>
        Number.isSafeInteger(finance.dailyFare) && finance.dailyFare >= 0 &&
        finance.dailyFare <= 99_999_999_999_999 && finance.tripSummary.length <= 1000 &&
        [finance.driverWage, finance.companyAdvanceCompanyReport, finance.externalDriverFee ?? 0].every(amount =>
          Number.isSafeInteger(amount) && amount >= 0 && amount <= 99_999_999_999_999) &&
        (finance.companyAdvancePaymentNote || "").length <= 1000 && hasValidDriverPayment(finance),
      )) {
      alert("車費、運転士工資、会社立替及外注運転士費用须为不超过 99,999,999,999,999 的非负日元整数；運転士工資与外注費用须按費用类型選択。行程簡概及外注運転士备注最多1000字，预约最多3660个日历日。");
      return;
    }
    const savedForm: OrderDraft = {
      ...form,
      vehiclePlate: formVehicle ? formVehicle.plate : form.vehiclePlate,
      financeByDate: form.financeByDate,
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
      const id = createId();
      setOrders((currentOrders) => [
        ...currentOrders,
        { id, ...savedForm },
      ]);
      setEditingOrderId(id);
    } else {
      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.id === editingOrderId
            ? { id: order.id, ...savedForm }
            : order,
        ),
      );
    }

    return finishDialogSave([waitForOrders()], closeForm);
  }

  function requestOrderDeletion(order: Order) {
    requestDelete(
      `确定永久删除予約「${order.customer || order.id}」吗？此操作会一并清除财务、派单、执行記録及相关小票，且无法恢复。`,
      async () => {
        setOrders((currentOrders) =>
          currentOrders.filter((currentOrder) => currentOrder.id !== order.id),
        );
        if (!(await waitForOrders())) {
          throw new Error("訂単删除未获服务器确认。請检查保存错误并重新载入核对数据。");
        }
        closeForm();
      },
    );
  }

  function deleteOrder() {
    if (editingOrderId === null) return;
    const order = orders.find((currentOrder) => currentOrder.id === editingOrderId);
    if (order) requestOrderDeletion(order);
  }

  async function signOut() {
    try {
      const supabase = createSupabaseClient();
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
      router.replace("/login");
    } catch (error) {
      console.error("Failed to sign out.", error);
      setPersistenceError(
        error instanceof Error ? error.message : "退出登录失败，請重试。",
      );
    }
  }

  if (!isDataReady) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
        <div className="w-full max-w-lg rounded-xl border bg-white p-6 text-center shadow-sm">
          {dataLoadError ? (
            <>
              <h1 className="text-lg font-bold text-rose-800">无法载入業務数据</h1>
              <p role="alert" className="mt-2 text-sm text-gray-700">{dataLoadError}</p>
              <p className="mt-2 text-sm text-gray-600">
                請检查 Supabase 环境变量、数据库迁移和当前账号的激活状態。
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
          当前账号没有用户資料。請联系系统管理员。
        </p>
      </main>
    );
  }

  const accountingTotals = accountingPreviewOrder
    ? summarizeFinanceEntries(Object.values(accountingForm))
    : null;
  const accountingOrderPrice = sumDailyFares(accountingForm);
  const primaryAccountingForm: Record<string, OrderFinance> = accountingPreviewOrder
    ? Object.fromEntries(
        Object.entries(accountingForm).flatMap(([key, finance]) => {
          const { orderId, date } = parseAccountingKey(key);
          return orderId === accountingPreviewOrder.id ? [[date, finance] as const] : [];
        }),
      )
    : {};
  const primaryAccountingOrderPrice = sumDailyFares(primaryAccountingForm);
  const isAccountingBatch = accountingBatchOrders.length > 1;
  const accountingSourceOptions = accountingPreviewOrder
    ? allOrderSourceRecords
        .filter((source) => source.regionId === accountingPreviewOrder.regionId)
        .map((source) => source.companyName)
    : [];
  const accountingCompanyOptions = accountingPreviewOrder
    ? allCompanyRecords
        .filter((company) => company.regionId === accountingPreviewOrder.regionId)
        .map((company) => company.name)
    : [];
  function updateAccountingFinance(key: string, patch: Partial<OrderFinance>) {
    if (patch.driver !== undefined) {
      void saveAccountingDrivers([key], patch.driver, true);
      return;
    }
    setAccountingForm((current) => ({
      ...current,
      [key]: { ...(current[key] || emptyOrderFinance), ...patch },
    }));
  }
  async function saveAccountingDrivers(keys: string[], name: string, syncPaymentType = false) {
    if (dialogSavingRef.current) return;
    const targets = keys.map(key => ({ key, ...parseAccountingKey(key) }));
    if (targets.some(({ orderId, date }) => !allOrders.some(order => order.id === orderId &&
      getOrderDateKeys(order).includes(date)))) {
      alert("訂単或用車日期已变化，請关闭财务窗口后重新打开。");
      return;
    }
    if (targets.some(({ key, orderId, date }) => accountingForm[key]?.driverPaymentType !==
      allOrders.find(order => order.id === orderId)?.financeByDate[date]?.driverPaymentType)) {
      alert("費用类型尚未保存，請先保存财务数据后再選任運転士；未保存的金額不会自動提交。");
      return;
    }
    if (targets.some(({ key, orderId, date }) => {
      const order = allOrders.find(order => order.id === orderId);
      if (!order) return false;
      const finance = order.financeByDate[date];
      return finance?.driverPaymentType === "company_advance" &&
        [finance, accountingForm[key]].some(entry => entry &&
          (withCompanyAdvanceDriver(entry, name).companyAdvancePaymentNote || "").length > 1000);
    })) {
      alert("運転士姓名加入后外注運転士备注超过1000字，請先缩短备注再選任。");
      return;
    }
    setOrders(current => current.map(order => {
      const days = targets.filter(target => target.orderId === order.id);
      if (!days.length) return order;
      const financeByDate = getReservationFinance(order);
      for (const { date } of days) {
        const finance = financeByDate[date] || { ...emptyOrderFinance,
          driver: order.driver, vehicle: order.vehicle, vehiclePlate: order.vehiclePlate };
        financeByDate[date] = syncPaymentType
          ? setReservationDriverPayment({ ...finance, driver: name }, name ? "wage" : "company_advance", name)
          : finance.driverPaymentType === "company_advance"
            ? withCompanyAdvanceDriver(finance, name)
            : { ...finance, driver: name };
      }
      return { ...order, financeByDate };
    }));
    await finishDialogSave([waitForOrders()], () => {
      setAccountingForm(current => Object.fromEntries(Object.entries(current).map(([key, finance]) => {
        if (!keys.includes(key)) return [key, finance];
        return [key, syncPaymentType
          ? setReservationDriverPayment({ ...finance, driver: name }, name ? "wage" : "company_advance", name)
          : finance.driverPaymentType === "company_advance"
            ? withCompanyAdvanceDriver(finance, name)
            : { ...finance, driver: name }];
      })));
    });
  }
  const accountingMixedValue = "__mixed__";
  const accountingBatchDriverOptions = accountingPreviewOrder
    ? [...new Set(allDriverRecords
        .filter((driver) => driver.regionId === accountingPreviewOrder.regionId)
        .map((driver) => driver.name))]
        .sort((first, second) => first.localeCompare(second, "ja"))
    : [];
  const accountingBatchStatusOptions: Order["status"][] = [
    "仮予約",
    "予約確定",
    "キャンセル",
  ];
  const getCommonValue = (values: string[]) =>
    values.length > 0 && values.every((value) => value === values[0]) ? values[0] : null;
  const accountingBatchCommon = {
    driver: getCommonValue(Object.values(accountingForm).map((finance) => finance.driver)),
    orderSource: getCommonValue(Object.values(accountingOrderMeta).map((meta) => meta.orderSource)),
    company: getCommonValue(Object.values(accountingOrderMeta).map((meta) => meta.company)),
    status: getCommonValue(Object.values(accountingOrderMeta).map((meta) => meta.status)),
  };
  function applyAccountingBatchValue(
    field: "driver" | "orderSource" | "company" | "status",
    value: string,
  ) {
    if (value === accountingMixedValue) return;
    if (field === "driver") {
      void saveAccountingDrivers(Object.keys(accountingForm), value);
      return;
    }
    if (field === "status") {
      const status = accountingBatchStatusOptions.find((option) => option === value);
      if (!status) return;
      setAccountingOrderMeta((current) =>
        Object.fromEntries(
          Object.entries(current).map(([entryOrderId, meta]) => [
            entryOrderId,
            { ...meta, status },
          ]),
        ),
      );
      return;
    }
    setAccountingOrderMeta((current) =>
      Object.fromEntries(
        Object.entries(current).map(([entryOrderId, meta]) => [entryOrderId, { ...meta, [field]: value }]),
      ),
    );
  }
  function updateAccountingOrderMeta(
    orderId: string,
    field: "orderSource" | "company",
    value: string,
  ) {
    setAccountingOrderMeta((current) => ({
      ...current,
      [orderId]: { ...(current[orderId] ?? { orderSource: "", company: "" }), [field]: value },
    }));
  }
  function orderHasStatus(order: Order, kind: "invoice" | "deposit", status: Order["invoiceStatus"] | "paid" | "unpaid") {
    return kind === "invoice"
      ? order.invoiceStatus === status
      : Boolean(order.depositDate) === (status === "paid");
  }
  async function changeOrderStatus(
    targetOrders: Order[],
    kind: "invoice" | "deposit",
    status: Order["invoiceStatus"] | "paid" | "unpaid",
  ) {
    const ids = [...new Set(targetOrders.map((order) => order.id))];
    if (!ids.length || dialogSavingRef.current || ids.some((id) => invoiceStatusSavingIdsRef.current.has(id))) return false;

    const nextSavingIds = new Set(invoiceStatusSavingIdsRef.current);
    ids.forEach((id) => nextSavingIds.add(id));
    invoiceStatusSavingIdsRef.current = nextSavingIds;
    setInvoiceStatusSavingIds(nextSavingIds);
    try {
      if (!(await waitForOrders())) {
        alert("訂単有未确认的保存，請先检查页面顶部的保存错误并重新载入核对。");
        return false;
      }

      const targetIds = new Set(ids);
      setOrders((current) => current.map((order) =>
        targetIds.has(order.id) && !orderHasStatus(order, kind, status)
          ? kind === "invoice"
            ? { ...order, invoiceStatus: status as Order["invoiceStatus"] }
            : { ...order, depositDate: status === "paid" ? order.depositDate || todayDateKey : "" }
          : order,
      ));
      if (!(await waitForOrders())) {
        alert("状態保存未获服务器确认，請检查页面顶部的保存错误并重新载入核对。");
        return false;
      }
      return true;
    } finally {
      const remaining = new Set(invoiceStatusSavingIdsRef.current);
      ids.forEach((id) => remaining.delete(id));
      invoiceStatusSavingIdsRef.current = remaining;
      setInvoiceStatusSavingIds(remaining);
    }
  }
  function openOrderStatusDialog(
    order: Order,
    kind: "invoice" | "deposit",
    origin: "reservation" | "finance" | "finance-batch",
    nextStatus?: Order["invoiceStatus"] | "paid" | "unpaid",
  ) {
    setInvoiceStatusDialog({
      orderId: order.id,
      kind,
      status: nextStatus ?? (kind === "invoice"
        ? order.invoiceStatus === "已完成" ? "未完成" : "已完成"
        : order.depositDate ? "unpaid" : "paid"),
      scope: "single",
      origin,
      month: origin === "reservation" ? orderMonth : financeMonth,
    });
  }
  async function saveInvoiceStatusDialog() {
    const dialog = invoiceStatusDialog;
    if (!dialog) return;
    const order = orders.find((candidate) => candidate.id === dialog.orderId);
    if (!order) {
      alert("訂単已不存在，請刷新后重试。");
      setInvoiceStatusDialog(null);
      return;
    }

    const ordersInDialogMonth = orders.filter((candidate) =>
      candidate.date <= `${dialog.month}-31` &&
      (candidate.endDate || candidate.date) >= `${dialog.month}-01`,
    );
    const targetOrders = dialog.scope === "source"
      ? getMonthlySameSourceOrders(ordersInDialogMonth, order, dialog.month)
      : (dialog.origin === "reservation" || dialog.origin === "finance-batch") && order.importBatchId
        ? getAccountingBatchOrders(order, ordersInDialogMonth)
        : [order];
    const changedOrders = targetOrders.filter((candidate) =>
      !orderHasStatus(candidate, dialog.kind, dialog.status),
    );
    if (!changedOrders.length) {
      setInvoiceStatusDialog(null);
      return;
    }
    try {
      if (await changeOrderStatus(changedOrders, dialog.kind, dialog.status)) {
        setInvoiceStatusDialog(null);
      }
    } catch (error) {
      console.error("Failed to update invoice status.", error);
      const message = error instanceof Error ? error.message : "无法确认請求書状態保存结果。";
      setPersistenceError(message);
      alert("請求書状態保存失败，請检查页面顶部的保存错误并重新载入核对。");
    }
  }
  const canViewVehicleAndBalanceReports =
      currentProfile.role === "admin";
  const invoiceStatusDialogOrder = invoiceStatusDialog
    ? orders.find((order) => order.id === invoiceStatusDialog.orderId) ?? null
    : null;
  const invoiceStatusDialogContext = invoiceStatusDialog && invoiceStatusDialogOrder
    ? invoiceStatusDialog
    : null;
  const invoiceStatusDialogMonth = invoiceStatusDialogContext?.month ?? orderMonth;
  const invoiceStatusDialogSingleTargets = invoiceStatusDialogOrder
    ? (invoiceStatusDialogContext?.origin === "reservation" ||
      invoiceStatusDialogContext?.origin === "finance-batch") && invoiceStatusDialogOrder.importBatchId
      ? getAccountingBatchOrders(invoiceStatusDialogOrder, orders.filter((candidate) =>
        candidate.date <= `${invoiceStatusDialogMonth}-31` &&
        (candidate.endDate || candidate.date) >= `${invoiceStatusDialogMonth}-01`,
      ))
      : [invoiceStatusDialogOrder]
    : [];
  const invoiceStatusDialogSourceTargets = invoiceStatusDialogOrder
    ? getMonthlySameSourceOrders(
      orders.filter((candidate) =>
        candidate.date <= `${invoiceStatusDialogMonth}-31` &&
        (candidate.endDate || candidate.date) >= `${invoiceStatusDialogMonth}-01`,
      ),
      invoiceStatusDialogOrder,
      invoiceStatusDialogMonth,
    )
    : [];
  const invoiceStatusDialogTargets = invoiceStatusDialogContext
    ? invoiceStatusDialogContext.scope === "source"
      ? invoiceStatusDialogSourceTargets
      : invoiceStatusDialogSingleTargets
    : [];
  const invoiceStatusDialogChangedCount = invoiceStatusDialogContext
    ? invoiceStatusDialogTargets.filter((order) =>
      !orderHasStatus(order, invoiceStatusDialogContext.kind, invoiceStatusDialogContext.status),
    ).length
    : 0;
  const isInvoiceStatusDialogSaving = invoiceStatusDialogTargets.some(
    (order) => invoiceStatusSavingIds.has(order.id),
  );

  return (
    <main className={`dashboard min-h-screen bg-gray-100 text-gray-900${activeView === "calendar" ? " mobile-calendar-view" : ""}`}>
      {dialogSaving && <div role="status" aria-live="polite" aria-busy="true"
        className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
        <p className="rounded-lg bg-white px-6 py-4 font-semibold shadow-xl">正在保存，請稍候…</p>
      </div>}
      <div className="contents" inert={dialogSaving}>
      {/* 顶部 */}
      <header className="dashboard-header flex flex-wrap items-center justify-between gap-3 bg-slate-900 px-4 py-2 text-white sm:px-6 sm:py-2">
        <div>
          <h1 className="text-xl font-bold">ハイヤー配車管理</h1>
        </div>

        <div className="dashboard-actions flex flex-wrap items-center gap-2 sm:gap-3">
          {currentProfile.role === "admin" && (
            <label className="calendar-region-selector flex items-center gap-2 text-sm font-medium">
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
                  setDriverWageItemDrafts([]);
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
                className="max-w-36 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-white"
              >
                <option value={ALL_REGIONS_ID}>全部地域</option>
                {regions.map((region) => (
                  <option key={region.id} value={region.id}>{region.name}</option>
                ))}
              </select>
            </label>
          )}
          {activeView === "calendar" && (
            <label className="calendar-quick-date flex items-center gap-1 text-sm">
              <span>日期</span>
              <input
                type="date"
                aria-label="日历快速查询日期"
                value={calendarQueryDate}
                className="min-w-0 rounded border border-slate-500 bg-slate-800 px-2 py-1 text-white"
                onChange={(event) => {
                  const dateKey = event.target.value;
                  setCalendarQueryDate(dateKey);
                  if (!dateKey) return;
                  const [year, month, day] = dateKey.split("-").map(Number);
                  const selectedDate = new Date(year, month - 1, day);
                  if (isMobileCalendar) {
                    calendarQueryDateRef.current = dateKey;
                    calendarTodayRequestedRef.current = true;
                    calendarAnchorRef.current = null;
                    setMobileCalendarFirstMonth(new Date(year, month - 3, 1));
                    setCalendarTodayRequest((request) => request + 1);
                  } else {
                    setCalendarCenterDate(selectedDate);
                  }
                }}
              />
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
            className="rounded border border-slate-500 px-3 py-1 text-sm font-semibold hover:bg-slate-800"
          >
            退出
          </button>
          <button
            type="button"
            onClick={openBatchOrderImport}
            disabled={activeRegionId === ALL_REGIONS_ID || availableVehicleRecords.length === 0}
            className="rounded-lg border border-blue-300 px-4 py-1 text-sm font-bold text-blue-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            批量导入
          </button>
          <button
            onClick={() => openNewOrder(availableVehicleRecords[0], toDateKey(calendarCenterDate))}
            disabled={activeRegionId === ALL_REGIONS_ID || availableVehicleRecords.length === 0}
            className="rounded-lg bg-blue-600 px-5 py-1 font-bold hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ＋ 新建訂単
          </button>
        </div>
      </header>

      {driverExecution.error && <p role="alert" className="mx-4 my-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{driverExecution.error}</p>}
      {persistenceError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <span>保存错误：{persistenceError} 本地显示可能尚未同步到服务器，請重新载入后核对数据。</span>
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
          車両月度費用功能尚未启用：請数据库管理员应用
          {" "}
          <code>supabase/migrations/20261018000000_vehicle_monthly_finance.sql</code>
          {" "}后再录入月度費用或車両固定月費；其余業務数据已正常载入。
        </p>
      )}
      {balanceExpensesMigrationPending && (
        <p role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          收支平衡支出项目尚未启用：請数据库管理员应用
          {" "}
          <code>supabase/migrations/20261019000000_balance_expenses.sql</code>
          {" "}后再新增项目或保存金額；其余業務数据已正常载入。
        </p>
      )}
      {driverWageItemsMigrationPending && (
        <p role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          運転士工資手動项目尚未启用：請数据库管理员应用
          {" "}
          <code>supabase/migrations/20261103000000_driver_wage_items.sql</code>
          {" "}后再录入；其余業務数据已正常载入。
        </p>
      )}
      {pendingSaveCount > 0 && !persistenceError && (
        <p role="status" className="border-b bg-blue-50 px-4 py-2 text-sm text-blue-900">
          正在保存到服务器…
        </p>
      )}

      <div className="dashboard-layout flex min-h-[calc(100vh-76px)] flex-col lg:flex-row">
        <aside className="dashboard-sidebar w-full min-w-0 shrink-0 border-b bg-white p-3 lg:w-[220px] lg:border-b-0 lg:border-r lg:border-slate-200 lg:p-4">
          <p className="mb-3 flex items-center gap-2 px-3 text-xs font-semibold tracking-wide text-slate-500">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            工作台
            <span className="ml-auto hidden text-[9px] font-medium tracking-[0.18em] text-slate-300 lg:inline">MENU</span>
          </p>
          <nav aria-label="主菜单" className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-4">
            {[
              {
                label: "業務",
                surface: "bg-sky-50/80 ring-sky-100",
                heading: "text-sky-700",
                items: [
                  { id: "calendar", label: "カレンダー", icon: "calendar" },
                  { id: "orders", label: "予約管理", icon: "orders" },
                  { id: "operations", label: "運行管理", icon: "operations" },
                ],
              },
              {
                label: "管理",
                surface: "bg-emerald-50/70 ring-emerald-100",
                heading: "text-emerald-700",
                items: [
                  { id: "drivers", label: "運転士", icon: "driver" },
                  { id: "vehicles", label: "車両", icon: "vehicle" },
                  { id: "sources", label: "来源", icon: "source" },
                  { id: "companies", label: "所属会社", icon: "company" },
                ],
              },
              {
                label: "財務・統計",
                surface: "bg-amber-50/70 ring-amber-100",
                heading: "text-amber-700",
                items: [
                  { id: "orderFinance", label: "経理統計", icon: "finance" },
                  { id: "driverFinance", label: "給料統計", icon: "salary" },
                  ...(canViewVehicleAndBalanceReports
                    ? [
                        { id: "vehicleFinance" as const, label: "車両統計", icon: "vehicleFinance" },
                        { id: "balance" as const, label: "收支平衡", icon: "balance" },
                      ]
                    : []),
                ],
              },
              ...(currentProfile.role === "admin"
                ? [{
                    label: "システム",
                  surface: "bg-violet-50/70 ring-violet-100",
                  heading: "text-violet-700",
                    items: [
                      { id: "login" as const, label: "ログイン管理", icon: "login" },
                      { id: "audit" as const, label: "操作記録", icon: "audit" },
                    ],
                  }]
                : []),
            ].map((group) => (
              <div key={group.label} className={`flex shrink-0 items-center gap-1 rounded-xl p-1.5 ring-1 ring-inset ${group.surface} border-r border-slate-200 pr-2 last:border-r-0 last:pr-0 lg:w-full lg:flex-col lg:items-stretch lg:gap-1 lg:border-r-0 lg:border-b-0 lg:p-2 lg:last:pb-2`}>
                <p className={`hidden px-3 pb-1 text-[10px] font-semibold tracking-widest lg:block ${group.heading}`}>
                  {group.label}
                </p>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (item.id === "orders" && activeView !== "orders") {
                        setOrderMonth(getCurrentMonthKey());
                        setOrderDateFilter("");
                        setOrderSourceFilter("");
                        setOrderCompanyFilter("");
                      }
                      setActiveView(item.id as ActiveView);
                    }}
                    aria-current={activeView === item.id ? "page" : undefined}
                    className={`group flex min-h-11 w-full shrink-0 items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${activeView === item.id ? "bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-[0_6px_16px_rgba(15,23,42,0.16)]" : "text-slate-600 hover:translate-x-0.5 hover:bg-slate-100 hover:text-slate-950"}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${activeView === item.id ? "bg-white/10 text-blue-100" : "text-slate-400 group-hover:text-slate-700"}`}
                    >
                      <SidebarIcon name={item.icon} />
                    </span>
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </aside>

        <section className="workspace-content min-w-0 flex-1">
          {activeView === "operations" && <OperationsReports key={activeRegionId}
            region={activeRegionId === ALL_REGIONS_ID ? "" : activeRegionId} />}
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
                账号由管理员直接创建并设置初始密码，无需邮件邀請。普通用户只能管理所属地域的数据；管理员可以查看并管理全部地域。
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
                      <option value="">選択会社</option>
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
                      <option value="">選択职位</option>
                      {loginAccountForm.position &&
                        !LOGIN_ACCOUNT_POSITIONS.some(
                          (position) => position === loginAccountForm.position,
                        ) && (
                          <option value={loginAccountForm.position}>
                            {loginAccountForm.position}（現有职位）
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
                      <option value="">選択地域</option>
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
                    <div className="rounded border bg-slate-50 p-3 sm:col-span-2 xl:col-span-3">
                      <p className="mb-2 text-sm text-gray-600">
                        {editingLoginAccountId === null
                          ? "设置初始登录密码（8 至 128 个字符），請通过安全方式告知用户。"
                          : "如需重设密码，請填写两次并单独点击“设置新密码”。仅保存資料不会修改密码；设置密码会同時确认该用户邮箱。"}
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
                  <div className="flex items-end">
                    <button type="submit" disabled={accountBusy} className="w-full rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">
                      {accountBusy ? "正在处理…" : editingLoginAccountId === null
                        ? "创建账号"
                        : "保存資料"}
                    </button>
                  </div>
                  </fieldset>
                </form>
              )}
              <div className="overflow-x-auto border bg-white">
                <table className="management-table w-full min-w-[1250px] table-fixed text-center text-sm" data-table="accounts">
                  <colgroup>
                    <col style={{ width: "10%" }} /><col style={{ width: "22%" }} />
                    <col style={{ width: "26%" }} /><col style={{ width: "6%" }} />
                    <col style={{ width: "6%" }} /><col style={{ width: "9%" }} />
                    <col style={{ width: "9%" }} /><col style={{ width: "12%" }} />
                  </colgroup>
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">用户姓名</th>
                      <th className="px-4 py-3 font-semibold">登录邮箱</th>
                      <th className="px-4 py-3 font-semibold">所属会社</th>
                      <th className="px-4 py-3 font-semibold">职位</th>
                      <th className="px-4 py-3 font-semibold">地域</th>
                      <th className="px-4 py-3 font-semibold">账号状態</th>
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
                      <tr key={account.id} className="border-t transition-colors hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium">{account.fullName}</td>
                        <td className="px-4 py-3">{account.email}</td>
                        <td className="px-4 py-3">{account.company}</td>
                        <td className="px-4 py-3">{account.position}</td>
                        <td className="px-4 py-3">{regionNameById.get(account.regionId) || "未知地域"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex min-h-7 items-center justify-center rounded-full px-3 text-xs font-medium ${account.emailConfirmed
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
                            : "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200"}`}>
                            {account.emailConfirmed ? "已激活" : "待激活"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex min-h-7 items-center justify-center rounded-full px-3 text-xs font-medium ${account.role === "admin"
                            ? "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200"
                            : "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200"}`}>
                            {account.role === "admin" ? "管理员" : "普通用户"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="list-action-buttons">
                            <div className="driver-action-slot">
                              <button type="button" disabled={accountBusy} onClick={() => openLoginAccountForm(account)} className="table-action-button table-action-button--edit driver-action-button">编辑</button>
                            </div>
                            <div className="driver-action-slot">
                              <button type="button" disabled={accountBusy || account.id === currentProfile.id} onClick={() => deleteLoginAccount(account)} className="table-action-button table-action-button--delete driver-action-button" title={account.id === currentProfile.id ? "不能删除当前账号" : undefined}>删除</button>
                            </div>
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
            <OrderFinanceReviewProvider key={`${financeMonth}-${activeRegionId}`} month={financeMonth}
              enabled={currentProfile.role === "admin"} blocked={pendingSaveCount > 0 || Boolean(persistenceError)}
              onApproved={refreshApprovedOrderFinance}>
            <FinanceSummaryPanel
              title="経理統計"
              month={financeMonth}
              onMonthChange={setFinanceMonth}
              headerActions={
                <button
                  type="button"
                  onClick={exportOrderFinance}
                  className="table-action-button table-action-button--export"
                >
                  导出财务表（A4）
                </button>
              }
              trailingHeaderActions={
                <>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
                    来源
                    <button
                      type="button"
                      onClick={() => setSourceSelectionOpen("finance-filter")}
                      title={financeSourceFilter || undefined}
                      className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
                    >
                      {financeSourceFilter === ""
                        ? "全部来源"
                        : financeSourceFilter === UNSOURCED_ORDER
                          ? "未填写"
                          : getSourceDisplayName(financeSourceFilter, activeRegionId === ALL_REGIONS_ID ? undefined : activeRegionId)}
                      {" · 点击選択"}
                    </button>
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
                    所属会社
                    <select
                      value={financeCompanyFilter}
                      onChange={(event) => setFinanceCompanyFilter(event.target.value)}
                      className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
                    >
                      <option value="">全部会社</option>
                      {companyRows.map((company) => (
                        <option key={company.id} value={company.name}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
                    請求書状態
                    <select
                      value={financeInvoiceStatusFilter}
                      onChange={(event) => setFinanceInvoiceStatusFilter(event.target.value)}
                      className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
                    >
                      <option value="">全部状態</option>
                      <option value="未完成">未完成</option>
                      <option value="已完成">已完成</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
                    入金状態
                    <select
                      value={financeDepositStatusFilter}
                      onChange={(event) => setFinanceDepositStatusFilter(event.target.value)}
                      className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
                    >
                      <option value="">全部状態</option>
                      <option value="paid">入金済み</option>
                      <option value="unpaid">未入金</option>
                    </select>
                  </label>
                </>
              }
            >
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-4">
                  <p className="text-sm font-semibold text-blue-800">総請求金額</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-blue-950">
                    {formatYen(filteredFinanceTotals.requestAmount)}
                  </p>
                  <dl className="mt-3 space-y-1 border-t border-blue-200 pt-2 text-sm text-blue-950">
                    {([
                      ["口座入金", filteredFinanceRequestAmounts.bank],
                      ["現金入金", filteredFinanceRequestAmounts.cash],
                      ["未设置入金方式", filteredFinanceRequestAmounts.unassigned],
                    ] as const).map(([label, amount]) => (
                      <div key={label} className="flex flex-wrap justify-between gap-x-2">
                        <dt>{label}</dt><dd className="font-semibold tabular-nums">{formatYen(amount)}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-2 text-xs text-blue-800">按訂単入金方式分类，不代表已实际收款。</p>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4">
                  <p className="text-sm font-semibold text-emerald-800">利润総和</p>
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
              <div className="order-finance-table-region border bg-white">
                <table className="management-table order-finance-management-table w-full min-w-[1400px] table-fixed text-center text-sm" data-table="order-finance">
                  <colgroup>
                    <col style={{ width: "15%" }} /><col style={{ width: "25%" }} />
                    <col style={{ width: "15%" }} /><col style={{ width: "10%" }} />
                    <col style={{ width: "10%" }} /><col style={{ width: "12.5%" }} />
                    <col style={{ width: "12.5%" }} />
                  </colgroup>
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-2 py-3 font-semibold">用車日期</th>
                      <th className="px-2 py-3 font-semibold">予約情報</th>
                      <th className="px-2 py-3 font-semibold">来源</th>
                      <th className="px-2 py-3 font-semibold">請求書状態</th>
                      <th className="px-2 py-3 font-semibold">入金状態</th>
                      <th className="px-2 py-3 font-semibold">請求金額</th>
                      <th className="px-2 py-3 font-semibold">訂単総利润</th>
                    </tr>
                  </thead>
                  <tbody>
                    {financeDisplayGroups.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                          该月份暂无訂単财务記録
                        </td>
                      </tr>
                    ) : (
                      financeDisplayGroups.map((group) => {
                        const order = group.orders[0];
                        const isBatch = Boolean(order.importBatchId);
                        const groupSaving = group.orders.some((member) => invoiceStatusSavingIds.has(member.id));
                        return (
                          <tr key={group.key} className="border-t hover:bg-gray-50">
                          <td data-label="用車日期" className="whitespace-nowrap px-2 py-3">
                            {group.dateRange}
                          </td>
                          <td data-label="予約情報" className="break-words px-2 py-3">
                            {group.orders.length > 1 && (
                              <span className="mb-1 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                                {group.orders.length} 笔／团
                              </span>
                            )}
                            <button
                              type="button"
                              title={group.customers.join("、")}
                              onClick={() => openAccounting(order)}
                              aria-haspopup="dialog"
                              className="font-medium text-blue-700 hover:underline"
                            >
                              {group.customers[0] || "未填写"}
                            </button>
                          </td>
                          <td data-label="来源" className="break-words px-2 py-3">{group.sources.join("、")}</td>
                          <td data-label="請求書状態" className="whitespace-nowrap px-2 py-3 font-semibold">
                            <button
                              type="button"
                              aria-label={`${group.orders.length} 笔訂単請求書状态：${group.invoiceStatus}，点击变更`}
                              title={isBatch ? "点击變更当前团全部订單状态" : "点击選択状态和变更范围"}
                              disabled={groupSaving}
                              onClick={() => openOrderStatusDialog(
                                order, "invoice", isBatch ? "finance-batch" : "finance",
                                group.allInvoicesComplete ? "未完成" : "已完成",
                              )}
                              className={`rounded border px-2 py-1 text-xs transition-colors disabled:cursor-wait disabled:opacity-60 ${group.allInvoicesComplete ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100" : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"}`}
                            >
                              {groupSaving ? "保存中…" : group.invoiceStatus}
                            </button>
                          </td>
                          <td data-label="入金状態" className="whitespace-nowrap px-2 py-3 font-semibold">
                            <button
                              type="button"
                              aria-label={`${group.orders.length} 笔訂単入金状态：${group.depositStatus}，点击变更`}
                              title={isBatch ? "点击變更当前团全部订單状态" : "点击選択状态和变更范围"}
                              disabled={groupSaving}
                              onClick={() => openOrderStatusDialog(
                                order, "deposit", isBatch ? "finance-batch" : "finance",
                                group.allDepositsPaid ? "unpaid" : "paid",
                              )}
                              className={`rounded border px-2 py-1 text-xs transition-colors disabled:cursor-wait disabled:opacity-60 ${group.allDepositsPaid ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100" : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"}`}
                            >
                              {groupSaving ? "保存中…" : group.depositStatus}
                            </button>
                          </td>
                          <td data-label="請求金額" className="whitespace-nowrap px-2 py-3 tabular-nums">{formatYen(group.totals.requestAmount)}</td>
                          <td data-label="訂単総利润" className="whitespace-nowrap px-2 py-3 font-semibold tabular-nums">{formatYen(group.totals.profit)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </FinanceSummaryPanel>
            </OrderFinanceReviewProvider>
          )}

          {activeView === "driverFinance" && (
            <FinanceSummaryPanel
              title="給料統計"
              month={financeMonth}
              onMonthChange={(month) => {
                setFinanceMonth(month);
                setDriverFinanceDriverFilter("");
                setDriverWageItemDrafts([]);
              }}
              headerActions={
                <>
                <button
                  type="button"
                  onClick={async () => {
                    if (activeRegionId === ALL_REGIONS_ID || !selectedDriverFinanceDriver) {
                      alert("請先選択一个分区和一位運転士，再导出月度工資表。");
                      return;
                    }
                    if (
                      filteredDriverFinanceDetails.length === 0 &&
                      selectedDriverWageItems.length === 0
                    ) {
                      alert("该運転士本月暂无工資記録。");
                      return;
                    }
                    try {
                      await printDriverWages({
                        driver: `${selectedDriverFinanceDriver} ／ ${driverFinanceCompanyLabel}`,
                        month: financeMonth,
                        region: regionNameById.get(activeRegionId) || "",
                        rows: filteredDriverFinanceDetails,
                        manualItems: selectedDriverWageItems,
                      });
                    } catch (error) {
                      alert(error instanceof Error ? error.message : "工資表导出失败，請重试。");
                    }
                  }}
                  className="table-action-button table-action-button--export"
                >
                  导出工資表（A4）
                </button>
                <button
                  type="button"
                  onClick={exportCompanyWages}
                  className="table-action-button table-action-button--export"
                >
                  会社全员工資総表（A4）
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
                        setDriverWageItemDrafts([]);
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
                    <button
                      type="button"
                      onClick={() => setDriverSelectionTarget("driver-finance-filter")}
                      className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
                    >
                      {selectedDriverFinanceDriver || "全部運転士"} · 点击選択
                    </button>
                  </label>
                </>
              }
            >
              <div className="mb-2 flex flex-wrap justify-end gap-2">
                <div className="rounded border px-4 py-2 text-right">
                  <span className="mr-3 text-sm font-semibold">運転士立替</span>
                  <span className="text-lg font-bold tabular-nums">{formatYen(driverFinanceTotalAdvances)}</span>
                </div>
                <div className="rounded border border-emerald-200 bg-emerald-50 px-4 py-2 text-right">
                  <span className="mr-3 text-sm font-semibold text-emerald-800">
                    工資総额
                  </span>
                  <span className="text-lg font-bold tabular-nums text-emerald-950">
                    {formatYen(driverFinanceTotalWage)}
                  </span>
                </div>
                <div className="rounded border border-blue-200 bg-blue-50 px-4 py-2 text-right">
                  <span className="mr-3 text-sm font-semibold text-blue-800">支付総额</span>
                  <span className="text-lg font-bold tabular-nums text-blue-950">{formatYen(driverFinanceTotalAdvances + driverFinanceTotalWage)}</span>
                </div>
              </div>
              <div className="driver-finance-table-region overflow-x-auto border bg-white">
                <table className="management-table driver-finance-management-table w-full min-w-[1400px] table-fixed text-center text-sm" data-table="driver-finance">
                  <colgroup>
                    <col style={{ width: "10%" }} /><col style={{ width: "18%" }} />
                    <col style={{ width: "11%" }} /><col style={{ width: "10%" }} />
                    <col style={{ width: "10%" }} /><col style={{ width: "8%" }} />
                    <col style={{ width: "8%" }} /><col style={{ width: "9%" }} />
                    <col style={{ width: "8%" }} /><col style={{ width: "8%" }} />
                  </colgroup>
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">服务日期</th>
                      <th className="px-4 py-3 font-semibold">訂単名称</th>
                      <th className="px-4 py-3 font-semibold">車輌番号</th>
                      <th className="px-4 py-3 font-semibold">運転士姓名</th>
                      <th className="px-4 py-3 text-right font-semibold">運転士立替</th>
                      <th className="px-4 py-3 text-right font-semibold">超時工資</th>
                      <th className="px-4 py-3 text-right font-semibold">奖励工資</th>
                      <th className="px-4 py-3 text-right font-semibold">運転士比例工資</th>
                      <th className="px-4 py-3 text-right font-semibold">運転士固定工資</th>
                      <th className="px-4 py-3 text-right font-semibold">支付総额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDriverFinanceGroups.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                          暂无運転士工資記録
                        </td>
                      </tr>
                    ) : (
                      visibleDriverFinanceGroups.map((group) => {
                        return group.drivers.map((driverGroup, index) => (
                          <tr key={`${group.key}-${driverGroup.driver}`} className="border-t bg-blue-50 font-semibold">
                            <td data-label="服务日期" className="px-4 py-3">{formatOrderDate(group.startDate)}</td>
                            <td data-label="訂単名称" className="px-4 py-3 text-left">
                              {group.drivers.length > 1 && (
                                <span className="mr-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
                                  {index + 1}/{group.drivers.length} 司机
                                </span>
                              )}
                              <button
                                type="button"
                                aria-haspopup="dialog"
                                onClick={() => openAccounting(group.orders[0])}
                                className="text-left text-blue-700 hover:underline"
                              >
                                {group.customers.join("、")}
                              </button>
                            </td>
                            <td data-label="車輌番号" className="px-4 py-3">{driverGroup.vehicles.join("、") || "—"}</td>
                            <td data-label="運転士姓名" className="px-4 py-3">{driverGroup.driver || "—"}</td>
                            <td data-label="運転士立替" className="px-4 py-3 text-right tabular-nums">{formatYen(driverGroup.totals.driverAdvances)}</td>
                            <td data-label="超時工資" className="px-4 py-3 text-right tabular-nums">{formatYen(driverGroup.totals.overtimeFee)}</td>
                            <td data-label="奖励工資" className="px-4 py-3 text-right tabular-nums">{formatYen(driverGroup.totals.bonusWage)}</td>
                            <td data-label="運転士比例工資" className="px-4 py-3 text-right tabular-nums">{formatYen(driverGroup.totals.percentageWage)}</td>
                            <td data-label="運転士固定工資" className="px-4 py-3 text-right tabular-nums">{formatYen(driverGroup.totals.fixedWage)}</td>
                            <td data-label="支付総额" className="px-4 py-3 text-right tabular-nums text-blue-800">{formatYen(driverGroup.totals.paymentTotal)}</td>
                          </tr>
                        ));
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <section className="mt-4 rounded border bg-white p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">手動工資项目</h3>
                    <p className="mt-1 text-xs text-gray-500">
                      按所选月份、運転士和所属会社保存；全部会社筛选時可为每个项目单独選択会社。金額可填写正数或负数，并计入工資及支付総额。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addDriverWageItemDraft}
                    disabled={
                      driverWageItemsMigrationPending ||
                      currentProfile?.role !== "admin" ||
                      !selectedDriverFinanceDriver ||
                      activeRegionId === ALL_REGIONS_ID
                    }
                    className="rounded border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    + 添加项目
                  </button>
                </div>
                {!selectedDriverFinanceDriver ? (
                  <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    請先選択運転士，再录入手動工資项目。
                  </p>
                ) : driverWageItemsMigrationPending ? (
                  <p role="alert" className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    手動工資项目尚未启用，請先应用数据库迁移后再录入。
                  </p>
                ) : driverWageItemDrafts.length === 0 ? (
                  <p className="text-sm text-gray-500">当前月份暂无手動工資项目。</p>
                ) : (
                  <div className="space-y-2">
                    {driverWageItemDrafts.map((draft, index) => (
                      <div key={draft.id || `new-${index}`} className="flex flex-wrap items-end gap-2">
                        {driverFinanceCompanyFilter === "" && (
                          <label className="min-w-[180px] flex-1 text-sm font-medium">
                            所属会社
                            <select
                              value={
                                draft.companyName === undefined
                                  ? "__select_company__"
                                  : draft.companyName || "__unassigned_company__"
                              }
                              onChange={(event) =>
                                setDriverWageItemDrafts((current) =>
                                  current.map((item, itemIndex) =>
                                    itemIndex === index
                                      ? {
                                          ...item,
                                          companyName:
                                            event.target.value === "__select_company__"
                                              ? undefined
                                              : event.target.value === "__unassigned_company__"
                                                ? ""
                                                : event.target.value,
                                        }
                                      : item,
                                  ),
                                )
                              }
                              className="mt-1 w-full rounded border bg-white px-3 py-2"
                            >
                              <option value="__select_company__">請選択所属会社</option>
                              <option value="__unassigned_company__">未设置所属会社</option>
                              {driverFinanceCompanies.map((company) => (
                                <option key={company} value={company}>{company}</option>
                              ))}
                            </select>
                          </label>
                        )}
                        <label className="min-w-[180px] flex-1 text-sm font-medium">
                          项目名称
                          <input
                            type="text"
                            maxLength={200}
                            value={draft.name}
                            onChange={(event) =>
                              setDriverWageItemDrafts((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, name: event.target.value } : item,
                                ),
                              )
                            }
                            className="mt-1 w-full rounded border px-3 py-2"
                            placeholder="例如：月度津贴"
                          />
                        </label>
                        <label className="w-48 text-sm font-medium">
                          金額（JPY）
                          <input
                            type="number"
                            min="-99999999999999"
                            max="99999999999999"
                            step="1"
                            value={draft.amount}
                            onChange={(event) =>
                              setDriverWageItemDrafts((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, amount: event.target.value } : item,
                                ),
                              )
                            }
                            className="mt-1 w-full rounded border px-3 py-2 text-right tabular-nums"
                            placeholder="可输入负数"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            const savedItem = selectedDriverWageItems.find(
                              (item) => item.id === draft.id,
                            );
                            if (savedItem) {
                              deleteDriverWageItem(savedItem);
                            } else {
                              setDriverWageItemDrafts((current) =>
                                current.filter((_, itemIndex) => itemIndex !== index),
                              );
                            }
                          }}
                          className="table-action-button table-action-button--delete"
                        >
                          删除
                        </button>
                      </div>
                    ))}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                      <span className="text-sm text-gray-600">
                        项目合计：{formatYen(driverFinanceManualWageTotal)}
                      </span>
                      <button
                        type="button"
                        onClick={saveDriverWageItems}
                        disabled={
                          driverWageItemsMigrationPending ||
                          currentProfile?.role !== "admin" ||
                          activeRegionId === ALL_REGIONS_ID
                        }
                        className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        保存手動工資项目
                      </button>
                    </div>
                  </div>
                )}
              </section>
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
                  className="table-action-button table-action-button--export"
                >
                  导出車両财务表（A4）
                </button>
              }
              trailingHeaderActions={
                <label className="flex items-center gap-2 text-sm font-medium text-gray-600">
                  車両番号
                  <select
                    value={vehicleFinanceVehicleFilter}
                    onChange={(event) => {
                      const vehicleId = event.target.value;
                      setVehicleFinanceVehicleFilter(vehicleId);
                      setVehicleMonthlyFinanceForm(
                        getVehicleMonthlyFinanceForm(vehicleId, financeMonth),
                      );
                      setVehicleMonthlyFinanceError("");
                    }}
                    className="rounded border bg-white px-3 py-2 text-sm text-gray-900"
                  >
                    <option value="">全部車両番号</option>
                    {vehicleRecords.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
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
                        {financeMonth} 月度費用与里程
                      </h3>
                      <p className="mt-1 text-xs text-gray-500">
                        停車场費和保险費默认使用車両資料中的固定月额；保存过的月份金額不会随默认值变更。
                      </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {([
                        ["parkingFee", "停車场費用（JPY）"],
                        ["insuranceFee", "保险費用（JPY）"],
                        ["inspectionFee", "点检/車检費用（JPY）"],
                        ["repairFee", "维修費用（JPY）"],
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
                        <h4 className="text-sm font-semibold">备品費用明細</h4>
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
                        <p className="text-sm text-gray-500">尚未添加备品費用。</p>
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
                                aria-label={`备品金額 ${index + 1}`}
                                placeholder="金額（JPY）"
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
                                className="table-action-button table-action-button--delete"
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
                        保存月度費用与里程
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
                    請先在右上角選択車両番号，再录入该車両的月度費用和公里数。
                  </p>
                )}
              </section>
              {selectedVehicleForFinance && (
                <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                  {[
                    ["訂単利润総和", formatYen(vehicleOrderProfit)],
                    ["各种費用支出", formatYen(vehicleMonthlyExpenses)],
                    ["扣除費用后利润", formatYen(vehicleNetProfit)],
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
                    每車一行，包含外注車両（标注“外注”，未登记番号時明确提示）。訂単利润已扣除固定費用与备品。月度費用使用已保存記録；未登记月份使用默认停車场費及保险費。无运营記録的車両也计入固定成本。
                  </p>
                  {vehicleSummaryResult.error ? (
                    <p role="alert" className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">{vehicleSummaryResult.error}</p>
                  ) : (
                    <div className="overflow-x-auto border bg-white">
                      <table className="management-table w-full min-w-[1350px] table-fixed text-center text-sm" data-table="vehicle-summary">
                        <colgroup>
                          <col style={{ width: "9%" }} /><col style={{ width: "17%" }} />
                          <col style={{ width: "12%" }} /><col style={{ width: "12%" }} />
                          <col style={{ width: "12%" }} /><col style={{ width: "12%" }} />
                          <col style={{ width: "13%" }} /><col style={{ width: "13%" }} />
                        </colgroup>
                        <thead className="bg-gray-100 text-gray-600">
                          <tr>
                            <th className="px-4 py-3 font-semibold">服务月份</th>
                            <th className="px-4 py-3 font-semibold">車両番号</th>
                            <th className="px-4 py-3 text-right font-semibold">請求総金額</th>
                            <th className="px-4 py-3 text-right font-semibold">運転士立替</th>
                            <th className="px-4 py-3 text-right font-semibold">会社支付</th>
                            <th className="px-4 py-3 text-right font-semibold">運転士工資</th>
                            <th className="px-4 py-3 text-right font-semibold">固定費用与备品</th>
                            <th className="px-4 py-3 text-right font-semibold">訂単利润（扣費后）</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vehicleSummaryResult.rows.length === 0 ? (
                            <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">暂无車両或财务記録</td></tr>
                          ) : vehicleSummaryResult.rows.map((row) => (
                            <tr key={row.key} className="border-t hover:bg-gray-50">
                              <td className="px-4 py-3">{row.month}</td>
                              <td className="px-4 py-3 font-medium">
                                {row.vehicleNumber}
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
                            <td colSpan={2} className="px-4 py-3">合计／利润汇総</td>
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
                <table className="management-table w-full min-w-[1350px] table-fixed text-center text-sm" data-table="vehicle-finance">
                  <colgroup>
                    <col style={{ width: "10%" }} /><col style={{ width: "21%" }} />
                    <col style={{ width: "9%" }} /><col style={{ width: "12%" }} />
                    <col style={{ width: "12%" }} /><col style={{ width: "12%" }} />
                    <col style={{ width: "12%" }} /><col style={{ width: "12%" }} />
                  </colgroup>
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">服务日期</th>
                      <th className="px-4 py-3 font-semibold">訂単名称</th>
                      <th className="px-4 py-3 font-semibold">運転士</th>
                      <th className="px-4 py-3 text-right font-semibold">請求金額</th>
                      <th className="px-4 py-3 text-right font-semibold">運転士総立替</th>
                      <th className="px-4 py-3 text-right font-semibold">会社総支出</th>
                      <th className="px-4 py-3 text-right font-semibold">運転士総工資</th>
                      <th className="px-4 py-3 text-right font-semibold">訂単総利润</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVehicleFinanceDetails.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                          暂无車両财务記録
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
                    onClick={() => exportBalance()}
                    className="table-action-button table-action-button--export"
                  >
                    导出收支報表（A4）
                  </button>
                  <button
                    type="button"
                    onClick={() => exportBalance("companyAdvances")}
                    title="A4 PDF 导出"
                    className="table-action-button table-action-button--export"
                  >
                    外注運転士出金明細
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
                当月利润＝請求総金額＋手動输入的其他收入－下方手動输入的支出総和。不自動扣除車両費用、運転士工資、立替或其他运营支出。
                整单請求金額（訂単价格及全日期的ETC旅報、運転士立替旅報、会社立替旅報、超時費）按首个服务日所在月份计入，不按天分摊。
                首个服务日排除休运日；請求按訂単所属会社归集，其他收入和支出按手動项目所属会社及录入月份归集。
                口座入金、現金入金按訂単入金方式分类，不要求填写入金日期，不代表已实际收款；未设置入金方式另列。
              </p>
              {balanceResult.summary ? (
              <>
              <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <section className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-4 shadow-sm">
                  <p className="text-sm font-semibold text-blue-800">請求総和</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-blue-950">
                    {formatYen(balanceResult.summary.totals.requestAmount)}
                  </p>
                  <p className="mt-1 text-xs text-blue-800">
                    整单請求金額归首个服务日所在月份
                  </p>
                  <dl className="mt-3 space-y-1 border-t border-blue-200 pt-2 text-sm text-blue-950">
                    {([
                      ["口座入金", balanceResult.summary.totals.bankRequestAmount],
                      ["現金入金", balanceResult.summary.totals.cashRequestAmount],
                      ["未设置入金方式", balanceResult.summary.totals.unassignedRequestAmount],
                    ] as const).map(([label, amount]) => (
                      <div key={label} className="flex flex-wrap justify-between gap-x-2">
                        <dt>{label}</dt><dd className="font-semibold tabular-nums">{formatYen(amount)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <section className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 shadow-sm">
                  <p className="text-sm font-semibold text-emerald-800">其他收入総和</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-950">
                    {formatYen(balanceResult.summary.totals.incomeTotal)}
                  </p>
                  <p className="mt-1 text-xs text-emerald-800">手動输入的其他收入当月金額合计</p>
                </section>
                <section className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 shadow-sm">
                  <p className="text-sm font-semibold text-emerald-800">支出総和</p>
                  <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-950">
                    {formatYen(balanceResult.summary.totals.expenseTotal)}
                  </p>
                  <p className="mt-1 text-xs text-emerald-800">仅下方手動输入项目的当月金額合计</p>
                  <dl className="mt-3 space-y-1 border-t border-emerald-200 pt-2 text-sm text-emerald-950">
                    {(["paypay", "微信", "支付宝", "口座", ""] as const).map((method) => (
                      <div key={method} className="flex flex-wrap justify-between gap-x-2">
                        <dt>{method || "未设置出金方式"}</dt>
                        <dd className="font-semibold tabular-nums">{formatYen(balanceResult.summary.paymentAmounts[method])}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-2 text-xs text-emerald-800">
                    外注運転士出金对账明細，仅供核对，不重复计入收支平衡；月份沿用訂単首个服务月。
                  </p>
                </section>
                <section className="rounded-lg border border-violet-200 bg-violet-50 px-5 py-4 shadow-sm">
                  <p className={`text-sm font-semibold ${balanceResult.summary.totals.net < 0 ? "text-red-600" : "text-black"}`}>
                    {balanceResult.summary.totals.net < 0 ? "当月亏损" : "当月利润"}
                  </p>
                  <p className={`mt-2 text-2xl font-bold tabular-nums ${balanceResult.summary.totals.net < 0 ? "text-red-600" : "text-black"}`}>
                    {formatYen(balanceResult.summary.totals.net)}
                  </p>
                  <p className="mt-1 text-xs text-violet-800">請求総和 + 其他收入 - 支出総和</p>
                </section>
              </div>
              <div className="mb-5 overflow-x-auto rounded-lg border bg-white">
                <table className="management-table w-full min-w-[1400px] table-fixed text-center text-sm" data-table="balance">
                  <colgroup>
                    <col style={{ width: "18%" }} /><col style={{ width: "11%" }} />
                    <col style={{ width: "11%" }} /><col style={{ width: "11%" }} />
                    <col style={{ width: "12%" }} /><col style={{ width: "12%" }} />
                    <col style={{ width: "12%" }} /><col style={{ width: "13%" }} />
                  </colgroup>
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3">所属会社</th>
                      {["請求総和", "口座入金", "現金入金", "未设置入金方式", "其他收入（手動）", "支出総和（手動）", "当月利润／亏损"].map((label) => (
                        <th key={label} className="px-4 py-3 text-right">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {balanceResult.summary.rows.map((row) => (
                      <tr key={row.companyName} className="border-t">
                        <td className="px-4 py-3">{row.companyName || "未填写"}</td>
                        {[row.requestAmount, row.bankRequestAmount, row.cashRequestAmount, row.unassignedRequestAmount, row.incomeTotal, row.expenseTotal].map((amount, index) => (
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
                        balanceResult.summary.totals.requestAmount,
                        balanceResult.summary.totals.bankRequestAmount,
                        balanceResult.summary.totals.cashRequestAmount,
                        balanceResult.summary.totals.unassignedRequestAmount,
                        balanceResult.summary.totals.incomeTotal, balanceResult.summary.totals.expenseTotal,
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
                    <h3 className="font-bold">手動{label}项目</h3>
                    <p className="mt-1 text-xs text-gray-600">
                      {kind === "income" ? "这里的其他收入计入利润。" : "收支平衡仅扣除这里手動输入的費用。"}项目名称按会社长期保留；每月金額需单独录入并保存。
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
                          placeholder={kind === "income" ? "例如：停車场收入" : "例如：办公用品"}
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
                    請選択具体所属会社后添加项目或录入金額；全部会社视图仅用于查看汇総。
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="management-table w-full min-w-[800px] table-fixed text-center text-sm" data-table="balance-items">
                    <colgroup>
                      <col style={{ width: "28%" }} /><col style={{ width: "32%" }} />
                      <col style={{ width: "26%" }} /><col style={{ width: "14%" }} />
                    </colgroup>
                    <thead className="bg-gray-100 text-gray-600">
                      <tr>
                        <th className="px-4 py-3 font-semibold">所属会社</th>
                        <th className="px-4 py-3 font-semibold">{label}项目</th>
                        <th className="px-4 py-3 text-right font-semibold">
                          {balanceMonth} 金額（JPY）
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
                                  aria-label={`${item.name} ${balanceMonth} 金額`}
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
                                  className="table-action-button table-action-button--delete disabled:cursor-not-allowed"
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
                          手動{label}合计
                        </th>
                        <th className="px-4 py-3 text-right tabular-nums">
                          {balanceResult.summary ? formatYen(kind === "income" ? balanceResult.summary.totals.incomeTotal : balanceResult.summary.totals.expenseTotal) : "金額无效／数据未就绪"}
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
                      新月份沿用已登记的{label}项目，金額默认空白。
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
                        保存本月{label}金額
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
      {/* 日期控制 */}
      <div className="calendar-toolbar border-b bg-white px-3 py-0.5">
        <div className="calendar-date-controls flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-0.5 shadow-sm">
          <button
            type="button"
            onClick={() => setCalendarCenterDate((date) => new Date(date.getFullYear(), date.getMonth() - 1, date.getDate()))}
            className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
            aria-label="上一月"
          >
            ←
          </button>

          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={`選択年份，当前${calendarCenterDate.getFullYear()}年`}
            onClick={() => setYearPickerStart(Math.min(2089, Math.max(2020, calendarCenterDate.getFullYear() - 5)))}
            className="calendar-year-button rounded-full border border-slate-200 bg-white px-3 py-1 text-center text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 sm:min-w-0 sm:flex-[1_1_0px] sm:px-0"
          >
            {calendarCenterDate.getFullYear()}年
          </button>

          {yearPickerStart !== null && (
            <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="calendar-year-dialog-title"
                onKeyDown={(event) => { if (event.key === "Escape") setYearPickerStart(null); }}
                className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl"
              >
                <div className="dialog-floating-header mb-4 flex items-center justify-between gap-3">
                  <h2 id="calendar-year-dialog-title" className="text-lg font-bold">選択年份</h2>
                  <button type="button" aria-label="关闭" onClick={() => setYearPickerStart(null)} className="text-2xl text-gray-500">
                    ×
                  </button>
                </div>
                <div className="mb-3 flex items-center justify-between">
                  <button
                    type="button"
                    aria-label="上一组年份"
                    disabled={yearPickerStart <= 2020}
                    onClick={() => setYearPickerStart((start) => Math.max(2020, (start ?? 2020) - 12))}
                    className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    ‹
                  </button>
                  <span className="text-sm font-semibold text-slate-600">
                    {yearPickerStart} ～ {Math.min(2100, yearPickerStart + 11)}
                  </span>
                  <button
                    type="button"
                    aria-label="下一组年份"
                    disabled={yearPickerStart + 12 > 2100}
                    onClick={() => setYearPickerStart((start) => Math.min(2089, (start ?? 2020) + 12))}
                    className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                  >
                    ›
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {Array.from({ length: 12 }, (_, index) => yearPickerStart + index)
                    .filter((year) => year <= 2100)
                    .map((year) => {
                      const selected = year === calendarCenterDate.getFullYear();
                      return (
                        <button
                          key={year}
                          type="button"
                          aria-pressed={selected}
                          autoFocus={selected}
                          onClick={() => {
                            setCalendarCenterDate(
                              (date) =>
                                new Date(
                                  year,
                                  date.getMonth(),
                                  Math.min(date.getDate(), new Date(year, date.getMonth() + 1, 0).getDate()),
                                ),
                            );
                            setYearPickerStart(null);
                          }}
                          className={`rounded-lg border py-2 text-sm font-semibold transition-colors ${selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"}`}
                        >
                          {year}年
                        </button>
                      );
                    })}
                </div>
              </section>
            </div>
          )}

          <label className="calendar-month-select flex items-center gap-1 text-xs text-slate-600 sm:hidden">
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

          <div className="calendar-month-buttons hidden min-w-0 flex-[12_1_44px] flex-nowrap items-center justify-center gap-1 sm:flex" role="group" aria-label="選択月份">
            {Array.from({ length: 12 }, (_, index) => {
              const selected = calendarCenterDate.getMonth() === index;
              return (
                <button
                  key={index}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setCalendarCenterDate(
                      (date) =>
                        new Date(
                          date.getFullYear(),
                          index,
                          Math.min(date.getDate(), new Date(date.getFullYear(), index + 1, 0).getDate()),
                        ),
                    )
                  }
                  className={`min-w-0 flex-1 rounded-full border py-1 text-center text-xs font-semibold transition-colors ${selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"}`}
                >
                  {index + 1}月
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setCalendarCenterDate((date) => new Date(date.getFullYear(), date.getMonth() + 1, date.getDate()))}
            className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
            aria-label="下一月"
          >
            →
          </button>
        </div>

        <div className="calendar-day-slider fixed bottom-4 left-1/2 z-40 w-[calc(100%-2rem)] max-w-[640px] -translate-x-1/2">
          <input
            type="range"
            min={1}
            max={calendarDaysInMonth}
            value={calendarCenterDate.getDate()}
            aria-label="選択本月日期"
            aria-valuetext={`${calendarCenterDate.getMonth() + 1}月${calendarCenterDate.getDate()}日`}
            style={{
              "--calendar-progress": `${((calendarCenterDate.getDate() - 1) / Math.max(1, calendarDaysInMonth - 1)) * 100}%`,
            } as CSSProperties}
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

      <div className="calendar-vehicle-filters flex flex-wrap items-center gap-1 border-b bg-white px-3 py-0.5">
        {([
          ["all", "全体車両"],
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
        <button
          type="button"
          aria-label="筛选预约来源"
          aria-haspopup="dialog"
          onClick={() => setSourceSelectionOpen("calendar-filter")}
          title={calendarSourceFilter && calendarSourceFilter !== UNSOURCED_ORDER ? calendarSourceFilter : undefined}
          className={`max-w-[16rem] truncate rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
            calendarSourceFilter
              ? "border-blue-700 bg-blue-700 text-white"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"
          }`}
        >
          来源：{calendarSourceFilter === ""
            ? "全部"
            : calendarSourceFilter === UNSOURCED_ORDER
              ? "未填写"
              : getSourceDisplayName(calendarSourceFilter, activeRegionId === ALL_REGIONS_ID ? undefined : activeRegionId)}
        </button>
        <button
          type="button"
          aria-label="回到今天"
          onClick={() => setCalendarCenterDate(new Date())}
          className="calendar-today-button rounded-full border border-blue-200 bg-blue-50 px-4 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
        >
          今天
        </button>
      </div>

      {/* 排班表 */}
      <div
        ref={setCalendarScroller}
        className="calendar-scroll max-h-[calc(100dvh-122px)] overflow-auto p-0"
        onScroll={(event) => {
          const scroller = event.currentTarget;
          if (isCalendarPinching) return;
          updateMobileCalendarVisibleRange(scroller);
          if (!isMobileCalendar || !calendarCenteredRef.current || calendarAnchorRef.current) return;
          const offset = scroller.scrollLeft < 520
            ? -1
            : scroller.scrollWidth - scroller.clientWidth - scroller.scrollLeft < 520 ? 1 : 0;
          if (!offset) return;
          const vehicleColumnWidth =
            scroller.querySelector<HTMLElement>(".calendar-vehicle-column")?.offsetWidth ?? 135 * calendarScale;
          const cell = Array.from(scroller.querySelectorAll<HTMLElement>("[data-calendar-date]"))
            .find((item) =>
              item.offsetLeft + item.offsetWidth - scroller.scrollLeft > vehicleColumnWidth,
            );
          if (!cell?.dataset.calendarDate) return;
          calendarAnchorRef.current = {
            date: cell.dataset.calendarDate,
            left: cell.offsetLeft - scroller.scrollLeft,
          };
          setMobileCalendarFirstMonth((month) =>
            new Date(month.getFullYear(), month.getMonth() + offset, 1),
          );
        }}
      >
        <div
          className="calendar-grid min-w-[1320px] border bg-white"
          style={{
            minWidth: Math.max(1320, 135 + dates.length * 130) * calendarScale,
            "--calendar-scale": calendarScale,
          } as CSSProperties}
        >
          <div
            className="calendar-date-header sticky top-0 z-20 grid bg-gray-100 shadow-sm"
            style={{
              gridTemplateColumns: `calc(var(--calendar-vehicle-width, 135px) * ${calendarScale}) repeat(${dates.length}, minmax(${130 * calendarScale}px, 1fr))`,
            }}
          >
            <div className="calendar-vehicle-column border-b border-r bg-gray-100 p-2 font-bold">
              <div className="calendar-vehicle-content">車両</div>
            </div>

            {dates.map((d) => (
              <div
                key={d.date}
                data-calendar-date={d.date}
                className={`border-b border-r p-3 text-center ${d.isToday ? "bg-blue-50" : "bg-gray-100"}`}
              >
                <div className={`font-bold ${d.isRedDay ? "text-red-600" : ""}`}>
                  {d.label}
                </div>
                <div className={`text-sm ${d.isRedDay ? "text-red-600" : "text-gray-500"}`}>
                  {d.day}
                </div>
                {d.isHoliday && <div className="text-xs text-red-600">休日</div>}
                {(restingDriverNamesByDate.get(d.date)?.length ?? 0) > 0 && (
                  <div
                    className="calendar-rest-drivers mt-1 break-words text-xs font-semibold leading-tight text-red-600"
                    title={`運転士休息：${restingDriverNamesByDate.get(d.date)!.join("、")}`}
                  >
                    {restingDriverNamesByDate.get(d.date)!.join("、")}
                  </div>
                )}
              </div>
            ))}
          </div>

          {filteredCalendarVehicleRecords.map((vehicleRecord) => {
            const vehicle = vehicleRecord.name;
            const vehicleTarget = { name: vehicleRecord.name, plate: vehicleRecord.plate };
            const isVehicleAvailable = getVehicleDisplayStatus(vehicleRecord) === "运营中";
            const isOutsourced = isOutsourcedVehicle(vehicle);
            const visibleOrders = orders
              .filter(
                (order) =>
                  (calendarSourceFilter === "" ||
                    (calendarSourceFilter === UNSOURCED_ORDER
                      ? !order.orderSource
                      : order.orderSource === calendarSourceFilter)) &&
                  getVehicleSegments(order, dates.filter(day => day.date >= order.date &&
                    day.date <= (order.endDate || order.date)).map(day => day.date), vehicleRecord).length > 0 &&
                  order.date <= dates[dates.length - 1].date &&
                  (order.endDate || order.date) >= dates[0].date,
              )
              .sort((first, second) =>
                first.date.localeCompare(second.date) ||
                (first.time || "99:99").localeCompare(second.time || "99:99"),
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
            const getTripSummary = (order: Order, date: string) =>
              (order.offDates || []).includes(date)
                ? ""
                : order.financeByDate?.[date]?.tripSummary?.trim() || "";
            // Single-day orders never show trip summaries on the calendar.
            const orderHasTripSummaries = (order: Order) =>
              Boolean(order.endDate) &&
              order.endDate !== order.date &&
              Object.keys(order.financeByDate || {}).some((date) =>
                date >= dates[0].date &&
                date <= dates[dates.length - 1].date &&
                getTripSummary(order, date) !== "",
              );
            // Every order sits in the date cells' grid row, stacked by lane.
            const baseOrderCardHeight = 56;
            const tripSummaryOrderCardHeight = 72;
            const executionHeaderHeight = visibleOrders.some(order => driverExecutionByOrder.has(order.id)) ? 18 : 0;
            const defaultOrderCardHeight = (visibleOrders.some(orderHasTripSummaries)
              ? tripSummaryOrderCardHeight
              : baseOrderCardHeight) + executionHeaderHeight;
            const orderCardHeight = isMobileCalendar
              ? Math.max(defaultOrderCardHeight, mobileCalendarCardHeights[vehicleRecord.id] ?? 0)
              : defaultOrderCardHeight;
            const orderCardGap = 4;
            const calendarRowMinimumHeight = isMobileCalendar ? 72 : 96;
            const calendarRowBottomSpacing = isMobileCalendar ? 12 : 44;
            const mobileVisibleStackedHeight = isMobileCalendar
              ? dates.reduce((height, day) => {
                  if (
                    !mobileCalendarVisibleRange ||
                    day.date < mobileCalendarVisibleRange.startDate ||
                    day.date > mobileCalendarVisibleRange.endDate
                  ) {
                    return height;
                  }
                  return Math.max(
                    height,
                    visibleOrders.reduce((dayHeight, order) => {
                      if (order.date > day.date || (order.endDate || order.date) < day.date) {
                        return dayHeight;
                      }
                      return Math.max(
                        dayHeight,
                        ((orderLanes.get(order.id) ?? 0) + 1) *
                          (orderCardHeight + orderCardGap),
                      );
                    }, 0),
                  );
                }, 0)
              : 0;
            const singleDayCellHeights = new Map(
              dates.map((day) => {
                const stackedHeight = visibleOrders.reduce((height, order) => {
                  if (order.date > day.date || (order.endDate || order.date) < day.date) {
                    return height;
                  }
                  return Math.max(height, ((orderLanes.get(order.id) ?? 0) + 1) * (orderCardHeight + orderCardGap));
                }, 0);

                return [
                  day.date,
                  isMobileCalendar
                    ? `${Math.max(
                        calendarRowMinimumHeight,
                        mobileVisibleStackedHeight + calendarRowBottomSpacing,
                      )}px`
                    : `${Math.max(
                        calendarRowMinimumHeight,
                        stackedHeight + calendarRowBottomSpacing,
                      )}px`,
                ];
              }),
            );

            return (
              <div
                key={vehicleRecord.id}
                className={`calendar-vehicle-row grid auto-rows-min ${
                  calendarVehicleDropTarget?.id === vehicleRecord.id
                    ? calendarVehicleDropTarget.after
                      ? "shadow-[inset_0_-3px_0_0_#1d4ed8]"
                      : "shadow-[inset_0_3px_0_0_#1d4ed8]"
                    : ""
                } ${draggingCalendarVehicleId === vehicleRecord.id ? "opacity-50" : ""}`}
                onDragOver={(event) => {
                  if (vehicleRecord.calendarOnly) return;
                  event.preventDefault();
                  if (draggingCalendarVehicleId) {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    const after = event.clientY > bounds.top + bounds.height / 2;
                    if (
                      calendarVehicleDropTarget?.id !== vehicleRecord.id ||
                      calendarVehicleDropTarget.after !== after
                    ) {
                      setCalendarVehicleDropTarget({ id: vehicleRecord.id, after });
                    }
                    return;
                  }
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const vehicleColumnWidth = event.currentTarget.firstElementChild?.getBoundingClientRect().width ?? 135;
                  const dayWidth = (bounds.width - vehicleColumnWidth) / dates.length;
                  const dateIndex = Math.max(
                    0,
                    Math.min(
                      dates.length - 1,
                      Math.floor((event.clientX - bounds.left - vehicleColumnWidth) / dayWidth),
                    ),
                  );
                  setDragTargetKey(`${vehicleRecord.id}::${dates[dateIndex].date}`);
                }}
                onDrop={(event) => {
                  if (vehicleRecord.calendarOnly) return;
                  event.preventDefault();
                  if (draggingCalendarVehicleId) {
                    const bounds = event.currentTarget.getBoundingClientRect();
                    reorderCalendarVehicle(
                      draggingCalendarVehicleId,
                      vehicleRecord.id,
                      event.clientY > bounds.top + bounds.height / 2,
                    );
                    setDraggingCalendarVehicleId(null);
                    setCalendarVehicleDropTarget(null);
                    return;
                  }
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const vehicleColumnWidth = event.currentTarget.firstElementChild?.getBoundingClientRect().width ?? 135;
                  const dayWidth = (bounds.width - vehicleColumnWidth) / dates.length;
                  const dateIndex = Math.max(
                    0,
                    Math.min(
                      dates.length - 1,
                      Math.floor((event.clientX - bounds.left - vehicleColumnWidth) / dayWidth),
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
                          vehicleTarget,
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
                    moveOrderToCell(dragData, vehicleTarget, dates[dateIndex].date);
                  }
                }}
                style={{
                  gridTemplateColumns: `calc(var(--calendar-vehicle-width, 135px) * ${calendarScale}) repeat(${dates.length}, minmax(${130 * calendarScale}px, 1fr))`,
                }}
              >
                <div
                  className="calendar-vehicle-column relative row-start-1 flex min-h-[72px] items-center justify-center border-b border-r bg-slate-50 py-2 pl-4 pr-1"
                  style={isMobileCalendar ? {
                    minHeight: 72 * calendarScale,
                    paddingBlock: 8 * calendarScale,
                  } : undefined}
                >
                  <span
                    aria-hidden="true"
                    draggable={!vehicleRecord.calendarOnly}
                    role="button"
                    tabIndex={-1}
                    title="拖動调整車両顺序"
                    aria-label={`拖動调整車両顺序 ${vehicleRecord.plate || vehicle}`}
                    onDragStart={(event) => {
                      if (vehicleRecord.calendarOnly) { event.preventDefault(); return; }
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("application/x-calendar-vehicle", vehicleRecord.id);
                      setDraggingCalendarVehicleId(vehicleRecord.id);
                    }}
                    onDragEnd={() => {
                      setDraggingCalendarVehicleId(null);
                      setCalendarVehicleDropTarget(null);
                    }}
                    className="calendar-reorder-handle absolute inset-y-0 left-0 flex w-4 cursor-grab select-none items-center justify-center text-slate-400 hover:bg-slate-200 hover:text-slate-700 active:cursor-grabbing"
                  >
                    ⠿
                  </span>
                  {(() => {
                    const plate = vehicleRecord.plate || "未登记番号";
                    const notes = vehicleRecord.notes || "-";
                    const status = getVehicleDisplayStatus(vehicleRecord);
                    return (
                      <div className="calendar-vehicle-content flex w-full min-w-0 flex-col items-center text-center">
                        <button
                          type="button"
                          onClick={() => copyCalendarVehicleField(plate, "車両番号")}
                          title="点击复制車両番号"
                          aria-label={`复制車両番号 ${plate}`}
                          className={`max-w-full break-all text-center text-[13px] font-bold leading-tight tracking-tight hover:text-blue-700 focus:outline-none focus:underline ${vehicleRecord.plate ? "" : "text-gray-400"}`}
                        >
                          {plate}
                        </button>
                        <button
                          type="button"
                          onClick={() => copyCalendarVehicleField(vehicle, "車名")}
                          title="点击复制車名"
                          aria-label={`复制車名 ${vehicle}`}
                          className="calendar-vehicle-desktop-field mt-1 max-w-full truncate text-center text-xs text-slate-600 hover:text-blue-700 focus:outline-none focus:underline"
                        >
                          {vehicle}
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
                          className={`calendar-vehicle-desktop-field mt-1 max-w-full truncate text-center text-xs hover:opacity-75 focus:outline-none focus:underline ${status === "运营中" ? "text-emerald-700" : "text-red-700"}`}
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
                      minHeight: `${Number.parseFloat(singleDayCellHeights.get(d.date) ?? "0") *
                        (isOutsourced && !isMobileCalendar ? 2 : 1)}px`,
                    }}
                    onClick={() => {
                      if (splitSelection && !isCompactCalendar) {
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
                      openNewOrder(vehicleRecord, d.date);
                    }}
                    className={`border-b border-r p-2 transition-colors ${isVehicleAvailable ? "cursor-pointer" : "cursor-not-allowed bg-gray-50"} ${dragTargetKey === `${vehicleRecord.id}::${d.date}` ? "bg-blue-100 ring-2 ring-inset ring-blue-400" : ""}`}
                  />
                ))}

                {visibleOrders.flatMap((order) => getVehicleSegments(order,
                  dates.map(day => day.date >= order.date && day.date <= (order.endDate || order.date) ? day.date : ""),
                  vehicleRecord).filter(segment => dates[segment.start].date >= order.date &&
                    dates[segment.start].date <= (order.endDate || order.date)).map(({ start: startIndex, end }) => {
                  const endIndex = end - 1;
                  const barDates = dates.slice(startIndex, endIndex + 1);
                  const driverSegments = getDriverSegments(order, barDates.map(day => day.date)).map(segment => ({
                    ...segment, expired: driverRecords.some(driver => driver.name === segment.driver &&
                      isDriverLicenseExpired(driver)),
                  }));
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
                  const cardFontSize = 12;
                  const infoSegmentWidth = (infoSegmentEnd - infoSegmentStart) * 130 - 34;
                  const showStatusOnTitleLine =
                    infoSegmentStart !== -1 &&
                    order.customer.length * cardFontSize +
                      order.status.length * cardFontSize +
                      8 <= infoSegmentWidth;
                  const orderLane = orderLanes.get(order.id) ?? 0;
                  const laneOffset = orderLane * (orderCardHeight + orderCardGap) + orderCardGap;
                  const isSelectingSplit =
                    !isCompactCalendar && isSplittable && splitSelection?.orderId === order.id;
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
                      getOrderDriverNames(order).includes(driver.name) && isDriverLicenseExpired(driver),
                  );
                  const sourceColor = orderSourceColorByRegion.get(`${order.regionId}:${order.orderSource}`);
                  const showTripSummaries = orderHasTripSummaries(order);
                  const execution = driverExecutionByOrder.get(order.id);
                  const executionDayIndex = execution ? barDates.findIndex(day => day.date === execution.date && !order.offDates.includes(day.date)) : -1;
                  const executionPadding = executionDayIndex >= 0 ? 18 : 0;

                  return (
                    <div
                      key={`${order.id}:${startIndex}`}
                      style={{
                        gridColumn: `${startIndex + 2} / ${endIndex + 3}`,
                        gridRow: 1,
                        transform: `translateY(${laneOffset * (isMobileCalendar ? calendarScale : 1)}px)`,
                        height: `${orderCardHeight * (isMobileCalendar ? calendarScale : 1)}px`,
                        minHeight: 0,
                        zIndex: 1,
                        backgroundColor: sourceColor || undefined,
                        color: sourceColor ? getSourceTextColor(sourceColor) : undefined,
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
                      className={`calendar-order-card relative mx-1 my-0 cursor-grab overflow-hidden rounded-lg border px-2 py-1 text-center text-xs leading-3 shadow-sm active:cursor-grabbing ${statusStyles[order.status]} ${draggingOrderId === order.id ? "opacity-50" : ""}`}
                    >
                      {!isMobileCalendar && execution && executionDayIndex >= 0 && <div className="pointer-events-none absolute top-0 z-20 min-w-0 px-1 text-center"
                        style={{ left: `${executionDayIndex / barDates.length * 100}%`, width: `${100 / barDates.length}%` }}>
                        <DriverExecutionBadge row={execution} date={barDates[executionDayIndex].date} />
                      </div>}
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
                              {isOffDate && !isCompactCalendar && <span className="text-xs font-bold">休運</span>}
                            </div>
                          );
                        })}
                      </div>

                      {isSplittable && !isCompactCalendar && (
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

                      {isCompactCalendar && driverSegments.map(segment => (
                        <div
                          key={segment.start}
                          data-calendar-card-vehicle={vehicleRecord.id}
                          className="calendar-card-content absolute flex flex-col items-center justify-center break-all px-1 text-center text-xs leading-4"
                          style={{ left: `${segment.start / barDates.length * 100}%`,
                            width: `${(segment.end - segment.start) / barDates.length * 100}%`,
                            top: (orderCardHeight / 2 - 4) * calendarScale, transform: "translateY(-50%)" }}
                        >
                          <div className="grid w-full min-w-0"
                            style={{ gridTemplateColumns: `repeat(${segment.end - segment.start}, minmax(0, 1fr))` }}>
                            {barDates.slice(segment.start, segment.end).map(day => (
                              <div key={day.date} className="calendar-mobile-execution min-w-0 px-1">
                                <DriverExecutionBadge row={execution} date={day.date} />
                              </div>
                            ))}
                          </div>
                          <span className="min-w-0 max-w-full font-bold">
                            {order.customer}
                          </span>
                          <DriverNameLabel name={segment.label || "未安排"} isExternal={segment.isExternal}
                            className={`font-semibold ${segment.expired ? "bg-white text-red-600" : ""}`} />
                          <div className="grid w-full min-w-0"
                            style={{ gridTemplateColumns: `repeat(${segment.end - segment.start}, minmax(0, 1fr))` }}>
                            {barDates.slice(segment.start, segment.end).map(day => {
                              const summary = getTripSummary(order, day.date);
                              return <div key={day.date} className="min-w-0 px-1">
                                {summary && <span className="calendar-mobile-summary block break-words rounded bg-white/70 text-slate-800">
                                  {summary}
                                </span>}
                              </div>;
                            })}
                          </div>
                        </div>
                      ))}

                      {isMobileCalendar && !isCompactCalendar && (
                        <div
                          data-calendar-card-vehicle={vehicleRecord.id}
                          className={`calendar-card-content relative grid w-full gap-y-1 leading-4 ${isSplittable ? "pt-6" : ""} ${isSelectingSplit ? "pb-6" : ""}`}
                          style={{ gridTemplateColumns: `repeat(${barDates.length}, minmax(0, 1fr))`,
                            paddingTop: executionPadding + (isSplittable ? 24 : 0) }}
                        >
                          {infoSegmentStart !== -1 && (
                            <div
                              className="min-w-0 px-1"
                              style={{ gridColumn: `${infoSegmentStart + 1} / ${infoSegmentEnd + 1}` }}
                            >
                              <div className="flex flex-wrap items-center justify-center gap-x-2">
                                {order.time && <span>{order.time}</span>}
                                <span className="break-all font-bold">{order.customer}</span>
                                <span>{order.status}</span>
                              </div>
                              {(order.orderSource || getOrderDriverNames(order).some(Boolean)) && (
                                <div className="grid grid-cols-2 gap-1 break-all">
                                  <span>{orderSourceShortNameByRegion.get(`${order.regionId}:${order.orderSource}`) || order.orderSource || "未填写"}</span>
                                  <OrderDriverLabels order={order}
                                    className={orderDriverExpired ? "bg-white font-semibold text-red-600" : ""} />
                                </div>
                              )}
                            </div>
                          )}
                          {showTripSummaries && !isSelectingSplit && barDates.map((day, index) => (
                            <div
                              key={day.date}
                              className="row-start-2 min-w-0 break-all px-1"
                              style={{ gridColumn: index + 1 }}
                            >
                              {getTripSummary(order, day.date)}
                            </div>
                          ))}
                        </div>
                      )}

                      {!isMobileCalendar && driverSegments.map(segment => (
                        <div
                          key={segment.start}
                          style={{
                            left: `${(segment.start / barDates.length) * 100}%`,
                            width: `${((segment.end - segment.start) / barDates.length) * 100}%`,
                            top: executionPadding,
                          }}
                          className={`absolute inset-y-0 z-10 flex flex-col items-center justify-center gap-0 px-1 ${isSelectingSplit ? "pointer-events-none pb-5" : showTripSummaries ? "pb-4" : ""}`}
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
                          {(order.orderSource || segment.driver) && (
                            <div className="grid w-full grid-cols-2 gap-1">
                              <div
                                className="min-w-0 truncate"
                                title={order.orderSource || "未填写"}
                              >
                                {orderSourceShortNameByRegion.get(`${order.regionId}:${order.orderSource}`) || order.orderSource || "未填写"}
                              </div>
                              <DriverNameLabel name={segment.label || "未安排"} isExternal={segment.isExternal}
                                className={`min-w-0 truncate ${segment.expired ? "rounded bg-white px-1 font-semibold text-red-600" : ""}`} />
                            </div>
                          )}
                          <CalendarInvoiceStatus status={order.invoiceStatus} />
                        </div>
                      ))}

                      {!isMobileCalendar && showTripSummaries && !isSelectingSplit && (
                        <div
                          className="pointer-events-none absolute inset-x-0 bottom-0.5 z-20 grid"
                          style={{ gridTemplateColumns: `repeat(${barDates.length}, minmax(0, 1fr))` }}
                        >
                          {barDates.map((day) => {
                            const tripSummary = getTripSummary(order, day.date);
                            return (
                              <div key={day.date} className="min-w-0 px-1">
                                {tripSummary && (
                                  <span
                                    className="pointer-events-auto block truncate rounded bg-white/70 px-1 text-xs leading-4 text-slate-800"
                                    title={tripSummary}
                                  >
                                    {tripSummary}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }))}
              </div>
            );
          })}
        </div>
      </div>
            </>
          )}

          {activeView === "orders" && (
            <div className="p-3 md:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">予約管理</h2>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-gray-600">日期</span>
                  <button
                    type="button"
                    aria-label="選択预约筛选日期"
                    aria-haspopup="dialog"
                    disabled={!orderMonth}
                    onClick={() => setShowOrderDateFilter(true)}
                    className="rounded border bg-white px-3 py-2 text-sm disabled:opacity-40"
                  >
                    {orderDateFilter || "全部日期"}
                  </button>
                  {showOrderDateFilter && (
                    <OrderDateFilterDialog
                      month={orderMonth}
                      selected={orderDateFilter}
                      onSelect={(date) => {
                        setOrderDateFilter(date);
                      }}
                      onClose={() => setShowOrderDateFilter(false)}
                    />
                  )}
                  <label htmlFor="order-vehicle-filter" className="text-sm font-medium text-gray-600">
                    車両番号
                  </label>
                  <select
                    id="order-vehicle-filter"
                    value={orderVehicleFilter}
                    onChange={(event) => setOrderVehicleFilter(event.target.value)}
                    className="rounded border bg-white px-3 py-2 text-sm"
                  >
                    <option value="">全部車両番号</option>
                    {orderVehicleFilterOptions.map((plate) => (
                      <option key={plate} value={plate}>
                        {plate}
                      </option>
                    ))}
                    <option value={UNASSIGNED_ORDER_VEHICLE}>未安排車両番号</option>
                  </select>
                  <label htmlFor="order-driver-filter" className="text-sm font-medium text-gray-600">
                    運転士
                  </label>
                  <select
                    id="order-driver-filter"
                    value={orderDriverFilter}
                    onChange={(event) => setOrderDriverFilter(event.target.value)}
                    className="rounded border bg-white px-3 py-2 text-sm"
                  >
                    <option value="">全部運転士</option>
                    {orderDriverFilterOptions.map((driver) => (
                      <option key={driver} value={driver}>
                        {driver}
                      </option>
                    ))}
                    <option value={UNASSIGNED_ORDER_DRIVER}>未安排運転士</option>
                  </select>
                  <span className="text-sm font-medium text-gray-600">
                    来源
                  </span>
                  <button
                    type="button"
                    aria-label="筛选訂単来源"
                    onClick={() => setSourceSelectionOpen("order-filter")}
                    title={orderSourceFilter || undefined}
                    className="rounded border bg-white px-3 py-2 text-sm"
                  >
                    {orderSourceFilter === ""
                      ? "全部来源"
                      : orderSourceFilter === UNSOURCED_ORDER
                        ? "未填写"
                        : getSourceDisplayName(orderSourceFilter, activeRegionId === ALL_REGIONS_ID ? undefined : activeRegionId)}
                    {" · 点击選択"}
                  </button>
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
              <div className="calendar-date-controls mb-3 mt-0 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-2 py-1.5 shadow-sm">
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-label={`選択预约年份，当前${orderMonth.slice(0, 4)}年`}
                  onClick={() => setOrderYearPickerStart(
                    Math.min(2089, Math.max(2020, Number(orderMonth.slice(0, 4)) - 5)),
                  )}
                  className="calendar-year-button rounded-full border border-slate-200 bg-white px-3 py-1 text-center text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100"
                >
                  {orderMonth.slice(0, 4)}年
                </button>
                {orderYearPickerStart !== null && (
                  <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
                    <section
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="order-year-dialog-title"
                      onKeyDown={(event) => { if (event.key === "Escape") setOrderYearPickerStart(null); }}
                      className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl"
                    >
                      <div className="dialog-floating-header mb-4 flex items-center justify-between gap-3">
                        <h2 id="order-year-dialog-title" className="text-lg font-bold">選択预约年份</h2>
                        <button type="button" aria-label="关闭" onClick={() => setOrderYearPickerStart(null)} className="text-2xl text-gray-500">
                          ×
                        </button>
                      </div>
                      <div className="mb-3 flex items-center justify-between">
                        <button
                          type="button"
                          aria-label="上一组预约年份"
                          disabled={orderYearPickerStart <= 2020}
                          onClick={() => setOrderYearPickerStart((start) => Math.max(2020, (start ?? 2020) - 12))}
                          className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                        >
                          ‹
                        </button>
                        <span className="text-sm font-semibold text-slate-600">
                          {orderYearPickerStart} ～ {Math.min(2100, orderYearPickerStart + 11)}
                        </span>
                        <button
                          type="button"
                          aria-label="下一组预约年份"
                          disabled={orderYearPickerStart + 12 > 2100}
                          onClick={() => setOrderYearPickerStart((start) => Math.min(2089, (start ?? 2020) + 12))}
                          className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                        >
                          ›
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {Array.from({ length: 12 }, (_, index) => orderYearPickerStart + index)
                          .filter((year) => year <= 2100)
                          .map((year) => {
                            const selected = year === Number(orderMonth.slice(0, 4));
                            return (
                              <button
                                key={year}
                                type="button"
                                aria-pressed={selected}
                                autoFocus={selected}
                                onClick={() => {
                                  setOrderMonth(`${year}-${orderMonth.slice(5, 7)}`);
                                  setOrderDateFilter("");
                                  setOrderYearPickerStart(null);
                                }}
                                className={`rounded-lg border py-2 text-sm font-semibold transition-colors ${selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"}`}
                              >
                                {year}年
                              </button>
                            );
                          })}
                      </div>
                    </section>
                  </div>
                )}
                <div className="calendar-month-buttons grid min-w-0 flex-1 grid-cols-6 gap-1 sm:grid-cols-12 sm:flex-nowrap sm:items-center sm:justify-center" role="group" aria-label="選択预约月份">
                  {Array.from({ length: 12 }, (_, index) => {
                    const month = String(index + 1).padStart(2, "0");
                    const selected = orderMonth.slice(5, 7) === month;
                    return (
                      <button
                        key={month}
                        type="button"
                        aria-label={`${Number(month)}月`}
                        aria-pressed={selected}
                        onClick={() => {
                          setOrderMonth(`${orderMonth.slice(0, 4)}-${month}`);
                          setOrderDateFilter("");
                        }}
                        className={`min-w-0 rounded-full border py-1 text-center text-xs font-semibold transition-colors sm:flex-1 ${
                          selected
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {Number(month)}月
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="overflow-x-auto border bg-white">
                <table className="w-full min-w-[1400px] table-fixed text-center text-sm">
                  <colgroup>
                    <col className="w-[16%]" />
                    <col className="w-[8%]" />
                    <col className="w-[8%]" />
                    <col className="w-[24%]" />
                    <col className="w-[9%]" />
                    <col className="w-[9%]" />
                    <col className="w-[10%]" />
                    <col className="w-[9%]" />
                    <col className="w-[7%]" />
                  </colgroup>
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-2 py-3 font-semibold">用車日期</th>
                      <th className="px-2 py-3 font-semibold">配車時間</th>
                      <th className="px-2 py-3 font-semibold">手配状態</th>
                      <th className="px-2 py-3 font-semibold">予約情報</th>
                      <th className="px-2 py-3 font-semibold">車両</th>
                      <th className="px-2 py-3 font-semibold">運転士</th>
                      <th className="px-2 py-3 font-semibold">来源</th>
                      <th className="px-2 py-3 font-semibold">請求書状態</th>
                      <th className="px-2 py-3 font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupReservationOrders(monthlyOrders)
                      .map(({ order, count }) => {
                        const isInvoiceStatusSaving = invoiceStatusSavingIds.has(order.id);
                        return (
                        <tr key={order.id} className="border-t hover:bg-gray-50">
                          <td className="whitespace-nowrap px-2 py-3">
                            {formatOrderDate(order.date)}
                            {order.endDate && order.endDate !== order.date && ` ～ ${formatOrderDate(order.endDate)}`}
                          </td>
                          <td className="whitespace-nowrap px-2 py-3">{order.time}</td>
                          <td className="px-2 py-3">
                            <span
                              className={`rounded border px-2 py-1 text-xs ${isOrderArranged(order) ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}
                            >
                              {isOrderArranged(order) ? "完成" : "未完成"}
                            </span>
                          </td>
                          <td className="break-words px-2 py-3">
                            <button
                              type="button"
                              onClick={() => openEditOrder(order)}
                              className="font-medium text-blue-700 hover:underline"
                            >
                              {order.customer}
                            </button>
                            <div><DriverExecutionBadge row={driverExecutionByOrder.get(order.id)}
                              date={driverExecution.data?.date ?? todayDateKey} /></div>
                            {order.importBatchId && (
                              <span className="ml-2 whitespace-nowrap rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                                合计{count}单
                              </span>
                            )}
                          </td>
                          <td className="break-words px-2 py-3">
                            <button
                              type="button"
                              onClick={() => {
                                setOrderDetailsMode("vehicle");
                                setSelectedOrderDetails(order);
                              }}
                              className="font-medium text-blue-700 hover:underline"
                            >
                              {order.vehicle}
                              <span className="block text-xs text-gray-500">{getOrderVehicleNumber(order)}</span>
                            </button>
                          </td>
                          <td className="break-words px-2 py-3">
                            <button
                              type="button"
                              aria-haspopup="dialog"
                              aria-label={`選任運転士：${order.customer}`}
                              onClick={() => setDriverSelectionTarget(order.id)}
                              className="font-medium text-blue-700 hover:underline"
                            >
                              <OrderDriverLabels order={order} />
                            </button>
                          </td>
                          <td className="break-words px-2 py-3">{order.orderSource || "未填写"}</td>
                          <td className="px-2 py-3">
                            <div className="flex flex-col items-center gap-1">
                              <button
                                type="button"
                                disabled={isInvoiceStatusSaving}
                                aria-label={`${order.customer} 請求書状態：${order.invoiceStatus}，点击切换`}
                                aria-busy={isInvoiceStatusSaving}
                                title="点击選択請求書状態和变更范围"
                                onClick={() => openOrderStatusDialog(order, "invoice", "reservation")}
                                className={`rounded border px-2 py-1 text-xs font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${order.invoiceStatus === "已完成" ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100" : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"}`}
                              >
                                {isInvoiceStatusSaving ? "保存中…" : order.invoiceStatus}
                              </button>
                            </div>
                          </td>
                          <td className="px-2 py-3">
                            <div className="flex flex-nowrap items-center justify-center gap-2">
                              <button
                                type="button"
                                onClick={() => openAccounting(order)}
                                className={`inline-flex w-14 items-center justify-center whitespace-nowrap rounded border py-1 text-xs font-semibold transition-colors ${
                                  order.accountingStatus === "完成核算"
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                    : "border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200"
                                }`}
                                aria-label={`${order.customer} 核算状態：${order.accountingStatus === "完成核算" ? "核算完成" : "未完成，財務統計"}`}
                              >
                                {order.accountingStatus === "完成核算" ? "核算完成" : "財務統計"}
                              </button>
                              <button
                                type="button"
                                onClick={() => requestOrderDeletion(order)}
                                className="table-action-button table-action-button--delete w-14"
                              >
                                删除
                              </button>
                            </div>
                          </td>
                        </tr>
                        );
                      })}
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

          {invoiceStatusDialog && invoiceStatusDialogOrder && (
            <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4">
              <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="invoice-status-dialog-title"
                aria-busy={isInvoiceStatusDialogSaving}
                className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-2xl sm:p-6"
              >
                <div className="dialog-floating-header mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h2 id="invoice-status-dialog-title" className="text-lg font-bold">
                      更改{invoiceStatusDialog.kind === "invoice" ? "請求書" : "入金"}状態
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">{invoiceStatusDialogOrder.customer}</p>
                  </div>
                  <button
                    type="button"
                    disabled={isInvoiceStatusDialogSaving}
                    aria-label="关闭"
                    onClick={() => setInvoiceStatusDialog(null)}
                    className="text-2xl text-gray-500"
                  >
                    ×
                  </button>
                </div>

                <fieldset>
                  <legend className="mb-2 text-sm font-semibold">
                    {invoiceStatusDialog.kind === "invoice" ? "選択請求書状態" : "選択入金状態"}
                  </legend>
                  <div className="grid grid-cols-2 gap-3">
                    {(invoiceStatusDialog.kind === "invoice"
                      ? (["未完成", "已完成"] as const)
                      : (["unpaid", "paid"] as const)).map((status) => {
                      const statusLabel = status === "paid" ? "入金済み"
                        : status === "unpaid" ? "未入金" : status;
                      const selected = invoiceStatusDialog.status === status;
                      return (
                      <label
                        key={statusLabel}
                        className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border p-3 text-sm font-semibold transition-colors ${selected
                          ? status === "已完成" || status === "paid"
                            ? "border-green-500 bg-green-50 text-green-800 ring-2 ring-green-100"
                            : "border-red-400 bg-red-50 text-red-800 ring-2 ring-red-100"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                      >
                        <input
                          type="radio"
                          name="invoice-status"
                          value={statusLabel}
                          disabled={isInvoiceStatusDialogSaving}
                          checked={selected}
                          onChange={() => setInvoiceStatusDialog((current) =>
                            current ? { ...current, status } : current)}
                        />
                        {statusLabel}
                      </label>
                    );})}
                  </div>
                </fieldset>

                <fieldset className="mt-5">
                  <legend className="mb-2 text-sm font-semibold">变更范围</legend>
                  <div className="space-y-2">
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-gray-50">
                      <input
                        type="radio"
                        name="invoice-status-scope"
                        checked={invoiceStatusDialog.scope === "single"}
                        disabled={isInvoiceStatusDialogSaving}
                        onChange={() => setInvoiceStatusDialog((current) =>
                          current ? { ...current, scope: "single" } : current)}
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-sm font-medium">
                          {(invoiceStatusDialog.origin === "reservation" ||
                            invoiceStatusDialog.origin === "finance-batch") && invoiceStatusDialogOrder.importBatchId
                            ? `当前导入批次（${invoiceStatusDialog.month} ${invoiceStatusDialogSingleTargets.length} 笔）`
                            : "仅此訂単"}
                        </span>
                        {(invoiceStatusDialog.origin === "reservation" ||
                          invoiceStatusDialog.origin === "finance-batch") && invoiceStatusDialogOrder.importBatchId && (
                          <span className="mt-1 block text-xs text-gray-500">
                            列表中合并显示的同批次訂単会一起变更。
                          </span>
                        )}
                      </span>
                    </label>
                    <label className={`flex items-start gap-3 rounded-lg border p-3 ${invoiceStatusDialogSourceTargets.length > 1
                      ? "cursor-pointer hover:bg-gray-50"
                      : "cursor-not-allowed bg-gray-50 text-gray-400"}`}>
                      <input
                        type="radio"
                        name="invoice-status-scope"
                        checked={invoiceStatusDialog.scope === "source"}
                        disabled={invoiceStatusDialogSourceTargets.length < 2 || isInvoiceStatusDialogSaving}
                        onChange={() => setInvoiceStatusDialog((current) =>
                          current ? { ...current, scope: "source" } : current)}
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-sm font-medium">
                          {invoiceStatusDialog.month} 同来源訂単（{invoiceStatusDialogSourceTargets.length} 笔）
                        </span>
                        <span className="mt-1 block text-xs">
                          {invoiceStatusDialogOrder.orderSource
                            ? `来源：${invoiceStatusDialogOrder.orderSource}`
                            : "该訂単未填写来源，无法批量变更。"}
                          {" · "}仅包含该月份内、同地域且来源完全一致的訂単。
                        </span>
                      </span>
                    </label>
                  </div>
                </fieldset>

                <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-600" role="status">
                  将变更 {invoiceStatusDialogChangedCount} 笔訂単为「{
                    invoiceStatusDialog.status === "paid" ? "入金済み"
                      : invoiceStatusDialog.status === "unpaid" ? "未入金" : invoiceStatusDialog.status
                  }」。
                  {invoiceStatusDialog.kind === "deposit" && invoiceStatusDialog.status === "paid" && (
                    <span className="mt-1 block text-xs">新标记为已入金的訂単将記録今天（{todayDateKey}）为入金日；已有入金日保留。</span>
                  )}
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={isInvoiceStatusDialogSaving}
                    onClick={() => setInvoiceStatusDialog(null)}
                    className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={invoiceStatusDialogChangedCount === 0 || isInvoiceStatusDialogSaving}
                    onClick={() => void saveInvoiceStatusDialog()}
                    className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isInvoiceStatusDialogSaving ? "保存中…" : "确认变更"}
                  </button>
                </div>
              </section>
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
              <div className="mb-4 flex flex-wrap items-end gap-3 rounded border bg-white p-3">
                <label className="min-w-[min(100%,20rem)] flex-1 text-sm font-medium">
                  全体标语（運転士端顶部显示）
                  <input
                    type="text"
                    maxLength={100}
                    value={driverGlobalSlogan}
                    readOnly={currentProfile?.role !== "admin"}
                    disabled={!driverGlobalSloganLoaded || driverGlobalSloganLoading || driverGlobalSloganSaving}
                    onChange={(event) => setDriverGlobalSlogan(event.target.value)}
                    className="mt-1 w-full rounded border p-2 read-only:bg-gray-50"
                    placeholder={driverGlobalSloganLoading ? "正在读取…" : driverGlobalSloganError ? "读取失败，无法编辑" : ""}
                  />
                </label>
                {currentProfile?.role === "admin" && <button
                  type="button"
                  onClick={() => void saveDriverGlobalSlogan()}
                  disabled={!driverGlobalSloganLoaded || driverGlobalSloganLoading || driverGlobalSloganSaving}
                  className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {driverGlobalSloganSaving ? "保存中…" : "保存全体标语"}
                </button>}
                {driverGlobalSloganError && <p role="alert" className="w-full text-sm text-red-700">{driverGlobalSloganError}</p>}
              </div>
              <div
                className="driver-table-region border bg-white"
                role="region"
                aria-label="運転士列表"
              >
                <DriverLoginProvider>
                <table className="management-table driver-management-table w-full min-w-[1800px] table-fixed text-center text-sm" data-table="drivers">
                  <colgroup>
                    <col style={{ width: "12%" }} /><col style={{ width: "18%" }} />
                    <col style={{ width: "13%" }} /><col style={{ width: "13%" }} />
                    <col style={{ width: "13%" }} /><col style={{ width: "14%" }} />
                    <col style={{ width: "17%" }} />
                  </colgroup>
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">運転士</th>
                      <th className="px-4 py-3 font-semibold">姓名读音（罗马字）</th>
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
                        <td data-label="運転士" className={`whitespace-nowrap px-4 py-3 font-medium ${isDriverLicenseExpired(driver) ? "text-red-600" : ""}`}>{driver.name}</td>
                        <td data-label="姓名读音（罗马字）" className="whitespace-nowrap px-4 py-3">{driver.reading || "-"}</td>
                        <td data-label="携帯番号" className="px-4 py-3">{driver.phone || "-"}</td>
                        <td data-label="微信号" className="px-4 py-3">{driver.wechat || "-"}</td>
                        <td data-label="WhatsApp" className="px-4 py-3">{driver.whatsapp || "-"}</td>
                        <td data-label="免許有効期限" className="whitespace-nowrap px-4 py-3">{driver.licenseExpiry || "-"}</td>
                        <td data-label="操作" className="px-4 py-3">
                          <div className="driver-action-buttons">
                            <div className="driver-action-slot">
                            <button
                              type="button"
                              onClick={() => openEditDriver(driver)}
                              className="table-action-button table-action-button--edit driver-action-button"
                            >
                              编辑
                            </button>
                            </div>
                            <div className="driver-action-slot">
                            <DriverMobileDialog
                              driverId={driver.id}
                              name={driver.name}
                              regionId={driver.regionId}
                              disabled={driver.id.startsWith("unregistered-driver-")}
                              slogan={driverSloganDrafts[driver.id] ?? driver.personalSlogan ?? ""}
                              onSloganChange={(value) => setDriverSloganDrafts((current) => ({
                                ...current, [driver.id]: value,
                              }))}
                              onSloganBlur={(value) => {
                                if (driver.id.startsWith("unregistered-driver-")) return;
                                const personalSlogan = value.trim();
                                setDriverSloganDrafts((current) => ({ ...current, [driver.id]: personalSlogan }));
                                if (personalSlogan === (driver.personalSlogan ?? "")) return;
                                setDriverRecords((current) => current.map((record) =>
                                  record.id === driver.id ? { ...record, personalSlogan } : record,
                                ));
                              }}
                            />
                            </div>
                            <div className="driver-action-slot">
                            <button
                              type="button"
                              onClick={() => deleteDriver(driver)}
                              className="table-action-button table-action-button--delete driver-action-button"
                            >
                              删除
                            </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </DriverLoginProvider>
              </div>
            </div>
          )}

          {activeView === "vehicles" && (
            <div className="p-4 md:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold">車両列表</h2>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <label className="flex items-center gap-2 text-sm text-gray-600">
                    車両所属
                    <select
                      aria-label="車両所属筛选"
                      className="rounded border px-2 py-1.5 text-sm text-gray-900"
                      value={vehicleOwnerFilter === null ? "__all__" : vehicleOwnerFilter || "__none__"}
                      onChange={(event) => {
                        const value = event.target.value;
                        setVehicleOwnerFilter(
                          value === "__all__" ? null : value === "__none__" ? "" : value,
                        );
                      }}
                    >
                      <option value="__all__">全部</option>
                      {vehicleOwnerOptions.map((owner) => (
                        <option key={owner} value={owner}>{owner}</option>
                      ))}
                      <option value="__none__">未设置</option>
                    </select>
                  </label>
                  <span className="text-sm text-gray-500">共 {filteredVehicleRows.length} 両</span>
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
                <table className="management-table w-full min-w-[1450px] table-fixed text-center text-sm" data-table="vehicles">
                  <colgroup>
                    <col style={{ width: "10%" }} /><col style={{ width: "12%" }} />
                    <col style={{ width: "15%" }} /><col style={{ width: "5%" }} />
                    <col style={{ width: "7%" }} /><col style={{ width: "10%" }} />
                    <col style={{ width: "10%" }} /><col style={{ width: "7%" }} />
                    <col style={{ width: "17%" }} /><col style={{ width: "7%" }} />
                  </colgroup>
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
                    {filteredVehicleRows.map((vehicle) => (
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
                          <div className="list-action-buttons">
                            <div className="driver-action-slot">
                            <button
                              type="button"
                              onClick={() => openEditVehicle(vehicle)}
                              className="table-action-button table-action-button--edit driver-action-button"
                            >
                              编辑
                            </button>
                            </div>
                            <div className="driver-action-slot">
                            <button
                              type="button"
                              onClick={() => deleteVehicle(vehicle)}
                              className="table-action-button table-action-button--delete driver-action-button"
                            >
                              删除
                            </button>
                            </div>
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
                <table className="management-table w-full min-w-[1250px] table-fixed text-center text-sm" data-table="sources">
                  <colgroup>
                    <col className="w-[10%]" />
                    <col className="w-[24%]" />
                    <col className="w-[9%]" />
                    <col className="w-[8%]" />
                    <col className="w-[15%]" />
                    <col className="w-[26%]" />
                    <col className="w-[8%]" />
                  </colgroup>
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 font-semibold">颜色</th>
                      <th className="px-3 py-2 font-semibold">会社全称</th>
                      <th className="px-3 py-2 font-semibold">簡称</th>
                      <th className="px-3 py-2 font-semibold">担当</th>
                      <th className="px-3 py-2 font-semibold">連絡先</th>
                      <th className="px-3 py-2 font-semibold">地址</th>
                      <th className="px-3 py-2 font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sourceRows.map((source) => (
                      <tr key={source.id} className="border-t">
                        <td className="whitespace-nowrap px-3 py-2 font-medium">
                          <SourceColorPicker
                            color={source.color || "#94a3b8"}
                            sourceName={source.companyName}
                            onSelect={(color) => updateSourceColor(source, color)}
                          />
                        </td>
                        <td className="truncate px-3 py-2 font-medium" title={source.companyName}>{source.companyName}</td>
                        <td className="truncate px-3 py-2" title={source.shortName || undefined}>{source.shortName || "-"}</td>
                        <td className="truncate px-3 py-2" title={source.contactName || undefined}>{source.contactName || "-"}</td>
                        <td className="truncate px-3 py-2" title={source.contactInfo || undefined}>{source.contactInfo || "-"}</td>
                        <td className="break-words px-3 py-2">{source.address || "-"}</td>
                        <td className="px-3 py-2">
                          <div className="list-action-buttons">
                            <div className="driver-action-slot">
                            <button
                              type="button"
                              onClick={() => openEditSource(source)}
                              className="table-action-button table-action-button--edit driver-action-button"
                            >
                              编辑
                            </button>
                            </div>
                            <div className="driver-action-slot">
                            <button
                              type="button"
                              onClick={() => deleteSource(source)}
                              className="table-action-button table-action-button--delete driver-action-button"
                            >
                              删除
                            </button>
                            </div>
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
              <div className="company-table-region border bg-white">
                <table className="management-table company-management-table w-full min-w-[1900px] table-fixed text-center text-sm" data-table="companies">
                  <colgroup>
                    <col style={{ width: "13%" }} /><col style={{ width: "6%" }} />
                    <col style={{ width: "7%" }} /><col style={{ width: "7%" }} />
                    <col style={{ width: "9%" }} /><col style={{ width: "15%" }} />
                    <col style={{ width: "15%" }} /><col style={{ width: "14%" }} />
                    <col style={{ width: "8%" }} /><col style={{ width: "6%" }} />
                  </colgroup>
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">会社名称</th>
                      <th className="px-4 py-3 font-semibold">会社印章</th>
                      <th className="px-4 py-3 font-semibold">運行管理者</th>
                      <th className="px-4 py-3 font-semibold">整備管理者</th>
                      <th className="px-4 py-3 font-semibold">会社电话</th>
                      <th className="px-4 py-3 font-semibold">営業所地址</th>
                      <th className="px-4 py-3 font-semibold">車庫位置</th>
                      <th className="px-4 py-3 font-semibold">振込口座</th>
                      <th className="px-4 py-3 font-semibold">T番号</th>
                      <th className="px-4 py-3 font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companyRows.map((company) => (
                      <tr key={company.id} className="border-t">
                        <td data-label="会社名称" className="px-4 py-3 font-medium">{company.name}</td>
                        <td data-label="会社印章" className="px-4 py-3">
                          <button type="button" onClick={() => openCompanySeal(company)}
                            className="rounded border px-2 py-1 text-blue-700 hover:bg-blue-50"
                            aria-label={`设置印章：${company.name}`}>
                            {company.sealImage
                              ? <Image src={company.sealImage} alt={`${company.name}印章`} width={48} height={48} unoptimized className="h-12 w-12 object-contain" />
                              : "上传印章"}
                          </button>
                        </td>
                        <td data-label="運行管理者" className="px-4 py-3">{company.operationsManager || "-"}</td>
                        <td data-label="整備管理者" className="px-4 py-3">{company.maintenanceManager || "-"}</td>
                        <td data-label="会社电话" className="px-4 py-3">{company.phone || "-"}</td>
                        <td data-label="営業所地址" className="px-4 py-3">{company.rollCallAddress || "-"}</td>
                        <td data-label="車庫位置" className="px-4 py-3">{company.garageAddress || "-"}</td>
                        <td data-label="振込口座" className="whitespace-pre-wrap px-4 py-3">{company.bankAccount || "-"}</td>
                        <td data-label="T番号" className="px-4 py-3">{company.taxRegistrationNumber || "-"}</td>
                        <td data-label="操作" className="px-4 py-3">
                          <div className="list-action-buttons">
                            <div className="driver-action-slot">
                            <button
                              type="button"
                              onClick={() => openEditCompany(company)}
                              className="table-action-button table-action-button--edit driver-action-button"
                            >
                              编辑
                            </button>
                            </div>
                            <div className="driver-action-slot">
                            <button
                              type="button"
                              onClick={() => deleteCompany(company)}
                              className="table-action-button table-action-button--delete driver-action-button"
                            >
                              删除
                            </button>
                            </div>
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

      {sealCompany && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="company-seal-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <div className="dialog-floating-header mb-4 flex items-center justify-between gap-3">
              <h2 id="company-seal-title" className="text-xl font-bold">会社印章</h2>
              <button type="button" aria-label="关闭会社印章" onClick={() => setSealCompany(null)}
                className="text-2xl text-gray-500">×</button>
            </div>
            <p className="mb-4 break-words text-sm font-semibold">{sealCompany.name}</p>
            <CompanySealUpload standalone value={sealDraft} onChange={setSealDraft} onBusyChange={setSealUploadBusy} />
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={saveCompanySeal} disabled={sealUploadBusy}
                className="rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-40">
                保存印章
              </button>
            </div>
          </section>
        </div>
      )}

      {showBatchOrderForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="dialog-floating-header mb-5 flex items-center justify-between">
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
              系统会从每条信息中识别“配車時間、上車地点、下車地点”；以下状態、運転士、来源和所属公司将应用于本批所有訂単。
            </p>
            <div className="space-y-4">
              <label className="block text-sm font-medium">
                用車日期
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
                  {availableVehicleRecords.map((vehicle) => (
                    <option key={vehicle.id} value={vehicle.id}>
                      {vehicle.plate ? `${vehicle.plate}（${vehicle.name}）` : vehicle.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                预约状態
                <select
                  value={batchOrderStatus}
                  onChange={(event) => setBatchOrderStatus(event.target.value as OrderStatus)}
                  className="mt-1 w-full rounded border px-3 py-2"
                >
                  <option value="仮予約">仮予約</option>
                  <option value="予約確定">予約確定</option>
                  <option value="キャンセル">キャンセル</option>
                </select>
              </label>
              <div className="block text-sm font-medium">
                運転士
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => setDriverSelectionTarget("batch")}
                  className="mt-1 w-full rounded border px-3 py-2 text-left hover:bg-blue-50"
                >
                  {batchOrderDriver || "未安排運転士"} · 点击選任
                </button>
              </div>
              <div className="block text-sm font-medium">
                来源
                <button type="button" aria-haspopup="dialog"
                  onClick={() => setSourceSelectionOpen("batch")}
                  title={batchOrderSource || undefined}
                  className="mt-1 w-full rounded border px-3 py-2 text-left hover:bg-blue-50">
                  {(batchOrderSource
                    ? orderSourceShortNameByRegion.get(`${getRegionForNewRecords()}:${batchOrderSource}`) || batchOrderSource
                    : "未填写来源")} · 点击選択
                </button>
              </div>
              <label className="block text-sm font-medium">
                所属公司
                <select
                  value={batchOrderCustomCompanyMode ? "__custom_company__" : batchOrderCompany}
                  onChange={(event) => {
                    if (event.target.value === "__custom_company__") {
                      setBatchOrderCustomCompanyMode(true);
                      setBatchOrderCompany("");
                    } else {
                      setBatchOrderCustomCompanyMode(false);
                      setBatchOrderCompany(event.target.value);
                    }
                  }}
                  className="mt-1 w-full rounded border px-3 py-2"
                >
                  <option value="">請選択所属公司</option>
                  {companies.map((company) => (
                    <option key={company} value={company}>{company}</option>
                  ))}
                  <option value="__custom_company__">＋ 手動输入新公司</option>
                </select>
                {batchOrderCustomCompanyMode && (
                  <input
                    type="text"
                    value={batchOrderCompany}
                    onChange={(event) => setBatchOrderCompany(event.target.value)}
                    placeholder="請输入所属公司"
                    className="mt-2 w-full rounded border px-3 py-2"
                  />
                )}
              </label>
              <label className="block text-sm font-medium">
                预约信息
                <textarea
                  rows={8}
                  autoFocus
                  value={batchOrderInput}
                  onChange={(event) => setBatchOrderInput(event.target.value)}
                  placeholder={"06:30 出発地 结束地\n06:45 出発地 结束地"}
                  className="mt-1 w-full resize-y rounded border p-2 font-mono text-sm"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={importBatchOrders}
                className="rounded bg-blue-600 px-5 py-2 font-bold text-white hover:bg-blue-700"
              >
                生成訂単
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新建 / 编辑予約窗口 */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="dialog-floating-header mb-5 flex items-center justify-between">
              <h2 className="text-xl font-bold">
                {editingOrderId === null ? "新建訂単" : "編集訂単"}
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
              {/* 訂単名称 */}
              <label className="block text-sm font-medium">
                訂単名称
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
                    if (!nextDate) return;
                    const dateOffset = Math.round(
                      (new Date(`${nextDate}T00:00:00Z`).getTime() -
                        new Date(`${form.date}T00:00:00Z`).getTime()) / 86_400_000,
                    );
                    const nextEndDate = form.endDate < nextDate
                      ? nextDate
                      : form.endDate;
                    setForm({
                      ...form,
                      date: nextDate,
                      financeByDate: shiftFinanceDates(form.financeByDate, dateOffset),
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

              {/* 来源 */}
              <div className="block text-sm font-medium">
                来源
                <button type="button" aria-haspopup="dialog"
                  onClick={() => setSourceSelectionOpen("form")}
                  title={form.orderSource || undefined}
                  className="mt-1 w-full rounded border p-2 text-left hover:bg-blue-50">
                  {(form.orderSource
                    ? orderSourceShortNameByRegion.get(`${form.regionId || getRegionForNewRecords()}:${form.orderSource}`) || form.orderSource
                    : "未填写来源")} · 点击選択
                </button>
              </div>

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
                  {(form.status === "運行中" || form.status === "完了") && (
                    <option value={form.status} disabled>历史状態（已停用，保留原記録）</option>
                  )}
                  <option value="キャンセル">キャンセル</option>
                </select>
              </label>
              {/* 車両 */}
              <label className="block text-sm font-medium">
                車両
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={form.vehicle}
                  onChange={(e) => {
                    const sameName = orderFormVehicles.filter((vehicle) => vehicle.name === e.target.value);
                    setForm(current => changeOrderVehicle(current, {
                      name: e.target.value, plate: sameName.length === 1 ? sameName[0].plate : "",
                    }, (current.endDate || current.date) === current.date));
                  }}
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
                      disabled={!orderFormVehicleAvailableByName.get(vehicle)}
                    >
                      {vehicle}{!orderFormVehicleAvailableByName.get(vehicle) ? "（不可用于新予約）" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <OrderVehiclePlateSelect
                vehicles={orderFormVehicles}
                vehicleName={form.vehicle}
                vehiclePlate={form.vehiclePlate}
                getStatus={getVehicleDisplayStatus}
                onSelect={(vehicle) =>
                  setForm((current) => changeOrderVehicle(current, vehicle, (current.endDate || current.date) === current.date))
                }
              />
              {form.endDate !== form.date && <p className="text-xs text-gray-600">
                上方为訂単默认車両番号。
              </p>}

              <fieldset className="space-y-3 rounded border border-blue-200 bg-blue-50/40 p-3">
                <legend className="px-1 text-sm font-semibold">每日行程与車費</legend>
                <p className="text-xs text-gray-600">請在各用車日選択当日運転士并设置費用类型；運転士工資与外注運転士費用二选一。会社立替費用独立記録。</p>
                {getOrderDateKeys(form).map((date) => {
                  const finance = getReservationFinance(form)[date] || emptyOrderFinance;
                  return (
                  <div key={date} className="space-y-2 rounded border bg-white p-3">
                    <p className="text-sm font-semibold">
                      {date}{form.offDates.includes(date) ? "（休運）" : ""}
                    </p>
                    <label className="block text-sm font-medium">
                      行程簡概
                      <textarea
                        rows={2}
                        maxLength={1000}
                        placeholder="例：成田空港 → 都内ホテル"
                        className="mt-1 w-full resize-y rounded border p-2"
                        value={form.financeByDate[date]?.tripSummary || ""}
                        onChange={(event) => setForm((current) =>
                          updateReservationFinance(current, date, { tripSummary: event.target.value }),
                        )}
                      />
                    </label>
                    <label className="block text-sm font-medium">
                      当日車費（JPY）
                      <input
                        type="number"
                        min="0"
                        max="99999999999999"
                        step="1"
                        inputMode="numeric"
                        className="mt-1 w-full rounded border p-2"
                        value={form.financeByDate[date]?.dailyFare || ""}
                        onChange={(event) => setForm((current) =>
                          updateReservationFinance(current, date, {
                            dailyFare: event.target.value === "" ? 0 : Number(event.target.value),
                          }),
                        )}
                      />
                    </label>
                    {!form.offDates.includes(date) && (
                      <div className="space-y-2">
                        <FinanceDriverSelect
                          drivers={allDriverRecords}
                          orders={allOrders}
                          regionId={form.regionId || getRegionForNewRecords() || undefined}
                          today={todayDateKey}
                          serviceDate={date}
                          value={getServiceDriver(form, date)}
                          onChange={name => setForm(current => updateReservationDailyDriver(current, date, name))}
                        />
                        <label className="block text-sm font-medium">費用类型
                          <select aria-label={`${date} 運転士費用类型`} className="mt-1 w-full rounded border p-2"
                            value={finance.driverPaymentType || ""}
                            onChange={event => {
                              const type = event.target.value;
                              if (type !== "wage" && type !== "company_advance") return;
                              setForm(current => updateReservationFinance(current, date,
                                setReservationDriverPayment(getReservationFinance(current)[date] || emptyOrderFinance,
                                  type, getServiceDriver(current, date))));
                            }}>
                            <option value="" disabled>選択工資或外注</option>
                            <option value="wage">運転士工資</option>
                            <option value="company_advance">運転士外注</option>
                          </select>
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="block text-sm font-medium">運転士工資（JPY）
                            <input aria-label={`${date} 運転士工資`} type="number" min="0" max="99999999999999" step="1" inputMode="numeric"
                              disabled={finance.driverPaymentType !== "wage"}
                              className="mt-1 w-full rounded border p-2 disabled:bg-gray-100"
                              value={finance.driverWage || ""}
                              onChange={event => setForm(current => updateReservationFinance(current, date,
                                { driverWageMode: "fixed", driverWage: event.target.value === "" ? 0 : Number(event.target.value) }))} />
                          </label>
                          <label className="block text-sm font-medium">
                            {finance.driverPaymentType === "company_advance" ? "外注運転士費用（JPY）" : "運転士外注（JPY）"}
                            <input aria-label={`${date} ${finance.driverPaymentType === "company_advance" ? "外注運転士費用" : "運転士外注"}`} type="number" min="0" max="99999999999999" step="1" inputMode="numeric"
                              disabled={finance.driverPaymentType !== "company_advance"}
                              className="mt-1 w-full rounded border p-2 disabled:bg-gray-100"
                              value={finance.externalDriverFee || ""}
                              onChange={event => setForm(current => updateReservationFinance(current, date,
                                { externalDriverFee: event.target.value === "" ? 0 : Number(event.target.value) }))} />
                          </label>
                        </div>
                        {finance.driverPaymentType === "wage" && finance.driverWageMode === "percentage" &&
                          <p className="text-xs text-amber-700">当前为比例工資；输入快捷金額后改为固定工資，奖励及超時工資仍保留。</p>}
                        {finance.driverPaymentType === "company_advance" &&
                          <>
                          <label className="block text-sm font-medium">外注運転士出金方式
                            <select aria-label={`${date} 外注運転士出金方式`} className="mt-1 w-full rounded border p-2"
                              value={finance.companyAdvancePaymentMethod || ""}
                              onChange={event => {
                                const method = event.target.value;
                                if (method === "" || method === "paypay" || method === "微信" ||
                                  method === "支付宝" || method === "口座") {
                                  setForm(current => updateReservationFinance(current, date,
                                    { companyAdvancePaymentMethod: method }));
                                }
                              }}>
                              <option value="">未设置</option>
                              <option value="paypay">paypay</option>
                              <option value="微信">微信</option>
                              <option value="支付宝">支付宝</option>
                              <option value="口座">口座</option>
                            </select>
                          </label>
                          <label className="block text-sm font-medium">外注運転士出金状態
                            <select aria-label={`${date} 外注運転士出金状態`} className="mt-1 w-full rounded border p-2"
                              value={finance.companyAdvancePaymentStatus || ""}
                              onChange={event => {
                                const status = event.target.value;
                                if (status === "" || status === "已完成" || status === "未完成") {
                                  setForm(current => updateReservationFinance(current, date,
                                    { companyAdvancePaymentStatus: status }));
                                }
                              }}>
                              <option value="">未選択</option>
                              <option value="已完成">已完成</option>
                              <option value="未完成">未完成</option>
                            </select>
                          </label>
                          <label className="block text-sm font-medium">外注運転士备注
                            <textarea aria-label={`${date} 外注運転士备注`} rows={2} maxLength={1000}
                              className="mt-1 w-full rounded border p-2" value={finance.companyAdvancePaymentNote || ""}
                              onChange={event => setForm(current => updateReservationFinance(current, date,
                                { companyAdvancePaymentNote: event.target.value }))} />
                          </label>
                          </>}
                      </div>
                    )}
                  </div>
                  );
                })}
              </fieldset>

              <label className="block text-sm font-medium">
                配車時間
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={5}
                  pattern="([01]?[0-9]|2[0-3]):[0-5][0-9]"
                  title="請输入 0930 或 09:30 格式的有效時間"
                  aria-describedby="order-time-hint"
                  placeholder="0930"
                  className="mt-1 w-full rounded border p-2"
                  value={form.time}
                  onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))}
                  onBlur={(event) => setForm((current) => ({
                    ...current,
                    time: normalizeOrderTimeInput(event.target.value),
                  }))}
                />
                <span id="order-time-hint" className="mt-1 block text-xs font-normal text-gray-500">
                  可直接输入 0930，离开输入框后自動整理为 09:30；也可输入 09:30。
                </span>
              </label>

              {/* 上車地点 */}
              <label className="block text-sm font-medium">
                上車地点
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

              {/* 下車地点 */}
              <label className="block text-sm font-medium">
                下車地点
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
                  <option value="" disabled>請選択所属会社</option>
                  {companies.map((company) => (
                    <option key={company} value={company}>{company}</option>
                  ))}
                  <option value="__custom_company__">＋ 手動输入新公司</option>
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
                    placeholder="請输入公司名称"
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
            {editingOrderId !== null && (
              <div className="mt-6">
                <button
                  type="button"
                  onClick={deleteOrder}
                  className="table-action-button table-action-button--delete"
                >
                  删除予約
                </button>
              </div>
            )}
            <div className="pointer-events-none sticky bottom-3 z-10 mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => addOrder()}
                disabled={dialogSaving}
                className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-950/20 ring-4 ring-white/90 transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8" />
                </svg>
                {editingOrderId === null ? "保存予約" : "保存修改"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingOrderConflicts.length > 0 && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-conflict-title"
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
          >
            <div className="dialog-floating-header flex items-center justify-between gap-3">
              <h2 id="order-conflict-title" className="text-lg font-bold">配車時間冲突</h2>
              <button type="button" aria-label="关闭配車時間冲突"
                onClick={() => setPendingOrderConflicts([])} className="text-2xl text-gray-500">×</button>
            </div>
            <p className="mt-3 text-sm text-gray-700">
              以下予約在相同日期与本予約使用同一車両或同一運転士，且時間重复或相近（2小時内）：
            </p>
            <ul className="mt-2 space-y-2 text-sm text-gray-700">
              {pendingOrderConflicts.map(({ order, vehicles, drivers }) => (
                <li key={order.id}>
                  {order.date}
                  {order.endDate && order.endDate !== order.date ? ` ～ ${order.endDate}` : ""}
                  {" "}{order.time || "未填写時間"} · {order.customer || "未填写客户"}
                  <div className="text-xs font-bold text-red-600">
                    {vehicles.length > 0 && `車両重复：${vehicles.join("、")}`}
                    {vehicles.length > 0 && drivers.length > 0 && "　"}
                    {drivers.length > 0 && `運転士重复：${drivers.join("、")}`}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => addOrder(true)}
                disabled={dialogSaving}
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
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="driver-form-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
          >
            <div className="dialog-floating-header mb-5 flex items-center justify-between">
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
                姓名读音（罗马字，用于A-Z排序）
                <input
                  type="text"
                  maxLength={200}
                  className="mt-1 w-full rounded border p-2"
                  value={driverForm.reading}
                  onChange={(event) => setDriverForm({ ...driverForm, reading: event.target.value })}
                  placeholder="例如：TANAKA TARO"
                />
              </label>
              <label className="block text-sm font-medium">
                个人标语（留空時手机端显示“姓名，你好”）
                <input
                  type="text"
                  maxLength={100}
                  className="mt-1 w-full rounded border p-2"
                  value={driverForm.personalSlogan}
                  onChange={(event) => setDriverForm({ ...driverForm, personalSlogan: event.target.value })}
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
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="vehicle-form-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
          >
            <div className="dialog-floating-header mb-5 flex items-center justify-between">
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
                  默认停車场月費（JPY）
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
                  默认保险月費（JPY）
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
                  <option value="">請選択所属会社</option>
                  {companyRecords.map((company) => (
                    <option key={company.id} value={company.name}>{company.name}</option>
                  ))}
                  {vehicleForm.ownerCompany &&
                    !companyRecords.some((company) => company.name === vehicleForm.ownerCompany) && (
                    <option value={vehicleForm.ownerCompany}>{vehicleForm.ownerCompany}</option>
                  )}
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
                  <option value="">請選択座位数</option>
                  {["5", "7", "8", "10"].map((seats) => (
                    <option key={seats} value={seats}>{seats}座</option>
                  ))}
                  {vehicleForm.seats && !["5", "7", "8", "10"].includes(vehicleForm.seats) && (
                    <option value={vehicleForm.seats}>{vehicleForm.seats}座</option>
                  )}
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
                  <option value="">請選択燃油类型</option>
                  {fuelTypes.map((fuelType) => (
                    <option key={fuelType} value={fuelType}>
                      {fuelType}
                    </option>
                  ))}
                  {vehicleForm.fuelType && !fuelTypes.includes(vehicleForm.fuelType) && (
                    <option value={vehicleForm.fuelType}>{vehicleForm.fuelType}</option>
                  )}
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
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-form-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
          >
            <div className="dialog-floating-header mb-5 flex items-center justify-between">
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
                簡称（显示在カレンダー卡片上，留空则显示全称）
                <input
                  type="text"
                  maxLength={50}
                  className="mt-1 w-full rounded border p-2"
                  value={sourceForm.shortName || ""}
                  onChange={(event) =>
                    setSourceForm({ ...sourceForm, shortName: event.target.value })
                  }
                />
              </label>
              <label className="block text-sm font-medium">
                来源颜色
                <span className="mt-1 flex items-center gap-3">
                  <input
                    type="color"
                    aria-label="選択来源颜色"
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
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="company-form-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
          >
            <div className="dialog-floating-header mb-5 flex items-center justify-between">
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
                営業所地址
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

      {sourceSelectionOpen && (
        <SourceSelectionDialog
          sources={rankSourcesByUsage(
            sourceRows.filter((source) => {
              if (sourceSelectionOpen === "order-filter" || sourceSelectionOpen === "finance-filter" || sourceSelectionOpen === "calendar-filter") {
                return activeRegionId === ALL_REGIONS_ID || source.regionId === activeRegionId;
              }
              const accountingOrderId = sourceSelectionOpen.startsWith("accounting-order:")
                ? sourceSelectionOpen.slice("accounting-order:".length)
                : null;
              const sourceRegionId = sourceSelectionOpen === "form"
                ? form.regionId || getRegionForNewRecords()
                : accountingOrderId
                  ? accountingBatchOrders.find((order) => order.id === accountingOrderId)?.regionId
                  : accountingPreviewOrder?.regionId || getRegionForNewRecords();
              return source.regionId === sourceRegionId;
            }),
            orders,
          )}
          selected={
            sourceSelectionOpen === "form"
              ? form.orderSource
              : sourceSelectionOpen === "batch"
                ? batchOrderSource
                : sourceSelectionOpen === "accounting-batch"
                  ? accountingBatchCommon.orderSource || ""
                  : sourceSelectionOpen === "order-filter"
                    ? orderSourceFilter
                    : sourceSelectionOpen === "finance-filter"
                      ? financeSourceFilter
                      : sourceSelectionOpen === "calendar-filter"
                        ? calendarSourceFilter
                        : accountingOrderMeta[sourceSelectionOpen.slice("accounting-order:".length)]?.orderSource || ""
          }
          allLabel={
            sourceSelectionOpen === "order-filter" || sourceSelectionOpen === "finance-filter" || sourceSelectionOpen === "calendar-filter"
              ? "全部来源"
              : undefined
          }
          unassignedValue={
            sourceSelectionOpen === "order-filter" || sourceSelectionOpen === "finance-filter" || sourceSelectionOpen === "calendar-filter"
              ? UNSOURCED_ORDER
              : undefined
          }
          unassignedLabel={
            sourceSelectionOpen === "order-filter" || sourceSelectionOpen === "finance-filter" || sourceSelectionOpen === "calendar-filter"
              ? "未填写"
              : undefined
          }
          onClose={() => setSourceSelectionOpen(null)}
          onSelect={(name) => {
            if (sourceSelectionOpen === "form") {
              setForm((current) => ({ ...current, orderSource: name }));
            } else if (sourceSelectionOpen === "batch") {
              setBatchOrderSource(name);
            } else if (sourceSelectionOpen === "accounting-batch") {
              applyAccountingBatchValue("orderSource", name);
            } else if (sourceSelectionOpen === "order-filter") {
              setOrderSourceFilter(name);
            } else if (sourceSelectionOpen === "calendar-filter") {
              setCalendarSourceFilter(name);
            } else if (sourceSelectionOpen === "finance-filter") {
              setFinanceSourceFilter(name);
            } else if (sourceSelectionOpen.startsWith("accounting-order:")) {
              const orderId = sourceSelectionOpen.slice("accounting-order:".length);
              updateAccountingOrderMeta(orderId, "orderSource", name);
            }
          }}
        />
      )}

      {driverSelectionTarget && (
        <DriverSelectionDialog
          drivers={driverSelectionCandidates}
          serviceDates={driverSelectionDates}
          selected={driverSelectionTarget === "batch"
              ? batchOrderDriver
              : driverSelectionTarget === "accounting-batch"
                ? accountingBatchCommon.driver || ""
                : driverSelectionTarget === "driver-finance-filter"
                  ? selectedDriverFinanceDriver
                  : driverSelectionTarget.startsWith("accounting-finance:")
                    ? accountingForm[driverSelectionTarget.slice("accounting-finance:".length)]?.driver || ""
                    : driverSelectionOrder?.driver || ""}
          allowManual={driverSelectionTarget !== "driver-finance-filter"}
          emptyLabel={driverSelectionTarget === "driver-finance-filter" ? "全部運転士" : "未安排運転士"}
          showServiceDays={driverSelectionTarget !== "driver-finance-filter"}
          onClose={() => setDriverSelectionTarget(null)}
          onSelect={(name) => {
            if (driverSelectionTarget === "batch") {
              setBatchOrderDriver(name);
            } else if (driverSelectionTarget === "accounting-batch") {
              applyAccountingBatchValue("driver", name);
            } else if (driverSelectionTarget === "driver-finance-filter") {
              setDriverFinanceDriverFilter(name);
              setDriverWageItemDrafts(getDriverWageItemDrafts(name));
            } else if (driverSelectionTarget.startsWith("accounting-finance:")) {
              updateAccountingFinance(
                driverSelectionTarget.slice("accounting-finance:".length),
                { driver: name },
              );
            } else if (driverSelectionOrder) {
              setOrders((current) => current.map((order) =>
                order.id === driverSelectionOrder.id ? { id: order.id, ...updateReservationDriver(order, name) } : order));
              void finishDialogSave([waitForOrders()], () => {});
            } else {
              alert("訂単已不存在，請刷新后重试。");
            }
          }}
        />
      )}

      {batchAddType && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="batch-add-title"
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-xl rounded-lg bg-white p-6 shadow-xl"
          >
            <div className="dialog-floating-header mb-5 flex items-center justify-between">
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
                ? "姓名,携帯番号（可选）,微信号（可选）,WhatsApp（可选）,免許有効期限（可选）,个人标语（可选）,姓名读音罗马字（可选）"
                : batchAddType === "vehicles"
                  ? "車名,車両番号,座位数,燃油类型,車検有効期限,自賠責有効期限,備考,車両所属（可选）"
                  : batchAddType === "sources"
                    ? "来源,名（可选）,連絡先（可选）,颜色（可选）"
                    : "会社名称,運行管理者（可选）,整備管理者（可选）,会社电话（可选）,営業所地址（可选）,車庫位置（可选）"}
              className="w-full resize-y rounded border p-3 text-sm"
            />
            <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex justify-end gap-3 border-t bg-white px-6 py-4">
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
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="accounting-preview-title"
            className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="dialog-floating-header mb-5 flex items-center justify-between">
              <h2 id="accounting-preview-title" className="text-xl font-bold">
                訂単財務統計
              </h2>
              <button
                type="button"
                className="table-action-button table-action-button--export ml-3"
                onClick={async () => {
                  const primaryMeta = accountingOrderMeta[accountingPreviewOrder.id];
                  const sourceName = (primaryMeta?.orderSource ?? accountingPreviewOrder.orderSource).trim();
                  const companyName = (primaryMeta?.company ?? accountingPreviewOrder.company).trim();
                  const source = orderSourceRecords.find((item) =>
                    item.regionId === accountingPreviewOrder.regionId && item.companyName === sourceName);
                  const company = companyRecords.find((item) =>
                    item.regionId === accountingPreviewOrder.regionId && item.name === companyName);
                  if (!source || !company) {
                    alert("請先为訂単设置同分区的来源和所属会社。");
                    return;
                  }
                  if (!company.bankAccount || !/^T[0-9]{13}$/.test(company.taxRegistrationNumber) || !company.phone || !company.rollCallAddress) {
                    alert("請先在所属会社登记振込口座、有效T番号、电话和営業所地址。");
                    return;
                  }
                  const price = primaryAccountingOrderPrice;
                  if (!Number.isSafeInteger(price) || price < 0) {
                    alert("請求書訂単价格必须为非负日元整数。");
                    return;
                  }
                  const today = new Date();
                  const sum = (key: "etcTripReport" | "driverAdvanceTripReport" | "companyAdvanceTripReport") =>
                    Object.values(primaryAccountingForm).reduce((total, finance) => total + getOrderFinanceAmount(finance, key), 0);
                  const invoiceDays = Object.entries(primaryAccountingForm)
                    .sort(([first], [second]) => first.localeCompare(second))
                    .filter(([, finance]) => finance.dailyFare > 0 || finance.tripSummary.trim())
                    .map(([date, finance]) => ({
                      date,
                      summary: finance.tripSummary.trim(),
                      fare: getOrderFinanceAmount(finance, "dailyFare"),
                    }));
                  try {
                    const response = await fetch("/api/invoices/number", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ orderId: accountingPreviewOrder.id, companyId: company.id }),
                    });
                    const payload = await readJsonSafely(response);
                    if (!response.ok) throw new Error(buildApiErrorMessage(response, payload, "請求書编号分配失败。"));
                    if (!payload || typeof payload !== "object" || !("number" in payload) ||
                      typeof payload.number !== "string" || !/^INV-\d{6,}$/.test(payload.number)) {
                      throw new Error("服务器返回的請求書编号格式不正确。");
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
                      days: invoiceDays,
                      etcTrip: sum("etcTripReport"),
                      driverAdvanceTrip: sum("driverAdvanceTripReport"),
                      companyAdvanceTrip: sum("companyAdvanceTripReport"),
                      overtimeRequest: Object.values(primaryAccountingForm).reduce(
                        (total, finance) => total + getOvertimeRequestAmount(finance), 0,
                      ),
                    });
                  } catch (error) {
                    alert(error instanceof Error ? error.message : "請求書导出失败，請重试。");
                  }
                }}
              >
                請求書导出（A4）
              </button>
              <button
                type="button"
                className="table-action-button table-action-button--export ml-auto mr-4"
                onClick={async () => {
                  try {
                    await printOrderExpenses({
                      name: accountingPreviewOrder.customer,
                      period: `${accountingPreviewOrder.date} ～ ${accountingPreviewOrder.endDate || accountingPreviewOrder.date}`,
                      note: accountingFinanceNote,
                      rows: Object.entries(primaryAccountingForm).sort(([first], [second]) => first.localeCompare(second)).map(([date, finance]) => {
                        const totals = calculateOrderFinance(finance);
                        return {
                          date,
                          driver: finance.driver,
                          vehicleNumber: getFinanceDayOrder(accountingPreviewOrder, finance).vehiclePlate || "-",
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
                    alert(error instanceof Error ? error.message : "导出失败，請重试。");
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
                <span className="text-gray-500">用車日期：</span>
                {formatOrderDate(accountingPreviewOrder.date)}
                {accountingPreviewOrder.endDate !== accountingPreviewOrder.date &&
                  ` ～ ${formatOrderDate(accountingPreviewOrder.endDate)}`}
              </p>
              <p>
                <span className="text-gray-500">車両番号：</span>
                {getOrderVehicleNumber({ ...accountingPreviewOrder, financeByDate: primaryAccountingForm })}
              </p>
              <p>
                <span className="text-gray-500">運転士：</span>
                {getOrderDriverLabel(allOrders.find(order => order.id === accountingPreviewOrder.id) || accountingPreviewOrder)}
              </p>
              <p>
                <span className="text-gray-500">来源：</span>
                {accountingOrderMeta[accountingPreviewOrder.id]?.orderSource || "未填写"}
              </p>
              <p>
                <span className="text-gray-500">所属会社：</span>
                {accountingOrderMeta[accountingPreviewOrder.id]?.company || "未设置"}
              </p>
            </div>
            {isAccountingBatch && (
              <div className="mt-5 rounded border border-indigo-200 bg-indigo-50 p-4 text-sm">
                <p className="font-semibold text-indigo-900">
                  {accountingBatchOrders[0]?.importBatchId
                    ? `导入批次：合计${accountingBatchOrders.length}单`
                    : `同日批量訂単：共 ${accountingBatchOrders.length} 单（同一天、同一車両的单日訂単）`}
                </p>
                <p className="mt-1 text-xs text-indigo-800">
                  批量统一设置：在这里選択一次，本批全部訂単同步；下方各訂単仍可单独修改，只影响该訂単。
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {([
                    ["driver", "運転士（全部统一）", accountingBatchDriverOptions, accountingBatchCommon.driver, "未安排運転士"],
                    ["orderSource", "訂単来源（全部统一）", accountingSourceOptions, accountingBatchCommon.orderSource, "未填写"],
                    ["company", "訂単所属（全部统一）", accountingCompanyOptions, accountingBatchCommon.company, "未设置"],
                    ["status", "訂単状態（全部统一）", accountingBatchStatusOptions, accountingBatchCommon.status, "請選択訂単状態"],
                  ] as const).map(([field, label, options, common, emptyLabel]) => (
                    <label key={field} className="block min-w-0 font-medium text-indigo-900">
                      {label}
                      {field === "orderSource" ? (
                        <button
                          type="button"
                          onClick={() => setSourceSelectionOpen("accounting-batch")}
                          title={common || emptyLabel}
                          className="mt-1 block h-10 w-full min-w-0 truncate whitespace-nowrap rounded border bg-white px-2 text-left leading-9 text-gray-900"
                        >
                          {common === null
                            ? "（各单不同） · 点击選択"
                            : `${common ? getSourceDisplayName(common, accountingPreviewOrder?.regionId) : emptyLabel} · 点击選択`}
                        </button>
                      ) : field === "driver" ? (
                        <button
                          type="button"
                          onClick={() => setDriverSelectionTarget("accounting-batch")}
                          title={common || emptyLabel}
                          className="mt-1 block h-10 w-full min-w-0 truncate whitespace-nowrap rounded border bg-white px-2 text-left leading-9 text-gray-900"
                        >
                          {common === null ? "（各单不同） · 点击選任" : `${common || emptyLabel} · 点击選任`}
                        </button>
                      ) : (
                        <select
                          className="mt-1 h-10 w-full rounded border bg-white px-2 text-gray-900"
                          value={common ?? accountingMixedValue}
                          onChange={(event) => applyAccountingBatchValue(field, event.target.value)}
                        >
                          {common === null && (
                            <option value={accountingMixedValue} disabled>
                              （各单不同）
                            </option>
                          )}
                          {(common === "運行中" || common === "完了") && (
                            <option value={common} disabled>历史状態（已停用，保留原記録）</option>
                          )}
                          {field !== "status" && <option value="">{emptyLabel}</option>}
                          {common && field !== "status" && !options.includes(common) && (
                            <option value={common}>{common}（現有記録）</option>
                          )}
                          {options.map((option) => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      )}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-indigo-800">
                  核算状態、請求書、入金和备注仅保存到当前点击的訂単；請求書和費用表导出也仅针对当前訂単。
                </p>
              </div>
            )}
            <div className="mt-5 flex flex-wrap gap-4">
              <div className="w-full max-w-sm text-sm font-semibold">
                訂単价格（每日当日車費合计，JPY）
                <output
                  aria-live="polite"
                  className="mt-1 block w-full rounded border bg-gray-100 p-2 text-gray-800"
                >
                  {formatYen(primaryAccountingOrderPrice)}
                </output>
              </div>
              {isAccountingBatch && (
                <div className="w-full max-w-sm text-sm font-semibold">
                  本批訂単价格合计（JPY）
                  <output
                    aria-live="polite"
                    className="mt-1 block w-full rounded border bg-gray-100 p-2 text-gray-800"
                  >
                    {formatYen(accountingOrderPrice)}
                  </output>
                </div>
              )}
            </div>
            <div className="mt-5 space-y-4">
              {Object.entries(accountingForm).map(([financeKey, finance]) => {
                const { orderId: financeOrderId, date } = parseAccountingKey(financeKey);
                const financeOrder =
                  accountingBatchOrders.find((batchOrder) => batchOrder.id === financeOrderId) ??
                  accountingPreviewOrder;
                const financeOrderMeta = accountingOrderMeta[financeOrder.id] ?? {
                  orderSource: financeOrder.orderSource || "",
                  company: financeOrder.company || "",
                  status: financeOrder.status,
                };
                const isOffDate = financeOrder.offDates.includes(date);
                const isOutsideOrderDates =
                  date < financeOrder.date ||
                  date > (financeOrder.endDate || financeOrder.date);
                const dailyTotals = calculateOrderFinance(finance);
                const dailyEtcTotal =
                  getOrderFinanceAmount(finance, "etcCompanyReport") +
                  getOrderFinanceAmount(finance, "etcTripReport");
                const dailyFuelCost = getOrderFinanceAmount(finance, "fuelCost");
                const dailyFuelPrice = dailyTotals.fuelConsumption > 0
                  ? dailyFuelCost / dailyTotals.fuelConsumption
                  : null;

                return (
                  <section
                    key={financeKey}
                    className={`rounded-lg border bg-white p-4 ${isAccountingBatch && financeOrder.id === accountingPreviewOrder.id ? "border-blue-500 ring-1 ring-blue-300" : ""}`}
                  >
                    <div className="mb-4 grid grid-cols-1 gap-2 border-b pb-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <h3 className="font-semibold">{formatOrderDate(date)}</h3>
                        {isAccountingBatch && financeOrder.time && (
                          <span className="font-semibold text-gray-700">{financeOrder.time}</span>
                        )}
                        {isAccountingBatch && financeOrder.id === accountingPreviewOrder.id && (
                          <span className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-800">
                            当前訂単
                          </span>
                        )}
                        {isOutsideOrderDates && (
                          <span className="ml-2 rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
                            訂単日期外
                          </span>
                        )}
                        {isOffDate && (
                          <span className="ml-2 rounded bg-orange-100 px-2 py-1 text-xs text-orange-800">
                            休运日
                          </span>
                        )}
                      </div>
                      {date === financeOrder.date && (
                        <span className="min-w-0 text-center text-lg font-bold text-gray-900">
                          {financeOrder.customer || "未填写"}
                        </span>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600 md:justify-end">
                        <span>当日請求 {formatYen(dailyTotals.requestAmount)}</span>
                        <span>ETC総额 {formatYen(dailyEtcTotal)}</span>
                        <span>燃油費 {formatYen(dailyFuelCost)}</span>
                        <span>燃油消耗 {dailyTotals.fuelConsumption.toLocaleString("ja-JP")} L</span>
                        <span>
                          油价 {dailyFuelPrice === null
                            ? "—"
                            : `${dailyFuelPrice.toLocaleString("ja-JP", { maximumFractionDigits: 2 })} JPY/L`}
                        </span>
                        <span>利润 {formatYen(dailyTotals.profit)}</span>
                      </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      {isAccountingBatch && (
                        <div className="md:col-span-2 grid gap-3 sm:grid-cols-2">
                          <label className="block text-sm font-medium">
                            訂単来源
                            <button
                              type="button"
                              onClick={() => setSourceSelectionOpen(`accounting-order:${financeOrder.id}`)}
                              title={financeOrderMeta.orderSource || undefined}
                              className="mt-1 w-full rounded border p-2 text-left hover:bg-blue-50"
                            >
                              {financeOrderMeta.orderSource
                                ? getSourceDisplayName(financeOrderMeta.orderSource, financeOrder.regionId)
                                : "未填写"} · 点击選択
                            </button>
                          </label>
                          <label className="block text-sm font-medium">
                            訂単所属
                            <select
                              className="mt-1 w-full rounded border p-2"
                              value={financeOrderMeta.company}
                              onChange={(event) =>
                                updateAccountingOrderMeta(financeOrder.id, "company", event.target.value)
                              }
                            >
                              <option value="">未设置</option>
                              {accountingCompanyOptions.map((company) => (
                                <option key={company} value={company}>{company}</option>
                              ))}
                              {financeOrderMeta.company &&
                                !accountingCompanyOptions.includes(financeOrderMeta.company) && (
                                  <option value={financeOrderMeta.company}>
                                    {financeOrderMeta.company}（未登记）
                                  </option>
                                )}
                            </select>
                          </label>
                        </div>
                      )}
                      <div className="md:col-span-2 grid gap-3 rounded border border-blue-200 bg-blue-50/40 p-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
                        <label className="block text-sm font-medium">
                          行程簡概
                          <textarea
                            rows={2}
                            maxLength={1000}
                            placeholder="例：成田空港 → 都内ホテル"
                            className="mt-1 w-full resize-y rounded border bg-white p-2"
                            value={finance.tripSummary}
                            onChange={(event) =>
                              setAccountingForm((current) => ({
                                ...current,
                                [financeKey]: {
                                  ...(current[financeKey] || emptyOrderFinance),
                                  tripSummary: event.target.value,
                                },
                              }))
                            }
                          />
                        </label>
                        <label className="block text-sm font-medium">
                          当日車費
                          <div className="relative mt-1">
                            <input
                              type="number"
                              min="0"
                              max="99999999999999"
                              step="1"
                              inputMode="numeric"
                              className="w-full rounded border bg-white p-2 pr-12"
                              value={finance.dailyFare || ""}
                              onChange={(event) =>
                                setAccountingForm((current) => ({
                                  ...current,
                                  [financeKey]: {
                                    ...(current[financeKey] || emptyOrderFinance),
                                    dailyFare:
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
                        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
                          <FinanceDriverSelect
                            drivers={allDriverRecords}
                            orders={orders}
                            regionId={accountingPreviewOrder.regionId}
                            today={todayDateKey}
                            serviceDate={date}
                            value={getServiceDriver({ driver: "", financeByDate: { day: finance } }, "day")}
                            onChange={(driver) => updateAccountingFinance(financeKey, { driver })}
                          />
                      <label className="block text-sm font-medium">運転士費用类型
                        <select className="mt-1 w-full rounded border p-2" value={finance.driverPaymentType || ""}
                          onChange={event => {
                            const type = event.target.value;
                            if (type !== "wage" && type !== "company_advance") return;
                            setAccountingForm(current => ({ ...current, [financeKey]: setReservationDriverPayment(
                              current[financeKey] || emptyOrderFinance, type,
                              getServiceDriver({ driver: "", financeByDate: { day: current[financeKey] } }, "day")) }));
                          }}>
                          <option value="" disabled>請選択運転士費用类型</option>
                          <option value="wage">運転士工資</option>
                          <option value="company_advance">運転士外注</option>
                        </select>
                      </label>
                          <label className="block text-sm font-medium">
                            {finance.driverPaymentType === "company_advance" ? "外注運転士費用（JPY）" : "運転士工資快捷入力（JPY）"}
                            <input aria-label={`${date} ${finance.driverPaymentType === "company_advance" ? "外注運転士費用" : "運転士工資快捷入力"}`} type="number" min="0" max="99999999999999"
                              step="1" inputMode="numeric" disabled={finance.driverPaymentType !== "wage" && finance.driverPaymentType !== "company_advance"}
                              className="mt-1 w-full rounded border bg-white p-2 disabled:bg-gray-100"
                              value={finance.driverPaymentType === "company_advance"
                                ? finance.externalDriverFee || "" : finance.driverWage || ""}
                              onChange={event => {
                                const amount = event.target.value === "" ? 0 : Number(event.target.value);
                                if (finance.driverPaymentType === "company_advance") {
                                  updateAccountingFinance(financeKey, { externalDriverFee: amount });
                                } else {
                                  updateAccountingFinance(financeKey, { driverWageMode: "fixed", driverWage: amount });
                                }
                              }} />
                          </label>
                        </div>
                        {finance.driverPaymentType === "wage" && finance.driverWageMode === "percentage" &&
                          <p className="text-xs text-amber-700 sm:col-span-2">当前为比例工資；输入快捷金額后改为固定工資，奖励及超時工資仍保留。</p>}
                      {finance.driverPaymentType === "company_advance" &&
                        <>
                        <label className="block text-sm font-medium">外注運転士出金方式
                          <select aria-label={`${date} 外注運転士出金方式`} className="mt-1 w-full rounded border bg-white p-2"
                            value={finance.companyAdvancePaymentMethod || ""}
                            onChange={event => {
                              const method = event.target.value;
                              if (method === "" || method === "paypay" || method === "微信" ||
                                method === "支付宝" || method === "口座") {
                                updateAccountingFinance(financeKey, { companyAdvancePaymentMethod: method });
                              }
                            }}>
                            <option value="">未设置</option>
                            <option value="paypay">paypay</option>
                            <option value="微信">微信</option>
                            <option value="支付宝">支付宝</option>
                            <option value="口座">口座</option>
                          </select>
                        </label>
                        <label className="block text-sm font-medium">外注運転士出金状態
                          <select aria-label={`${date} 外注運転士出金状態`} className="mt-1 w-full rounded border bg-white p-2"
                            value={finance.companyAdvancePaymentStatus || ""}
                            onChange={event => {
                              const status = event.target.value;
                              if (status === "" || status === "已完成" || status === "未完成") {
                                updateAccountingFinance(financeKey, { companyAdvancePaymentStatus: status });
                              }
                            }}>
                            <option value="">未選択</option>
                            <option value="已完成">已完成</option>
                            <option value="未完成">未完成</option>
                          </select>
                        </label>
                        <label className="block text-sm font-medium">外注運転士备注
                          <textarea aria-label={`${date} 外注運転士备注`} rows={2} maxLength={1000}
                            className="mt-1 w-full rounded border bg-white p-2"
                            value={finance.companyAdvancePaymentNote || ""}
                            onChange={event => updateAccountingFinance(financeKey, {
                              companyAdvancePaymentNote: event.target.value,
                            })} />
                          <span className="text-xs font-normal text-gray-600">外注運転士費用不进入工資表。</span>
                        </label>
                        </>}
                      </div>
                      <OrderVehiclePlateSelect
                        financeMode
                        vehicles={allVehicleRecords.filter((vehicle) =>
                          Boolean(accountingPreviewOrder.regionId) &&
                          vehicle.regionId === accountingPreviewOrder.regionId,
                        ).slice().sort(compareVehicles)}
                        vehicleName={getFinanceDayOrder(financeOrder, finance).vehicle}
                        vehiclePlate={getFinanceDayOrder(financeOrder, finance).vehiclePlate}
                        getStatus={getVehicleDisplayStatus}
                        onSelect={(vehicle) =>
                            setAccountingForm((current) => ({
                              ...current,
                              [financeKey]: {
                                ...(current[financeKey] || emptyOrderFinance),
                                vehicle: vehicle.name,
                                vehiclePlate: vehicle.plate,
                                vehicleOverride: Boolean(vehicle.name),
                              },
                            }))
                        }
                      />
                      <div className="grid items-start gap-3 md:col-span-2 md:grid-cols-2">
                      {orderFinanceSections.map((section) => (
                        <fieldset
                          key={section.title}
                          className={`min-w-0 rounded border p-3 ${
                            section.title === "ETC 与燃油"
                              ? "md:col-start-1 md:row-start-1"
                              : section.title === "超時費用"
                                ? "md:col-start-1 md:row-start-2"
                                : "md:col-start-2 md:row-start-1 md:row-span-2 md:flex md:flex-col md:self-stretch"
                          }`}
                        >
                          <legend className="px-1 text-sm font-semibold">{section.title}</legend>
                          <div className={section.title === "超時費用" ? "grid grid-cols-2 gap-3" : section.title === "立替費用" ? "grid gap-3 sm:grid-cols-2 md:flex-1 md:grid-rows-[auto_auto_minmax(0,1fr)]" : "grid gap-3 sm:grid-cols-2"}>
                            {section.fields.map((field) => (
                              <div
                                key={field.key}
                                className={field.key === "driverOvertimeHours"
                                  ? "col-span-2 mx-auto block w-1/2 text-center text-sm font-medium"
                                  : "block text-sm font-medium"}
                              >
                                <label className="block">
                                {field.label}
                                <div className="relative mt-1">
                                  <input
                                    type="number"
                                    min="0"
                                    max={field.unit === "JPY" || field.unit === "JPY/h" ? "99999999999999" : "99999999.99"}
                                    step={field.unit === "JPY" || field.unit === "JPY/h" ? "1" : "0.01"}
                                    inputMode={field.unit === "JPY" || field.unit === "JPY/h" ? "numeric" : "decimal"}
                                    readOnly={field.readOnly}
                                    disabled={finance.driverPaymentType === "company_advance" && field.key === "driverOvertimeRate"}
                                    className={`h-10 w-full rounded border p-2 pr-12 ${field.readOnly ? "bg-gray-100 text-gray-700" : ""}`}
                                    value={
                                      field.key === "driverOvertimeFee"
                                        ? getDriverOvertimeFee(finance) || ""
                                        : field.key === "overtimeRequestAmount"
                                          ? getOvertimeRequestAmount(finance) || ""
                                          : finance[field.key] || ""
                                    }
                                    onChange={(event) => {
                                      if (field.readOnly) return;
                                      const value = event.target.value === "" ? 0 : Number(event.target.value);
                                      setAccountingForm((current) => {
                                        const updated: OrderFinance = {
                                          ...(current[financeKey] || emptyOrderFinance),
                                          [field.key]: value,
                                        };
                                        if (field.key === "driverOvertimeHours" ||
                                          field.key === "driverOvertimeRate") {
                                          updated.driverOvertimeFee = Math.round(
                                            updated.driverOvertimeHours * updated.driverOvertimeRate,
                                          );
                                        }
                                        if (field.key === "driverOvertimeHours" ||
                                          field.key === "overtimeRequestRate") {
                                          updated.overtimeRequestRate ??= 0;
                                          updated.overtimeRequestAmount = getOvertimeRequestAmount(updated);
                                        }
                                        return { ...current, [financeKey]: updated };
                                      });
                                    }}
                                  />
                                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-gray-500">
                                    {field.unit}
                                  </span>
                                </div>
                                </label>
                              </div>
                            ))}
                                {section.title === "立替費用" && (
                                  <div className="grid content-start gap-3 sm:col-span-2 sm:grid-cols-2">
                                  <label className="min-w-0 block text-sm font-medium">
                                    外注運転士出金方式
                                    <select className="mt-1 h-10 w-full rounded border bg-gray-100 p-2" disabled
                                      value={finance.driverPaymentType === "company_advance"
                                        ? finance.companyAdvancePaymentMethod || "" : ""}>
                                      <option value="">未设置</option>
                                      <option value="paypay">paypay</option>
                                      <option value="微信">微信</option>
                                      <option value="支付宝">支付宝</option>
                                      <option value="口座">口座</option>
                                    </select>
                                  </label>
                                  <label className="min-w-0 block text-sm font-medium">
                                    外注運転士出金状態
                                    <select className="mt-1 h-10 w-full rounded border bg-gray-100 p-2" disabled
                                      value={finance.driverPaymentType === "company_advance"
                                        ? finance.companyAdvancePaymentStatus || "" : ""}>
                                      <option value="">未選択</option>
                                      <option value="已完成">已完成</option>
                                      <option value="未完成">未完成</option>
                                    </select>
                                  </label>
                                  <label className="block text-sm font-medium sm:col-span-2">
                                    外注運転士备注
                                    <textarea rows={2} maxLength={1000} readOnly
                                      className="mt-1 h-12 w-full resize-none rounded border bg-gray-100 p-2"
                                      value={finance.driverPaymentType === "company_advance"
                                        ? finance.companyAdvancePaymentNote || "" : ""} />
                                  </label>
                                  <div className="min-w-0 sm:col-span-2">
                                    <OrderReceipts key={`receipts-${financeOrder.id}-${date}`} orderId={financeOrder.id} date={date} />
                                  </div>
                                  </div>
                                )}
                          </div>
                        </fieldset>
                      ))}
                      <fieldset disabled={finance.driverPaymentType === "company_advance"} className="min-w-0 rounded border p-3 md:col-span-2 md:row-start-3 disabled:opacity-50">
                        <legend className="px-1 text-sm font-semibold">運転士工資</legend>
                        <div className={`grid gap-3 sm:grid-cols-2 ${finance.driverWageMode === "percentage" ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
                          <label className="block text-sm font-medium">
                            運転士工資方式
                            <select
                              className="mt-1 w-full rounded border p-2"
                              value={finance.driverWageMode}
                              onChange={(event) =>
                                setAccountingForm((current) => ({
                                  ...current,
                                  [financeKey]: {
                                    ...(current[financeKey] || emptyOrderFinance),
                                    driverWageMode:
                                      event.target.value === "percentage"
                                        ? "percentage"
                                        : "fixed",
                                  },
                                }))
                              }
                            >
                              <option value="fixed">運転士固定工資</option>
                              <option value="percentage">運転士比例工資</option>
                            </select>
                          </label>
                          {finance.driverWageMode === "percentage" ? (
                            <>
                              <label className="block text-sm font-medium">
                                運転士比例工資
                                <select
                                  className="mt-1 w-full rounded border p-2"
                                  value={finance.driverWagePercentage}
                                  onChange={(event) =>
                                    setAccountingForm((current) => ({
                                      ...current,
                                      [financeKey]: {
                                        ...(current[financeKey] || emptyOrderFinance),
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
                                计算運転士比例工資
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
                              運転士固定工資
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
                                      [financeKey]: {
                                        ...(current[financeKey] || emptyOrderFinance),
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
                            運転士奖励工資
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
                                    [financeKey]: {
                                      ...(current[financeKey] || emptyOrderFinance),
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
                    </div>
                  </section>
                );
              })}
            </div>
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-semibold">自動统计</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                {[
                  { label: "請求金額", amount: accountingTotals.requestAmount },
                  { label: "運転士総立替", amount: accountingTotals.driverAdvances },
                  { label: "会社総支出", amount: accountingTotals.companyExpenses },
                  { label: "運転士総工資", amount: accountingTotals.driverWages },
                  { label: "訂単総利润", amount: accountingTotals.profit },
                ].map((item) => (
                  <div key={item.label} className="rounded border bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">{item.label}</p>
                    <p className="mt-1 font-bold tabular-nums">{formatYen(item.amount)}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-gray-500">
                請求金額 = 訂単价格 + ETC（旅報）+ 運転士立替（旅報）+ 会社立替（旅報）+ 超時請求；
                比例工資 =（請求金額 - 運転士総立替 - 会社総支出）× 50% / 60% / 70%；
                運転士総工資 = 超時工資 + 固定工資或比例工資 + 奖励工資；
                訂単総利润 = 請求金額 - 会社総支出 - 運転士総立替 - 運転士総工資。
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
                  <option value="">請選択核算担当</option>
                  {accountingAccounts.map((account) => (
                    <option key={account.id} value={account.email}>
                      {account.fullName.trim() || "未填写姓名"}
                    </option>
                  ))}
                  {accountingAssignee &&
                    !accountingAccounts.some((account) => account.email === accountingAssignee) && (
                      <option value={accountingAssignee}>
                        {getAccountingAssigneeName(accountingAssignee, accountingAccounts)}（历史記録）
                      </option>
                    )}
                </select>
              </label>
              <label className="block text-sm font-semibold">
                核算状態
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
                請求書状態
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
                請求書発送日
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
                  <option value="">未選択</option>
                  <option value="口座入金">口座入金</option>
                  <option value="现金入金">現金入金</option>
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
                placeholder="填写整笔訂単的财务备注"
                value={accountingFinanceNote}
                onChange={(event) => setAccountingFinanceNote(event.target.value)}
              />
            </label>
            <div className="pointer-events-none sticky bottom-3 z-10 mt-6 flex justify-end">
              <button
                type="button"
                onClick={saveAccounting}
                className="pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-950/20 ring-4 ring-white/90 transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 3h12l4 4v14H3V3h2Zm2 0v6h10V3M7 21v-8h10v8" />
                </svg>
                保存财务数据
              </button>
            </div>
          </section>
        </div>
      )}

      {selectedOrderDetails && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-details-title"
            className={`max-h-[90vh] w-full overflow-y-auto rounded-lg bg-white p-6 shadow-xl ${orderDetailsMode === "itinerary" ? "max-w-4xl" : "max-w-md"}`}
          >
            <div className="dialog-floating-header mb-5 flex items-center justify-between">
              <h2 id="order-details-title" className="text-xl font-bold">
                {orderDetailsMode === "itinerary" ? "行程指示書" : selectedOrderVehicleRef?.vehicle}
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
            <label className="mb-4 block text-sm">服务日
              <select aria-label="車両信息服务日" className="ml-2 rounded border p-2"
                value={selectedOrderServiceDate} onChange={event => setOrderDetailsDate(event.target.value)}>
                {getOrderDateKeys(selectedOrderDetails).map(date => <option key={date} value={date}>
                  {date} · {getServiceVehicle(selectedOrderDetails, date).vehiclePlate || "未填写"}
                </option>)}
              </select>
            </label>
            {orderDetailsMode === "itinerary" ? (
              <div className="grid grid-cols-1 gap-x-10 gap-y-6 text-sm md:grid-cols-2">
                <dl className="space-y-3">
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">車両番号</dt>
                    <dd className="break-words font-medium">{selectedOrderVehicleRef?.vehiclePlate || "未填写"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">運転士</dt>
                    <dd className="break-words font-medium">{getOrderDriverLabel(selectedOrderDetails)}</dd>
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
                    <dt className="text-gray-500">営業所地址</dt>
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
                  <dd className="break-words font-medium">{selectedOrderVehicleRef?.vehiclePlate || "未填写"}</dd>
                </div>
                <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                  <dt className="text-gray-500">運転士</dt>
                  <dd className="break-words font-medium">{getOrderDriverLabel(selectedOrderDetails)}</dd>
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
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              confirmPendingDelete();
            }}
            className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
          >
            <div className="dialog-floating-header flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">确认删除</h2>
              <button
                type="button"
                aria-label="关闭删除确认"
                onClick={() => {
                  setPendingDelete(null);
                  setDeletePassword("");
                  setDeleteError("");
                }}
                disabled={isDeleting}
                className="text-2xl text-gray-500"
              >×</button>
            </div>
            {deleteCompleted && <p role="status" className="mt-3 text-sm text-emerald-700">删除已完成，請点右上角 × 关闭。</p>}
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
                disabled={isDeleting || deleteCompleted}
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
                type="submit"
                disabled={isDeleting || deleteCompleted || !deletePassword}
                className="table-action-button table-action-button--delete"
              >
                {deleteCompleted ? "已删除" : isDeleting ? "正在删除…" : "确认删除"}
              </button>
            </div>
          </form>
        </div>
      )}
      </div>
    </main>
  );
}
