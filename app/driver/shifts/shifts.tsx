"use client";

import DriverNavigation from "@/app/driver/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { createDriverRequestId, japanDate } from "@/lib/driver/orders";
import { shiftDataSchema, shiftMonthDays, shiftSubmissionSchema, type ShiftData } from "@/lib/driver/shifts";
import { getJapaneseHolidays } from "@/lib/japanese-holidays";
import "./shifts.css";

export default function DriverShifts() {
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
  const generation = useRef(0);
  const lock = useRef(false);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const dirty = Boolean(saved && (JSON.stringify([...dates].sort()) !== JSON.stringify(saved.dates)
    || JSON.stringify([...attendanceDates].sort()) !== JSON.stringify(saved.attendanceDates) || note !== saved.note));
  const calendar = shiftMonthDays(month);
  const holidays = getJapaneseHolidays(Number(month.slice(0, 4)));

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    async function load() {
      try {
        const response = await fetch(`/api/driver/shifts?month=${month}`, { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { location.replace("/driver/login?next=%2Fdriver%2Fshifts"); return; }
        const result = await response.json();
        if (controller.signal.aborted || current !== generation.current) return;
        if (!response.ok) throw new Error(result.error || "休息日期读取失败。");
        const data = shiftDataSchema.parse(result);
        if (data.month !== month) throw new Error("月份不一致，請刷新核对。");
        setSaved(data); setDates(data.dates); setAttendanceDates(data.attendanceDates); setNote(data.note);
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("Driver shift load failed.", cause);
        setError(cause instanceof Error ? cause.message : "休息日期读取失败。");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    function clear() {
      ++generation.current; controller.abort(); lock.current = false; pending.current = null;
      setSaved(null); setDates([]); setAttendanceDates([]); setNote(""); setError(""); setNotice(""); setBusy(false); setLoading(true);
    }
    function visibility() {
      if (document.visibilityState === "hidden") clear();
      else setRevision(value => value + 1);
    }
    const { data: subscription } = createClient("driver").auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") { clear(); location.replace("/driver/login"); }
    });
    document.addEventListener("visibilitychange", visibility);
    void load();
    return () => {
      generation.current = current + 1; controller.abort(); subscription.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [month, revision]);

  function canLeave() { return !dirty || window.confirm("切换会放弃尚未提交的休息日期和备注，是否继续？"); }
  function reload() {
    if (!canLeave()) return;
    setSaved(null); setDates([]); setNote(""); setError(""); setNotice(""); setLoading(true);
    pending.current = null; setRevision(value => value + 1);
  }
  async function submit() {
    if (lock.current || !saved) return;
    const content = { month, dates: [...dates].sort(), attendanceDates: [...attendanceDates].sort(),
      note: note.trim(), expectedVersion: saved.version };
    const key = JSON.stringify(content);
    if (pending.current?.key !== key) pending.current = { key, id: createDriverRequestId() };
    const parsed = shiftSubmissionSchema.safeParse({ ...content, requestId: pending.current.id });
    if (!parsed.success) { setError("請检查所选日期及备注。"); return; }
    const current = generation.current;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/driver/shifts", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) throw new Error(result.error || "提交未获确认，請刷新核对。");
      const data = shiftDataSchema.parse(result);
      if (data.month !== month) throw new Error("提交月份不一致，請刷新核对。");
      setSaved(data); setDates(data.dates); setAttendanceDates(data.attendanceDates); setNote(data.note); pending.current = null;
      setNotice("シフト已提交，休息提示立即生效；仍可被選任，最终安排請与调度确认。");
    } catch (cause) {
      if (current !== generation.current) return;
      console.error("Driver shift submit failed.", cause);
      setError(cause instanceof Error ? cause.message : "提交失败，請重试。");
    } finally { if (current === generation.current) { lock.current = false; setBusy(false); } }
  }
  return <main className="driver-main driver-shifts">
    <DriverNavigation active="shifts" busy={busy} canLeave={canLeave} />
    <h1>シフト提出</h1>
    <label className="driver-field">月份<input type="month" value={month} disabled={busy} onChange={event => {
      const next = event.target.value;
      if (!next || next === month || !canLeave()) return;
      setLoading(true); setSaved(null); setDates([]); setNote(""); setError(""); setNotice("");
      pending.current = null; setMonth(next);
    }} /></label>
    <button className="driver-link" disabled={busy || loading} onClick={reload}>刷新シフト</button>
    {error && <p className="driver-error" role="alert">{error}</p>}
    {notice && <p className="driver-notice" role="status">{notice}</p>}
    {loading ? <p role="status" className="driver-empty">正在读取シフト…</p> : saved && <>
    <section className="driver-card"><h2>{month} · シフト希望</h2>
      <p className="driver-muted">每天可选择「希望出勤」或「希望休」</p>
      <div className="shift-mode-buttons" role="group" aria-label="选择シフト希望类型">
        <button type="button" className={`shift-mode-button is-attendance${selectionMode === "attendance" ? " is-active" : ""}`}
          aria-pressed={selectionMode === "attendance"} disabled={busy}
          onClick={() => setSelectionMode("attendance")}>希望出勤</button>
        <button type="button" className={`shift-mode-button is-rest${selectionMode === "rest" ? " is-active" : ""}`}
          aria-pressed={selectionMode === "rest"} disabled={busy}
          onClick={() => setSelectionMode("rest")}>希望休</button>
      </div>
      <div className="shift-calendar" aria-label="シフト希望日期">
          {["月", "火", "水", "木", "金", "土", "日"].map(day => <span className="shift-weekday" key={day}>{day}</span>)}
          {Array.from({ length: calendar.offset }, (_, index) => <span key={`blank-${index}`} />)}
          {calendar.dates.map(date => {
            const restSelected = dates.includes(date);
            const attendanceSelected = attendanceDates.includes(date);
            const weekend = [0, 6].includes(new Date(`${date}T00:00:00`).getDay());
            const holiday = holidays.has(date);
            const selected = attendanceSelected || restSelected;
            const markers = [weekend && "休日", holiday && "祝日",
              attendanceSelected && "希望出勤", restSelected && "希望休"].filter(Boolean);
            return <button key={date} type="button"
              className={`shift-day${weekend || holiday ? " is-day-off" : ""}${attendanceSelected ? " is-attendance-selected" : ""}${restSelected ? " is-rest-selected" : ""}`}
              aria-label={`${date}${markers.length ? ` ${markers.join(" ")}` : ""}`}
              aria-pressed={selected} disabled={busy} onClick={() => {
                if (selectionMode === "attendance") {
                  if (attendanceSelected) setAttendanceDates(current => current.filter(value => value !== date));
                  else { setAttendanceDates(current => [...current, date]); setDates(current => current.filter(value => value !== date)); }
                } else if (restSelected) setDates(current => current.filter(value => value !== date));
                else { setDates(current => [...current, date]); setAttendanceDates(current => current.filter(value => value !== date)); }
                setNotice("");
              }}>
              <span>{Number(date.slice(8))}</span>
              {weekend && <small>休日</small>}
              {holiday && <small>祝日</small>}
              {selected && <small className="shift-day-selected">{attendanceSelected ? "出勤" : "休"}</small>}
              {!markers.length && <small>&nbsp;</small>}
            </button>;
          })}
        </div>
        <p className="driver-muted">希望出勤 {attendanceDates.length} 天 · 希望休 {dates.length} 天</p>
        <label className="driver-field">备注<textarea rows={3} maxLength={1000} value={note} disabled={busy}
          placeholder="例：希望连休、時間安排等" onChange={event => { setNote(event.target.value); setNotice(""); }} /></label>
        <p className="driver-muted">{saved.version ? "已提交，可修改后重新提交；重新提交会替换本月原選択。" : "尚未提交"}{dirty ? " · 有未提交修改" : ""}</p>
        <button className="driver-button" disabled={busy} onClick={() => void submit()}>{busy ? "正在提交…" : "提交シフト"}</button>
      </section>
    </>}
  </main>;
}
