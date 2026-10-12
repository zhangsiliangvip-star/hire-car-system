
"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type {
  ActiveView,
  AccountProfile,
  BatchAddType,
  CalendarVehicleFilter,
  Company,
  CompanyDraft,
  Driver,
  DriverDraft,
  LoginAccount,
  Order,
  OrderDraft,
  OrderSource,
  OrderSourceDraft,
  OrderStatus,
  Vehicle,
  VehicleDisplayStatus,
  VehicleDraft,
  VehicleStatus,
} from "@/lib/domain";
import { usePersistedCollection } from "@/lib/use-persisted-collection";
import { createClient as createSupabaseClient } from "@/lib/supabase/browser";

const DEFAULT_VEHICLE_NAME = "Alphard 01";

const fuelTypes = ["レギュラー", "ディーゼル"];
const vehicleNameOptions = [
  "Alphard",
  "Hiace",
  "Tesla",
  "外注 Alphard",
  "外注 Hiace",
  "外注其他",
];
const MANUAL_VEHICLE_NAME = "__manual_vehicle_name__";

function getVehicleModelOrder(vehicleName: string) {
  if (/阿尔法|alphard/i.test(vehicleName)) return 0;
  if (/海狮|hiace/i.test(vehicleName)) return 1;
  if (/特斯拉|tesla/i.test(vehicleName)) return 2;
  return 3;
}

function isOutsourcedVehicle(vehicleName: string) {
  return /外注/.test(vehicleName);
}

function getVehicleTypeOrder(vehicleName: string) {
  const modelOrder = getVehicleModelOrder(vehicleName);
  return isOutsourcedVehicle(vehicleName) ? modelOrder + 4 : modelOrder;
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

const CUSTOM_DRIVER = "__custom_driver__";
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
  };
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
  const [persistenceError, setPersistenceError] = useState("");
  const [pendingSaveCount, setPendingSaveCount] = useState(0);
  const [accountError, setAccountError] = useState("");
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [currentProfile, setCurrentProfile] = useState<AccountProfile | null>(null);
  const reportPersistenceError = useCallback((message: string) => {
    setPersistenceError(message);
  }, []);
  const reportPendingSave = useCallback((change: number) => {
    setPendingSaveCount((count) => Math.max(0, count + change));
  }, []);
  const {
    items: orders,
    updateItems: setOrders,
    replaceItems: replaceOrders,
  } = usePersistedCollection<Order>("orders", reportPersistenceError, reportPendingSave);
  const {
    items: orderSourceRecords,
    updateItems: setOrderSourceRecords,
    replaceItems: replaceOrderSourceRecords,
  } = usePersistedCollection<OrderSource>("orderSources", reportPersistenceError, reportPendingSave);
  const {
    items: companyRecords,
    updateItems: setCompanyRecords,
    replaceItems: replaceCompanyRecords,
  } = usePersistedCollection<Company>("companies", reportPersistenceError, reportPendingSave);
  const {
    items: driverRecords,
    updateItems: setDriverRecords,
    replaceItems: replaceDriverRecords,
  } = usePersistedCollection<Driver>("drivers", reportPersistenceError, reportPendingSave);
  const {
    items: vehicleRecords,
    updateItems: setVehicleRecords,
    replaceItems: replaceVehicleRecords,
  } = usePersistedCollection<Vehicle>("vehicles", reportPersistenceError, reportPendingSave);

  const [showForm, setShowForm] = useState(false);
  const [showBatchOrderForm, setShowBatchOrderForm] = useState(false);
  const [batchOrderInput, setBatchOrderInput] = useState("");
  const [batchOrderDate, setBatchOrderDate] = useState("");
  const [batchOrderVehicle, setBatchOrderVehicle] = useState("");
  const [batchOrderSource, setBatchOrderSource] = useState("");
  const [batchOrderCompany, setBatchOrderCompany] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{
    message: string;
    action: () => void | Promise<void>;
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
  const [activeView, setActiveView] = useState<ActiveView>("calendar");
  const [orderMonth, setOrderMonth] = useState(getCurrentMonthKey);
  const [orderSourceFilter, setOrderSourceFilter] = useState("");
  const [orderCompanyFilter, setOrderCompanyFilter] = useState("");
  const [showSourceForm, setShowSourceForm] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editingSourceName, setEditingSourceName] = useState<string | null>(null);
  const [sourceForm, setSourceForm] = useState<OrderSourceDraft>({
    companyName: "",
    contactName: "",
    contactInfo: "",
    color: "#2563eb",
  });
  const [loginAccounts, setLoginAccounts] = useState<LoginAccount[]>([]);
  const [showLoginAccountForm, setShowLoginAccountForm] = useState(false);
  const [editingLoginAccountId, setEditingLoginAccountId] = useState<string | null>(null);
  const [loginAccountForm, setLoginAccountForm] = useState({
    fullName: "",
    email: "",
    company: "",
    position: "",
    role: "user" as LoginAccount["role"],
  });
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null);
  const [editingCompanyName, setEditingCompanyName] = useState<string | null>(null);
  const [companyForm, setCompanyForm] = useState<CompanyDraft>({
    name: "",
    operationsManager: "",
    maintenanceManager: "",
    phone: "",
    rollCallAddress: "",
    garageAddress: "",
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
  const [customSourceMode, setCustomSourceMode] = useState(false);
  const [customCompanyMode, setCustomCompanyMode] = useState(false);
  useEffect(() => {
    let cancelled = false;

    async function loadDashboard() {
      try {
        const response = await fetch("/api/data", { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || "无法载入业务数据。");
        }
        if (cancelled) return;

        replaceOrders(payload.orders);
        replaceDriverRecords(payload.drivers);
        replaceVehicleRecords(payload.vehicles);
        replaceOrderSourceRecords(payload.orderSources);
        replaceCompanyRecords(payload.companies);
        setCurrentProfile(payload.profile);
        setIsDataReady(true);

        if (payload.profile.role === "admin") {
          setIsLoadingAccounts(true);
          try {
            const accountsResponse = await fetch("/api/admin/accounts", {
              cache: "no-store",
            });
            const accountsPayload = await accountsResponse.json();
            if (!accountsResponse.ok) {
              throw new Error(accountsPayload.error || "无法读取账号列表。");
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
  ]);
  const orderSources = orderSourceRecords.map((source) => source.companyName);
  const orderSourceColorByName = new Map(
    orderSourceRecords.map((source) => [source.companyName, source.color]),
  );
  const unregisteredSourceNames = Array.from(
    new Set(orders.map((order) => order.orderSource).filter(Boolean)),
  ).filter((name) => !orderSourceRecords.some((source) => source.companyName === name));
  const sourceRows = [
    ...orderSourceRecords,
    ...unregisteredSourceNames.map((name, index) => ({
      id: `unregistered-source-${index}`,
      companyName: name,
      contactName: "",
      contactInfo: "",
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
    })),
  ];
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
      ownerCompany: "",
      seats: "",
      fuelType: "",
      inspectionExpiry: "",
      liabilityExpiry: "",
      notes: "",
      status: "运营中" as const,
    })),
  ];
  const vehicles = vehicleRecords
    .slice()
    .sort((first, second) => {
      const typeOrderDifference =
        getVehicleTypeOrder(first.name) - getVehicleTypeOrder(second.name);
      if (typeOrderDifference !== 0) return typeOrderDifference;
      if (first.name !== second.name) return 0;
      return first.id.localeCompare(second.id);
    })
    .map((vehicle) => vehicle.name);
  const filteredCalendarVehicles = vehicles.filter((vehicle) => {
    const modelOrder = getVehicleModelOrder(vehicle);
    const isOutsourced = isOutsourcedVehicle(vehicle);
    if (calendarVehicleFilter === "all") return !isOutsourced;
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
  const todayDateKey = toDateKey(new Date());
  const isUpcomingOrder = (order: Order) => order.date > todayDateKey;

  function requestDelete(message: string, action: () => void | Promise<void>) {
    setDeleteError("");
    setPendingDelete({ message, action });
  }

  async function confirmPendingDelete() {
    if (!pendingDelete || isDeleting) return;
    setDeleteError("");
    setIsDeleting(true);
    try {
      await pendingDelete.action();
      setPendingDelete(null);
    } catch (error) {
      console.error("Failed to complete a confirmed deletion.", error);
      setDeleteError(
        error instanceof Error ? error.message : "删除失败，请稍后重试。",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  async function loadLoginAccounts() {
    setIsLoadingAccounts(true);
    try {
      const response = await fetch("/api/admin/accounts", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "无法读取账号列表。");
      }
      setLoginAccounts(payload);
      setAccountError("");
    } finally {
      setIsLoadingAccounts(false);
    }
  }

  async function saveLoginAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fullName = loginAccountForm.fullName.trim();
    const email = loginAccountForm.email.trim().toLowerCase();
    const position = loginAccountForm.position.trim();
    if (!fullName || !email || !loginAccountForm.company || !position) {
      alert("请填写用户姓名、邮箱、所属会社和职位。");
      return;
    }

    setAccountError("");
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
                role: loginAccountForm.role,
              }
            : {
                userId: editingLoginAccountId,
                fullName,
                company: loginAccountForm.company,
                position,
                role: loginAccountForm.role,
              },
        ),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "保存账号失败。");
      await loadLoginAccounts();
    } catch (error) {
      console.error("Failed to save a user account.", error);
      setAccountError(error instanceof Error ? error.message : "保存账号失败。");
      return;
    }

    setEditingLoginAccountId(null);
    setLoginAccountForm({
      fullName: "",
      email: "",
      company: "",
      position: "",
      role: "user",
    });
    setShowLoginAccountForm(false);
  }

  function openLoginAccountForm(account?: LoginAccount) {
    setEditingLoginAccountId(account?.id ?? null);
    setLoginAccountForm({
      fullName: account?.fullName ?? "",
      email: account?.email ?? "",
      company: account?.company ?? "",
      position: account?.position ?? "",
      role: account?.role ?? "user",
    });
    setShowLoginAccountForm(true);
  }

  function deleteLoginAccount(account: LoginAccount) {
    requestDelete(`确定要删除登录账号「${account.email}」吗？`, async () => {
      const response = await fetch("/api/admin/accounts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: account.id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "删除账号失败。");
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
            offDates: order.offDates.filter((offDate) => offDate < startDate),
          });
        }

        if (hasAfter) {
          remainingOrders.push({
            ...order,
            id: hasBefore ? createId() : order.id,
            date: shiftDateKey(endDate, 1),
            endDate: orderEndDate,
            offDates: order.offDates.filter((offDate) => offDate > endDate),
          });
        }

        remainingOrders.push({
          ...order,
          id: createId(),
          vehicle,
          date: startDate,
          endDate,
          offDates: movedOffDates,
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

  function openNewOrder(vehicle: string, date: string) {
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
          order.driver === editingDriverName
            ? { ...order, driver: savedDriver.name }
            : order,
        ),
      );
    }

    setShowDriverForm(false);
  }

  function deleteDriver(driver: Driver) {
    const linkedOrders = orders.filter(
      (order) => order.driver === driver.name && isUpcomingOrder(order),
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
          order.driver === driver.name && isUpcomingOrder(order)
            ? { ...order, driver: "" }
            : order,
        ),
      );
    });
  }

  function openNewSource() {
    setEditingSourceId(null);
    setEditingSourceName(null);
    setSourceForm({ companyName: "", contactName: "", contactInfo: "", color: "#2563eb" });
    setShowSourceForm(true);
  }

  function openEditSource(source: OrderSource) {
    setEditingSourceId(source.id.startsWith("unregistered-") ? null : source.id);
    setEditingSourceName(source.companyName);
    setSourceForm({
      companyName: source.companyName,
      contactName: source.contactName,
      contactInfo: source.contactInfo,
      color: source.color || "#2563eb",
    });
    setShowSourceForm(true);
  }

  function saveSource() {
    const savedSource: OrderSourceDraft = {
      companyName: sourceForm.companyName.trim(),
      contactName: sourceForm.contactName.trim(),
      contactInfo: sourceForm.contactInfo.trim(),
      color: sourceForm.color,
    };

    if (!savedSource.companyName) {
      alert("请填写来源。");
      return;
    }

    if (
      orderSourceRecords.some(
        (source) =>
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
          order.orderSource === editingSourceName
            ? { ...order, orderSource: savedSource.companyName }
            : order,
        ),
      );
    }

    setShowSourceForm(false);
  }

  function updateSourceColor(source: OrderSource, color: string) {
    setOrderSourceRecords((current) => {
      if (current.some((record) => record.companyName === source.companyName)) {
        return current.map((record) =>
          record.companyName === source.companyName
            ? { ...record, color }
            : record,
        );
      }

      return [
        ...current,
        {
          id: createId(),
          companyName: source.companyName,
          contactName: source.contactName,
          contactInfo: source.contactInfo,
          color,
        },
      ];
    });
  }

  function deleteSource(source: OrderSource) {
    const linkedOrders = orders.filter(
      (order) =>
        order.orderSource === source.companyName && isUpcomingOrder(order),
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
          order.orderSource === source.companyName && isUpcomingOrder(order)
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
    });
    setShowCompanyForm(true);
  }

  function openNewCompany() {
    setEditingCompanyId(null);
    setEditingCompanyName(null);
    setCompanyForm({
      name: "",
      operationsManager: "",
      maintenanceManager: "",
      phone: "",
      rollCallAddress: "",
      garageAddress: "",
    });
    setShowCompanyForm(true);
  }

  function saveCompany() {
    const savedName = companyForm.name.trim();
    if (!savedName) {
      alert("请填写会社名。");
      return;
    }

    if (
      companyRecords.some(
        (company) =>
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
          order.company === editingCompanyName
            ? { ...order, company: savedName }
            : order,
        ),
      );
      setVehicleRecords((current) =>
        current.map((vehicle) =>
          vehicle.ownerCompany === editingCompanyName
            ? { ...vehicle, ownerCompany: savedName }
            : vehicle,
        ),
      );
    }

    setShowCompanyForm(false);
  }

  function deleteCompany(company: Company) {
    const linkedOrders = orders.filter(
      (order) => order.company === company.name && isUpcomingOrder(order),
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
            order.company === company.name && isUpcomingOrder(order)
              ? { ...order, company: "" }
              : order,
          ),
        );
      },
    );
  }

  function openNewVehicle() {
    setEditingVehicleId(null);
    setEditingVehicleName(null);
    setVehicleNameMode(vehicleNameOptions[0]);
    setVehicleForm({
      name: vehicleNameOptions[0],
      plate: "",
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
    const existingVehicle = vehicleRecords.find(
      (vehicle) => vehicle.id === editingVehicleId,
    );
    const savedVehicle: VehicleDraft = {
      name: editingVehicleName === null
        ? vehicleForm.name.trim() || vehicleForm.plate.trim()
        : vehicleForm.name.trim(),
      plate: vehicleForm.plate.trim(),
      ownerCompany: vehicleForm.ownerCompany.trim(),
      seats: vehicleForm.seats.trim(),
      fuelType: vehicleForm.fuelType,
      inspectionExpiry: vehicleForm.inspectionExpiry,
      liabilityExpiry: vehicleForm.liabilityExpiry,
      notes: vehicleForm.notes.trim(),
      status: vehicleForm.status,
    };

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
      !companyRecords.some((company) => company.name === savedVehicle.ownerCompany) &&
      savedVehicle.ownerCompany !== existingVehicle?.ownerCompany
    ) {
      alert("車両所属必须从所属会社列表中选择。");
      return;
    }

    if (
      vehicleRecords.some(
        (vehicle) =>
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
          order.vehicle === editingVehicleName
            ? { ...order, vehicle: savedVehicle.name }
            : order,
        ),
      );
    }

    setShowVehicleForm(false);
  }

  function deleteVehicle(vehicle: Vehicle) {
    const linkedOrders = orders.filter(
      (order) => order.vehicle === vehicle.name && isUpcomingOrder(order),
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
          order.vehicle === vehicle.name && isUpcomingOrder(order)
            ? { ...order, vehicle: "" }
            : order,
        ),
      );
    });
  }

  function openBatchAdd(type: BatchAddType) {
    setBatchInput("");
    setBatchAddType(type);
  }

  function saveBatchAdd() {
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
        alert("車両每行请按顺序填写：車名、車両番号、座位数（5/7/8/10）、燃油类型、車検有効期限、自賠責保険有効期限、備考、車両所属（后4项可选）。");
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
          status: "运营中" as const,
        })),
      ]);
    }

    if (batchAddType === "sources") {
      const records = lines.map((line) => {
        const [companyName, contactName = "", contactInfo = "", color = "#2563eb"] = splitColumns(line);
        return { companyName, contactName, contactInfo, color };
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

  function closeForm() {
    setShowForm(false);
    setEditingOrderId(null);
    setOffDateInput("");
    setCustomDriverMode(false);
    setCustomSourceMode(false);
    setCustomCompanyMode(false);
  }

  function addOrder() {
    if (
      editingOrderId === null &&
      vehicleStatusByName.get(form.vehicle) !== "运营中"
    ) {
      alert(`车辆「${form.vehicle}」当前不可用，不能新增予約。`);
      return;
    }

    if (!form.customer.trim()) {
      alert("请填写予約情報。");
      return;
    }

    const savedForm: OrderDraft = {
      ...form,
      driver: form.driver.trim(),
      orderSource: form.orderSource.trim(),
      company: form.company.trim(),
      salesRep: form.salesRep.trim(),
    };

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

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      {/* 顶部 */}
      <header className="flex items-center justify-between bg-slate-900 px-6 py-4 text-white">
        <div>
          <h1 className="text-xl font-bold">ハイヤー配車管理</h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden text-right text-xs sm:block">
            <p className="font-semibold">{currentProfile.fullName || currentProfile.email}</p>
            <p className="text-slate-300">
              {currentProfile.role === "admin" ? "管理员" : "普通用户"}
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
            disabled={availableVehicles.length === 0}
            className="rounded-lg border border-blue-300 px-4 py-2 text-sm font-bold text-blue-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            批量导入
          </button>
          <button
            onClick={() => openNewOrder(availableVehicles[0] ?? "", toDateKey(calendarCenterDate))}
            disabled={availableVehicles.length === 0}
            className="rounded-lg bg-blue-600 px-5 py-2 font-bold hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ＋ 新建予約
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
      {pendingSaveCount > 0 && !persistenceError && (
        <p role="status" className="border-b bg-blue-50 px-4 py-2 text-sm text-blue-900">
          正在保存到服务器…
        </p>
      )}

      <div className="flex min-h-[calc(100vh-76px)] flex-col md:flex-row">
        <aside className="w-full shrink-0 border-b bg-white p-3 md:w-[180px] md:border-b-0 md:border-r">
          <p className="mb-3 px-3 text-xs font-semibold text-gray-500">工作台</p>
          <nav aria-label="主菜单" className="flex gap-2 overflow-x-auto md:flex-col">
            {[
              { id: "calendar", label: "カレンダー", icon: "▦" },
              { id: "orders", label: "予約管理", icon: "≡" },
              { id: "drivers", label: "運転士", icon: "♙" },
              { id: "vehicles", label: "車両", icon: "▰" },
              { id: "sources", label: "来源", icon: "↗" },
              { id: "companies", label: "所属会社", icon: "▣" },
              ...(currentProfile.role === "admin"
                ? [{ id: "login" as const, label: "ログイン管理", icon: "♙" }]
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

        <section className="min-w-0 flex-1">
          {activeView === "login" && currentProfile?.role === "admin" && (
            <div className="p-4 md:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold">ログイン管理</h2>
                <button
                  type="button"
                  onClick={() => {
                    if (showLoginAccountForm) {
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
                新账号会收到邮箱邀请并自行设置密码。只有管理员可以管理账号；登录用户共享本工作区的业务数据。
              </p>
              {accountError && (
                <p role="alert" className="mb-4 rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
                  {accountError}
                </p>
              )}
              {showLoginAccountForm && (
                <form onSubmit={saveLoginAccount} className="mb-5 grid gap-4 rounded border bg-white p-4 sm:grid-cols-2 xl:grid-cols-3">
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
                      {companies.map((company) => <option key={company} value={company}>{company}</option>)}
                    </select>
                  </label>
                  <label className="text-sm font-medium">
                    职位
                    <input required value={loginAccountForm.position} onChange={(event) => setLoginAccountForm((current) => ({ ...current, position: event.target.value }))} className="mt-1 w-full rounded border p-2" />
                  </label>
                  <label className="text-sm font-medium">
                    角色
                    <select
                      value={loginAccountForm.role}
                      disabled={editingLoginAccountId === currentProfile.id}
                      onChange={(event) => setLoginAccountForm((current) => ({
                        ...current,
                        role: event.target.value === "admin" ? "admin" : "user",
                      }))}
                      className="mt-1 w-full rounded border bg-white p-2 disabled:bg-gray-100"
                    >
                      <option value="user">普通用户</option>
                      <option value="admin">管理员</option>
                    </select>
                  </label>
                  <div className="flex items-end">
                    <button type="submit" className="w-full rounded bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">
                      {editingLoginAccountId === null ? "发送邀请" : "保存修改"}
                    </button>
                  </div>
                </form>
              )}
              <div className="overflow-x-auto border bg-white">
                <table className="w-full min-w-[850px] text-left text-sm">
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">用户姓名</th>
                      <th className="px-4 py-3 font-semibold">登录邮箱</th>
                      <th className="px-4 py-3 font-semibold">所属会社</th>
                      <th className="px-4 py-3 font-semibold">职位</th>
                      <th className="px-4 py-3 font-semibold">账号状态</th>
                      <th className="px-4 py-3 font-semibold">角色</th>
                      <th className="px-4 py-3 font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingAccounts && loginAccounts.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">正在读取账号…</td></tr>
                    ) : loginAccounts.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">暂无登录账号</td></tr>
                    ) : loginAccounts.map((account) => (
                      <tr key={account.id} className="border-t">
                        <td className="px-4 py-3 font-medium">{account.fullName}</td>
                        <td className="px-4 py-3">{account.email}</td>
                        <td className="px-4 py-3">{account.company}</td>
                        <td className="px-4 py-3">{account.position}</td>
                        <td className="px-4 py-3">{account.emailConfirmed ? "已激活" : "待激活"}</td>
                        <td className="px-4 py-3">{account.role === "admin" ? "管理员" : "普通用户"}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-3">
                            <button type="button" onClick={() => openLoginAccountForm(account)} className="font-medium text-blue-700 hover:underline">编辑</button>
                            <button type="button" disabled={account.id === currentProfile.id} onClick={() => deleteLoginAccount(account)} className="font-medium text-rose-700 hover:underline disabled:cursor-not-allowed disabled:opacity-40" title={account.id === currentProfile.id ? "不能删除当前账号" : undefined}>删除</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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

        <div className="mt-3 flex items-center justify-end gap-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-1.5 shadow-sm">
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

        <div className="fixed bottom-4 left-1/2 z-40 w-[calc(100%-2rem)] max-w-[640px] -translate-x-1/2 rounded-full border border-slate-200 bg-white/95 px-5 py-3 shadow-lg backdrop-blur">
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
        className="overflow-x-auto px-4 pb-24 pt-4"
        onWheel={(event) => {
          const container = event.currentTarget;
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            event.preventDefault();
            container.scrollLeft += event.deltaY;
          }
        }}
      >
        <div className="min-w-[1320px] overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div
            className="grid"
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
                        backgroundColor: orderSourceColorByName.has(order.orderSource)
                          ? `color-mix(in srgb, ${orderSourceColorByName.get(order.orderSource)} 18%, white)`
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
                          <td className="px-4 py-3">{order.driver || "未安排"}</td>
                          <td className="px-4 py-3">{order.orderSource || "未填写"}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded border px-2 py-1 text-xs ${statusStyles[order.status]}`}>
                              {order.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-3">
                              <button
                                type="button"
                                onClick={() => openEditOrder(order)}
                                className="font-medium text-blue-700 hover:underline"
                              >
                                编辑
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
                      <th className="px-4 py-3 font-semibold">自賠責保険有効期限</th>
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
                <table className="w-full min-w-[1250px] text-left text-sm">
                  <thead className="bg-gray-100 text-gray-600">
                    <tr>
                      <th className="px-4 py-3 font-semibold">来源</th>
                      <th className="px-4 py-3 font-semibold">名</th>
                      <th className="px-4 py-3 font-semibold">連絡先</th>
                      <th className="px-4 py-3 font-semibold">关联予約</th>
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
                        <td className="px-4 py-3">{orders.filter((order) => order.orderSource === source.companyName).length}</td>
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
                      <th className="px-4 py-3 font-semibold">運行管理者</th>
                      <th className="px-4 py-3 font-semibold">整備管理者</th>
                      <th className="px-4 py-3 font-semibold">会社电话</th>
                      <th className="px-4 py-3 font-semibold">点呼位置</th>
                      <th className="px-4 py-3 font-semibold">車庫位置</th>
                      <th className="px-4 py-3 font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companyRows.map((company) => (
                      <tr key={company.id} className="border-t">
                        <td className="px-4 py-3 font-medium">{company.name}</td>
                        <td className="px-4 py-3">{company.operationsManager || "-"}</td>
                        <td className="px-4 py-3">{company.maintenanceManager || "-"}</td>
                        <td className="px-4 py-3">{company.phone || "-"}</td>
                        <td className="px-4 py-3">{company.rollCallAddress || "-"}</td>
                        <td className="px-4 py-3">{company.garageAddress || "-"}</td>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-bold">
                {editingOrderId === null ? "新建予約" : "编辑予約"}
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
              {/* 予約情報 */}
              <label className="block text-sm font-medium">
                予約情報
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

              <label className="block text-sm font-medium">
                配車時間
                <input
                  type="time"
                  className="mt-1 w-full rounded border p-2"
                  value={form.time}
                  onChange={(event) => setForm({ ...form, time: event.target.value })}
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
                    ...availableVehicles,
                    ...(editingOrderId !== null &&
                    form.vehicle &&
                    !availableVehicles.includes(form.vehicle)
                      ? [form.vehicle]
                      : []),
                  ])].map((vehicle) => (
                    <option
                      key={vehicle}
                      value={vehicle}
                      disabled={vehicleStatusByName.get(vehicle) !== "运营中"}
                    >
                      {vehicle}{vehicleStatusByName.get(vehicle) !== "运营中" ? "（不可用于新予約）" : ""}
                    </option>
                  ))}
                </select>
              </label>

              {/* 運転士 */}
              <label className="block text-sm font-medium">
                運転士
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={
                    customDriverMode ? CUSTOM_DRIVER : form.driver
                  }
                  onChange={(e) => {
                    const value = e.target.value;

                    if (value === CUSTOM_DRIVER) {
                      setCustomDriverMode(true);
                      setForm({ ...form, driver: "" });
                    } else {
                      setCustomDriverMode(false);
                      setForm({ ...form, driver: value });
                    }
                  }}
                >
                  <option value="">未安排運転士</option>
                  {driverRecords.map((driver) => (
                    <option key={driver.id} value={driver.name}>
                      {driver.name}
                    </option>
                  ))}
                  <option value={CUSTOM_DRIVER}>
                    ＋ 手动输入新運転士
                  </option>
                </select>
              </label>

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
                  placeholder="例如：东京站"
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
                  onClick={addOrder}
                  className="rounded bg-blue-600 px-5 py-2 font-bold text-white"
                >
                  {editingOrderId === null ? "保存予約" : "保存修改"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDriverForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
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
              <label className="block text-sm font-medium">
                車名
                <select
                  className="mt-1 w-full rounded border p-2"
                  value={vehicleNameMode}
                  onChange={(event) => {
                    const nextMode = event.target.value;
                    setVehicleNameMode(nextMode);
                    if (nextMode !== MANUAL_VEHICLE_NAME) {
                      setVehicleForm({ ...vehicleForm, name: nextMode });
                    } else if (editingVehicleName === null) {
                      setVehicleForm({ ...vehicleForm, name: "" });
                    }
                  }}
                >
                  {!vehicleNameOptions.includes(vehicleNameMode) &&
                    vehicleNameMode !== MANUAL_VEHICLE_NAME && (
                      <option value={vehicleNameMode}>{vehicleNameMode}</option>
                    )}
                  {vehicleNameOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                  <option value={MANUAL_VEHICLE_NAME}>手动输入車名</option>
                </select>
                {vehicleNameMode === MANUAL_VEHICLE_NAME && (
                  <input
                    type="text"
                    required
                    className="mt-1 w-full rounded border p-2"
                    value={vehicleForm.name}
                    onChange={(event) =>
                      setVehicleForm({ ...vehicleForm, name: event.target.value })
                    }
                  />
                )}
              </label>
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
                自賠責保険有効期限
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
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
                名
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
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
                点呼位置
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
                className="rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800"
              >
                保存会社
              </button>
            </div>
          </section>
        </div>
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
                  ? "車名,車両番号,座位数,燃油类型,車検有効期限,自賠責保険有効期限,備考,車両所属（可选）"
                  : batchAddType === "sources"
                    ? "来源,名（可选）,連絡先（可选）,颜色（可选）"
                    : "会社名称,運行管理者（可选）,整備管理者（可选）,会社电话（可选）,点呼位置（可选）,車庫位置（可选）"}
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

      {selectedOrderDetails && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-details-title"
            className={`max-h-[90vh] w-full overflow-y-auto rounded-lg bg-white p-6 shadow-xl ${orderDetailsMode === "itinerary" ? "max-w-4xl" : "max-w-md"}`}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 id="order-details-title" className="text-xl font-bold">
                {orderDetailsMode === "itinerary" ? "行程指示書" : selectedOrderDetails.vehicle}
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
                    <dt className="text-gray-500">名</dt>
                    <dd className="break-words font-medium">{selectedOrderSource?.contactName || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">連絡先</dt>
                    <dd className="break-words font-medium">{selectedOrderSource?.contactInfo || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">予約情報</dt>
                    <dd className="break-words font-medium">{selectedOrderDetails.customer || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">配車時間</dt>
                    <dd className="break-words font-medium">{selectedOrderDetails.time || "-"}</dd>
                  </div>
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b pb-3">
                    <dt className="text-gray-500">开始日期</dt>
                    <dd className="break-words font-medium">{formatOrderDate(selectedOrderDetails.date)}</dd>
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
                    <dt className="text-gray-500">自賠責保険有効期限</dt>
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
                    <dt className="text-gray-500">点呼位置</dt>
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
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              confirmPendingDelete();
            }}
            className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-lg font-bold">确认删除</h2>
            <p className="mt-3 text-sm text-gray-700">{pendingDelete.message}</p>
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
                }}
                disabled={isDeleting}
                className="rounded border px-4 py-2 text-sm font-semibold hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={isDeleting}
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