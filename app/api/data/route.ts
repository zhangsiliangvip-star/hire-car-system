import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import type {
  Company,
  BalanceExpenseItem,
  Driver,
  Order,
  OrderFinance,
  OrderSource,
  Region,
  OrderFinanceByDate,
  Vehicle,
  VehicleMonthlyFinance,
} from "@/lib/domain";
import { jsonResponse } from "@/lib/api-response";
import { readAllPages } from "@/lib/supabase/pagination";
import { verifyDeletePassword } from "@/lib/delete-password";
import { isCompanySealDataUrl, MAX_SEAL_DATA_LENGTH } from "@/lib/company-seal";
import { collectionAuditTable, toLastOperation, type LastOperation } from "@/lib/audit";

const idSchema = z.string().uuid();
const dateSchema = z.iso.date();
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const orderFinanceSchema = z.object({
  driver: z.string().max(200).default(""),
  vehicle: z.string().max(200).default(""),
  vehiclePlate: z.string().max(100).default(""),
  etcCompanyReport: z.number().int().min(0).max(99_999_999_999_999).default(0),
  etcTripReport: z.number().int().min(0).max(99_999_999_999_999).default(0),
  fuelCost: z.number().int().min(0).max(99_999_999_999_999).default(0),
  fuelConsumption: z.number().min(0).max(99_999_999.99)
    .refine((value) => Number(value.toFixed(2)) === value)
    .default(0),
  driverAdvanceCompanyReport: z.number().int().min(0).max(99_999_999_999_999).default(0),
  driverAdvanceTripReport: z.number().int().min(0).max(99_999_999_999_999).default(0),
  companyAdvanceCompanyReport: z.number().int().min(0).max(99_999_999_999_999).default(0),
  companyAdvanceTripReport: z.number().int().min(0).max(99_999_999_999_999).default(0),
  driverOvertimeHours: z.number().min(0).max(99_999_999.99)
    .refine((value) => Number(value.toFixed(2)) === value)
    .default(0),
  driverOvertimeRate: z.number().int().min(0).max(99_999_999_999_999).default(0),
  driverOvertimeFee: z.number().int().min(0).max(99_999_999_999_999).default(0),
  driverWageMode: z.enum(["fixed", "percentage"]).default("fixed"),
  driverWagePercentage: z.union([z.literal(50), z.literal(60), z.literal(70)]).default(50),
  driverWage: z.number().int().min(0).max(99_999_999_999_999).default(0),
  driverBonusWage: z.number().int().min(0).max(99_999_999_999_999).default(0),
}).strict().refine((finance) => {
  if (finance.driverOvertimeRate === 0) {
    return true;
  }
  const overtimeFee = Math.round(finance.driverOvertimeHours * finance.driverOvertimeRate);
  return Number.isSafeInteger(overtimeFee) &&
    overtimeFee <= 99_999_999_999_999 &&
    finance.driverOvertimeFee === overtimeFee;
}, {
  message: "Driver overtime fee must equal overtime hours multiplied by the hourly rate.",
});
const financeByDateSchema = z.record(dateSchema, orderFinanceSchema)
  .refine((entries) => Object.keys(entries).length <= 3660);
const orderSchema = z.object({
  id: idSchema,
  regionId: idSchema,
  vehicle: z.string().max(200),
  vehiclePlate: z.string().max(100).default(""),
  date: dateSchema,
  endDate: dateSchema,
  offDates: z.array(dateSchema).max(366),
  customer: z.string().max(500),
  phone: z.string().max(100),
  pickup: z.string().max(500),
  destination: z.string().max(500),
  time: z.string().max(20),
  status: z.enum(["仮予約", "予約確定", "運行中", "完了", "キャンセル"]),
  notes: z.string().max(5000),
  driver: z.string().max(200),
  orderSource: z.string().max(200),
  company: z.string().max(200),
  salesRep: z.string().max(200),
  orderPrice: z.number().int().min(0).max(99_999_999_999_999).default(0),
  accountingStatus: z.enum(["完成核算", "未完成"]).default("未完成"),
  invoiceStatus: z.enum(["未完成", "已完成"]),
  invoiceSentDate: z.union([dateSchema, z.literal("")]),
  depositMethod: z.enum(["", "口座入金", "现金入金"]).default(""),
  depositDate: z.union([dateSchema, z.literal("")]).default(""),
  accountingAssignee: z.string().max(200).default(""),
  financeNote: z.string().max(5000).default(""),
  financeByDate: financeByDateSchema.default({}),
}).strict();
const driverSchema = z.object({
  id: idSchema,
  regionId: idSchema,
  name: z.string().min(1).max(200),
  phone: z.string().max(100),
  wechat: z.string().max(200),
  whatsapp: z.string().max(200),
  licenseExpiry: z.union([dateSchema, z.literal("")]),
}).strict();
const vehicleSchema = z.object({
  id: idSchema,
  regionId: idSchema,
  name: z.string().min(1).max(200),
  plate: z.string().max(100),
  defaultParkingFee: z.number().int().min(0).max(99_999_999_999_999),
  defaultInsuranceFee: z.number().int().min(0).max(99_999_999_999_999),
  ownerCompany: z.string().max(200),
  seats: z.string().max(20),
  fuelType: z.string().max(100),
  inspectionExpiry: z.union([dateSchema, z.literal("")]),
  liabilityExpiry: z.union([dateSchema, z.literal("")]),
  notes: z.string().max(5000),
  status: z.enum(["运营中", "停运中"]),
  calendarOrder: z.number().int().min(0).max(1_000_000).nullable().default(null),
}).strict();
const vehicleMonthlyFinanceSchema = z.object({
  id: idSchema,
  regionId: idSchema,
  vehicleId: idSchema,
  month: monthSchema,
  parkingFee: z.number().int().min(0).max(99_999_999_999_999),
  insuranceFee: z.number().int().min(0).max(99_999_999_999_999),
  inspectionFee: z.number().int().min(0).max(99_999_999_999_999),
  repairFee: z.number().int().min(0).max(99_999_999_999_999),
  supplies: z.array(z.object({
    description: z.string().min(1).max(300),
    amount: z.number().int().min(0).max(99_999_999_999_999),
  }).strict()).max(100),
  startOdometer: z.number().int().min(0).max(99_999_999_999).nullable(),
  endOdometer: z.number().int().min(0).max(99_999_999_999).nullable(),
}).strict().refine(
  (record) =>
    record.startOdometer === null ||
    record.endOdometer === null ||
    record.endOdometer >= record.startOdometer,
  { message: "End odometer cannot be less than start odometer." },
);
const balanceExpenseItemSchema = z.object({
  id: idSchema,
  kind: z.enum(["expense", "income"]).default("expense"),
  regionId: idSchema,
  companyName: z.string().max(200),
  name: z.string().min(1).max(200),
  monthlyAmounts: z.record(
    monthSchema,
    z.number().int().min(0).max(99_999_999_999_999),
  ),
}).strict();
const orderSourceSchema = z.object({
  id: idSchema,
  regionId: idSchema,
  companyName: z.string().min(1).max(200),
  contactName: z.string().max(200),
  contactInfo: z.string().max(500),
  address: z.string().max(500),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
}).strict();
const companySchema = z.object({
  id: idSchema,
  regionId: idSchema,
  name: z.string().min(1).max(200),
  operationsManager: z.string().max(200),
  maintenanceManager: z.string().max(200),
  phone: z.string().max(100),
  rollCallAddress: z.string().max(500),
  garageAddress: z.string().max(500),
  bankAccount: z.string().max(1000),
  taxRegistrationNumber: z.string().regex(/^(?:T[0-9]{13})?$/, "T番号须为 T 加13位数字"),
  sealImage: z.string().max(MAX_SEAL_DATA_LENGTH).refine(isCompanySealDataUrl, "印章须为512像素以内的有效PNG图片"),
}).strict();
const mutationSchema = z.discriminatedUnion("collection", [
  z.object({
    collection: z.literal("orders"),
    upsert: z.array(orderSchema).max(500),
    deleteIds: z.array(idSchema).max(500),
    deletePassword: z.string().max(1024),
  }).strict(),
  z.object({
    collection: z.literal("drivers"),
    upsert: z.array(driverSchema).max(500),
    deleteIds: z.array(idSchema).max(500),
    deletePassword: z.string().max(1024),
  }).strict(),
  z.object({
    collection: z.literal("vehicles"),
    upsert: z.array(vehicleSchema).max(500),
    deleteIds: z.array(idSchema).max(500),
    deletePassword: z.string().max(1024),
  }).strict(),
  z.object({
    collection: z.literal("vehicleMonthlyFinances"),
    upsert: z.array(vehicleMonthlyFinanceSchema).max(500),
    deleteIds: z.array(idSchema).max(500),
    deletePassword: z.string().max(1024),
  }).strict(),
  z.object({
    collection: z.literal("balanceExpenseItems"),
    upsert: z.array(balanceExpenseItemSchema).max(500),
    deleteIds: z.array(idSchema).max(500),
    deletePassword: z.string().max(1024),
  }).strict(),
  z.object({
    collection: z.literal("orderSources"),
    upsert: z.array(orderSourceSchema).max(500),
    deleteIds: z.array(idSchema).max(500),
    deletePassword: z.string().max(1024),
  }).strict(),
  z.object({
    collection: z.literal("companies"),
    upsert: z.array(companySchema).max(500),
    deleteIds: z.array(idSchema).max(500),
    deletePassword: z.string().max(1024),
  }).strict(),
]);

function toFinanceAmount(value: unknown) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : 0;
}

function toOrderFinance(value: unknown): OrderFinance {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      driver: "",
      vehicle: "",
      vehiclePlate: "",
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
  }

  const entry = value as Partial<OrderFinance>;
  const fuelConsumption = entry.fuelConsumption;
  return {
    driver: typeof entry.driver === "string" ? entry.driver.slice(0, 200) : "",
    vehicle: typeof entry.vehicle === "string" ? entry.vehicle.slice(0, 200) : "",
    vehiclePlate: typeof entry.vehiclePlate === "string" ? entry.vehiclePlate.slice(0, 100) : "",
    etcCompanyReport: toFinanceAmount(entry.etcCompanyReport),
    etcTripReport: toFinanceAmount(entry.etcTripReport),
    fuelCost: toFinanceAmount(entry.fuelCost),
    fuelConsumption:
      typeof fuelConsumption === "number" &&
      Number.isFinite(fuelConsumption) &&
      fuelConsumption >= 0 &&
      fuelConsumption <= 99_999_999.99
        ? Math.round(fuelConsumption * 100) / 100
        : 0,
    driverAdvanceCompanyReport: toFinanceAmount(entry.driverAdvanceCompanyReport),
    driverAdvanceTripReport: toFinanceAmount(entry.driverAdvanceTripReport),
    companyAdvanceCompanyReport: toFinanceAmount(entry.companyAdvanceCompanyReport),
    companyAdvanceTripReport: toFinanceAmount(entry.companyAdvanceTripReport),
    driverOvertimeHours:
      typeof entry.driverOvertimeHours === "number" &&
      Number.isFinite(entry.driverOvertimeHours) &&
      entry.driverOvertimeHours >= 0 &&
      entry.driverOvertimeHours <= 99_999_999.99
        ? Math.round(entry.driverOvertimeHours * 100) / 100
        : 0,
    driverOvertimeRate: toFinanceAmount(entry.driverOvertimeRate),
    driverOvertimeFee: toFinanceAmount(entry.driverOvertimeFee),
    driverWageMode: entry.driverWageMode === "percentage" ? "percentage" : "fixed",
    driverWagePercentage:
      entry.driverWagePercentage === 60 || entry.driverWagePercentage === 70
        ? entry.driverWagePercentage
        : 50,
    driverWage: toFinanceAmount(entry.driverWage),
    driverBonusWage: toFinanceAmount(entry.driverBonusWage),
  };
}

function toFinanceByDate(value: unknown): OrderFinanceByDate {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([date]) => dateSchema.safeParse(date).success)
      .map(([date, entry]) => [date, toOrderFinance(entry)]),
  );
}

function toOrder(row: Database["public"]["Tables"]["orders"]["Row"]): Order {
  return {
    lastOperation: toLastOperation(row.last_operation),
    id: row.id,
    regionId: row.region_id,
    vehicle: row.vehicle,
    vehiclePlate: row.vehicle_plate ?? "",
    date: row.date,
    endDate: row.end_date,
    offDates: row.off_dates,
    customer: row.customer,
    phone: row.phone,
    pickup: row.pickup,
    destination: row.destination,
    time: row.time,
    status: row.status,
    notes: row.notes,
    driver: row.driver,
    orderSource: row.order_source,
    company: row.company,
    salesRep: row.sales_rep,
    orderPrice: toFinanceAmount(row.order_price),
    accountingStatus: row.accounting_status,
    invoiceStatus: row.invoice_status,
    invoiceSentDate: row.invoice_sent_date || "",
    depositMethod: row.deposit_method,
    depositDate: row.deposit_date || "",
    accountingAssignee: row.accounting_assignee,
    financeNote: row.finance_note,
    financeByDate: toFinanceByDate(row.finance_by_date),
  };
}

function toDriver(row: Database["public"]["Tables"]["drivers"]["Row"]): Driver {
  return {
    lastOperation: toLastOperation(row.last_operation),
    id: row.id,
    regionId: row.region_id,
    name: row.name,
    phone: row.phone,
    wechat: row.wechat,
    whatsapp: row.whatsapp,
    licenseExpiry: row.license_expiry || "",
  };
}

function toVehicle(row: Database["public"]["Tables"]["vehicles"]["Row"]): Vehicle {
  return {
    lastOperation: toLastOperation(row.last_operation),
    id: row.id,
    regionId: row.region_id,
    name: row.name,
    plate: row.plate,
    defaultParkingFee: row.default_parking_fee ?? 0,
    defaultInsuranceFee: row.default_insurance_fee ?? 0,
    ownerCompany: row.owner_company,
    seats: row.seats,
    fuelType: row.fuel_type,
    inspectionExpiry: row.inspection_expiry || "",
    liabilityExpiry: row.liability_expiry || "",
    notes: row.notes,
    status: row.status,
    calendarOrder: row.calendar_order ?? null,
  };
}

function toVehicleMonthlyFinance(
  row: Database["public"]["Tables"]["vehicle_monthly_finances"]["Row"],
): VehicleMonthlyFinance {
  return {
    lastOperation: toLastOperation(row.last_operation),
    id: row.id,
    regionId: row.region_id,
    vehicleId: row.vehicle_id,
    month: row.month,
    parkingFee: row.parking_fee,
    insuranceFee: row.insurance_fee,
    inspectionFee: row.inspection_fee,
    repairFee: row.repair_fee,
    supplies: row.supplies,
    startOdometer: row.start_odometer,
    endOdometer: row.end_odometer,
  };
}

function toBalanceExpenseItem(
  row: Database["public"]["Tables"]["balance_expense_items"]["Row"],
): BalanceExpenseItem {
  if (row.kind !== "expense" && row.kind !== "income") {
    throw new Error("Balance income migration is required or item kind is invalid.");
  }
  return {
    kind: row.kind,
    lastOperation: toLastOperation(row.last_operation),
    id: row.id,
    regionId: row.region_id,
    companyName: row.company_name,
    name: row.name,
    monthlyAmounts: row.monthly_amounts,
  };
}

function toOrderSource(
  row: Database["public"]["Tables"]["order_sources"]["Row"],
): OrderSource {
  return {
    lastOperation: toLastOperation(row.last_operation),
    id: row.id,
    regionId: row.region_id,
    companyName: row.company_name,
    contactName: row.contact_name,
    contactInfo: row.contact_info,
    address: row.address,
    color: row.color,
  };
}

function toCompany(
  row: Database["public"]["Tables"]["companies"]["Row"],
): Company {
  return {
    lastOperation: toLastOperation(row.last_operation),
    id: row.id,
    regionId: row.region_id,
    name: row.name,
    operationsManager: row.operations_manager,
    maintenanceManager: row.maintenance_manager,
    phone: row.phone,
    rollCallAddress: row.roll_call_address,
    garageAddress: row.garage_address,
    bankAccount: row.bank_account,
    taxRegistrationNumber: row.tax_registration_number,
    sealImage: row.seal_image,
  };
}

function toOrderRow(order: Order): Database["public"]["Tables"]["orders"]["Insert"] {
  return {
    id: order.id,
    region_id: order.regionId ?? "",
    vehicle: order.vehicle,
    vehicle_plate: order.vehiclePlate ?? "",
    date: order.date,
    end_date: order.endDate,
    off_dates: order.offDates,
    customer: order.customer,
    phone: order.phone,
    pickup: order.pickup,
    destination: order.destination,
    time: order.time,
    status: order.status,
    notes: order.notes,
    driver: order.driver,
    order_source: order.orderSource,
    company: order.company,
    sales_rep: order.salesRep,
    order_price: order.orderPrice,
    accounting_status: order.accountingStatus,
    invoice_status: order.invoiceStatus,
    invoice_sent_date: order.invoiceSentDate || null,
    deposit_method: order.depositMethod,
    deposit_date: order.depositDate || null,
    accounting_assignee: order.accountingAssignee,
    finance_note: order.financeNote,
    finance_by_date: order.financeByDate,
  };
}

function toDriverRow(driver: Driver): Database["public"]["Tables"]["drivers"]["Insert"] {
  return {
    id: driver.id,
    region_id: driver.regionId ?? "",
    name: driver.name,
    phone: driver.phone,
    wechat: driver.wechat,
    whatsapp: driver.whatsapp,
    license_expiry: driver.licenseExpiry || null,
  };
}

function toVehicleRow(vehicle: Vehicle): Database["public"]["Tables"]["vehicles"]["Insert"] {
  return {
    id: vehicle.id,
    region_id: vehicle.regionId ?? "",
    name: vehicle.name,
    plate: vehicle.plate,
    default_parking_fee: vehicle.defaultParkingFee,
    default_insurance_fee: vehicle.defaultInsuranceFee,
    owner_company: vehicle.ownerCompany,
    seats: vehicle.seats,
    fuel_type: vehicle.fuelType,
    inspection_expiry: vehicle.inspectionExpiry || null,
    liability_expiry: vehicle.liabilityExpiry || null,
    notes: vehicle.notes,
    status: vehicle.status,
    calendar_order: vehicle.calendarOrder ?? null,
  };
}

function toVehicleMonthlyFinanceRow(
  finance: VehicleMonthlyFinance,
): Database["public"]["Tables"]["vehicle_monthly_finances"]["Insert"] {
  return {
    id: finance.id,
    region_id: finance.regionId,
    vehicle_id: finance.vehicleId,
    month: finance.month,
    parking_fee: finance.parkingFee,
    insurance_fee: finance.insuranceFee,
    inspection_fee: finance.inspectionFee,
    repair_fee: finance.repairFee,
    supplies: finance.supplies,
    start_odometer: finance.startOdometer,
    end_odometer: finance.endOdometer,
  };
}

function toBalanceExpenseItemRow(
  item: BalanceExpenseItem,
): Database["public"]["Tables"]["balance_expense_items"]["Insert"] {
  return {
    kind: item.kind,
    id: item.id,
    region_id: item.regionId,
    company_name: item.companyName,
    name: item.name,
    monthly_amounts: item.monthlyAmounts,
  };
}

function toOrderSourceRow(
  source: OrderSource,
): Database["public"]["Tables"]["order_sources"]["Insert"] {
  return {
    id: source.id,
    region_id: source.regionId ?? "",
    company_name: source.companyName,
    contact_name: source.contactName,
    contact_info: source.contactInfo,
    address: source.address,
    color: source.color,
  };
}

function toCompanyRow(
  company: Company,
): Database["public"]["Tables"]["companies"]["Insert"] {
  return {
    id: company.id,
    region_id: company.regionId ?? "",
    name: company.name,
    operations_manager: company.operationsManager,
    maintenance_manager: company.maintenanceManager,
    phone: company.phone,
    roll_call_address: company.rollCallAddress,
    garage_address: company.garageAddress,
    bank_account: company.bankAccount,
    tax_registration_number: company.taxRegistrationNumber,
    seal_image: company.sealImage,
  };
}

async function applyMutation(
  supabase: Awaited<ReturnType<typeof getAuthenticatedProfile>>["supabase"],
  mutation: z.infer<typeof mutationSchema>,
) {
  if (mutation.collection === "orders") {
    if (mutation.upsert.length) {
      const { error } = await supabase.from("orders").upsert(mutation.upsert.map(toOrderRow));
      if (error) throw error;
    }
    if (mutation.deleteIds.length) {
      const { error } = await supabase.from("orders").delete().in("id", mutation.deleteIds);
      if (error) throw error;
    }
  } else if (mutation.collection === "drivers") {
    if (mutation.upsert.length) {
      const { error } = await supabase.from("drivers").upsert(mutation.upsert.map(toDriverRow));
      if (error) throw error;
    }
    if (mutation.deleteIds.length) {
      const { error } = await supabase.from("drivers").delete().in("id", mutation.deleteIds);
      if (error) throw error;
    }
  } else if (mutation.collection === "vehicles") {
    if (mutation.upsert.length) {
      const { error } = await supabase.from("vehicles").upsert(mutation.upsert.map(toVehicleRow));
      if (error) throw error;
    }
    if (mutation.deleteIds.length) {
      const { error } = await supabase.from("vehicles").delete().in("id", mutation.deleteIds);
      if (error) throw error;
    }
  } else if (mutation.collection === "vehicleMonthlyFinances") {
    if (mutation.upsert.length) {
      const { error } = await supabase
        .from("vehicle_monthly_finances")
        .upsert(mutation.upsert.map(toVehicleMonthlyFinanceRow));
      if (error) throw error;
    }
    if (mutation.deleteIds.length) {
      const { error } = await supabase
        .from("vehicle_monthly_finances")
        .delete()
        .in("id", mutation.deleteIds);
      if (error) throw error;
    }
  } else if (mutation.collection === "balanceExpenseItems") {
    if (mutation.upsert.length) {
      const { error } = await supabase
        .from("balance_expense_items")
        .upsert(mutation.upsert.map(toBalanceExpenseItemRow));
      if (error) throw error;
    }
    if (mutation.deleteIds.length) {
      const { error } = await supabase
        .from("balance_expense_items")
        .delete()
        .in("id", mutation.deleteIds);
      if (error) throw error;
    }
  } else if (mutation.collection === "orderSources") {
    if (mutation.upsert.length) {
      const { error } = await supabase
        .from("order_sources")
        .upsert(mutation.upsert.map(toOrderSourceRow));
      if (error) throw error;
    }
    if (mutation.deleteIds.length) {
      const { error } = await supabase
        .from("order_sources")
        .delete()
        .in("id", mutation.deleteIds);
      if (error) throw error;
    }
  } else if (mutation.collection === "companies") {
    if (mutation.upsert.length) {
      const { error } = await supabase
        .from("companies")
        .upsert(mutation.upsert.map(toCompanyRow));
      if (error) throw error;
    }
    if (mutation.deleteIds.length) {
      const { error } = await supabase
        .from("companies")
        .delete()
        .in("id", mutation.deleteIds);
      if (error) throw error;
    }
  }
}

export async function GET() {
  try {
    const { supabase, profile } = await getAuthenticatedProfile();
    if (!profile) {
      return jsonResponse({ error: "请先登录。" }, { status: 401 });
    }

    const [regions, orders, drivers, vehicles, orderSources, companies] = await Promise.all([
      readAllPages((from, to) =>
        supabase.from("regions").select("*").order("id").range(from, to),
      ),
      readAllPages((from, to) =>
        supabase.from("orders").select("*").order("date").order("id").range(from, to),
      ),
      readAllPages((from, to) =>
        supabase.from("drivers").select("*").order("name").order("id").range(from, to),
      ),
      readAllPages((from, to) =>
        supabase.from("vehicles").select("*").order("name").order("id").range(from, to),
      ),
      readAllPages((from, to) =>
        supabase
          .from("order_sources")
          .select("*")
          .order("company_name")
          .order("id")
          .range(from, to),
      ),
      readAllPages((from, to) =>
        supabase.from("companies").select("*").order("name").order("id").range(from, to),
      ),
    ]);
    let vehicleMonthlyFinances: Database["public"]["Tables"]["vehicle_monthly_finances"]["Row"][] = [];
    let vehicleMonthlyFinanceMigrationPending = false;
    if (profile.role === "admin") {
    try {
      vehicleMonthlyFinances = await readAllPages((from, to) =>
        supabase
          .from("vehicle_monthly_finances")
          .select("*")
          .order("month")
          .order("vehicle_id")
          .range(from, to),
      );
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "PGRST205" ||
        !("message" in error) ||
        typeof error.message !== "string" ||
        !error.message.includes("vehicle_monthly_finances")
      ) {
        throw error;
      }
      vehicleMonthlyFinanceMigrationPending = true;
      console.warn(
        "Vehicle monthly finance migration is not applied; loading the rest of the dashboard without monthly finance records.",
      );
    }
    }
    let balanceExpenseItems: Database["public"]["Tables"]["balance_expense_items"]["Row"][] = [];
    let balanceExpensesMigrationPending = false;
    if (profile.role === "admin") {
    try {
      balanceExpenseItems = await readAllPages((from, to) =>
        supabase
          .from("balance_expense_items")
          .select("*")
          .order("company_name")
          .order("name")
          .range(from, to),
      );
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "PGRST205" ||
        !("message" in error) ||
        typeof error.message !== "string" ||
        !error.message.includes("balance_expense_items")
      ) {
        throw error;
      }
      balanceExpensesMigrationPending = true;
      console.warn(
        "Balance expenses migration is not applied; loading the rest of the dashboard without expense items.",
      );
    }
    }

    return jsonResponse({
      profile,
      regions: (regions as Region[]),
      orders: orders.map(toOrder),
      drivers: drivers.map(toDriver),
      vehicles: vehicles.map(toVehicle),
      vehicleMonthlyFinances: vehicleMonthlyFinances.map(toVehicleMonthlyFinance),
      vehicleMonthlyFinanceMigrationPending,
      balanceExpenseItems: balanceExpenseItems.map(toBalanceExpenseItem),
      balanceExpensesMigrationPending,
      orderSources: orderSources.map(toOrderSource),
      companies: companies.map(toCompany),
    });
  } catch (error) {
    console.error("Failed to load dashboard data.", error);
    return jsonResponse(
      { error: "无法读取业务数据，请检查 Supabase 配置和数据库迁移。" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, profile } = await getAuthenticatedProfile();
    if (!profile) {
      return jsonResponse({ error: "请先登录。" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
    }
    const parsed = mutationSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: "提交的数据格式不正确。" }, { status: 400 });
    }
    if (
      profile.role !== "admin" &&
      (parsed.data.collection === "vehicleMonthlyFinances" ||
        parsed.data.collection === "balanceExpenseItems")
    ) {
      return jsonResponse({ error: "仅管理员可以管理车辆统计及收支平衡数据。" }, { status: 403 });
    }
    if (parsed.data.deleteIds.length > 0) {
      const passwordCheck = verifyDeletePassword(parsed.data.deletePassword);
      if (!passwordCheck.configured) {
        return jsonResponse({ error: "服务器尚未配置删除专用密码。" }, { status: 503 });
      }
      if (!passwordCheck.valid) {
        return jsonResponse({ error: "删除专用密码错误，请检查后重试。" }, { status: 403 });
      }
    }

    if (
      profile.role !== "admin" &&
      parsed.data.upsert.some((record) => record.regionId !== profile.regionId)
    ) {
      return jsonResponse({ error: "不能在其他地域新增或修改数据。" }, { status: 403 });
    }

    await applyMutation(supabase, parsed.data);
    let saved: { id: string; lastOperation: LastOperation | null }[] = [];
    if (parsed.data.upsert.length) {
      const { data, error } = await supabase
        .from(collectionAuditTable[parsed.data.collection])
        .select("id, last_operation")
        .in("id", parsed.data.upsert.map((record) => record.id));
      if (error) throw error;
      saved = (data ?? []).map((record) => ({
        id: record.id, lastOperation: toLastOperation(record.last_operation),
      }));
      if (saved.length !== new Set(parsed.data.upsert.map((record) => record.id)).size) {
        throw new Error("Unable to confirm all saved records.");
      }
    }
    return jsonResponse({ ok: true, saved });
  } catch (error) {
    console.error("Failed to persist dashboard data.", error);
    return jsonResponse(
      { error: "保存失败，数据尚未确认写入，请检查网络和数据库权限。" },
      { status: 500 },
    );
  }
}
