"use client";

import DriverNavigation from "@/app/driver/navigation";
import { ReportDutyFields } from "@/components/report-duty-fields";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/browser";
import { createDriverRequestId } from "@/lib/driver/orders";
import { departureFromForm, durationLabel, isBlankReportStop, reportCommandSchema, reportDataSchema, reportDefaultsSchema, reportTime,
  reportHeaderSchema, reportOnDate, reportSchema, reportTimeOrderError, reportTotals, returnFromForm, stopFromForm, toJapanInput, type DailyReport } from "@/lib/driver/reports";
import type { z } from "zod";
import styles from "./report.module.css";

type Action = z.infer<typeof reportCommandSchema>["action"];
type Depot = { name: string; address: string } | null;
type Save = (action: Action, payload: unknown) => Promise<boolean>;

function LocationRows({ depot, locationKey, disabled, save }: {
  depot: Depot; locationKey: string; disabled: boolean; save: (payload: { useDefault: boolean; address: string; km: number }) => Promise<boolean>;
}) {
  const label = "出库";
  const formId = "report-checkout";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (await save({ useDefault: false, address: String(data.get("address") ?? ""), km: Number(data.get("km")) })) form.reset();
  }
  return <tbody aria-label={`${label}打卡`}>
    <tr className="driver-sheet-location"><th scope="row">{label}</th><td>
      <form id={formId} onSubmit={submit}>
        {depot && <span className="driver-muted">{depot.name}车库（可修改）</span>}
        <input key={locationKey} name="address" aria-label={`${label}地点地址`} placeholder={`${label}地点地址`}
          disabled={disabled} defaultValue={depot?.address ?? ""} required maxLength={300} autoComplete="off" />
      </form>
    </td><td><input form={formId} name="km" aria-label={`${label}公里表`} placeholder="km" type="number" inputMode="decimal"
        min="0" max="9999999" step="0.1" required /></td>
      <td className="driver-time-cell">—</td>
      <td className="driver-time-cell" aria-label="出库时间：打卡自动生成">—</td></tr>
    <tr><td colSpan={5}><div className="driver-stop-actions">
      <button form={formId} className="driver-button" disabled={disabled}>{label}打卡</button>
    </div></td></tr>
  </tbody>;
}
function ReturnRow({ report, disabled, saveChanges }: {
  report: DailyReport; disabled: boolean; saveChanges: () => Promise<void>;
}) {
  const formId = "report-edit-return";
  return <tbody aria-label="归库记录"><tr className="driver-sheet-location">
    <th scope="row">归库</th><td><form id={formId} data-return onSubmit={e => { e.preventDefault(); void saveChanges(); }}>
      <input key={report.returnAddress} name="address" aria-label="归库地点地址" maxLength={300}
        disabled={disabled} defaultValue={report.returnAddress ?? ""} />
    </form></td><td><input key={report.returnKm} form={formId} name="km" aria-label="归库公里表" type="number"
      inputMode="decimal" min="0" max="9999999" step="0.1" disabled={disabled} defaultValue={report.returnKm ?? ""} /></td>
    <td><input key={report.returnedAt} form={formId} name="returnedAt" aria-label="归库时间" type="time" step="60"
      disabled={disabled} defaultValue={toJapanInput(report.returnedAt).slice(11, 16)} /></td><td className="driver-time-cell">—</td>
  </tr></tbody>;
}
function DepartureRow({ report, disabled, saveChanges }: {
  report: DailyReport; disabled: boolean; saveChanges: () => Promise<void>;
}) {
  const formId = "report-edit-departure";
  return <tbody aria-label="出库记录"><tr className="driver-sheet-location">
    <th scope="row">出库</th><td><form id={formId} data-departure onSubmit={e => { e.preventDefault(); void saveChanges(); }}>
      <input key={report.departureAddress} name="address" aria-label="出库地点地址" required maxLength={300}
        disabled={disabled} defaultValue={report.departureAddress} />
    </form></td><td><input key={report.departureKm} form={formId} name="km" aria-label="出库公里表" type="number"
      inputMode="decimal" min="0" max="9999999" step="0.1" required disabled={disabled} defaultValue={report.departureKm} /></td>
    <td className="driver-time-cell">—</td><td><input key={report.departedAt} form={formId} name="departedAt"
      aria-label="出库时间" type="time" step="60" required disabled={disabled} defaultValue={toJapanInput(report.departedAt).slice(11, 16)} /></td>
  </tr></tbody>;
}
function AddStopForm({ disabled, save, error, saveChanges, saving, closed, removeStop, canRemove }: {
  disabled: boolean; save: Save; error?: string; saveChanges?: () => Promise<void>; saving?: boolean; closed?: boolean;
  removeStop?: () => Promise<void>; canRemove?: boolean;
}) {
  return <>
    <tr><td colSpan={5}><div className="driver-stop-add">
      <div className="driver-stop-actions">
        {!closed && <div className="driver-stop-row-controls">
          <button type="button" className="driver-button" aria-label="追加空白经由地" disabled={disabled} onClick={async () => {
            await save("add_stop", { address: "", arrivedAt: null, departedAt: null });
          }}>＋</button>
          <button type="button" className="driver-button driver-secondary" aria-label="删除最后一条空白经由地"
            disabled={saving || !canRemove} onClick={removeStop}>−</button>
        </div>}
        {saveChanges && <button type="button" className="driver-button driver-secondary" disabled={saving} onClick={saveChanges}>保存修改</button>}
      </div>
      {error && <p className="driver-error" role="alert">{error}</p>}
    </div></td></tr>
  </>;
}
function StopRow({ stop, index, disabled, saveChanges }: {
  stop: DailyReport["stops"][number]; index: number; disabled: boolean;
  saveChanges: () => Promise<void>;
}) {
  const formId = `report-stop-${stop.id}`;
  const recordedKm = stop.departedKm ?? stop.arrivedKm ?? stop.plannedKm ?? null;
  async function correct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveChanges();
  }
  return <tbody aria-label={`经由地 ${index + 1}`}>
      <tr className="driver-sheet-location"><th scope="row">经由{index + 1}</th><td>
        <form id={formId} data-stop-id={stop.id} onSubmit={correct}>
          <input key={stop.address} name="address" aria-label={`经由地 ${index + 1} 地址`} disabled={disabled} maxLength={300} defaultValue={stop.address} />
        </form>
      </td><td className="driver-stop-km">
          <input key={recordedKm} form={formId} name="km" disabled={disabled} type="number" inputMode="decimal" min="0" max="9999999" step="0.1"
            aria-label={`经由地 ${index + 1} 公里数（公里表累计读数）`}
            placeholder="km" defaultValue={recordedKm ?? ""} />
      </td>
        {(["arrived", "departed"] as const).map(prefix => {
          const label = prefix === "arrived" ? "到着" : "出发";
          const time = toJapanInput(stop[`${prefix}At`]).slice(11, 16);
          return <td key={prefix}>
            <input key={stop[`${prefix}At`]} form={formId} name={`${prefix}At`} disabled={disabled} type="time" step="60"
              aria-label={`经由地 ${index + 1} ${label}时间`} defaultValue={time} />
          </td>;
        })}
      </tr>
    </tbody>;
}

export default function DriverReport() {
  const [data, setData] = useState<z.infer<typeof reportDataSchema> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [starting, setStarting] = useState(false);
  const [dirty, setDirtyState] = useState(false);
  const [newDate, setNewDate] = useState(() => reportTime(new Date().toISOString()).slice(0, 10));
  const [defaults, setDefaults] = useState<z.infer<typeof reportDefaultsSchema> | null>(null);
  const [assignment, setAssignment] = useState("");
  const [defaultsError, setDefaultsError] = useState("");
  const table = useRef<HTMLTableElement>(null);
  const headerForm = useRef<HTMLFormElement>(null);
  const lock = useRef(false);
  const pending = useRef<{ key: string; requestId: string } | null>(null);
  const dirtyRef = useRef(dirty);
  function setDirty(value: boolean) { dirtyRef.current = value; setDirtyState(value); }
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/driver/reports", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { location.replace("/driver/login"); return; }
        if (!response.ok) throw new Error("无法读取日报，请重试或联系管理员。");
        const result = reportDataSchema.parse(await response.json());
        if (active && document.visibilityState === "visible") { setData(result); setDirty(false); setBusy(false); }
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("Report load failed.", cause);
        if (active) { setError("无法读取日报，请刷新重试。"); setBusy(false); }
      }
    }
    function revalidate() { setData(null); setDefaults(null); setAssignment(""); setDefaultsError(""); setBusy(true); setError(""); setRevision(v => v + 1); }
    function visibility() {
      if (document.visibilityState === "hidden") { controller.abort(); setData(null); setDefaults(null); setAssignment(""); setBusy(true); }
      else revalidate();
    }
    function pageShow(event: PageTransitionEvent) { if (event.persisted) revalidate(); }
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", pageShow);
    const { data: subscription } = createClient().auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") { setData(null); location.replace("/driver/login"); }
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    void load();
    return () => {
      active = false; controller.abort(); clearInterval(timer); subscription.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pageshow", pageShow);
    };
  }, [revision]);
  const open = data?.reports.find(r => !r.returnedAt);
  const report = starting && !open ? undefined : data?.reports.find(r => r.id === selected) ?? data?.reports[0];
  const serviceDate = newDate ?? reportTime(new Date(now).toISOString()).slice(0, 10);
  const currentDefaults = defaults?.serviceDate === serviceDate ? defaults : null;
  const selectedOrder = currentDefaults?.orders.find(order => order.assignmentId === assignment);
  const needsOrder = Boolean(currentDefaults?.orders.length && !selectedOrder);
  const canLoadDefaults = Boolean(data && !report && !busy);
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
        if (!response.ok) throw new Error("日报同步失败，请刷新核对最新車両番号。");
        const result = reportDataSchema.parse(await response.json());
        if (active && !dirtyRef.current && !lock.current && document.visibilityState === "visible") {
          setData(result); setError("");
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("Driver report synchronization failed.", cause);
        if (active) setError("日报同步失败，请刷新核对最新車両番号。");
      } finally { loading = false; }
    }
    const timer = setInterval(() => void refreshSavedReports(), 10_000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [busy, saving, dirty, starting]);
  useEffect(() => {
    if (!canLoadDefaults) return;
    const controller = new AbortController();
    let active = true;
    async function loadDefaults() {
      try {
        const response = await fetch(`/api/driver/report-defaults?date=${encodeURIComponent(serviceDate)}`,
          { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { location.replace("/driver/login"); return; }
        if (!response.ok) throw new Error("无法读取当天订单和车库，请重试。");
        const result = reportDefaultsSchema.parse(await response.json());
        if (result.serviceDate !== serviceDate) throw new Error("日报默认信息日期不匹配。");
        if (active && document.visibilityState === "visible") {
          setDefaults(result);
          setAssignment(result.orders.length === 1 ? result.orders[0].assignmentId : "");
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("Driver report defaults load failed.", cause);
        if (active) setDefaultsError("无法读取当天订单和车库，请点“刷新日报”重试。");
      }
    }
    void loadDefaults();
    return () => { active = false; controller.abort(); };
  }, [canLoadDefaults, serviceDate, revision]);
  function readHeader() {
    if (!headerForm.current || !headerForm.current.reportValidity()) throw new Error("请检查日期、点呼时间、車両番号、運転手和客数。");
    const fields = new FormData(headerForm.current);
    return reportHeaderSchema.parse({ serviceDate: String(fields.get("serviceDate") ?? ""),
      dutyStartTime: String(fields.get("dutyStartTime") ?? "") || null,
      dutyEndTime: String(fields.get("dutyEndTime") ?? "") || null,
      dutyStartDate: fields.get("dutyStartTime") ? String(fields.get("dutyStartDate") ?? "") : null,
      dutyEndDate: fields.get("dutyEndTime") ? String(fields.get("dutyEndDate") ?? "") : null,
      ...(data?.vehicleLinking ? {
        assignmentId: report ? String(fields.get("assignmentId") ?? "") || null : selectedOrder?.assignmentId ?? null,
        vehicleBaseline: report ? String(fields.get("vehicleBaseline") ?? "") : selectedOrder?.vehicleNumber ?? "",
      } : {}),
      vehicleNumber: String(fields.get("vehicleNumber") ?? ""), driverName: String(fields.get("driverName") ?? ""),
      passengerCount: fields.get("passengerCount") === "" ? null : Number(fields.get("passengerCount")) });
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
      if (!parsed.success) throw new Error("请填写有效地址和公里表；补录的时间与公里表须成对填写。");
      const response = await fetch("/api/driver/reports", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      const result = await response.json();
      if (!response.ok) {
        if ([400,401,403,404,409,422].includes(response.status)) pending.current = null;
        if (response.status === 409 && action !== "edit_stops" && !(["add_stop", "remove_stop"].includes(action) && dirty)) { setData(null); setBusy(true); setRevision(v => v + 1); }
        throw new Error(typeof result.error === "string" ? result.error : "日报保存未获确认，请刷新核对。");
      }
      pending.current = null;
      const updated = reportSchema.parse(result.report);
      setSelected(updated.id);
      setStarting(false);
      setData(current => current ? { ...current, reports: [updated,
        ...current.reports.filter(r => r.id !== updated.id)].sort((a, b) => b.departedAt.localeCompare(a.departedAt)).slice(0, 31) } : current);
      if (action !== "add_stop" && action !== "remove_stop") setDirty(false);
      setNotice(action === "add_stop" ? "空白经由地已保存，填写修改后请点“保存修改”。" :
        action === "remove_stop" ? "已删除一条空白经由地，其他未保存的修改仍保留。" : "已保存。");
      return true;
    } catch (cause) {
      console.error("Driver report save failed.", cause);
      setError(cause instanceof Error ? cause.message : "日报保存失败。");
      return false;
    } finally { lock.current = false; setSaving(false); }
  }
  const totals = report ? reportTotals(report, now) : null;
  async function removeBlankStop() {
    if (!report || !table.current || lock.current) return;
    try {
      for (const stop of [...report.stops].reverse()) {
        if (!isBlankReportStop(stop)) continue;
        const form = table.current.querySelector<HTMLFormElement>(`form[data-stop-id="${stop.id}"]`);
        if (!form) throw new Error("表格内容不完整，请刷新后核对。");
        if (!form.checkValidity()) continue;
        const fields = new FormData(form);
        if (["address", "km", "arrivedAt", "departedAt"].some(name => String(fields.get(name) ?? "").trim())) continue;
        await save("remove_stop", { stopId: stop.id });
        return;
      }
      throw new Error("没有可删除的全空经由地，已填写的内容不会删除。");
    } catch (cause) {
      console.error("Blank report stop removal failed.", cause);
      setError(cause instanceof Error ? cause.message : "无法删除空白经由地。");
    }
  }
  async function saveChanges() {
    if (!report || !table.current || lock.current) return;
    try {
      const departureForm = table.current.querySelector<HTMLFormElement>("form[data-departure]");
      if (!departureForm || !departureForm.reportValidity()) throw new Error("请检查出库地点、公里数和时间。");
      const header = readHeader();
      const dated = reportOnDate(report, header.serviceDate);
      const departure = departureFromForm(dated, new FormData(departureForm));
      let previous = departure.departedAt;
      const stops = dated.stops.map(stop => {
        const form = table.current?.querySelector<HTMLFormElement>(`form[data-stop-id="${stop.id}"]`);
        if (!form) throw new Error("表格内容不完整，请刷新后核对。");
        if (!form.reportValidity()) throw new Error("请检查表格中的地点、公里数和日期时间。");
        const updated = stopFromForm(stop, new FormData(form), previous);
        previous = updated.departedAt ?? updated.arrivedAt ?? previous;
        return updated;
      });
      const returnForm = table.current.querySelector<HTMLFormElement>("form[data-return]");
      if (!returnForm || !returnForm.reportValidity()) throw new Error("请检查归库地点、公里数和时间。");
      const returned = returnFromForm(dated, new FormData(returnForm), stops.length ? previous : departure.departedAt);
      if (returned && stops.some(stop => !stop.departedAt)) throw new Error("请先补完所有经由地的到着、出发时间及公里数，再保存归库。");
      const timeError = reportTimeOrderError({
        header, departedAt: departure.departedAt, returnedAt: returned?.returnedAt ?? dated.returnedAt,
      });
      if (timeError) throw new Error(timeError);
      await save("edit_stops", { stops, departure, header, ...(returned ? { return: returned } : {}) });
    } catch (cause) {
      console.error("Report table validation failed.", cause);
      setError(cause instanceof Error ? cause.message : "表格内容无效，请检查日期时间。");
    }
  }
  const addStop = report ? <AddStopForm key={report.id}
    disabled={saving || report.stops.length >= 100} saving={saving}
    closed={Boolean(report.returnedAt)} saveChanges={saveChanges} save={save} error={error}
    removeStop={removeBlankStop} canRemove={report.stops.some(isBlankReportStop)} /> : null;
  return <main className={`driver-main ${styles.report}`}>
    <DriverNavigation active="report" busy={saving}
      canLeave={() => !dirty || window.confirm("切换会放弃尚未保存的日报修改，是否继续？")} />
    <div className="driver-toolbar">
      <button className="driver-link" disabled={saving} onClick={() => {
        if (dirty && !window.confirm("刷新会放弃尚未保存的修改，是否继续？")) return;
        setData(null); setDefaults(null); setAssignment(""); setDefaultsError(""); setBusy(true); setError(""); setRevision(v => v + 1);
      }}>刷新日报</button></div>
    {error && <p className="driver-error" role="alert">{error}</p>}
    {dirty && <p className="driver-muted">{report ? "有未保存的修改，请点表格末尾“保存修改”；＋和−仅保存空白行的增减。" :
      "有未保存的日报信息，请点“出库打卡”保存。"}</p>}
    {busy ? <p className="driver-empty">正在读取日报…</p> : data && <>
      {!report && <div className="driver-card">
        {!currentDefaults && !defaultsError && <p role="status">正在读取当天订单和车库…</p>}
        {defaultsError && <p className="driver-error" role="alert">{defaultsError}</p>}
        {currentDefaults && (currentDefaults.orders.length ? <label className="driver-field">关联当天订单
          <select aria-label="关联当天订单" value={assignment} disabled={saving} onChange={e => {
            if (dirty && !window.confirm("更换订单会重新带入車両番号及车库地址，是否继续？")) return;
            setAssignment(e.target.value); setDirty(true);
          }}>
            <option value="">请选择当天订单</option>
            {currentDefaults.orders.map(order => <option key={order.assignmentId} value={order.assignmentId}>
              {order.time} · {order.pickup} → {order.destination} · {order.vehicleNumber || "未填車両番号"}
            </option>)}
          </select></label> : <p className="driver-muted">当天没有已派给本人的订单，車両番号和车库地址请手动填写。</p>)}
        {selectedOrder && !selectedOrder.depot && <p className="driver-muted">未找到唯一车辆所属会社的车库地址，请手动填写。</p>}
      </div>}
      <form ref={headerForm} key={`header-${report?.id ?? "new"}-${report?.version ?? 0}-${report?.header?.vehicleNumber ?? ""}-${report?.header?.assignmentId ?? ""}`} className="driver-report-header"
        aria-label="日报基本信息" onInput={() => setDirty(true)} onSubmit={e => { e.preventDefault(); if (report) void saveChanges(); }}>
        {report && data.vehicleLinking && <label className="driver-report-order-link">关联当天订单
          <select name="assignmentId" aria-label="日报关联订单" disabled={saving}
            defaultValue={report.header?.assignmentId ?? ""} onChange={event => {
              const option = report.orderOptions?.find(item => item.assignmentId === event.target.value);
              const plate = headerForm.current?.elements.namedItem("vehicleNumber");
              const baseline = headerForm.current?.elements.namedItem("vehicleBaseline");
              if (option && plate instanceof HTMLInputElement && baseline instanceof HTMLInputElement) {
                plate.value = option.vehicleNumber; baseline.value = option.vehicleNumber;
              }
              setDirty(true);
            }}>
            <option value="">未关联（保留手填车牌，不同步订单）</option>
            {report.header?.assignmentId && !report.orderOptions?.some(item => item.assignmentId === report.header?.assignmentId) &&
              <option value={report.header.assignmentId}>原关联订单（历史派单）</option>}
            {report.orderOptions?.map(item => <option key={item.assignmentId} value={item.assignmentId}>
              {item.label} · {item.vehicleNumber || "未填写"}
            </option>)}
          </select>
          <span className="driver-muted">{report.header?.assignmentId
            ? "車両番号与关联订单按服务日同步；修改并保存也会更新订单。"
            : "尚未确认订单关联，保留原车牌；请人工选择后保存以开启同步。"}</span>
          <input name="vehicleBaseline" type="hidden" defaultValue={report.header?.vehicleNumber ?? ""} />
        </label>}
        <label>日期<input key={report?.serviceDate ?? "new-date"} name="serviceDate" aria-label="日期" type="date" required
          disabled={saving} defaultValue={report?.serviceDate ?? serviceDate} onChange={e => {
            if (!report) { setNewDate(e.target.value); setDefaults(null); setAssignment(""); setDefaultsError(""); }
            else {
              const link = headerForm.current?.elements.namedItem("assignmentId");
              if (link instanceof HTMLSelectElement) link.value = "";
            }
          }} /></label>
        <label>客数<input key={report?.header?.passengerCount ?? ""} name="passengerCount" aria-label="客数" type="number"
          inputMode="numeric" min="0" max="999" step="1" disabled={saving} defaultValue={report?.header?.passengerCount ?? ""} /></label>
        <label>車両番号<input key={report ? report.header?.vehicleNumber ?? "" : `${serviceDate}-${assignment}`} name="vehicleNumber" aria-label="車両番号"
          maxLength={100} disabled={saving || (!report && (!currentDefaults || needsOrder))}
          defaultValue={report?.header?.vehicleNumber ?? selectedOrder?.vehicleNumber ?? ""} /></label>
        <label>運転手<input key={report ? report.header?.driverName ?? "" : `${serviceDate}-${currentDefaults?.driverName ?? ""}`} name="driverName" aria-label="運転手"
          maxLength={100} disabled={saving || (!report && !currentDefaults)}
          defaultValue={report?.header?.driverName ?? currentDefaults?.driverName ?? ""} /></label>
        <ReportDutyFields key={`duty-${report?.id ?? serviceDate}-${report?.version ?? 0}`}
          header={report?.header} serviceDate={report?.serviceDate ?? serviceDate} disabled={saving} />
      </form>
      <section className="driver-card driver-stops" aria-label="出库经由地归库"><h2>出库 · 经由地 · 归库</h2>
        <p className="driver-muted">经由地时间手动填写后统一保存，早于上一项自动顺延至次日。</p>
        <table ref={table} className="driver-stop-table driver-sheet" onInput={e => {
          if (e.target instanceof HTMLInputElement && (e.target.form?.id === "report-checkout" || e.target.form?.dataset.stopId || e.target.form?.hasAttribute("data-departure") || e.target.form?.hasAttribute("data-return"))) setDirty(true);
        }}>
          <caption>{report ? `${report.serviceDate} · ${report.returnedAt ? "已归库" : "出库中"}` : "新日报"} · 日本时间</caption>
          <colgroup><col className="driver-col-label" /><col className="driver-col-address" /><col className="driver-col-km" />
            <col className="driver-col-time" /><col className="driver-col-time" /></colgroup>
          <thead><tr><th scope="col">项目</th><th scope="col">地址</th><th scope="col">公里数</th>
            <th scope="col">到着</th><th scope="col">出发</th></tr></thead>
          {!report && <LocationRows key={serviceDate} locationKey={assignment} depot={selectedOrder?.depot ?? null}
            disabled={saving || !currentDefaults || needsOrder} save={async p => {
            if (!currentDefaults || needsOrder) { setError("请先读取当天订单并选择订单。"); return false; }
            try { return await save("checkout", { ...p, header: readHeader() }); }
            catch (cause) { console.error("Invalid report header.", cause); setError("请检查日期、点呼时间、車両番号、運転手和客数。"); return false; }
          }} />}
          {report && <>
          <DepartureRow key={`departure-${report.id}`} report={report} disabled={saving} saveChanges={saveChanges} />
          {report.stops.map((stop, i) => <StopRow key={`${report.id}-${stop.id}`} stop={stop} index={i}
            disabled={saving} saveChanges={saveChanges} />)}
          {addStop && <tbody>{addStop}</tbody>}
          <ReturnRow key={`return-${report.id}`} report={report} disabled={saving} saveChanges={saveChanges} />
          </>}
        </table>
        {!report && <p className="driver-muted">出库后，在表格内继续添加经由地。</p>}
        {report?.returnedAt && !open && <button className="driver-link" disabled={saving}
          onClick={() => {
            if (dirty && !window.confirm("开始新日报会放弃尚未保存的修改，是否继续？")) return;
            setDirty(false); setSelected(null); setStarting(true); setNewDate(reportTime(new Date().toISOString()).slice(0, 10));
            setDefaults(null); setAssignment(""); setDefaultsError(""); setError(""); setNotice("");
          }}>开始新一次出库</button>}
      </section>
      {notice && <p className="driver-muted" role="status">{notice}</p>}
      {report && <>
        <section className="driver-card">
          <h2>本次汇总</h2>
          <div className="driver-row"><span>拘束时间{!report.returnedAt && "（进行中）"}</span><strong>{durationLabel(totals!.elapsedMs)}</strong></div>
          <div className="driver-row"><span>累计休息</span><strong>{durationLabel(totals!.restMs)}</strong></div>
          <div className="driver-row"><span>当日公里数</span><strong>{totals!.distance === null ? "归库后计算" : `${totals!.distance} km`}</strong></div>
        </section>
      </>}
      {data.reports.length > 0 && <details className="driver-card"><summary>历史日报</summary><label className="driver-field">最近31份日报
        <select value={report?.id ?? ""} disabled={saving} onChange={e => {
          if (dirty && !window.confirm("切换日报会放弃尚未保存的修改，是否继续？")) return;
          setDirty(false); setStarting(false); setSelected(e.target.value); setError(""); setNotice("");
        }}>
          {!report && <option value="">新日报 · 待出库</option>}
          {data.reports.map(r => <option key={r.id} value={r.id}>{r.serviceDate} {reportTime(r.departedAt).slice(11, 16)} {r.returnedAt ? "已归库" : "出库中"}</option>)}
        </select></label></details>}
    </>}
    <p className="driver-muted">请在安全停车后操作。新日报按所选当天订单带入車両番号、本人姓名及车辆所属会社车库地址，均可手动修改；已保存日报不自动覆盖。不采集定位。</p>
  </main>;
}
