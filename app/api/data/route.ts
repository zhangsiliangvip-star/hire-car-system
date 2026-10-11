import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import type {
  Company,
  Driver,
  Order,
  OrderSource,
  Vehicle,
} from "@/lib/domain";
import { jsonResponse } from "@/lib/api-response";
import { readAllPages } from "@/lib/supabase/pagination";

const idSchema = z.string().uuid();
const dateSchema = z.iso.date();
const orderSchema = z.object({
  id: idSchema,
  vehicle: z.string().max(200),
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
}).strict();
const driverSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(200),
  phone: z.string().max(100),
  wechat: z.string().max(200),
  whatsapp: z.string().max(200),
  licenseExpiry: z.union([dateSchema, z.literal("")]),
}).strict();
const vehicleSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(200),
  plate: z.string().max(100),
  ownerCompany: z.string().max(200),
  seats: z.string().max(20),
  fuelType: z.string().max(100),
  inspectionExpiry: z.union([dateSchema, z.literal("")]),
  liabilityExpiry: z.union([dateSchema, z.literal("")]),
  notes: z.string().max(5000),
  status: z.enum(["运营中", "停运中"]),
}).strict();
const orderSourceSchema = z.object({
  id: idSchema,
  companyName: z.string().min(1).max(200),
  contactName: z.string().max(200),
  contactInfo: z.string().max(500),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
}).strict();
const companySchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(200),
  operationsManager: z.string().max(200),
  maintenanceManager: z.string().max(200),
  phone: z.string().max(100),
  rollCallAddress: z.string().max(500),
  garageAddress: z.string().max(500),
}).strict();

const mutationSchema = z.discriminatedUnion("collection", [
  z.object({
    collection: z.literal("orders"),
    upsert: z.array(orderSchema).max(500),
    deleteIds: z.array(idSchema).max(500),
  }).strict(),
  z.object({
    collection: z.literal("drivers"),
    upsert: z.array(driverSchema).max(500),
    deleteIds: z.array(idSchema).max(500),
  }).strict(),
  z.object({
    collection: z.literal("vehicles"),
    upsert: z.array(vehicleSchema).max(500),
    deleteIds: z.array(idSchema).max(500),
  }).strict(),
  z.object({
    collection: z.literal("orderSources"),
    upsert: z.array(orderSourceSchema).max(500),
    deleteIds: z.array(idSchema).max(500),
  }).strict(),
  z.object({
    collection: z.literal("companies"),
    upsert: z.array(companySchema).max(500),
    deleteIds: z.array(idSchema).max(500),
  }).strict(),
]);

function toOrder(row: Database["public"]["Tables"]["orders"]["Row"]): Order {
  return {
    id: row.id,
    vehicle: row.vehicle,
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
  };
}

function toDriver(row: Database["public"]["Tables"]["drivers"]["Row"]): Driver {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    wechat: row.wechat,
    whatsapp: row.whatsapp,
    licenseExpiry: row.license_expiry || "",
  };
}

function toVehicle(row: Database["public"]["Tables"]["vehicles"]["Row"]): Vehicle {
  return {
    id: row.id,
    name: row.name,
    plate: row.plate,
    ownerCompany: row.owner_company,
    seats: row.seats,
    fuelType: row.fuel_type,
    inspectionExpiry: row.inspection_expiry || "",
    liabilityExpiry: row.liability_expiry || "",
    notes: row.notes,
    status: row.status,
  };
}

function toOrderSource(
  row: Database["public"]["Tables"]["order_sources"]["Row"],
): OrderSource {
  return {
    id: row.id,
    companyName: row.company_name,
    contactName: row.contact_name,
    contactInfo: row.contact_info,
    color: row.color,
  };
}

function toCompany(
  row: Database["public"]["Tables"]["companies"]["Row"],
): Company {
  return {
    id: row.id,
    name: row.name,
    operationsManager: row.operations_manager,
    maintenanceManager: row.maintenance_manager,
    phone: row.phone,
    rollCallAddress: row.roll_call_address,
    garageAddress: row.garage_address,
  };
}

function toOrderRow(order: Order): Database["public"]["Tables"]["orders"]["Insert"] {
  return {
    id: order.id,
    vehicle: order.vehicle,
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
  };
}

function toDriverRow(driver: Driver): Database["public"]["Tables"]["drivers"]["Insert"] {
  return {
    id: driver.id,
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
    name: vehicle.name,
    plate: vehicle.plate,
    owner_company: vehicle.ownerCompany,
    seats: vehicle.seats,
    fuel_type: vehicle.fuelType,
    inspection_expiry: vehicle.inspectionExpiry || null,
    liability_expiry: vehicle.liabilityExpiry || null,
    notes: vehicle.notes,
    status: vehicle.status,
  };
}

function toOrderSourceRow(
  source: OrderSource,
): Database["public"]["Tables"]["order_sources"]["Insert"] {
  return {
    id: source.id,
    company_name: source.companyName,
    contact_name: source.contactName,
    contact_info: source.contactInfo,
    color: source.color,
  };
}

function toCompanyRow(
  company: Company,
): Database["public"]["Tables"]["companies"]["Insert"] {
  return {
    id: company.id,
    name: company.name,
    operations_manager: company.operationsManager,
    maintenance_manager: company.maintenanceManager,
    phone: company.phone,
    roll_call_address: company.rollCallAddress,
    garage_address: company.garageAddress,
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
  } else {
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

    const [orders, drivers, vehicles, orderSources, companies] = await Promise.all([
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

    return jsonResponse({
      profile,
      orders: orders.map(toOrder),
      drivers: drivers.map(toDriver),
      vehicles: vehicles.map(toVehicle),
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

    await applyMutation(supabase, parsed.data);
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Failed to persist dashboard data.", error);
    return jsonResponse(
      { error: "保存失败，数据尚未确认写入，请检查网络和数据库权限。" },
      { status: 500 },
    );
  }
}
