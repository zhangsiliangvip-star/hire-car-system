"use client";

import DriverNavigation from "@/app/driver/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { createDriverRequestId, japanDate } from "@/lib/driver/orders";
import { shiftDataSchema, shiftMonthDays, shiftSubmissionSchema, type ShiftData } from "@/lib/driver/shifts";
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
  const generation = useRef(0);
  const lock = useRef(false);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const dirty = Boolean(saved && (JSON.stringify([...dates].sort()) !== JSON.stringify(saved.dates) || note !== saved.note));
  const calendar = shiftMonthDays(month);

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
        if (data.month !== month) throw new Error("月份不一致，请刷新核对。");
        setSaved(data); setDates(data.dates); setNote(data.note);
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("Driver shift load failed.", cause);
        setError(cause instanceof Error ? cause.message : "休息日期读取失败。");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    function clear() {
      ++generation.current; controller.abort(); lock.current = false; pending.current = null;
      setSaved(null); setDates([]); setNote(""); setError(""); setNotice(""); setBusy(false); setLoading(true);
    }
    function visibility() {
      if (document.visibilityState === "hidden") clear();
      else setRevision(value => value + 1);
    }
    const { data: subscription } = createClient().auth.onAuthStateChange(event => {
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
    const content = { month, dates: [...dates].sort(), note: note.trim(), expectedVersion: saved.version };
    const key = JSON.stringify(content);
    if (pending.current?.key !== key) pending.current = { key, id: createDriverRequestId() };
    const parsed = shiftSubmissionSchema.safeParse({ ...content, requestId: pending.current.id });
    if (!parsed.success) { setError("请检查所选日期及备注。"); return; }
    const current = generation.current;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/driver/shifts", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) throw new Error(result.error || "提交未获确认，请刷新核对。");
      const data = shiftDataSchema.parse(result);
      if (data.month !== month) throw new Error("提交月份不一致，请刷新核对。");
      setSaved(data); setDates(data.dates); setNote(data.note); pending.current = null;
      setNotice("シフト已提交，休息提示立即生效；仍可被選任，最终安排请与调度确认。");
    } catch (cause) {
      if (current !== generation.current) return;
      console.error("Driver shift submit failed.", cause);
      setError(cause instanceof Error ? cause.message : "提交失败，请重试。");
    } finally { if (current === generation.current) { lock.current = false; setBusy(false); } }
  }
  return <main className="driver-main driver-shifts">
    <DriverNavigation active="shifts" busy={busy} canLeave={canLeave} />
    <h1>シフト提出</h1>
    <p className="driver-muted">按月選択希望休息的日期，可多选；提交后立即显示“休”提示，不会阻止调度選任。切后台会清除未提交草稿。</p>
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
      <section className="driver-card"><h2>{month} · 希望休</h2>
        <div className="shift-calendar" aria-label="休息日期">
          {["日", "月", "火", "水", "木", "金", "土"].map(day => <span className="shift-weekday" key={day}>{day}</span>)}
          {Array.from({ length: calendar.offset }, (_, index) => <span key={`blank-${index}`} />)}
          {calendar.dates.map(date => <button key={date} type="button" className="shift-day"
            aria-label={date} aria-pressed={dates.includes(date)} disabled={busy}
            onClick={() => { setDates(current => current.includes(date) ? current.filter(value => value !== date) : [...current, date]); setNotice(""); }}>
            <span>{Number(date.slice(8))}</span><small>{dates.includes(date) ? "休" : "\u00a0"}</small>
          </button>)}
        </div>
        <p className="driver-muted">已选 {dates.length} 天{dates.length ? `：${[...dates].sort().map(date => date.slice(5)).join("、")}` : "（本月无希望休可直接提交）"}</p>
        <label className="driver-field">备注<textarea rows={3} maxLength={1000} value={note} disabled={busy}
          placeholder="例：希望连休、時間安排等" onChange={event => { setNote(event.target.value); setNotice(""); }} /></label>
        <p className="driver-muted">{saved.version ? "已提交，可修改后重新提交；重新提交会替换本月原選択。" : "尚未提交"}{dirty ? " · 有未提交修改" : ""}</p>
        <button className="driver-button" disabled={busy} onClick={() => void submit()}>{busy ? "正在提交…" : "提交シフト"}</button>
      </section>
    </>}
  </main>;
}
