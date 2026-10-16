import type { AuditedRecord } from "@/lib/audit";

export type OrderStatus =
  | "仮予約"
  | "予約確定"
  | "運行中"
  | "完了"
  | "キャンセル";

export type ActiveView =
  | "calendar"
  | "orders"
  | "orderFinance"
  | "driverFinance"
  | "vehicleFinance"
  | "balance"
  | "login"
  | "audit"
  | "drivers"
  | "vehicles"
  | "sources"
  | "companies";

export type CalendarVehicleFilter = "all" | "alphard" | "hiace" | "tesla" | "external";

export type OrderFinance = {
  driver: string;
  vehicle: string;
  vehiclePlate: string;
  etcCompanyReport: number;
  etcTripReport: number;
  fuelCost: number;
  fuelConsumption: number;
  driverAdvanceCompanyReport: number;
  driverAdvanceTripReport: number;
  companyAdvanceCompanyReport: number;
  companyAdvanceTripReport: number;
  driverOvertimeHours: number;
  driverOvertimeRate: number;
  driverOvertimeFee: number;
  driverWageMode: "fixed" | "percentage";
  driverWagePercentage: 50 | 60 | 70;
  driverWage: number;
  driverBonusWage: number;
};

export type OrderFinanceByDate = Record<string, OrderFinance>;

export type Order = AuditedRecord & {
  id: string;
  regionId?: string;
  vehicle: string;
  vehiclePlate: string;
  date: string;
  endDate: string;
  offDates: string[];
  customer: string;
  phone: string;
  pickup: string;
  destination: string;
  time: string;
  status: OrderStatus;
  notes: string;
  driver: string;
  orderSource: string;
  company: string;
  salesRep: string;
  orderPrice: number;
  accountingStatus: "未完成" | "完成核算";
  invoiceStatus: "未完成" | "已完成";
  invoiceSentDate: string;
  depositMethod: "" | "口座入金" | "现金入金";
  depositDate: string;
  accountingAssignee: string;
  financeNote: string;
  financeByDate: OrderFinanceByDate;
};

export type OrderDraft = Omit<Order, "id">;

export type Driver = AuditedRecord & {
  id: string;
  regionId?: string;
  name: string;
  phone: string;
  wechat: string;
  whatsapp: string;
  licenseExpiry: string;
};

export type DriverDraft = Omit<Driver, "id">;

export type VehicleStatus = "运营中" | "停运中";
export type VehicleDisplayStatus = VehicleStatus | "休運";

export type Vehicle = AuditedRecord & {
  id: string;
  regionId?: string;
  name: string;
  plate: string;
  defaultParkingFee: number;
  defaultInsuranceFee: number;
  ownerCompany: string;
  seats: string;
  fuelType: string;
  inspectionExpiry: string;
  liabilityExpiry: string;
  notes: string;
  status: VehicleStatus;
};

export type VehicleDraft = Omit<Vehicle, "id">;

export type VehicleMonthlySupply = {
  description: string;
  amount: number;
};

export type VehicleMonthlyFinance = AuditedRecord & {
  id: string;
  regionId?: string;
  vehicleId: string;
  month: string;
  parkingFee: number;
  insuranceFee: number;
  inspectionFee: number;
  repairFee: number;
  supplies: VehicleMonthlySupply[];
  startOdometer: number | null;
  endOdometer: number | null;
};

export type OrderSource = AuditedRecord & {
  id: string;
  regionId?: string;
  companyName: string;
  contactName: string;
  contactInfo: string;
  address: string;
  color: string;
};

export type OrderSourceDraft = Omit<OrderSource, "id">;

export type Company = AuditedRecord & {
  id: string;
  regionId?: string;
  name: string;
  operationsManager: string;
  maintenanceManager: string;
  phone: string;
  rollCallAddress: string;
  garageAddress: string;
  bankAccount: string;
  taxRegistrationNumber: string;
  sealImage: string;
};

export type CompanyDraft = Omit<Company, "id">;

export type BalanceExpenseItem = AuditedRecord & {
  id: string;
  kind: "expense" | "income";
  regionId?: string;
  companyName: string;
  name: string;
  monthlyAmounts: Record<string, number>;
};

export type BatchAddType = "drivers" | "vehicles" | "sources" | "companies";

export type AccountRole = "admin" | "user";

export type Region = {
  id: string;
  name: string;
};

export type AccountProfile = {
  id: string;
  email: string;
  fullName: string;
  company: string;
  position: string;
  regionId: string;
  role: AccountRole;
  emailConfirmed: boolean;
};

export type DashboardData = {
  profile: AccountProfile;
  regions: Region[];
  orders: Order[];
  drivers: Driver[];
  vehicles: Vehicle[];
  orderSources: OrderSource[];
  companies: Company[];
  vehicleMonthlyFinances: VehicleMonthlyFinance[];
  balanceExpenseItems: BalanceExpenseItem[];
};

export type LoginAccount = AccountProfile;

export type CollectionName =
  | "orders"
  | "drivers"
  | "vehicles"
  | "orderSources"
  | "companies"
  | "vehicleMonthlyFinances"
  | "balanceExpenseItems";
