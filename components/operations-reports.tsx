"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/browser";
import { createDriverRequestId, japanDate } from "@/lib/driver/orders";
import { durationLabel, dutyDuration, reportHeaderSchema, reportSchema, reportTimeOrderError, toJapanInput, type DailyReport } from "@/lib/driver/reports";
import { filterOperationRows, operationCommandSchema, operationDataSchema, operationDateLabel, operationInstant, operationResultSchema, operationTimeLabel, type OperationRow } from "@/lib/operations-reports";
import { printOperationsReports } from "@/lib/operations-report-print";
import { ReportDutyFields } from "@/components/report-duty-fields";

const fieldClass = "rounded border border-gray-300 bg-white px-2 py-1.5 text-sm disabled:bg-gray-100";
const buttonClass = "rounded border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50";
type Command = ReturnType<typeof operationCommandSchema.parse>;

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
  const [rests, setRests] = useState(() => row.report.rests.map(rest => ({ ...rest, key: createDriverRequestId() })));
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const r = row.report;
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
      const number = (name: string) => text(name) === "" ? null : Number(text(name));
      const instant = (name: string, original: string | null = null) => operationInstant(text(name), original);
      const header = reportHeaderSchema.parse({
        serviceDate: text("serviceDate"), vehicleNumber: text("vehicleNumber"), driverName: text("driverName"),
        passengerCount: number("passengerCount"),
        dutyStartTime: text("dutyStartTime") || null, dutyEndTime: text("dutyEndTime") || null,
        dutyStartDate: text("dutyStartTime") ? text("dutyStartDate") : null,
        dutyEndDate: text("dutyEndTime") ? text("dutyEndDate") : null,
      });
      const report = reportSchema.parse({ ...r, serviceDate: header.serviceDate,
        header: { ...(r.orderOptions ? { assignmentId: text("assignmentId") || null } : {}),
          vehicleNumber: header.vehicleNumber, driverName: header.driverName, passengerCount: header.passengerCount,
          dutyStartDate: header.dutyStartDate, dutyEndDate: header.dutyEndDate,
          dutyStartTime: header.dutyStartTime, dutyEndTime: header.dutyEndTime },
        departedAt: instant("departedAt", r.departedAt), departureAddress: text("departureAddress"), departureKm: number("departureKm"),
        returnedAt: instant("returnedAt", r.returnedAt), returnAddress: text("returnAddress").trim() || null, returnKm: number("returnKm"),
        stops: stops.map(stop => ({ id: stop.id, address: text(`${stop.id}.address`),
          arrivedAt: instant(`${stop.id}.arrivedAt`, stop.arrivedAt), arrivedKm: number(`${stop.id}.arrivedKm`),
          departedAt: instant(`${stop.id}.departedAt`, stop.departedAt), departedKm: number(`${stop.id}.departedKm`),
          plannedKm: number(`${stop.id}.plannedKm`) })),
        rests: rests.map(rest => ({ startedAt: instant(`${rest.key}.startedAt`, rest.startedAt), endedAt: instant(`${rest.key}.endedAt`, rest.endedAt) })),
      });
      const timeError = reportTimeOrderError(report);
      if (timeError) throw new Error(timeError);
      const draft = { action: "edit" as const, report: { ...report,
        header: { ...report.header, ...(r.orderOptions ? { vehicleBaseline: text("vehicleBaseline") } : {}) } }, reason: text("reason") };
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
        "請检查日期時間、点呼先后、公里数、每个经由地的配对字段和修改原因。");
    } finally { lock.current = false; setBusy(false); }
  }
  const input = (name: string, label: string, value: string | number | null | undefined,
    type: "text" | "number" | "datetime-local" | "date" = "text", required = false, maxLength = 300) =>
    <label className="flex min-w-0 flex-col gap-1 text-sm">{label}<input className={fieldClass} name={name} aria-label={label}
      type={type} required={required} disabled={busy} defaultValue={value ?? ""}
      {...(type === "number" ? { min: 0, max: name === "passengerCount" ? 999 : 9999999, step: name === "passengerCount" ? 1 : 0.1 } :
        type === "datetime-local" ? { step: 1 } : type === "text" ? { maxLength } : {})} /></label>;
  return <dialog ref={dialog} aria-labelledby="operation-editor-title"
    className="m-auto max-h-[92dvh] w-[min(1100px,96vw)] overflow-y-auto rounded-lg p-4 shadow-xl backdrop:bg-black/40"
    onCancel={event => { event.preventDefault(); close(); }}>
    <h2 id="operation-editor-title" className="mb-2 text-lg font-bold">编辑運行日報 · {row.driverName}</h2>
    <p className="mb-3 text-sm text-gray-600">全部日期時間为日本時間。修改不改变運転士归属；出库日期须与日報日期一致。归库后经由地须填写完整。
      旧日報点呼日期会预填，請核对后保存。切换到其他应用／标签页会清除未保存的编辑。</p>
    <form onSubmit={save} onInput={markDirty} className="space-y-4" onChange={event => {
      if (event.target instanceof HTMLInputElement && event.target.name === "serviceDate") {
        const link = event.currentTarget.elements.namedItem("assignmentId");
        if (link instanceof HTMLSelectElement) link.value = "";
      }
    }}>
      {r.orderOptions && <label className="block text-sm">关联当天訂単
        <select name="assignmentId" aria-label="日報关联訂単" className={`${fieldClass} ml-2 max-w-full`} disabled={busy}
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
            <option value={r.header.assignmentId}>原关联訂単（历史派单）</option>}
          {r.orderOptions?.map(item => <option key={item.assignmentId} value={item.assignmentId}>
            {item.label} · {item.vehicleNumber || "未填写"}
          </option>)}
        </select>
        <input type="hidden" name="vehicleBaseline" defaultValue={r.header?.vehicleNumber ?? ""} />
        <span className="mt-1 block text-amber-800">{r.header?.assignmentId
          ? "关联車牌跟随訂単最新選択；在此修改并保存，也会同步该日訂単及其他页面。"
          : "尚未确认訂単关联，原車牌保持不变；選択并保存后开启同步。"}</span>
        <span className="mt-1 block text-gray-600">修改日報日期会清除关联；先保存日期，再重新選択该日訂単。</span>
      </label>}
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-2 font-semibold">基本信息与点呼</legend>
        {input("serviceDate", "日期", r.serviceDate, "date", true)}
        {input("vehicleNumber", "車両番号", r.header?.vehicleNumber, "text", false, 100)}
        {input("driverName", "運転手", r.header?.driverName || row.driverName, "text", false, 100)}
        {input("passengerCount", "客数", r.header?.passengerCount, "number")}
        <ReportDutyFields header={r.header} serviceDate={r.serviceDate} disabled={busy} inputClassName={fieldClass} />
      </fieldset>
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-3">
        <legend className="mb-2 font-semibold">出库</legend>
        {input("departureAddress", "出库地点", r.departureAddress, "text", true)}
        {input("departureKm", "出库公里表", r.departureKm, "number", true)}
        {input("departedAt", "出発日期時間", toJapanInput(r.departedAt), "datetime-local", true)}
      </fieldset>
      <fieldset disabled={busy} className="space-y-3"><legend className="mb-2 font-semibold">全部经由地</legend>
        {stops.map((stop, i) => <div key={stop.id} className="rounded border p-3">
          <div className="mb-2 flex justify-between"><strong>经由地 {i + 1}</strong>
            <button type="button" className={buttonClass} onClick={() => {
              if (window.confirm(`删除第 ${i + 1} 个经由地？保存后生效。`)) { setStops(items => items.filter(s => s.id !== stop.id)); markDirty(); }
            }}>移除经由地</button></div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {input(`${stop.id}.address`, `经由地 ${i + 1} 地点`, stop.address)}
            {input(`${stop.id}.arrivedAt`, `经由地 ${i + 1} 到着`, toJapanInput(stop.arrivedAt), "datetime-local")}
            {input(`${stop.id}.arrivedKm`, `经由地 ${i + 1} 到着公里表`, stop.arrivedKm, "number")}
            {input(`${stop.id}.departedAt`, `经由地 ${i + 1} 出発`, toJapanInput(stop.departedAt), "datetime-local")}
            {input(`${stop.id}.departedKm`, `经由地 ${i + 1} 出発公里表`, stop.departedKm, "number")}
            {input(`${stop.id}.plannedKm`, `经由地 ${i + 1} 计划公里表`, stop.plannedKm, "number")}
          </div>
        </div>)}
        <button type="button" className={buttonClass} disabled={stops.length >= 100} onClick={() => {
          setStops(items => [...items, { id: createDriverRequestId(), address: "", arrivedAt: null, departedAt: null,
            arrivedKm: null, departedKm: null, plannedKm: null }]); markDirty();
        }}>＋ 经由地</button>
      </fieldset>
      <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-3"><legend className="mb-2 font-semibold">归库（未归库時三项全空）</legend>
        {input("returnAddress", "归库地点", r.returnAddress)}
        {input("returnKm", "归库公里表", r.returnKm, "number")}
        {input("returnedAt", "到着日期時間", toJapanInput(r.returnedAt), "datetime-local")}
      </fieldset>
      <fieldset disabled={busy} className="space-y-2"><legend className="mb-2 font-semibold">休息记录（不从工作総時长中扣除）</legend>
        {rests.map((rest, i) => <div key={rest.key} className="grid items-end gap-3 sm:grid-cols-3">
          {input(`${rest.key}.startedAt`, `休息 ${i + 1} 开始`, toJapanInput(rest.startedAt), "datetime-local", true)}
          {input(`${rest.key}.endedAt`, `休息 ${i + 1} 结束`, toJapanInput(rest.endedAt), "datetime-local")}
          <button type="button" className={buttonClass} onClick={() => {
            if (window.confirm(`移除第 ${i + 1} 段休息？保存后生效。`)) { setRests(items => items.filter(item => item.key !== rest.key)); markDirty(); }
          }}>移除休息</button>
        </div>)}
        <button type="button" className={buttonClass} disabled={rests.length >= 100} onClick={() => {
          setRests(items => [...items, { key: createDriverRequestId(), startedAt: r.departedAt, endedAt: null }]); markDirty();
        }}>＋ 休息</button>
      </fieldset>
      {input("reason", "修改原因（保留修改前后记录）", "", "text", true)}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className={buttonClass} disabled={busy} onClick={close}>取消</button>
        <button className={`${buttonClass} font-semibold`} disabled={busy}>{busy ? "保存中…" : "保存修改"}</button></div>
    </form>
  </dialog>;
}

function OperationMonth({ region, month }: { region: string; month: string }) {
  const [data, setData] = useState<ReturnType<typeof operationDataSchema.parse> | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [company, setCompany] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [date, setDate] = useState("");
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
  }, [month, region, revision]);
  const rows = data?.rows ?? [];
  const filtered = filterOperationRows(rows, company, vehicle, date);
  const companies = [...new Set([...(company ? [company] : []), ...rows.flatMap(row => row.company ? [row.company] : [])])].sort();
  const vehicles = [...new Set([...(vehicle ? [vehicle] : []), ...rows.filter(row => !company || row.company === company).flatMap(row =>
    row.report.header?.vehicleNumber ? [row.report.header.vehicleNumber] : [])])].sort();
  async function remove(row: OperationRow) {
    if (lock.current || !window.confirm(`永久删除 ${operationDateLabel(row.report.serviceDate)} · ${row.driverName} 的日報？\n運転士端的日報、所有经由地和修改历史将全部清除，不留删除日志，无法恢复。`)) return;
    lock.current = true; setBusy(true); setNotice(""); setError("");
    const current = new AbortController(); write.current = current;
    try {
      await submitCommand({ action: "delete", reportId: row.report.id, expectedVersion: row.report.version }, current.signal);
      if (current.signal.aborted) return;
      setData(old => old ? { ...old, rows: old.rows.filter(item => item.report.id !== row.report.id) } : old);
      setNotice("日報及其历史已永久删除。"); setRevision(v => v + 1);
    } catch (cause) {
      if (!current.signal.aborted) {
        console.error("Operations report deletion failed.", cause instanceof Error ? cause.name : "UnknownError");
        setError(cause instanceof Error ? cause.message : "删除结果未获确认，請刷新核对。");
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
  const stamp = operationTimeLabel;
  const duty = (r: DailyReport, prefix: "Start" | "End") => {
    return r.header?.[`duty${prefix}Time`] || "—";
  };
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">会社<select className={fieldClass} value={company}
        disabled={busy || Boolean(editing)} onChange={e => { setCompany(e.target.value); setVehicle(""); }}>
        <option value="">全部会社</option>{companies.map(name => <option key={name}>{name}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-sm">車両番号<select className={fieldClass} value={vehicle}
        disabled={busy || Boolean(editing)} onChange={e => setVehicle(e.target.value)}>
        <option value="">全部車両</option>{vehicles.map(name => <option key={name}>{name}</option>)}</select></label>
      <label className="flex flex-col gap-1 text-sm">日期<input className={fieldClass} aria-label="筛选日期" type="date" value={date}
        min={`${month}-01`} max={new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10)}
        disabled={busy || Boolean(editing)} onChange={e => setDate(e.target.value)} /></label>
      <button className={buttonClass} disabled={busy || Boolean(editing)} onClick={() => { setData(null); setRevision(v => v + 1); }}>刷新</button>
      <button className={buttonClass} disabled={busy || Boolean(editing) || !filtered.length}
        onClick={() => void output(filtered, `${month.slice(5)}月 運行日報`)}>月批量打印（{filtered.length}份）</button>
    </div>
    <p className="text-xs text-gray-600">日本時間 · 每10秒同步。工時＝退勤点呼－出勤点呼；日期或時間缺失時不计算。
      月批量打印遵循当前会社、車両番号和日期筛选，每份日報一页；清空日期可打印整月。导出PDF時在打印窗口選択“另存为PDF”。会社按車両番号唯一匹配車両所属会社，未匹配的保留显示。</p>
    {notice && <p role="status" className="text-sm text-green-800">{notice}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!data && !error && <p role="status">正在读取運転士日報…</p>}
    {data && !data.enabled && <p role="status">運行管理尚未在此环境启用，目前仅在隔离测试版开放。</p>}
    {data?.enabled && <><p className="text-sm text-gray-600">共 {filtered.length} 份日報（含出库中）</p>
      <div className="overflow-x-auto rounded border bg-white"><table className="w-full min-w-[1700px] border-collapse text-sm">
        <thead className="bg-gray-50"><tr>{["日期", "車両番号", "運転手", "出勤点呼時間", "出库地点", "出発時間",
          "接客地点", "下客地点", "归库地点", "到着時間", "退勤点呼時間", "工作総時长", "操作"].map(label =>
          <th key={label} className="whitespace-nowrap border-b p-2 text-center">{label}</th>)}</tr></thead>
        <tbody>{filtered.map(row => {
          const r = row.report; const stops = r.stops.filter(stop => stop.address.trim()); const hours = dutyDuration(r);
          const cells = [operationDateLabel(r.serviceDate), r.header?.vehicleNumber || "—",
            r.header?.driverName || row.driverName, duty(r, "Start"), r.departureAddress, stamp(r.departedAt),
            stops[0]?.address || "—", stops.at(-1)?.address || "—", r.returnAddress || "—", stamp(r.returnedAt),
            duty(r, "End"), hours === null ? "点呼未完整" : durationLabel(hours)];
          return <tr key={r.id}>{cells.map((value, i) => <td key={i} className="max-w-56 whitespace-pre-wrap break-words border-b p-2 text-center">{value}
            {i === 1 && r.orderOptions && !r.header?.assignmentId &&
              <span className="block text-xs text-amber-800">未关联訂単 · 請人工确认</span>}
          </td>)}
            <td className="border-b p-2 text-center"><div className="flex justify-center gap-2 whitespace-nowrap">
              <button className={buttonClass} disabled={busy} onClick={() => setEditing(row)}>编辑</button>
              <button className={`${buttonClass} text-red-700`} disabled={busy} onClick={() => void remove(row)}>删除</button>
              <button className={buttonClass} disabled={busy} onClick={() => void output([row], `${operationDateLabel(r.serviceDate)} 運行日報`)}>导出PDF</button>
            </div></td></tr>;
        })}{!filtered.length && <tr><td colSpan={13} className="p-6 text-center text-gray-500">当前筛选没有運転士日報。</td></tr>}</tbody>
      </table></div></>}
    {editing && <OperationReportEditor key={editing.report.id} row={editing} onClose={() => setEditing(null)}
      onSaved={() => { setEditing(null); setNotice("日報已保存，修改记录已保留。"); setData(null); setRevision(v => v + 1); }} />}
  </div>;
}

export function OperationsReports({ region }: { region: string }) {
  const [month, setMonth] = useState(() => japanDate().slice(0, 7));
  return <section className="space-y-4 p-4 md:p-6" aria-label="運行管理">
    <div className="flex flex-wrap items-center gap-4"><h2 className="text-lg font-bold">運行管理</h2>
      <label className="flex items-center gap-2 text-sm">月份<input className={fieldClass} type="month" aria-label="筛选月份"
        required value={month} onChange={e => { if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(e.target.value)) setMonth(e.target.value); }} /></label></div>
    <OperationMonth key={`${month}-${region}`} month={month} region={region} />
  </section>;
}
