"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/browser";
import { createDriverRequestId, japanDate } from "@/lib/driver/orders";
import { durationLabel, dutyDuration, reportHeaderSchema, reportOnDate, reportSchema, reportTimeOrderError, reportTotals, stopTime, toJapanInput, type DailyReport } from "@/lib/driver/reports";
import { filterOperationRows, operationCommandSchema, operationDataSchema, operationDateLabel, operationResultSchema, operationTimeLabel, type OperationRow } from "@/lib/operations-reports";
import { printOperationsReports } from "@/lib/operations-report-print";
import { ReportDutyFields } from "@/components/report-duty-fields";
import styles from "@/components/operations-report-editor.module.css";

const fieldClass = "rounded border border-gray-300 bg-white px-2 py-1.5 text-sm disabled:bg-gray-100";
const buttonClass = "rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50";
const operationReportColumns = ["日期", "車両番号", "運転手", "出勤点呼時間", "開始地点", "出発時間",
  "接客地点", "下客地点", "終了地点", "到着時間", "退勤点呼時間", "工作総時长", "操作"] as const;
type Command = ReturnType<typeof operationCommandSchema.parse>;

function validServiceDate(value: string) {
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function formatOperationClockInput(value: string) {
  const compact = value.trim();
  if (/^\d{4}$/.test(compact)) return `${compact.slice(0, 2)}:${compact.slice(2)}`;
  const clock = compact.match(/^(\d{1,2}):([0-5]\d)$/);
  return clock ? `${clock[1].padStart(2, "0")}:${clock[2]}` : value;
}

async function submitCommand(command: Command, signal: AbortSignal) {
  const response = await fetch("/api/operations-reports", { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(command), signal });
  const body: unknown = await response.json();
  if (!response.ok) throw new Error(typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
    ? body.error : "操作结果未获确认，請刷新核对。");
  const result = operationResultSchema.parse(body);
  const id = command.action === "edit" ? command.report.id : command.reportId;
  if (result.action !== command.action || (result.action === "edit" ? result.report.id : result.deletedId) !== id)
    throw new Error("操作返回不一致，請刷新核对。");
  if (result.action === "edit" && command.action === "edit" && result.report.version <= command.report.version)
    throw new Error("日報保存版本未获确认，請刷新核对。");
  return result;
}

export function OperationReportEditor({ row, onClose, onSaved }: {
  row: OperationRow; onClose: () => void; onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const unsaved = useRef(false);
  const [stops, setStops] = useState(row.report.stops);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const r = row.report;
  const totals = reportTotals(r);
  const restMs = totals.restMs;
  const restraintMs = dutyDuration(r);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    const preventLeave = (event: BeforeUnloadEvent) => { if (unsaved.current || lock.current) event.preventDefault(); };
    window.addEventListener("beforeunload", preventLeave);
    return () => { controller.current?.abort(); node?.close(); window.removeEventListener("beforeunload", preventLeave); };
  }, []);
  function markDirty() { unsaved.current = true; setDirty(true); }
  function close() {
    if (!lock.current && (!dirty || window.confirm("放弃尚未保存的日報修改？"))) onClose();
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const form = event.currentTarget;
    setError("");
    try {
      const data = new FormData(form);
      const text = (name: string) => String(data.get(name) ?? "");
      const clock = (name: string) => formatOperationClockInput(text(name));
      const number = (name: string) => text(name) === "" ? null : Number(text(name));
      const header = reportHeaderSchema.parse({
        serviceDate: text("serviceDate"), vehicleNumber: text("vehicleNumber"), driverName: text("driverName"),
        passengerCount: number("passengerCount"),
        dutyStartTime: clock("dutyStartTime") || null, dutyEndTime: clock("dutyEndTime") || null,
        dutyStartDate: text("dutyStartTime") ? text("dutyStartDate") : null,
        dutyEndDate: text("dutyEndTime") ? text("dutyEndDate") : null,
      });
      const dated = reportOnDate({ ...r, stops }, header.serviceDate);
      const departedAt = stopTime(clock("departedAt"), `${header.serviceDate}T00:00:00+09:00`, dated.departedAt);
      if (!departedAt) throw new Error("請填写有效出库時間（HH:mm）。");
      let previousAt = departedAt;
      const updatedStops = dated.stops.map(stop => {
        const arrivedAt = stopTime(clock(`${stop.id}.arrivedAt`), previousAt, stop.arrivedAt);
        const departedAt = stopTime(clock(`${stop.id}.departedAt`), arrivedAt ?? previousAt, stop.departedAt);
        const km = number(`${stop.id}.km`);
        previousAt = departedAt ?? arrivedAt ?? previousAt;
        return { ...stop, arrivedAt, arrivedKm: arrivedAt ? km : null,
          departedAt, departedKm: departedAt ? km : null, plannedKm: stop.plannedKm ?? null };
      });
      const returnedAt = stopTime(clock("returnedAt"), previousAt, dated.returnedAt);
      const report = reportSchema.parse({ ...dated,
        header: { ...(r.orderOptions ? { assignmentId: text("assignmentId") || null } : {}),
          vehicleNumber: header.vehicleNumber, driverName: header.driverName, passengerCount: header.passengerCount,
          dutyStartDate: header.dutyStartDate, dutyEndDate: header.dutyEndDate,
          dutyStartTime: header.dutyStartTime, dutyEndTime: header.dutyEndTime },
        departedAt, departureAddress: text("departureAddress"), departureKm: number("departureKm"),
        returnedAt, returnAddress: text("returnAddress").trim() || null, returnKm: number("returnKm"),
        stops: updatedStops.map(stop => ({ ...stop, address: text(`${stop.id}.address`) })),
        rests: dated.rests,
      });
      const timeError = reportTimeOrderError(report);
      if (timeError) throw new Error(timeError);
      const draft = { action: "edit" as const, report: { ...report,
        header: { ...report.header, ...(r.orderOptions ? { vehicleBaseline: text("vehicleBaseline") } : {}) } },
        reason: "电脑端编辑乘务日报" };
      const key = JSON.stringify(draft);
      if (pending.current?.key !== key) pending.current = { key, id: createDriverRequestId() };
      const command = operationCommandSchema.parse({ ...draft, requestId: pending.current.id });
      lock.current = true; setBusy(true);
      const request = new AbortController(); controller.current = request;
      await submitCommand(command, request.signal);
      if (!request.signal.aborted) onSaved();
    } catch (cause) {
      if (controller.current?.signal.aborted) return;
      console.error("Operations report edit failed.", cause instanceof Error ? cause.name : "UnknownError");
      setError(cause instanceof Error && cause.name !== "ZodError" ? cause.message :
        "請检查日期時間、点呼先后、公里数和每个经由地的配对字段。");
    } finally { lock.current = false; setBusy(false); }
  }
  const input = (name: string, label: string, value: string | number | null | undefined,
    type: "text" | "number" | "date" | "time" = "text", required = false, maxLength = 300) =>
    <label className="flex min-w-0 flex-col gap-1 text-sm">{label}<input className={fieldClass} name={name} aria-label={label}
      type={type} required={required} disabled={busy} defaultValue={value ?? ""}
      {...(type === "number" ? { min: 0, max: name === "passengerCount" ? 999 : 9999999, step: name === "passengerCount" ? 1 : 0.1 } :
        type === "time" ? { step: 60 } : type === "text" ? { maxLength } : {})} /></label>;
  const timeValue = (value: string | null) => value ? toJapanInput(value).slice(11, 16) : "";
  const cellInput = (name: string, label: string, value: string | number | null | undefined,
    type: "text" | "number" | "time", required = false) =>
    <input className={styles.cellInput} name={name} aria-label={label}
      type={type === "number" || type === "time" ? "text" : type}
      inputMode={type === "time" ? "numeric" : type === "number" ? "decimal" : undefined}
      maxLength={type === "time" ? 5 : type === "text" ? 300 : type === "number" ? 16 : undefined}
      placeholder={type === "time" ? "0800" : undefined}
      onBlur={type === "time" ? event => {
        event.currentTarget.value = formatOperationClockInput(event.currentTarget.value);
      } : undefined}
      required={required}
      disabled={busy} defaultValue={value ?? ""}
      />;
  return <dialog ref={dialog} aria-labelledby="operation-editor-title" className={styles.dialog}
    onCancel={event => { event.preventDefault(); close(); }}>
    <div className={styles.content}>
    <h2 id="operation-editor-title" className={styles.title}>乘務日報 · {row.driverName}</h2>
    <p className={styles.intro}>全部时间为日本时间。修改不改变司机归属；归库后需填写完整的经由地信息。</p>
    <form onSubmit={save} onInput={markDirty} className={styles.form} onChange={event => {
      if (event.target instanceof HTMLInputElement && event.target.name === "serviceDate") {
        const link = event.currentTarget.elements.namedItem("assignmentId");
        if (link instanceof HTMLSelectElement) link.value = "";
      }
    }}>
      {r.orderOptions && <label className={styles.association}>关联当天订单
        <select name="assignmentId" aria-label="日報关联訂単" disabled={busy}
          defaultValue={r.header?.assignmentId ?? ""} onChange={event => {
            const option = r.orderOptions?.find(item => item.assignmentId === event.target.value);
            const form = event.currentTarget.form;
            const plate = form?.elements.namedItem("vehicleNumber");
            const baseline = form?.elements.namedItem("vehicleBaseline");
            if (option && plate instanceof HTMLInputElement && baseline instanceof HTMLInputElement) {
              plate.value = option.vehicleNumber; baseline.value = option.vehicleNumber;
            }
            markDirty();
          }}>
          <option value="">未关联（保留原車牌，請人工确认）</option>
          {r.header?.assignmentId && !r.orderOptions?.some(item => item.assignmentId === r.header?.assignmentId) &&
            <option value={r.header.assignmentId}>原关联訂単（歴史派单）</option>}
          {r.orderOptions?.map(item => <option key={item.assignmentId} value={item.assignmentId}>
            {item.label} · {item.vehicleNumber || "未填写"}
          </option>)}
        </select>
        <input type="hidden" name="vehicleBaseline" defaultValue={r.header?.vehicleNumber ?? ""} />
        <span className={styles.associationNote}>{r.header?.assignmentId
          ? "关联車牌跟随訂単最新選択；在此修改并保存，也会同步该日訂単及其他页面。"
          : "尚未确认訂単关联，原車牌保持不变；選択并保存后开启同步。"}</span>
        <span className={styles.associationNote}>修改日報日期会清除关联；先保存日期，再重新選択该日订单。</span>
      </label>}
      <section className={styles.header} aria-label="基本信息与点呼">
        <h3 className={styles.sectionTitle}>基本信息与点呼</h3>
        <div className={styles.headerGrid}>
        {input("serviceDate", "日期", r.serviceDate, "date", true)}
        {input("passengerCount", "客数", r.header?.passengerCount, "number")}
        {input("vehicleNumber", "車両番号", r.header?.vehicleNumber, "text", false, 100)}
        {input("driverName", "運転手", r.header?.driverName || row.driverName, "text", false, 100)}
        <ReportDutyFields header={r.header} serviceDate={r.serviceDate} disabled={busy} inputClassName={fieldClass} manualTimeInput />
        </div>
      </section>
      <section className={styles.journey} aria-label="出库经由地归库">
        <h3 className={styles.sectionTitle}>出库 · 经由地 · 归库</h3>
        <p className={styles.journeyHint}>时间可直接输入四位数字（例如 0800），离开输入框后显示为 08:00；早于上一项时自动顺延至次日。</p>
        <table className={styles.journeyTable}>
          <colgroup><col style={{ width: "56px" }} /><col /><col style={{ width: "100px" }} />
            <col style={{ width: "90px" }} /><col style={{ width: "90px" }} /><col style={{ width: "78px" }} /></colgroup>
          <thead><tr><th>项目</th><th>地址</th><th>公里数</th><th>到着</th><th>出发</th><th>操作</th></tr></thead>
          <tbody><tr>
            <th>開始地点</th><td>{cellInput("departureAddress", "開始地点", r.departureAddress, "text", true)}</td>
            <td>{cellInput("departureKm", "出库公里表", r.departureKm, "number", true)}</td>
            <td aria-label="出库到着">—</td><td>{cellInput("departedAt", "出発時間", timeValue(r.departedAt), "time", true)}</td><td>—</td>
          </tr></tbody>
          {stops.map((stop, i) => <tbody key={stop.id} data-stop-id={stop.id}>
            <tr><th>经由{i + 1}</th>
              <td>{cellInput(`${stop.id}.address`, `经由地 ${i + 1} 地点`, stop.address, "text")}</td>
              <td>{cellInput(`${stop.id}.km`, `经由地 ${i + 1} 公里表`, stop.departedKm ?? stop.arrivedKm ?? stop.plannedKm, "number")}</td>
              <td>{cellInput(`${stop.id}.arrivedAt`, `经由地 ${i + 1} 到着時間`, timeValue(stop.arrivedAt), "time")}</td>
              <td>{cellInput(`${stop.id}.departedAt`, `经由地 ${i + 1} 出発時間`, timeValue(stop.departedAt), "time")}</td>
              <td className={styles.rowAction}>
                <button type="button" className={styles.removeButton} disabled={busy} aria-label={`削除经由地 ${i + 1}`} onClick={() => {
                  if (window.confirm(`削除第 ${i + 1} 个经由地？保存后生效。`)) { setStops(items => items.filter(s => s.id !== stop.id)); markDirty(); }
                }}>削除</button>
              </td>
            </tr>
          </tbody>)}
          <tbody><tr><td colSpan={6}>
            <button type="button" className={styles.addButton} disabled={stops.length >= 100 || busy} onClick={() => {
              setStops(items => [...items, { id: createDriverRequestId(), address: "", arrivedAt: null, departedAt: null,
                arrivedKm: null, departedKm: null, plannedKm: null }]); markDirty();
            }}>＋ 经由地</button>
          </td></tr></tbody>
          <tbody><tr>
            <th>終了地点</th><td>{cellInput("returnAddress", "終了地点", r.returnAddress, "text")}</td>
            <td>{cellInput("returnKm", "归库公里表", r.returnKm, "number")}</td>
            <td>{cellInput("returnedAt", "到着時間", timeValue(r.returnedAt), "time")}</td><td>—</td><td>—</td>
          </tr></tbody>
        </table>
      </section>
      <section className={styles.summary} aria-label="本次汇总">
        <h3 className={styles.sectionTitle}>本次汇总</h3>
        <div className={styles.summaryRow}>
          <span>当日公里数</span><strong>{totals.distance === null ? "归库后计算" : `${totals.distance} km`}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>休憩時間</span><strong>{durationLabel(restMs)}</strong>
        </div>
        <div className={styles.summaryRow}>
          <span>拘束時間</span><strong>{restraintMs === null ? "点呼未完整" : durationLabel(restraintMs)}</strong>
        </div>
      </section>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div role="group" aria-label="日报编辑操作" className={styles.stickyActions}>
        <button type="button" className={styles.cancelButton}
          disabled={busy} onClick={close}>取消</button>
        <button className={styles.saveButton}
          disabled={busy}>{busy ? "保存中…" : "保存修改"}</button></div>
    </form>
    </div>
  </dialog>;
}

function OperationMonth({ region, printMonth, selectedDate, setPrintMonth, setSelectedDate }: {
  region: string; printMonth: string; selectedDate: string;
  setPrintMonth: (value: string) => void; setSelectedDate: (value: string) => void;
}) {
  const [data, setData] = useState<ReturnType<typeof operationDataSchema.parse> | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [company, setCompany] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [editing, setEditing] = useState<OperationRow | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const write = useRef<AbortController | null>(null);
  const print = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    let request: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      if (!active || document.visibilityState !== "visible") return;
      request?.abort(); const current = new AbortController(); request = current;
      try {
        const month = selectedDate.slice(0, 7);
        const query = new URLSearchParams({ month }); if (region) query.set("region", region);
        const response = await fetch(`/api/operations-reports?${query}`, { cache: "no-store", signal: current.signal });
        if (!response.ok) throw new Error("无法读取運行日報，請刷新重试。");
        const result = operationDataSchema.parse(await response.json());
        if (!active || current.signal.aborted || document.visibilityState !== "visible") return;
        if (result.rows.some(row => !row.report.serviceDate.startsWith(`${month}-`) || (region && row.regionId !== region)) ||
          new Set(result.rows.map(row => row.report.id)).size !== result.rows.length) throw new Error("日報日期或地域不一致，請刷新。");
        setData(result); setError("");
        if (result.enabled) timer = setTimeout(() => void load(), 10000);
      } catch (cause) {
        if (!active || current.signal.aborted) return;
        console.error("Operations report refresh failed.", cause instanceof Error ? cause.name : "UnknownError");
        setData(null); setError(cause instanceof Error ? cause.message : "運行日報读取失败。");
        timer = setTimeout(() => void load(), 10000);
      }
    }
    function clear() {
      request?.abort(); clearTimeout(timer); write.current?.abort(); print.current?.abort();
      setData(null); setEditing(null); setError(""); setNotice("");
    }
    function visibility() {
      clear();
      if (active && document.visibilityState === "visible") {
        setNotice("正在重新读取日報；未保存修改已清除，刚提交的操作請核对结果。");
        void load();
      }
    }
    function focus() { clearTimeout(timer); void load(); }
    function beforeUnload(event: BeforeUnloadEvent) { if (lock.current) event.preventDefault(); }
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", focus); window.addEventListener("beforeunload", beforeUnload);
    const { data: subscription } = createClient().auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") { active = false; clear(); }
    });
    void load();
    return () => {
      active = false; request?.abort(); clearTimeout(timer); write.current?.abort(); print.current?.abort();
      subscription.subscription.unsubscribe(); document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", focus); window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [region, revision, selectedDate]);
  const rows = data?.rows ?? [];
  const dateRows = rows.filter(row => row.report.serviceDate === selectedDate);
  const filtered = filterOperationRows(dateRows, company, vehicle, "");
  const companies = [...new Set([...(company ? [company] : []), ...rows.flatMap(row => row.company ? [row.company] : [])])].sort();
  const vehicles = [...new Set([...(vehicle ? [vehicle] : []), ...rows.filter(row => !company || row.company === company).flatMap(row =>
    row.report.header?.vehicleNumber ? [row.report.header.vehicleNumber] : [])])].sort();
  async function remove(row: OperationRow) {
    if (lock.current || !window.confirm(`永久削除 ${operationDateLabel(row.report.serviceDate)} · ${row.driverName} 的日報？\n運転士端的日報、所有经由地和修改歴史将全部清除，不留削除日志，无法恢复。`)) return;
    lock.current = true; setBusy(true); setNotice(""); setError("");
    const current = new AbortController(); write.current = current;
    try {
      await submitCommand({ action: "delete", reportId: row.report.id, expectedVersion: row.report.version }, current.signal);
      if (current.signal.aborted) return;
      setData(old => old ? { ...old, rows: old.rows.filter(item => item.report.id !== row.report.id) } : old);
      setNotice("日報及其歴史已永久削除。"); setRevision(v => v + 1);
    } catch (cause) {
      if (!current.signal.aborted) {
        console.error("Operations report deletion failed.", cause instanceof Error ? cause.name : "UnknownError");
        setError(cause instanceof Error ? cause.message : "削除结果未获确认，請刷新核对。");
      }
    } finally { lock.current = false; setBusy(false); }
  }
  async function output(selected: OperationRow[], title: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    print.current?.abort(); const current = new AbortController(); print.current = current;
    try { await printOperationsReports(selected, title, current.signal); }
    catch (cause) {
      if (!current.signal.aborted) {
        console.error("Operations report print failed.", cause instanceof Error ? cause.name : "UnknownError");
        setError(cause instanceof Error ? cause.message : "打印失败，請重试。");
      }
    } finally { lock.current = false; setBusy(false); }
  }
  async function printSelectedMonth() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    const current = new AbortController(); print.current?.abort(); print.current = current;
    try {
      const query = new URLSearchParams({ month: printMonth }); if (region) query.set("region", region);
      const response = await fetch(`/api/operations-reports?${query}`, { cache: "no-store", signal: current.signal });
      if (!response.ok) throw new Error("无法读取所选月份日報，請刷新重试。");
      const result = operationDataSchema.parse(await response.json());
      if (!result.enabled) throw new Error("運行管理尚未在此环境启用。");
      if (result.rows.some(row => !row.report.serviceDate.startsWith(`${printMonth}-`) || (region && row.regionId !== region)) ||
        new Set(result.rows.map(row => row.report.id)).size !== result.rows.length)
        throw new Error("所选月份日報日期或地域不一致，請刷新。");
      const selected = filterOperationRows(result.rows, company, vehicle, "");
      if (!selected.length) throw new Error("所选月份没有符合当前会社／車両筛选的日報。");
      await printOperationsReports(selected, `${printMonth.slice(5)}月 運行日報`, current.signal);
    } catch (cause) {
      if (!current.signal.aborted) {
        console.error("Monthly operations report print failed.", cause instanceof Error ? cause.name : "UnknownError");
        setError(cause instanceof Error ? cause.message : "月批量打印失败，請重试。");
      }
    } finally { lock.current = false; setBusy(false); }
  }
  const stamp = operationTimeLabel;
  const duty = (r: DailyReport, prefix: "Start" | "End") => {
    return r.header?.[`duty${prefix}Time`] || "—";
  };
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">会社<select className={fieldClass} value={company}
        disabled={busy || Boolean(editing)} onChange={e => { setCompany(e.target.value); setVehicle(""); }}>
        <option value="">全部会社</option>{companies.map(name => <option key={name}>{name}</option>)}</select></label>
      <label className="flex items-center gap-2 text-sm">運行日期<input className={fieldClass} type="date" aria-label="运行日期"
        required value={selectedDate} onChange={e => {
          if (validServiceDate(e.target.value)) setSelectedDate(e.target.value);
        }} /></label>
      <label className="flex flex-col gap-1 text-sm">車両番号<select className={fieldClass} value={vehicle}
        disabled={busy || Boolean(editing)} onChange={e => setVehicle(e.target.value)}>
        <option value="">全部車両</option>{vehicles.map(name => <option key={name}>{name}</option>)}</select></label>
      <button className={buttonClass} disabled={busy || Boolean(editing)} onClick={() => { setData(null); setRevision(v => v + 1); }}>刷新</button>
      <button className="table-action-button table-action-button--export" disabled={busy || Boolean(editing)}
        onClick={() => void printSelectedMonth()}>月批量打印</button>
      <label className="flex items-center gap-2 text-sm">月批量打印月份<input className={fieldClass} type="month" aria-label="月批量打印月份"
        required value={printMonth} onChange={e => {
          if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(e.target.value)) setPrintMonth(e.target.value);
        }} /></label>
    </div>
    <p className="text-xs text-gray-600">日本時間 · 显示所选日期的运行日報；每10秒同步。工時＝退勤点呼－出勤点呼；日期或時間缺失時不计算。
      月批量打印使用上方選択月份，并遵循会社和車両筛选，每份日報一页；在打印窗口選択“另存为PDF”。会社按車両番号唯一匹配車両所属会社，未匹配的保留显示。</p>
    {notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!data && !error && <p role="status">正在读取運転士日報…</p>}
    {data && !data.enabled && <p role="status">運行管理尚未在此环境启用，目前仅在隔离测试版开放。</p>}
    {data?.enabled && <><p className="text-sm text-gray-600">{selectedDate} 运行：{filtered.length} 份日報（含出库中）</p>
      {!filtered.length && <p className="rounded border border-dashed bg-white px-4 py-8 text-center text-sm text-gray-500">所选日期暂无运行日報</p>}
      <div className="list-panel operations-report-table-region border bg-white"><table className="operations-report-table w-full table-fixed border-collapse">
        <colgroup>
          <col style={{ width: "6%" }} /><col style={{ width: "7%" }} /><col style={{ width: "7%" }} />
          <col style={{ width: "7%" }} /><col style={{ width: "8%" }} /><col style={{ width: "6%" }} />
          <col style={{ width: "8%" }} /><col style={{ width: "8%" }} /><col style={{ width: "8%" }} />
          <col style={{ width: "6%" }} /><col style={{ width: "7%" }} /><col style={{ width: "7%" }} />
          <col style={{ width: "15%" }} />
        </colgroup>
        <thead className="bg-gray-50"><tr>{operationReportColumns.map(label =>
          <th key={label} className="border-b text-center">{label}</th>)}</tr></thead>
        <tbody>{filtered.map(row => {
          const r = row.report;
          const routeStops = r.stops.map(stop => stop.address.trim()).filter(Boolean);
          const pickup = routeStops[0] || "—";
          const dropoff = routeStops.at(-1) || "—";
          const hours = dutyDuration(r);
          const cells = [operationDateLabel(r.serviceDate), r.header?.vehicleNumber || "—",
            r.header?.driverName || row.driverName, duty(r, "Start"), r.departureAddress, stamp(r.departedAt),
            pickup, dropoff, r.returnAddress || "—", stamp(r.returnedAt),
            duty(r, "End"), hours === null ? "点呼未完整" : durationLabel(hours)];
          return <tr key={r.id}>{cells.map((value, i) => <td key={i} data-label={operationReportColumns[i]}
            className="whitespace-pre-wrap break-words border-b text-center">{value}
            {i === 1 && r.orderOptions && !r.header?.assignmentId &&
              <span className="block text-xs text-amber-800">未关联訂単 · 請人工确认</span>}
          </td>)}
            <td data-label="操作" className="border-b text-center"><div className="list-action-buttons list-action-buttons--three">
              <div className="driver-action-slot"><button className="table-action-button table-action-button--edit driver-action-button" disabled={busy} onClick={() => setEditing(row)}>编辑</button></div>
              <div className="driver-action-slot"><button className="table-action-button table-action-button--delete driver-action-button" disabled={busy} onClick={() => void remove(row)}>削除</button></div>
              <div className="driver-action-slot"><button className="table-action-button table-action-button--export driver-action-button" disabled={busy} onClick={() => void output([row], `${operationDateLabel(r.serviceDate)} 運行日報`)}>导出PDF</button></div>
            </div></td></tr>;
        })}{!filtered.length && <tr><td colSpan={13} className="p-3 text-center text-gray-500">当前筛选没有運転士日報。</td></tr>}</tbody>
      </table></div></>}
    {editing && <OperationReportEditor key={editing.report.id} row={editing} onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); setNotice("日報已保存，修改記録已保留。"); setData(null); setRevision(v => v + 1); }} />}
  </div>;
}

export function OperationsReports({ region }: { region: string }) {
  const [month, setMonth] = useState(() => japanDate().slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(() => japanDate());
  return <section className="space-y-4 p-4 md:p-6" aria-label="運行管理">
    <h2 className="text-lg font-bold">運行管理</h2>
    <OperationMonth printMonth={month} setPrintMonth={setMonth} selectedDate={selectedDate}
      setSelectedDate={setSelectedDate} region={region} />
  </section>;
}
