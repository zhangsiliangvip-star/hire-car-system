import type { CollectionName } from "@/lib/domain";

export type LastOperation = {
  actorId: string | null;
  actorName: string;
  at: string;
};

export type AuditedRecord = {
  lastOperation?: LastOperation | null;
};

export const auditTables = {
  orders: "预约／订单财务",
  drivers: "運転士",
  vehicles: "車両",
  order_sources: "来源",
  companies: "所属会社",
  vehicle_monthly_finances: "车辆月度费用",
  balance_expense_items: "手动收入／支出",
  invoice_numbers: "请求书编号",
} as const;

export type AuditTable = keyof typeof auditTables;
export const auditTableNames = Object.keys(auditTables) as [AuditTable, ...AuditTable[]];
export type AuditValue = string | number | boolean | null | AuditValue[] | { [key: string]: AuditValue };
export type AuditLog = {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string;
  region_id: string | null;
  table_name: AuditTable;
  record_id: string;
  record_label: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  before_data: Record<string, AuditValue> | null;
  after_data: Record<string, AuditValue> | null;
};

export function toLastOperation(value: unknown): LastOperation | null {
  if (
    typeof value === "object" && value !== null &&
    "actorId" in value && (value.actorId === null || typeof value.actorId === "string") &&
    "actorName" in value && typeof value.actorName === "string" &&
    "at" in value && typeof value.at === "string" && Number.isFinite(Date.parse(value.at))
  ) {
    return { actorId: value.actorId, actorName: value.actorName, at: value.at };
  }
  if (value === null || value === undefined) return null;
  throw new Error("服务器返回的最后操作信息无效。");
}

export function formatAuditTime(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(value));
}

export const collectionAuditTable = {
  orders: "orders", drivers: "drivers", vehicles: "vehicles",
  orderSources: "order_sources", companies: "companies",
  vehicleMonthlyFinances: "vehicle_monthly_finances", balanceExpenseItems: "balance_expense_items",
} as const satisfies Record<CollectionName, AuditTable>;

const fieldLabels: Record<string, string> = {
  kind: "收支分类（income收入／expense支出）",
  import_batch_id: "导入批次编号", import_batch_index: "批次内顺序",
  id: "记录编号", region_id: "地域编号", vehicle: "車両", vehicle_plate: "予約車両番号", driver: "運転士",
  date: "服务开始日", end_date: "服务结束日", off_dates: "休运日",
  customer: "订单名称", phone: "电话", pickup: "上车地点", destination: "目的地",
  time: "配車時間", status: "状態", notes: "备注", order_source: "来源", company: "所属会社",
  sales_rep: "担当", order_price: "订单价格", accounting_status: "核算状态",
  invoice_status: "请求书状态", invoice_sent_date: "请求书发送日", deposit_method: "入金方式",
  deposit_date: "入金日", accounting_assignee: "核算担当", finance_note: "财务备注",
  finance_by_date: "每日财务", name: "名称", wechat: "微信", whatsapp: "WhatsApp",
  license_expiry: "免許有効期限", plate: "車両番号", owner_company: "車両所属",
  default_parking_fee: "默认停车场费", default_insurance_fee: "默认保险费",
  seats: "座位数", fuel_type: "燃油类型", calendar_order: "カレンダー顺序", inspection_expiry: "車検有効期限",
  liability_expiry: "自賠責有効期限", vehicle_id: "车辆编号", month: "月份",
  parking_fee: "停车场费", insurance_fee: "保险费", inspection_fee: "点检费",
  repair_fee: "维修费", supplies: "备品", start_odometer: "起始里程", end_odometer: "结束里程",
  company_name: "会社", short_name: "简称", monthly_amounts: "各月金额", contact_name: "联系人",
  contact_info: "联系方式", address: "地址", color: "颜色", operations_manager: "运行管理者",
  maintenance_manager: "整备管理者", roll_call_address: "营业所地址", garage_address: "车库地址",
  bank_account: "口座", tax_registration_number: "T番号", seal_image: "印章",
  order_id: "订单编号", company_id: "会社编号", serial_number: "请求书流水号",
  etcCompanyReport: "ETC会社", etcTripReport: "ETC旅报", fuelCost: "燃油费",
  fuelConsumption: "油量", driverAdvanceCompanyReport: "司机立替会社",
  driverAdvanceTripReport: "司机立替旅报", companyAdvanceCompanyReport: "会社立替会社",
  companyAdvanceTripReport: "会社立替旅报", driverOvertimeHours: "超时时数",
  driverOvertimeRate: "超时单价", driverOvertimeFee: "超时费", driverWageMode: "工资模式",
  driverWagePercentage: "工资比例", driverWage: "工资", driverBonusWage: "奖励",
  description: "项目名称", amount: "金额",
};

export function auditChanges(before: AuditLog["before_data"], after: AuditLog["after_data"]) {
  const changes: { field: string; before: AuditValue | undefined; after: AuditValue | undefined }[] = [];
  function visit(oldData: Record<string, AuditValue>, newData: Record<string, AuditValue>, path: string) {
    for (const key of new Set([...Object.keys(oldData), ...Object.keys(newData)])) {
      const oldValue = oldData[key], newValue = newData[key];
      const label = path + (fieldLabels[key] ?? key);
      if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
      if (
        oldValue && newValue && typeof oldValue === "object" && typeof newValue === "object" &&
        !Array.isArray(oldValue) && !Array.isArray(newValue)
      ) {
        visit(oldValue, newValue, label + " / ");
      } else {
        changes.push({ field: label, before: oldValue, after: newValue });
      }
    }
  }
  visit(before ?? {}, after ?? {}, "");
  return changes;
}
