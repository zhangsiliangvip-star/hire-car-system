export type OrderStatus =
  | "仮予約"
  | "予約確定"
  | "運行中"
  | "完了"
  | "キャンセル";

export type ActiveView =
  | "calendar"
  | "orders"
  | "login"
  | "drivers"
  | "vehicles"
  | "sources"
  | "companies";

export type CalendarVehicleFilter = "all" | "alphard" | "hiace" | "tesla" | "external";

export type Order = {
  id: string;
  vehicle: string;
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
};

export type OrderDraft = Omit<Order, "id">;

export type Driver = {
  id: string;
  name: string;
  phone: string;
  wechat: string;
  whatsapp: string;
  licenseExpiry: string;
};

export type DriverDraft = Omit<Driver, "id">;

export type VehicleStatus = "运营中" | "停运中";
export type VehicleDisplayStatus = VehicleStatus | "休運";

export type Vehicle = {
  id: string;
  name: string;
  plate: string;
  ownerCompany: string;
  seats: string;
  fuelType: string;
  inspectionExpiry: string;
  liabilityExpiry: string;
  notes: string;
  status: VehicleStatus;
};

export type VehicleDraft = Omit<Vehicle, "id">;

export type OrderSource = {
  id: string;
  companyName: string;
  contactName: string;
  contactInfo: string;
  color: string;
};

export type OrderSourceDraft = Omit<OrderSource, "id">;

export type Company = {
  id: string;
  name: string;
  operationsManager: string;
  maintenanceManager: string;
  phone: string;
  rollCallAddress: string;
  garageAddress: string;
};

export type CompanyDraft = Omit<Company, "id">;

export type BatchAddType = "drivers" | "vehicles" | "sources" | "companies";

export type AccountRole = "admin" | "user";

export type AccountProfile = {
  id: string;
  email: string;
  fullName: string;
  company: string;
  position: string;
  role: AccountRole;
  emailConfirmed: boolean;
};

export type DashboardData = {
  profile: AccountProfile;
  orders: Order[];
  drivers: Driver[];
  vehicles: Vehicle[];
  orderSources: OrderSource[];
  companies: Company[];
};

export type LoginAccount = AccountProfile;

export type CollectionName =
  | "orders"
  | "drivers"
  | "vehicles"
  | "orderSources"
  | "companies";
