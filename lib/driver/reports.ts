import { z } from "zod";

const address = z.string().trim().min(1).max(300);
const odometer = z.number().min(0).max(9999999).multipleOf(0.1);
const instant = z.iso.datetime({ offset: true });
const headerFields = {
  assignmentId: z.uuid().nullable().optional(),
  dutyStartDate: z.iso.date().nullable().optional(),
  dutyEndDate: z.iso.date().nullable().optional(),
  dutyStartTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  dutyEndTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  vehicleNumber: z.string().trim().max(100),
  driverName: z.string().trim().max(100),
  passengerCount: z.number().int().min(0).max(999).nullable(),
};
export const reportHeaderSchema = z.object({ serviceDate: z.iso.date(), ...headerFields,
  vehicleBaseline: z.string().max(100).optional(),
}).strict().superRefine((h, ctx) => {
  if ((h.dutyStartDate && !h.dutyStartTime) || (h.dutyEndDate && !h.dutyEndTime) ||
    (h.dutyStartDate && h.dutyEndDate && h.dutyStartTime && h.dutyEndTime &&
      `${h.dutyEndDate}T${h.dutyEndTime}` < `${h.dutyStartDate}T${h.dutyStartTime}`)) {
    ctx.addIssue({ code: "custom", message: "请检查点呼日期和時間先后。" });
  }
});
export const reportStopSchema = z.object({
  id: z.uuid(), address: z.string().trim().max(300),
  arrivedAt: instant.nullable(), arrivedKm: odometer.nullable(),
  departedAt: instant.nullable(), departedKm: odometer.nullable(),
  plannedKm: odometer.nullable().optional(),
}).strict().refine(v => (!(v.arrivedAt || v.departedAt) || v.address.length > 0));
export const reportSchema = z.object({
  id: z.uuid(), serviceDate: z.iso.date(), version: z.number().int().positive(),
  header: z.object(headerFields).strict().optional(),
  orderOptions: z.array(z.object({
    assignmentId: z.uuid(), label: z.string(), vehicleNumber: z.string().max(100),
  }).strict()).max(200).optional(),
  departedAt: instant, departureAddress: address, departureKm: odometer,
  returnedAt: instant.nullable(), returnAddress: address.nullable(), returnKm: odometer.nullable(),
  stops: z.array(reportStopSchema).max(100),
  rests: z.array(z.object({ startedAt: instant, endedAt: instant.nullable() }).strict()).max(100),
}).strict();
export type DailyReport = z.infer<typeof reportSchema>;
export const reportTimeErrors: Record<string, string> = {
  PVS01: "訂単关联与運転士或服务日不一致，请重新選択关联訂単。",
  PVS02: "请填写本地域已登记且唯一的車両番号；关联日報保存后会同步訂単。",
  PDT01: "出勤点呼時間不能晚于出库時間，请检查日期和時間。",
  PDT02: "退勤点呼時間不能早于出库時間，请检查日期和時間。",
  PDT03: "退勤点呼時間不能早于归库時間，请检查日期和時間。",
  PDT04: "退勤点呼時間不能早于出勤点呼時間。",
};

export function reportTimeOrderError(report: Pick<DailyReport, "header" | "departedAt" | "returnedAt">): string | null {
  const h = report.header;
  const start = h?.dutyStartDate && h.dutyStartTime
    ? Date.parse(`${h.dutyStartDate}T${h.dutyStartTime}:00+09:00`) : null;
  const end = h?.dutyEndDate && h.dutyEndTime
    ? Date.parse(`${h.dutyEndDate}T${h.dutyEndTime}:00+09:00`) : null;
  if (start !== null && start > Date.parse(report.departedAt)) return reportTimeErrors.PDT01;
  if (end !== null && end < Date.parse(report.departedAt)) return reportTimeErrors.PDT02;
  if (end !== null && report.returnedAt && end < Date.parse(report.returnedAt)) return reportTimeErrors.PDT03;
  if (start !== null && end !== null && end < start) return reportTimeErrors.PDT04;
  return null;
}
export const reportDefaultsSchema = z.object({
  serviceDate: z.iso.date(),
  driverName: z.string().max(100),
  orders: z.array(z.object({
    assignmentId: z.uuid(), time: z.string(), pickup: z.string(), destination: z.string(),
    vehicleNumber: z.string().max(100),
    depot: z.object({ name: z.string(), address }).strict().nullable(),
  }).strict()).max(200),
}).strict();
export const reportDataSchema = z.object({
  vehicleLinking: z.boolean().optional(),
  reports: z.array(reportSchema).max(31),
  depot: z.object({ name: z.string(), address }).strict().nullable(),
}).strict();
const location = { useDefault: z.boolean(), address: z.string().trim().max(300), km: odometer };
const locationSchema = z.object(location).strict().refine(v => v.useDefault || v.address.length > 0);
export const reportCommandSchema = z.object({
  reportId: z.uuid().nullable(), expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  requestId: z.uuid(),
  action: z.enum(["checkout", "add_stop", "remove_stop", "arrive", "depart", "edit_stop", "edit_stops", "return"]),
  payload: z.json(),
}).strict().superRefine((command, ctx) => {
  const stop = z.object({ stopId: z.uuid(), km: odometer }).strict();
  const schemas = {
    checkout: z.object({ ...location, header: reportHeaderSchema.optional() }).strict().refine(v => v.useDefault || v.address.length > 0),
    return: locationSchema,
    add_stop: z.object({ address: z.string().trim().max(300), km: odometer.optional(),
      arrivedAt: instant.nullable().optional(), departedAt: instant.nullable().optional(),
    }).strict().refine(v => (!(v.arrivedAt || v.departedAt) || v.address.length > 0) && (!v.departedAt || Boolean(v.arrivedAt)) &&
      (!(v.arrivedAt || v.departedAt) || v.km !== undefined) &&
      (!v.arrivedAt || !v.departedAt || Date.parse(v.departedAt) >= Date.parse(v.arrivedAt))),
    arrive: stop, depart: stop,
    remove_stop: z.object({ stopId: z.uuid() }).strict(),
    edit_stop: reportStopSchema,
    edit_stops: z.object({ stops: z.array(reportStopSchema).max(100),
      departure: z.object({ address, km: odometer, departedAt: instant }).strict().optional(),
      return: z.object({ address, km: odometer, returnedAt: instant }).strict().optional(),
      header: reportHeaderSchema.optional(),
    }).strict(),
  };
  if (!schemas[command.action].safeParse(command.payload).success ||
    (command.action === "checkout" ? command.reportId !== null || command.expectedVersion !== 0 :
      command.reportId === null || command.expectedVersion < 1)) {
    ctx.addIssue({ code: "custom", message: "Invalid report command." });
  }
});

export function isBlankReportStop(stop: DailyReport["stops"][number]): boolean {
  return !stop.address.trim() && stop.arrivedAt === null && stop.departedAt === null &&
    stop.arrivedKm === null && stop.departedKm === null && (stop.plannedKm ?? null) === null;
}

export function reportOnDate(report: DailyReport, serviceDate: string): DailyReport {
  z.iso.date().parse(serviceDate);
  const days = (Date.parse(serviceDate) - Date.parse(report.serviceDate)) / 86400000;
  if (!days) return report;
  const shift = (value: string | null) => {
    if (!value) return null;
    const shifted = new Date(Date.parse(value) + days * 86400000).toISOString();
    const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1];
    return fraction ? shifted.replace(/\.\d+Z$/, `.${fraction}Z`) : shifted;
  };
  return { ...report, serviceDate, departedAt: shift(report.departedAt)!, returnedAt: shift(report.returnedAt),
    stops: report.stops.map(stop => ({ ...stop, arrivedAt: shift(stop.arrivedAt), departedAt: shift(stop.departedAt) })),
    rests: report.rests.map(rest => ({ startedAt: shift(rest.startedAt)!, endedAt: shift(rest.endedAt) })) };
}

export function stopTime(value: string, previous: string, original: string | null = null): string | null {
  if (!value) return null;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) || !Number.isFinite(Date.parse(previous)))
    throw new Error("请填写有效時間（HH:mm）。");
  if (original && value === toJapanInput(original).slice(11, 16) && Date.parse(original) >= Date.parse(previous))
    return original;
  let time = Date.parse(fromJapanInput(`${toJapanInput(previous).slice(0, 10)}T${value}`)!);
  if (Math.floor(time / 60000) < Math.floor(Date.parse(previous) / 60000)) time += 86400000;
  return new Date(Math.max(time, Date.parse(previous))).toISOString();
}

export function departureFromForm(report: DailyReport, data: Pick<FormData, "get">) {
  const time = String(data.get("departedAt") ?? "");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("请填写有效出库時間（HH:mm）。");
  return { address: String(data.get("address") ?? ""), km: data.get("km") === "" ? NaN : Number(data.get("km")),
    departedAt: time === toJapanInput(report.departedAt).slice(11, 16) ? report.departedAt :
      fromJapanInput(`${toJapanInput(report.departedAt).slice(0, 10)}T${time}`)! };
}

export function returnFromForm(report: DailyReport, data: Pick<FormData, "get">, previous: string) {
  const address = String(data.get("address") ?? "").trim();
  const km = String(data.get("km") ?? "");
  const time = String(data.get("returnedAt") ?? "");
  if (!time && !km && (!address || address === report.returnAddress)) {
    if (report.returnedAt) throw new Error("已归库時間不能清空，请填写归库信息。");
    return undefined;
  }
  if (!address || !km || !time) throw new Error("请同時填写归库地点、公里数和時間；尚未归库時可全部留空。");
  return { address, km: Number(km), returnedAt: stopTime(time, previous, report.returnedAt)! };
}

export function stopFromForm(stop: DailyReport["stops"][number], data: Pick<FormData, "get">, previous: string) {
  const arrivedInput = String(data.get("arrivedAt") ?? "");
  const departedInput = String(data.get("departedAt") ?? "");
  const arrivedAt = stopTime(arrivedInput, previous, stop.arrivedAt);
  const departedAt = stopTime(departedInput, arrivedAt ?? previous, stop.departedAt);
  const km = data.get("km") === "" ? null : Number(data.get("km"));
  const unchangedKm = km === (stop.departedKm ?? stop.arrivedKm ?? stop.plannedKm ?? null);
  return { id: stop.id, address: String(data.get("address")),
    ...(stop.plannedKm !== undefined || !arrivedAt ? { plannedKm: km } : {}),
    arrivedAt, departedAt,
    arrivedKm: arrivedAt ? unchangedKm && stop.arrivedAt ? stop.arrivedKm : km : null,
    departedKm: departedAt ? unchangedKm && stop.departedAt ? stop.departedKm : km : null };
}

export function reportTotals(report: DailyReport, now = Date.now()) {
  const end = report.returnedAt ? Date.parse(report.returnedAt) : now;
  const elapsedMs = Math.max(0, end - Date.parse(report.departedAt));
  const restMs = report.stops.reduce((sum, stop) => !stop.arrivedAt ? sum :
    sum + Math.max(0, Math.min(end, stop.departedAt ? Date.parse(stop.departedAt) : end) -
      Date.parse(stop.arrivedAt)), 0);
  return { elapsedMs, restMs, distance: report.returnKm === null ? null :
    Math.round((report.returnKm - report.departureKm) * 10) / 10 };
}
export function durationLabel(ms: number) {
  const minutes = Math.floor(ms / 60000);
  return `${Math.floor(minutes / 60)}小時${minutes % 60}分`;
}
export function defaultDutyEndDate(date: string, start: string, end: string) {
  return start && end && end < start
    ? new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : date;
}
export function dutyDuration(report: DailyReport): number | null {
  const h = report.header;
  if (!h?.dutyStartDate || !h.dutyEndDate || !h.dutyStartTime || !h.dutyEndTime) return null;
  const start = Date.parse(`${h.dutyStartDate}T${h.dutyStartTime}+09:00`);
  const end = Date.parse(`${h.dutyEndDate}T${h.dutyEndTime}+09:00`);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}
export function reportTime(value: string) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}
export function toJapanInput(value: string | null) {
  return value ? reportTime(value).replace(" ", "T") : "";
}
export function fromJapanInput(value: string) {
  return value ? new Date(`${value}+09:00`).toISOString() : null;
}
