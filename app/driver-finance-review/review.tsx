"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { financeClaimSchema, expenseTotals, financeCategoryLabels } from "@/lib/driver/finance";
import { japanDate } from "@/lib/driver/orders";
import { createClient } from "@/lib/supabase/browser";
import { fuelClaimSchema, fuelReviewRowSchema } from "@/lib/driver/fuel";

const rowsSchema = z.object({ fuelRows: z.array(fuelReviewRowSchema), rows: z.array(z.object({ driverName: z.string(), date: z.string(),
  pickup: z.string(), destination: z.string(), claim: financeClaimSchema })) });
type Row = z.infer<typeof rowsSchema>["rows"][number];
export default function Review() {
  const [month, setMonth] = useState(() => japanDate().slice(0, 7));
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  const [receipt, setReceipt] = useState("");
  const [fuelRows, setFuelRows] = useState<z.infer<typeof fuelReviewRowSchema>[]>([]);
  const lock = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    async function load() {
      try {
        const response = await fetch(`/api/driver-finance-review?month=${month}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (controller.signal.aborted || current !== generation.current) return;
        if (!response.ok) throw new Error(data.error || "读取失败。");
        const parsed = rowsSchema.parse(data); setRows(parsed.rows); setFuelRows(parsed.fuelRows);
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("Finance review load failed.", cause); setError(cause instanceof Error ? cause.message : "读取失败。");
      } finally { if (!controller.signal.aborted) setBusy(false); }
    }
    function hide() {
      if (document.visibilityState === "hidden") {
        ++generation.current; controller.abort(); lock.current = false;
        setRows([]); setReceipt(""); setNotes({}); setNotice(""); setError(""); setBusy(true);
        setFuelRows([]);
      } else setRevision(value => value + 1);
    }
    const { data: subscription } = createClient().auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") {
        ++generation.current; controller.abort(); setRows([]); setReceipt(""); setNotes({}); setNotice(""); setError("");
        setFuelRows([]);
        location.replace("/login");
      }
    });
    document.addEventListener("visibilitychange", hide);
    void load();
    return () => {
      generation.current = current + 1; controller.abort(); subscription.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", hide);
    };
  }, [month, revision]);
  async function review(row: Row, decision: "approved" | "rejected") {
    if (lock.current) return;
    const note = notes[`${row.claim.assignmentId}-${row.claim.category}`] || "";
    if (decision === "rejected" && !note.trim()) { setError("退回时请填写原因。"); return; }
    if (!window.confirm(decision === "approved" ?
      `确认${financeCategoryLabels[row.claim.category]}入账？仅处理此分类；请核对是否已手工录入相同费用。` : "确认退回给司机修改？")) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const current = generation.current;
    try {
      const response = await fetch("/api/driver-finance-review", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          assignmentId: row.claim.assignmentId, expectedVersion: row.claim.version, decision, note,
          category: row.claim.category,
        }) });
      const data = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) throw new Error(data.error || "审核未获确认。");
      const claim = financeClaimSchema.parse(data.claim);
      setRows(items => items.map(item => item.claim.assignmentId === claim.assignmentId && item.claim.category === claim.category ? { ...item, claim } : item));
      setNotice("处理成功。");
    } catch (cause) { if (current === generation.current) { console.error("Finance review failed.", cause); setError(cause instanceof Error ? cause.message : "审核失败。"); } }
    finally { if (current === generation.current) { lock.current = false; setBusy(false); } }
  }
  async function reviewFuel(row: z.infer<typeof fuelReviewRowSchema>, decision: "approved" | "rejected") {
    if (lock.current) return;
    const note = notes[row.claim.id] || "";
    if (decision === "rejected" && !note.trim()) { setError("退回时请填写原因。"); return; }
    if (!window.confirm(decision === "approved" ?
      "确认将燃油费追加到指定订单当天的燃油费？公司支付／油卡，不加到司机立替和应发金额。请核对是否已手工录入。" : "确认退回燃油费？")) return;
    const current = generation.current;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/driver-finance-review", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          fuelId: row.claim.id, expectedVersion: row.claim.version, decision, note,
        }) });
      const result = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) throw new Error(result.error || "燃油费审核未确认。");
      const saved = fuelClaimSchema.parse(result.fuelClaim);
      setFuelRows(items => items.map(item => item.claim.id === saved.id ? { ...item, claim: saved } : item));
      setNotice("燃油费已处理。");
    } catch (cause) {
      if (current !== generation.current) return;
      console.error("Daily fuel review failed.", cause); setError(cause instanceof Error ? cause.message : "燃油费审核失败。");
    } finally { if (current === generation.current) { lock.current = false; setBusy(false); } }
  }
  async function viewReceipt(path: string, bucket = "driver-finance-receipts") {
    const current = generation.current;
    try {
      const { data, error: storageError } = await createClient().storage.from(bucket).createSignedUrl(path, 60);
      if (current !== generation.current) return;
      if (storageError || !data) throw new Error("票据不可用。");
      setReceipt(data.signedUrl);
    } catch (cause) { if (current === generation.current) { console.error("Review receipt failed.", cause); setError(cause instanceof Error ? cause.message : "票据读取失败。"); } }
  }
  return <main className="driver-main driver-finance">
    <Link className="driver-link" href="/">‹ 预约管理</Link><h1>司机财务审核</h1>
    <label className="driver-field">月份<input type="month" value={month} disabled={busy}
      onChange={event => { if (event.target.value) {
        setBusy(true); setRows([]); setError(""); setNotice(""); setReceipt(""); setNotes({}); setMonth(event.target.value);
        setFuelRows([]);
      } }} /></label>
    <button className="driver-link" disabled={busy} onClick={() => {
      setBusy(true); setRows([]); setError(""); setReceipt(""); setNotes({}); setRevision(value => value + 1);
      setFuelRows([]);
    }}>刷新</button>
    <p className="driver-muted">立替金额作为新增费用追加；超时小时数替换当日原值，单价仍由后台设定。确认前请核对重复票据。司机月工资只读，包含后台手动加减项目。</p>
    {error && <p role="alert" className="driver-error">{error}</p>}
    {notice && <p role="status" className="driver-notice">{notice}</p>}
    {busy && <p className="driver-muted">正在处理…</p>}
    {!busy && !rows.length && !fuelRows.length && <p className="driver-empty">本月暂无申报。</p>}
    {rows.map(row => {
      const totals = expenseTotals(row.claim.expenses);
      const key = `${row.claim.assignmentId}-${row.claim.category}`;
      return <section className="driver-card" key={key}>
        <h2>{row.date} · {row.driverName}{row.claim.historical ? " · 历史订单" : ""}</h2><p>{row.pickup} → {row.destination}</p>
        <h3>{financeCategoryLabels[row.claim.category]}</h3>
        <p>{row.claim.category === "overtime" ? `超时 ${row.claim.overtimeHours} 小时` :
          `¥${(totals.company + totals.trip).toLocaleString()}`} · {row.claim.status === "pending" ? "待确认" : row.claim.status === "approved" ? "已入账" : "已退回"}</p>
        {row.claim.expenses.map(item => <div key={item.id} className="finance-expense">
          <p>{item.type === "company" ? "社报" : "旅报"} · {item.detail} · ¥{item.amount.toLocaleString()}</p>
          {item.receipts.map((path, index) => <button key={path} className="driver-link" onClick={() => void viewReceipt(path)}>票据 {index + 1}　</button>)}
        </div>)}
        {row.claim.status === "pending" ? <>
          <label className="driver-field">审核备注（退回必填）<input maxLength={500}
            value={notes[key] || ""} disabled={busy}
            onChange={event => setNotes(current => ({ ...current, [key]: event.target.value }))} /></label>
          <button className="driver-button" disabled={busy} onClick={() => void review(row, "approved")}>确认并入账</button>
          <button className="driver-button driver-secondary" disabled={busy} onClick={() => void review(row, "rejected")}>退回修改</button>
        </> : <p className="driver-muted">{row.claim.reviewNote}</p>}
      </section>;
    })}
    {fuelRows.map(row => <section className="driver-card" key={row.claim.id}>
      <h2>{row.claim.date} · {row.driverName} · 燃油费</h2>
      <p>关联订单：{row.pickup} → {row.destination}</p>
      <p>¥{row.claim.amount.toLocaleString()} · {row.claim.status === "pending" ? "待确认" : row.claim.status === "approved" ? "已计入订单燃油费" : "已退回"}</p>
      <p className="driver-muted">每天一笔，全部关联指定订单当日燃油费；不计司机立替及应发金额。</p>
      {row.claim.receipts.map((path, index) => <button className="driver-link" key={path}
        onClick={() => void viewReceipt(path, "driver-fuel-receipts")}>油票 {index + 1}　</button>)}
      {row.claim.status === "pending" ? <>
        <label className="driver-field">审核备注（退回必填）<input value={notes[row.claim.id] || ""} maxLength={500}
          disabled={busy} onChange={event => setNotes(items => ({ ...items, [row.claim.id]: event.target.value }))} /></label>
        <button className="driver-button" disabled={busy} onClick={() => void reviewFuel(row, "approved")}>确认燃油费并入账</button>
        <button className="driver-button driver-secondary" disabled={busy} onClick={() => void reviewFuel(row, "rejected")}>退回燃油费</button>
      </> : <p className="driver-muted">{row.claim.reviewNote}</p>}
    </section>)}
    {receipt && <section className="driver-card"><button className="driver-link" onClick={() => setReceipt("")}>关闭票据</button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="finance-receipt" src={receipt} alt="司机立替票据" /></section>}
  </main>;
}
