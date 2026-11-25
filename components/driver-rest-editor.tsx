"use client";

import { useEffect, useRef, useState } from "react";
import { createDriverRequestId, japanDate } from "@/lib/driver/orders";
import { shiftDataSchema, shiftMonthDays, shiftSubmissionSchema, type ShiftData } from "@/lib/driver/shifts";

export type DriverRestEditorState = { busy: boolean; dirty: boolean };

export function DriverRestEditor({ driverId, onStateChange }: {
  driverId: string; onStateChange: (state: DriverRestEditorState) => void;
}) {
  const [month, setMonth] = useState(() => japanDate().slice(0, 7));
  const [saved, setSaved] = useState<ShiftData | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [attendanceDates, setAttendanceDates] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<"attendance" | "rest">("attendance");
  const lock = useRef(false);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const dirty = Boolean(saved && (JSON.stringify([...dates].sort()) !== JSON.stringify(saved.dates)
    || JSON.stringify([...attendanceDates].sort()) !== JSON.stringify(saved.attendanceDates) || note !== saved.note));
  const calendar = shiftMonthDays(month);

  useEffect(() => { onStateChange({ busy, dirty }); }, [busy, dirty, onStateChange]);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const query = new URLSearchParams({ driverId, month });
        const response = await fetch(`/api/driver-shifts?${query}`, { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(result.error || "シフト希望读取失败。");
        const data = shiftDataSchema.parse(result);
        if (data.month !== month) throw new Error("月份不一致，請刷新核对。");
        setSaved(data); setDates(data.dates); setAttendanceDates(data.attendanceDates); setNote(data.note);
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("Staff shift load failed.", cause);
        setError(cause instanceof Error ? cause.message : "シフト希望读取失败。");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [driverId, month, revision]);

  function reload(nextMonth = month) {
    if (lock.current || (dirty && !window.confirm("切换或刷新会放弃尚未保存的シフト希望修改，是否继续？"))) return;
    setLoading(true); setSaved(null); setDates([]); setAttendanceDates([]); setNote(""); setError(""); setNotice("");
    pending.current = null; setMonth(nextMonth); setRevision(value => value + 1);
  }

  async function submit() {
    if (lock.current || !saved) return;
    const content = { month, dates: [...dates].sort(), attendanceDates: [...attendanceDates].sort(),
      note: note.trim(), expectedVersion: saved.version };
    const key = JSON.stringify(content);
    if (pending.current?.key !== key) pending.current = { key, id: createDriverRequestId() };
    const parsed = shiftSubmissionSchema.safeParse({ ...content, requestId: pending.current.id });
    if (!parsed.success) { setError("請检查シフト希望日期及备注（最多1000字）。"); return; }
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/driver-shifts", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ driverId, shift: parsed.data }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "保存未获确认，請刷新核对。");
      const data = shiftDataSchema.parse(result);
      if (data.month !== month) throw new Error("保存月份不一致，請刷新核对。");
      setSaved(data); setDates(data.dates); setAttendanceDates(data.attendanceDates); setNote(data.note); pending.current = null;
      setNotice("シフト希望已保存，并与司机手机端同步。");
    } catch (cause) {
      console.error("Staff shift save failed.", cause);
      setError(cause instanceof Error ? cause.message : "シフト希望保存失败，請重试。");
    } finally { lock.current = false; setBusy(false); }
  }

  return <div className="staff-rest-editor" aria-busy={loading || busy}>
    <div className="flex flex-wrap items-end justify-between gap-3">
      <label className="driver-editor-field">月份<input type="month" value={month} disabled={busy} onChange={event => {
        if (event.target.value && event.target.value !== month) reload(event.target.value);
      }} /></label>
      <button type="button" className="driver-editor-secondary" disabled={busy || loading} onClick={() => reload()}>刷新シフト希望</button>
    </div>
    {error && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p>}
    {notice && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700" role="status">{notice}</p>}
    {loading ? <p className="py-10 text-center text-sm text-slate-500" role="status">正在读取シフト希望…</p> : saved && <>
      <div className="staff-rest-mode-buttons" role="group" aria-label="选择シフト希望类型">
        <button type="button" className={`staff-rest-mode is-attendance${selectionMode === "attendance" ? " is-active" : ""}`}
          aria-pressed={selectionMode === "attendance"} disabled={busy}
          onClick={() => setSelectionMode("attendance")}>希望出勤</button>
        <button type="button" className={`staff-rest-mode is-rest${selectionMode === "rest" ? " is-active" : ""}`}
          aria-pressed={selectionMode === "rest"} disabled={busy}
          onClick={() => setSelectionMode("rest")}>希望休</button>
      </div>
      <div className="staff-rest-calendar" aria-label={`${month}シフト希望`}>
        {["日", "月", "火", "水", "木", "金", "土"].map(day => <span className="staff-rest-weekday" key={day}>{day}</span>)}
        {Array.from({ length: calendar.offset }, (_, index) => <span key={`blank-${index}`} />)}
        {calendar.dates.map(date => {
          const restSelected = dates.includes(date);
          const attendanceSelected = attendanceDates.includes(date);
          const selected = restSelected || attendanceSelected;
          const markers = [restSelected && "希望休", attendanceSelected && "希望出勤"].filter(Boolean);
          return <button key={date} type="button"
            className={`staff-rest-cell${attendanceSelected ? " is-attendance-selected" : ""}${restSelected ? " is-rest-selected" : ""}`}
            aria-label={`${date}${markers.length ? ` ${markers.join(" ")}` : ""}`} aria-pressed={selected} disabled={busy}
            onClick={() => {
              if (selectionMode === "attendance") {
                if (attendanceSelected) setAttendanceDates(current => current.filter(value => value !== date));
                else { setAttendanceDates(current => [...current, date]); setDates(current => current.filter(value => value !== date)); }
              } else if (restSelected) setDates(current => current.filter(value => value !== date));
              else { setDates(current => [...current, date]); setAttendanceDates(current => current.filter(value => value !== date)); }
              setNotice("");
            }}>
          <span>{Number(date.slice(8))}</span>
          {selected && <small>{attendanceSelected ? "出勤" : "休"}</small>}
          {!markers.length && <small>&nbsp;</small>}
        </button>;
        })}
      </div>
      <p className="my-3 text-sm text-slate-600">希望出勤 <strong className="text-blue-700">{attendanceDates.length}</strong> 天 ·
        希望休 <strong className="text-rose-700">{dates.length}</strong> 天 · {dirty ? "有未保存修改" : saved.version ? "已同步" : "尚未设置"}</p>
      <label className="driver-editor-field">シフト备注<textarea rows={2} maxLength={1000} value={note} disabled={busy}
        placeholder="与司机手机端共用备注" onChange={event => { setNote(event.target.value); setNotice(""); }} /></label>
      <button type="button" className="driver-editor-primary mt-4 w-full" disabled={busy} onClick={() => void submit()}>
        {busy ? "正在保存シフト希望…" : "保存本月シフト希望"}
      </button>
    </>}
    <p className="mt-3 text-xs leading-5 text-slate-500">シフト希望单独保存，与手机端同步；只作排班参考，不会阻止调度选任。</p>
  </div>;
}
