"use client";

import DriverNavigation from "@/app/driver/navigation";
import Link from "next/link";
import { DriverReportDutyRows } from "@/components/driver-report-duty-rows";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/browser";
import { createDriverRequestId } from "@/lib/driver/orders";
import { captureReportFields, readReportDraft, writeReportDraft, type ReportDraft } from "@/lib/driver/report-draft";
import { defaultDutyEndDate, departureFromForm, durationLabel, formatManualClock, fromJapanInput, reportCommandSchema, reportDataSchema, reportDefaultsSchema, reportTime,
  reportHeaderSchema, reportHeaderShapeSchema, reportOnDate, reportSchema, reportTimeOrderError, reportTotals, returnFromForm, stopFromForm, toJapanInput, type DailyReport } from "@/lib/driver/reports";
import { z } from "zod";
import styles from "./report.module.css";

type Action = z.infer<typeof reportCommandSchema>["action"];
type Save = (action: Action, payload: unknown) => Promise<boolean>;

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function formatManualTimeInput(input: HTMLInputElement) {
  input.value = formatManualClock(input.value);
}

function formatManualTimes(root: ParentNode) {
  if (typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll<HTMLInputElement>("[data-manual-time]").forEach(formatManualTimeInput);
}

function LocationRows({ locationKey, serviceDate, depotAddress, disabled, save, fields }: {
  locationKey: string; serviceDate: string; depotAddress: string; disabled: boolean;
  fields?: Record<string, string>;
  save: (payload: { useDefault: false; address: string; km: number; departedAt: string; force?: boolean }) => Promise<boolean>;
}) {
  const label = "開始地点";
  const formId = "report-checkout";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    formatManualTimes(form);
    const data = new FormData(form);
    const departedAt = fromJapanInput(`${serviceDate}T${String(data.get("departedAt") ?? "")}`);
    if (!departedAt) {
      form.reportValidity();
      return;
    }
    if (await save({
      useDefault: false, address: String(data.get("address") ?? ""),
      km: Number(data.get("km")), departedAt, force: true,
    })) form.reset();
  }
  return <tbody aria-label={label}>
    <tr className="driver-sheet-location"><th scope="row" className="driver-location-label"><span>開始<br />地点</span></th><td>
      <form id={formId} onSubmit={submit}>
        <input key={locationKey} name="address" aria-label={`${label}地址`} placeholder={`${label}地址`}
          disabled={disabled} required maxLength={300} autoComplete="off" defaultValue={fields?.[`${formId}/address`] ?? depotAddress} />
      </form>
    </td><td><input form={formId} name="km" aria-label={`${label}公里数`} placeholder="km" type="number" inputMode="decimal" disabled={disabled}
        min="0" max="9999999" step="0.1" required defaultValue={fields?.[`${formId}/km`] ?? ""} /></td>
      <td className="driver-time-cell">—</td>
      <td><input form={formId} name="departedAt" aria-label="開始地点出発時間" type="text" inputMode="numeric"
        data-manual-time pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" maxLength={5} placeholder="0900"
        onBlur={e => formatManualTimeInput(e.currentTarget)} disabled={disabled} required defaultValue={fields?.[`${formId}/departedAt`] ?? ""} /></td></tr>
  </tbody>;
}
function ReturnRow({ report, depotAddress, disabled, saveChanges, fields }: {
  report: DailyReport; disabled: boolean; saveChanges: () => Promise<void>;
  depotAddress: string;
  fields?: Record<string, string>;
}) {
  const formId = "report-edit-return";
  return <tbody aria-label="归库記録"><tr className="driver-sheet-location">
    <th scope="row" className="driver-location-label"><span>終了<br />地点</span></th><td><form id={formId} data-return onSubmit={e => { e.preventDefault(); void saveChanges(); }}>
      <input key={report.returnAddress} name="address" aria-label="終了地点地址" maxLength={300}
        disabled={disabled} defaultValue={fields?.[`${formId}/address`] ?? (report.returnAddress || depotAddress)} />
    </form></td><td><input key={report.returnKm} form={formId} name="km" aria-label="归库公里表" type="number"
      inputMode="decimal" min="0" max="9999999" step="0.1" disabled={disabled} defaultValue={fields?.[`${formId}/km`] ?? report.returnKm ?? ""} /></td>
    <td><input key={report.returnedAt} form={formId} name="returnedAt" aria-label="归库時間" type="text" inputMode="numeric"
      data-manual-time pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" maxLength={5} placeholder="0900"
      onBlur={e => formatManualTimeInput(e.currentTarget)} disabled={disabled}
      defaultValue={fields?.[`${formId}/returnedAt`] ?? toJapanInput(report.returnedAt).slice(11, 16)} /></td><td className="driver-time-cell">—</td>
  </tr></tbody>;
}
function DepartureRow({ report, depotAddress, disabled, saveChanges, fields }: {
  report: DailyReport; disabled: boolean; saveChanges: () => Promise<void>;
  depotAddress: string;
  fields?: Record<string, string>;
}) {
  const formId = "report-edit-departure";
  return <tbody aria-label="出库記録"><tr className="driver-sheet-location">
    <th scope="row" className="driver-location-label"><span>開始<br />地点</span></th><td><form id={formId} data-departure onSubmit={e => { e.preventDefault(); void saveChanges(); }}>
      <input key={report.departureAddress} name="address" aria-label="開始地点地址" required maxLength={300}
        disabled={disabled} defaultValue={fields?.[`${formId}/address`] ?? (report.departureAddress || depotAddress)} />
    </form></td><td><input key={report.departureKm} form={formId} name="km" aria-label="出库公里表" type="number"
      inputMode="decimal" min="0" max="9999999" step="0.1" required disabled={disabled} defaultValue={fields?.[`${formId}/km`] ?? report.departureKm} /></td>
    <td className="driver-time-cell">—</td><td><input key={report.departedAt} form={formId} name="departedAt"
      aria-label="出库時間" type="text" inputMode="numeric" data-manual-time pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
      maxLength={5} placeholder="0900" onBlur={e => formatManualTimeInput(e.currentTarget)}
      required disabled={disabled} defaultValue={fields?.[`${formId}/departedAt`] ?? toJapanInput(report.departedAt).slice(11, 16)} /></td>
  </tr></tbody>;
}
function AddStopForm({ disabled, save }: {
  disabled: boolean; save: Save;
}) {
  return <div className="driver-stop-add">
    <button type="button" className="driver-button" aria-label="追加空白经由地" disabled={disabled} onClick={async () => {
      await save("add_stop", { address: "", arrivedAt: null, departedAt: null });
    }}>＋ 追加经由地</button>
  </div>;
}
function StopRow({ stop, index, disabled, saveChanges, removeStop, allowDelete, fields }: {
  stop: DailyReport["stops"][number]; index: number; disabled: boolean;
  saveChanges: () => Promise<void>; removeStop: (stopId: string) => Promise<void>; allowDelete: boolean;
  fields?: Record<string, string>;
}) {
  const formId = `report-stop-${stop.id}`;
  const recordedKm = stop.departedKm ?? stop.arrivedKm ?? stop.plannedKm ?? null;
  async function correct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveChanges();
  }
  return <tbody aria-label={`经由地 ${index + 1}`}>
      <tr className="driver-sheet-location"><th scope="row">经由{index + 1}</th><td>
        <div className="driver-stop-address">
          <form id={formId} data-stop-id={stop.id} onSubmit={correct}>
            <input key={stop.address} name="address" aria-label={`经由地 ${index + 1} 地址`} disabled={disabled} maxLength={300} defaultValue={fields?.[`${formId}/address`] ?? stop.address} />
          </form>
          {allowDelete && <button type="button" className="driver-stop-delete" aria-label={`削除经由地 ${index + 1}`}
            title="削除该经由地及其已填写内容" disabled={disabled}
            onClick={() => {
              if (window.confirm(`确定削除经由地 ${index + 1}？该行已填写内容也会削除。`)) void removeStop(stop.id);
            }}>×</button>}
        </div>
      </td><td className="driver-stop-km">
          <input key={recordedKm} form={formId} name="km" disabled={disabled} type="number" inputMode="decimal" min="0" max="9999999" step="0.1"
            aria-label={`经由地 ${index + 1} 公里数（公里表累计读数）`}
            placeholder="km" defaultValue={fields?.[`${formId}/km`] ?? recordedKm ?? ""} />
      </td>
        {(["arrived", "departed"] as const).map(prefix => {
          const label = prefix === "arrived" ? "到着" : "出発";
          const time = toJapanInput(stop[`${prefix}At`]).slice(11, 16);
          return <td key={prefix}>
            <input key={stop[`${prefix}At`]} form={formId} name={`${prefix}At`} disabled={disabled} type="text" inputMode="numeric"
              data-manual-time pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" maxLength={5} placeholder="0900"
              onBlur={e => formatManualTimeInput(e.currentTarget)} aria-label={`经由地 ${index + 1} ${label}時間`}
              defaultValue={fields?.[`${formId}/${prefix}At`] ?? time} />
          </td>;
        })}
      </tr>
    </tbody>;
}

export default function DriverReport({ initialReportId, initialDate, returnMonth }: {
  initialReportId?: string; initialDate?: string; returnMonth?: string;
} = {}) {
  const [data, setData] = useState<z.infer<typeof reportDataSchema> | null>(null);
  const [selected, setSelected] = useState<string | null>(initialReportId ?? null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [starting, setStarting] = useState(false);
  const [dirty, setDirtyState] = useState(false);
  const [newDate, setNewDate] = useState(() => initialDate ?? reportTime(new Date().toISOString()).slice(0, 10));
  const [defaults, setDefaults] = useState<z.infer<typeof reportDefaultsSchema> | null>(null);
  const [assignment, setAssignment] = useState("");
  const [defaultsError, setDefaultsError] = useState("");
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const headerForm = useRef<HTMLFormElement>(null);
  const lock = useRef(false);
  const pending = useRef<{ key: string; requestId: string } | null>(null);
  const dirtyRef = useRef(dirty);
  const draftOwner = useRef<string | null>(null);
  const persistRef = useRef<() => boolean>(() => true);
  const defaultsDraft = useRef<{ serviceDate: string; assignment: string } | null>(null);
  function setDirty(value: boolean) { dirtyRef.current = value; setDirtyState(value); }
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function readReport(reportId: string): Promise<DailyReport | null> {
      const response = await fetch(`/api/driver/report-history?reportId=${encodeURIComponent(reportId)}`,
        { cache: "no-store", signal: controller.signal });
      if (response.status === 401) { location.replace("/driver/login"); throw new Error("請重新登录。"); }
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("无法读取历史日報，請刷新重试。");
      const parsed = z.object({ report: reportSchema }).strict().parse(await response.json()).report;
      if (parsed.id !== reportId) throw new Error("历史日報与所选日報不一致。");
      return parsed;
    }
    async function load() {
      try {
        const [response, identity, target] = await Promise.all([
          fetch("/api/driver/reports", { cache: "no-store", signal: controller.signal }),
          createClient("driver").auth.getUser(),
          initialReportId !== undefined ? readReport(initialReportId) : Promise.resolve(null),
        ]);
        if (response.status === 401) { location.replace("/driver/login"); return; }
        if (identity.error || !identity.data.user) throw new Error("无法确认登录账号，請重新登录后重试。");
        if (!response.ok) throw new Error("无法读取日報，請重试或联系管理员。");
        const result = reportDataSchema.parse(await response.json());
        if (initialReportId !== undefined && !target) throw new Error("日報不存在或无权查看。");
        if (target && !result.reports.some(item => item.id === target.id)) result.reports.push(target);
        if (active && document.visibilityState === "visible") {
          draftOwner.current = identity.data.user.id;
          let restored: ReportDraft | null = null;
          let stored: ReportDraft | null = null;
          try {
            stored = readReportDraft(sessionStorage, draftOwner.current);
          } catch (cause) {
            console.error("Driver report draft restore failed.", cause);
            setError("无法读取本机草稿，請检查浏览器存储设置；现有草稿未清除。");
          }
          let saved = result.reports.find(item => item.id === stored?.reportId);
          if (stored?.reportId && !saved) {
            saved = await readReport(stored.reportId) ?? undefined;
            if (saved) result.reports.push(saved);
          }
          if (!active || controller.signal.aborted || document.visibilityState !== "visible") return;
          if (stored && (stored.reportId ? saved?.version !== stored.version : result.reports.some(item => !item.returnedAt))) {
            setError("服务器日報已有更新，未自动套用本机草稿。請核对最新内容后继续填写。");
          } else restored = stored;
          setDraft(restored);
          defaultsDraft.current = restored?.reportId === null ? restored : null;
          if (restored) {
            setSelected(restored.reportId); setStarting(restored.starting);
            setNewDate(restored.serviceDate); setAssignment(restored.assignment);
            setNotice(initialReportId && restored.reportId !== initialReportId
              ? "已恢复另一份本机草稿，請先保存或放弃修改，再選択历史日報。"
              : "已恢复本机草稿，請继续填写并点“保存”提交。");
          } else if (initialDate && !initialReportId) {
            const dateReport = result.reports.find(item => item.serviceDate === initialDate);
            const unfinished = result.reports.find(item => !item.returnedAt);
            if (dateReport) {
              setSelected(dateReport.id); setNewDate(dateReport.serviceDate);
            } else if (unfinished) {
              setSelected(unfinished.id); setNewDate(unfinished.serviceDate);
              setNotice(`请先完成 ${unfinished.serviceDate} 的未归库日報，再填写 ${initialDate} 的日報。`);
            } else {
              setSelected(null); setStarting(true); setNewDate(initialDate);
            }
          }
          setData(result); setDirty(Boolean(restored)); setBusy(false);
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("Report load failed.", cause);
        if (active) { setError(cause instanceof Error ? cause.message : "无法读取日報，請刷新重试。"); setBusy(false); }
      }
    }
    function revalidate() {
      if (!persistRef.current()) return;
      setData(null); setDefaults(null); setAssignment(""); setDefaultsError(""); setBusy(true); setError(""); setRevision(v => v + 1);
    }
    function visibility() {
      if (document.visibilityState === "hidden") { persistRef.current(); controller.abort(); }
      else if (!lock.current) revalidate();
    }
    function pageShow(event: PageTransitionEvent) { if (event.persisted) revalidate(); }
    function pageHide() { persistRef.current(); }
    function beforeUnload(event: BeforeUnloadEvent) {
      if (!persistRef.current()) { event.preventDefault(); event.returnValue = ""; }
    }
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", pageShow);
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("beforeunload", beforeUnload);
    const { data: subscription } = createClient("driver").auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") {
        discardDraft(); draftOwner.current = null; setDirty(false); setData(null); location.replace("/driver/login");
      }
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    void load();
    return () => {
      active = false; controller.abort(); clearInterval(timer); subscription.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pageshow", pageShow);
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [revision, initialReportId, initialDate]);
  const open = data?.reports.find(r => !r.returnedAt);
  const report = data?.reports.find(r => r.id === selected) ?? open;
  const serviceDate = newDate ?? reportTime(new Date(now).toISOString()).slice(0, 10);
  const currentDefaults = defaults?.serviceDate === serviceDate ? defaults : null;
  const selectedOrder = currentDefaults?.orders.find(order => order.assignmentId === assignment);
  const garageAddress = data?.depot?.address || "車庫";
  const needsOrder = Boolean(currentDefaults?.orders.length && !selectedOrder);
  const canLoadDefaults = !report && (busy || Boolean(data));
  const draftFields = draft?.reportId === (report?.id ?? null) ? draft.fields : undefined;
  function discardDraft() {
    try {
      if (draftOwner.current) writeReportDraft(sessionStorage, draftOwner.current, null);
      setDraft(null);
      defaultsDraft.current = null;
      return true;
    } catch (cause) {
      console.error("Driver report draft removal failed.", cause);
      setError("无法清除本机草稿，請检查浏览器存储设置后重试。");
      return false;
    }
  }
  function captureDraft(): ReportDraft {
    return {
      reportId: report?.id ?? null, version: report?.version ?? 0,
      serviceDate: validDate(serviceDate) ? serviceDate : reportTime(new Date().toISOString()).slice(0, 10),
      starting: !report, assignment,
      fields: captureReportFields(headerForm.current, table.current),
    };
  }
  function persistDraft() {
    if (!dirtyRef.current || !data || busy || !headerForm.current || !table.current) return true;
    try {
      if (!draftOwner.current) throw new Error("Draft account is unavailable.");
      writeReportDraft(sessionStorage, draftOwner.current, captureDraft());
      return true;
    } catch (cause) {
      console.error("Driver report draft save failed.", cause);
      setError("无法保留本机草稿，請先点“保存”提交，勿离开页面。");
      return false;
    }
  }
  persistRef.current = persistDraft;
  function queueDraft() { queueMicrotask(() => persistRef.current()); }
  function startNewReport() {
    if (open || saving) return;
    if (dirty && !window.confirm("开始新日報会放弃尚未保存的修改，是否继续？")) return;
    if (!discardDraft()) return;
    const today = reportTime(new Date().toISOString()).slice(0, 10);
    setDirty(false); setSelected(null); setStarting(true); setNewDate(today);
    if (serviceDate !== today) setDefaults(null);
    if (serviceDate !== today || report) setDefaultsError("");
    setAssignment(serviceDate === today && currentDefaults?.orders.length === 1 ? currentDefaults.orders[0].assignmentId : "");
    setError(""); setNotice("");
  }
  useEffect(() => {
    if (busy || saving || dirty || starting) return;
    const controller = new AbortController();
    let active = true;
    let loading = false;
    async function refreshSavedReports() {
      if (loading || dirtyRef.current || lock.current || document.visibilityState !== "visible") return;
      loading = true;
      try {
        const response = await fetch("/api/driver/reports", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { location.replace("/driver/login"); return; }
        if (!response.ok) throw new Error("日報同步失败，請刷新核对最新車両番号。");
        const result = reportDataSchema.parse(await response.json());
        if (selected && !result.reports.some(item => item.id === selected)) {
          const detail = await fetch(`/api/driver/report-history?reportId=${encodeURIComponent(selected)}`,
            { cache: "no-store", signal: controller.signal });
          if (detail.status === 401) { location.replace("/driver/login"); return; }
          if (!detail.ok) throw new Error("历史日報同步失败，請刷新核对。");
          const saved = z.object({ report: reportSchema }).strict().parse(await detail.json()).report;
          if (saved.id !== selected) throw new Error("历史日報与所选日報不一致。");
          result.reports.push(saved);
        }
        if (active && !dirtyRef.current && !lock.current && document.visibilityState === "visible") {
          setData(result); setError("");
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("Driver report synchronization failed.", cause);
        if (active) setError("日報同步失败，請刷新核对最新車両番号。");
      } finally { loading = false; }
    }
    const timer = setInterval(() => void refreshSavedReports(), 10_000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [busy, saving, dirty, starting, selected]);
  useEffect(() => {
    if (!canLoadDefaults) return;
    const controller = new AbortController();
    let active = true;
    async function loadDefaults() {
      try {
        const response = await fetch(`/api/driver/report-defaults?date=${encodeURIComponent(serviceDate)}`,
          { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { location.replace("/driver/login"); return; }
        if (!response.ok) throw new Error("无法读取当天訂単和車库，請重试。");
        const result = reportDefaultsSchema.parse(await response.json());
        if (result.serviceDate !== serviceDate) throw new Error("日報默认信息日期不匹配。");
        if (active && document.visibilityState === "visible") {
          setDefaults(result); setDefaultsError("");
          const restored = defaultsDraft.current;
          setAssignment(restored?.serviceDate === serviceDate
            ? restored.assignment : result.orders.length === 1 ? result.orders[0].assignmentId : "");
          defaultsDraft.current = null;
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("Driver report defaults load failed.", cause);
        if (active) setDefaultsError("无法读取当天訂単和車库，請点“刷新日報”重试。");
      }
    }
    void loadDefaults();
    return () => { active = false; controller.abort(); };
  }, [canLoadDefaults, serviceDate, revision]);
  function readHeader(force = false) {
    if (!headerForm.current || (!force && !headerForm.current.reportValidity())) throw new Error("請检查日期、点呼時間、車両番号、運転手和客数。");
    const fields = new FormData(headerForm.current);
    const previous = report?.header;
    const dateValue = String(fields.get("serviceDate") ?? "");
    const headerServiceDate = validDate(dateValue) ? dateValue : report?.serviceDate ?? serviceDate;
    const clock = (name: string, previousValue?: string | null) => {
      const value = formatManualClock(String(fields.get(name) ?? ""));
      return !value ? null : /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : force ? previousValue ?? null : value;
    };
    const dutyStartTime = clock("dutyStartTime", previous?.dutyStartTime);
    const dutyEndTime = clock("dutyEndTime", previous?.dutyEndTime);
    const passengerValue = fields.get("passengerCount");
    const passengerCount = passengerValue === "" ? null : Number(passengerValue);
    const vehicleValue = String(fields.get("vehicleNumber") ?? "");
    const driverValue = String(fields.get("driverName") ?? "");
    const header = { serviceDate: headerServiceDate,
      dutyStartTime, dutyEndTime,
      dutyStartDate: dutyStartTime ? headerServiceDate : null,
      dutyEndDate: dutyEndTime ? defaultDutyEndDate(headerServiceDate, dutyStartTime ?? "", dutyEndTime) : null,
      ...(data?.vehicleLinking ? {
        assignmentId: report ? String(fields.get("assignmentId") ?? "") || null : selectedOrder?.assignmentId ?? null,
        vehicleBaseline: report ? String(fields.get("vehicleBaseline") ?? "") : selectedOrder?.vehicleNumber ?? "",
      } : {}),
      vehicleNumber: vehicleValue.length <= 100 ? vehicleValue : force ? previous?.vehicleNumber ?? "" : vehicleValue,
      driverName: driverValue.length <= 100 ? driverValue : force ? previous?.driverName ?? "" : driverValue,
      passengerCount: passengerCount === null || (Number.isInteger(passengerCount) && passengerCount >= 0 && passengerCount <= 999)
        ? passengerCount : force ? previous?.passengerCount ?? null : passengerCount };
    return force ? reportHeaderShapeSchema.parse(header) : reportHeaderSchema.parse(header);
  }
  async function save(action: Action, payload: unknown): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true; setSaving(true); setError(""); setNotice("");
    try {
      const command = { reportId: action === "checkout" ? null : report?.id,
        expectedVersion: action === "checkout" ? 0 : report?.version, action, payload };
      const key = JSON.stringify(command);
      if (pending.current?.key !== key) pending.current = { key, requestId: createDriverRequestId() };
      const parsed = reportCommandSchema.safeParse({ ...command, requestId: pending.current.requestId });
      if (!parsed.success) throw new Error("請填写有效地址和公里表；补录的時間与公里表须成对填写。");
      const response = await fetch("/api/driver/reports", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      const result = await response.json();
      if (!response.ok) {
        if ([400,401,403,404,409,422].includes(response.status)) pending.current = null;
        if (response.status === 409 && action !== "edit_stops" && !(["add_stop", "remove_stop"].includes(action) && dirty)) { setData(null); setBusy(true); setRevision(v => v + 1); }
        throw new Error(typeof result.error === "string" ? result.error : "日報保存未获确认，請刷新核对。");
      }
      pending.current = null;
      const updated = reportSchema.parse(result.report);
      if (action === "add_stop" || action === "remove_stop") {
        if (dirtyRef.current) {
          const retained = { ...captureDraft(), reportId: updated.id, version: updated.version };
          if (action === "remove_stop" && typeof payload === "object" && payload && "stopId" in payload) {
            for (const key of Object.keys(retained.fields)) {
              if (key.startsWith(`report-stop-${payload.stopId}/`)) delete retained.fields[key];
            }
          }
          setDraft(retained);
          try {
            if (draftOwner.current) writeReportDraft(sessionStorage, draftOwner.current, retained);
          } catch (cause) {
            console.error("Driver report draft update failed.", cause);
            setError("经由地已更新，但本机草稿保留失败，請勿离开页面并立即保存。");
          }
        }
      } else {
        setDirty(false); discardDraft();
      }
      setSelected(updated.id);
      setStarting(false);
      setData(current => current ? { ...current, reports: [updated,
        ...current.reports.filter(r => r.id !== updated.id)].sort((a, b) => b.departedAt.localeCompare(a.departedAt)) } : current);
      if (action !== "add_stop" && action !== "remove_stop") setDirty(false);
      const forced = action === "edit_stops" && typeof payload === "object" && payload !== null &&
        "force" in payload && payload.force === true;
      setNotice(action === "add_stop" ? "空白经由地已添加，填写完成后請点悬浮“保存”按钮。" :
        action === "remove_stop" ? "经由地已削除，其他未保存的修改仍保留。" :
          forced ? "已强制保存；无效或缺失字段沿用已保存内容，可之后修改。" : "已保存。");
      return true;
    } catch (cause) {
      console.error("Driver report save failed.", cause);
      setError(cause instanceof Error ? cause.message : "日報保存失败。");
      return false;
    } finally { lock.current = false; setSaving(false); }
  }
  const totals = report ? reportTotals(report, now) : null;
  async function removeStop(stopId: string) {
    if (!report || !table.current || lock.current) return;
    try {
      const stop = report.stops.find(item => item.id === stopId);
      if (!stop) throw new Error("经由地不存在，請刷新后核对。");
      await save("remove_stop", { stopId: stop.id });
    } catch (cause) {
      console.error("Driver report stop removal failed.", cause);
      setError(cause instanceof Error ? cause.message : "无法削除经由地。");
    }
  }
  async function saveChanges(force = true) {
    if (!report || !table.current || lock.current) return;
    try {
      formatManualTimes(table.current);
      const departureForm = table.current.querySelector<HTMLFormElement>("form[data-departure]");
      if (!departureForm || (!force && !departureForm.reportValidity())) throw new Error("請检查開始地点、公里数和時間。");
      const header = readHeader(force);
      const dated = reportOnDate(report, header.serviceDate);
      const departure = departureFromForm(dated, new FormData(departureForm), force);
      let previous = departure.departedAt;
      const stops = dated.stops.map(stop => {
        const form = table.current?.querySelector<HTMLFormElement>(`form[data-stop-id="${stop.id}"]`);
        if (!form) throw new Error("表格内容不完整，請刷新后核对。");
        if (!force && !form.reportValidity()) throw new Error("請检查表格中的地点、公里数和日期時間。");
        const updated = stopFromForm(stop, new FormData(form), previous, force);
        previous = updated.departedAt ?? updated.arrivedAt ?? previous;
        return updated;
      });
      const returnForm = table.current.querySelector<HTMLFormElement>("form[data-return]");
      if (!returnForm || (!force && !returnForm.reportValidity())) throw new Error("請检查終了地点、公里数和時間。");
      const returned = returnFromForm(dated, new FormData(returnForm), stops.length ? previous : departure.departedAt, force);
      if (returned && stops.some(stop => !stop.departedAt) && !force) throw new Error("請先补完所有经由地的到着、出発時間及公里数，再保存归库。");
      const timeError = reportTimeOrderError({
        header, departedAt: departure.departedAt, returnedAt: returned?.returnedAt ?? dated.returnedAt,
      });
      if (timeError && !force) throw new Error(timeError);
      await save("edit_stops", { stops, departure, header, ...(returned ? { return: returned } : {}),
        ...(force ? { force: true } : {}) });
    } catch (cause) {
      console.error("Report table validation failed.", cause);
      setError(cause instanceof Error ? cause.message : "表格内容无效，請检查日期時間。");
    }
  }
  const addStop = report ? <AddStopForm key={report.id}
    disabled={saving || report.stops.length >= 100} save={save} /> : null;
  return <main className={`driver-main ${styles.report}`} onInput={queueDraft} onChange={queueDraft} onBlur={queueDraft}>
    <DriverNavigation active="report" busy={saving}
      canLeave={persistDraft} />
    {returnMonth && <Link className="driver-link" href={`/driver/history?month=${encodeURIComponent(returnMonth)}`}
      onClick={event => { if (saving || !persistDraft()) event.preventDefault(); }}>‹ 返回日歴</Link>}
    <div className="driver-toolbar">
      <button className="driver-link" disabled={saving} onClick={() => {
        if (dirty && !window.confirm("刷新会放弃尚未保存的修改，是否继续？")) return;
        if (!discardDraft()) return;
        setDirty(false);
        setData(null); setDefaults(null); setAssignment(""); setDefaultsError(""); setBusy(true); setError(""); setRevision(v => v + 1);
      }}>刷新日報</button>
      <button className="driver-link" disabled={saving || busy || !data || Boolean(open)}
        title={busy || !data ? "日报加载完成后可新建" : open ? "请先完成当前出库中的日报" : undefined}
        aria-label={busy || !data ? "新建日报（日报加载完成后可新建）" :
          open ? "新建日报（请先完成当前出库中的日报）" : "新建日报"}
        onClick={startNewReport}>＋ 新建日报</button>
    </div>
    {error && <p className="driver-error" role="alert">{error}</p>}
    {dirty && <p className="driver-muted">输入内容作为本机草稿保留，切换回来可继续填写；請点“保存”正式提交。</p>}
    {busy ? <p className="driver-empty">正在读取日報…</p> : data && <>
      <section className="driver-card driver-stops driver-report-card" aria-label="日報">
        <form id="report-header" ref={headerForm} key={`header-${report?.id ?? "new"}-${report?.version ?? 0}-${report?.header?.vehicleNumber ?? ""}-${report?.header?.assignmentId ?? ""}`} className="driver-report-header"
          aria-label="日報基本信息" onInput={() => setDirty(true)} onSubmit={e => { e.preventDefault(); if (report) void saveChanges(); }}>
        {!report && !currentDefaults && !defaultsError && <p role="status">正在读取当天訂単和車库…</p>}
        {!report && defaultsError && <p className="driver-error" role="alert">{defaultsError}</p>}
        <label>日期<input key={report?.serviceDate ?? "new-date"} name="serviceDate" aria-label="日期" type="date" required
          disabled={saving} defaultValue={draftFields?.["report-header/serviceDate"] ?? report?.serviceDate ?? serviceDate} onChange={e => {
            if (!report) { setDraft(null); defaultsDraft.current = null; setNewDate(e.target.value); setDefaults(null); setAssignment(""); setDefaultsError(""); }
            else {
              const link = headerForm.current?.elements.namedItem("assignmentId");
              if (link instanceof HTMLSelectElement) link.value = "";
            }
          }} /></label>
        {report && data.vehicleLinking && <label className="driver-report-order-link">关联当天订单
          <select name="assignmentId" aria-label="日報关联訂単" disabled={saving}
            defaultValue={draftFields?.["report-header/assignmentId"] ?? report.header?.assignmentId ?? ""} onChange={event => {
              const option = report.orderOptions?.find(item => item.assignmentId === event.target.value);
              const plate = headerForm.current?.elements.namedItem("vehicleNumber");
              const baseline = headerForm.current?.elements.namedItem("vehicleBaseline");
              if (option && plate instanceof HTMLInputElement && baseline instanceof HTMLInputElement) {
                plate.value = option.vehicleNumber; baseline.value = option.vehicleNumber;
              }
              setDirty(true);
            }}>
            <option value="">未关联（保留手填車牌，不同步訂単）</option>
            {report.header?.assignmentId && !report.orderOptions?.some(item => item.assignmentId === report.header?.assignmentId) &&
              <option value={report.header.assignmentId}>原关联訂単（歴史派单）</option>}
            {report.orderOptions?.map(item => <option key={item.assignmentId} value={item.assignmentId}>
              {item.label}
            </option>)}
          </select>
          <input name="vehicleBaseline" type="hidden" defaultValue={draftFields?.["report-header/vehicleBaseline"] ?? report.header?.vehicleNumber ?? ""} />
        </label>}
        {!report && currentDefaults && <label className="driver-report-order-link">关联当天订单
          <select aria-label="关联当天訂単" value={assignment} disabled={saving || !currentDefaults.orders.length} onChange={e => {
            if (dirty && !window.confirm("更换訂単会重新带入車両番号及車库地址，是否继续？")) return;
            setDraft(null); defaultsDraft.current = null; setAssignment(e.target.value); setDirty(true);
          }}>
            <option value="">{currentDefaults.orders.length ? "請選択当天訂単" : "暂无可关联订单"}</option>
            {currentDefaults.orders.map(order => <option key={order.assignmentId} value={order.assignmentId}>
              {order.orderName?.trim() || "未命名订单"}
            </option>)}
          </select>
        </label>}
        {!report && selectedOrder && !selectedOrder.depot && <p className="driver-muted">未找到車庫地址，已暂填「車庫」，請按需修改。</p>}
        <label>車両番号<input key={report ? report.header?.vehicleNumber ?? "" : `${serviceDate}-${assignment}`} name="vehicleNumber" aria-label="車両番号"
          maxLength={100} disabled={saving || (!report && (!currentDefaults || needsOrder))}
          defaultValue={draftFields?.["report-header/vehicleNumber"] ?? report?.header?.vehicleNumber ?? selectedOrder?.vehicleNumber ?? ""} /></label>
        <label>運転手<input key={report ? report.header?.driverName ?? "" : `${serviceDate}-${currentDefaults?.driverName ?? ""}`} name="driverName" aria-label="運転手"
          maxLength={100} disabled={saving || (!report && !currentDefaults)}
          defaultValue={draftFields?.["report-header/driverName"] ?? report?.header?.driverName ?? currentDefaults?.driverName ?? ""} /></label>
        <label>客数<input key={report?.header?.passengerCount ?? ""} name="passengerCount" aria-label="客数" type="number"
          inputMode="numeric" min="0" max="999" step="1" disabled={saving} defaultValue={draftFields?.["report-header/passengerCount"] ?? report?.header?.passengerCount ?? ""} /></label>
        <DriverReportDutyRows key={`duty-start-${report?.id ?? serviceDate}-${report?.version ?? 0}`}
          position="start" header={report?.header}
          disabled={saving} draft={draftFields} />
        </form>
        <table ref={table} className="driver-stop-table driver-sheet" onInput={e => {
          if (e.target instanceof HTMLInputElement && (e.target.form?.id === "report-header" || e.target.form?.id === "report-checkout" ||
            e.target.form?.dataset.stopId || e.target.form?.hasAttribute("data-departure") || e.target.form?.hasAttribute("data-return"))) setDirty(true);
        }}>
          <caption className="driver-report-caption">乗務記録</caption>
          <colgroup><col className="driver-col-label" /><col className="driver-col-address" /><col className="driver-col-km" />
            <col className="driver-col-time" /><col className="driver-col-time" /></colgroup>
          <thead><tr><th scope="col">项目</th><th scope="col">地址</th><th scope="col">公里数</th>
            <th scope="col">到着</th><th scope="col">出発</th></tr></thead>
          {!report && <LocationRows key={serviceDate} locationKey={assignment} serviceDate={serviceDate}
            depotAddress={selectedOrder?.depot?.address || "車庫"} fields={draftFields}
            disabled={saving || !currentDefaults || needsOrder} save={async p => {
            if (!currentDefaults || needsOrder) { setError("請先读取当天訂単并選択訂単。"); return false; }
            try {
              const header = readHeader(Boolean(p.force));
              const timeError = reportTimeOrderError({ header, departedAt: p.departedAt, returnedAt: null });
              if (timeError && !p.force) throw new Error(timeError);
              return await save("checkout", { ...p, header });
            }
            catch (cause) {
              console.error("Invalid manual report checkout.", cause);
              setError(cause instanceof Error ? cause.message : "請检查开始地点、公里数、時間和日報基本信息。");
              return false;
            }
          }} />}
          {report && <>
          <DepartureRow key={`departure-${report.id}`} report={report} depotAddress={garageAddress}
            disabled={saving} saveChanges={saveChanges} fields={draftFields} />
          {report.stops.map((stop, i) => <StopRow key={`${report.id}-${stop.id}`} stop={stop} index={i}
            disabled={saving} saveChanges={saveChanges} removeStop={removeStop}
           allowDelete fields={draftFields} />)}
          <ReturnRow key={`return-${report.id}`} report={report} depotAddress={garageAddress}
            disabled={saving} saveChanges={saveChanges} fields={draftFields} />
          </>}
          <DriverReportDutyRows key={`duty-end-${report?.id ?? serviceDate}-${report?.version ?? 0}`}
            position="end" header={report?.header}
            disabled={saving} draft={draftFields} />
        </table>
        {addStop}
      </section>
      {notice && <p className="driver-muted" role="status">{notice}</p>}
      {report && <>
        <section className="driver-card">
          <h2>本次汇総</h2>
          <div className="driver-row"><span>当日公里数</span><strong>{totals!.distance === null ? "归库后计算" : `${totals!.distance} km`}</strong></div>
          <div className="driver-row"><span>休憩時間</span><strong>{durationLabel(totals!.restMs)}</strong></div>
          <div className="driver-row"><span>拘束時間{!report.returnedAt && "（进行中）"}</span><strong>{durationLabel(totals!.elapsedMs)}</strong></div>
        </section>
      </>}
      {data.reports.length > 0 && <details className="driver-card"><summary>历史日報</summary><label className="driver-field">最近及所选日報
        <select value={report?.id ?? ""} disabled={saving} onChange={e => {
          if (dirty && !window.confirm("切换日報会放弃尚未保存的修改，是否继续？")) return;
          if (!discardDraft()) return;
          setDirty(false); setStarting(false); setSelected(e.target.value); setError(""); setNotice("");
        }}>
          {!report && <option value="">新日報 · 待出库</option>}
          {data.reports.map(r => {
            const orderName = r.orderOptions?.find(option => option.assignmentId === r.header?.assignmentId)?.label.trim();
            return <option key={r.id} value={r.id}>{r.serviceDate}{orderName ? ` · ${orderName}` : ""}</option>;
          })}
        </select></label></details>}
        {data && !busy && !report && <div className={styles.floatingActions} role="group" aria-label="開始地点保存">
          <button type="submit" form="report-checkout" className="driver-button"
            disabled={saving || !currentDefaults || needsOrder}>
            {saving ? "保存中…" : "保存開始地点"}
          </button>
        </div>}
        {report && <div className={styles.floatingActions} role="group" aria-label="日報修改和保存">
          <button type="button" className="driver-button driver-secondary" aria-pressed="true" disabled>
            修改中
          </button>
          <button type="button" className="driver-button" disabled={saving || !dirty} onClick={() => saveChanges()}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>}
    </>}
  </main>;
}
