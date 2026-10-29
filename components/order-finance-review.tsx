"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { z } from "zod";
import { createClient } from "@/lib/supabase/browser";
import { financeCategoryLabels, financeClaimSchema } from "@/lib/driver/finance";
import { fuelClaimSchema } from "@/lib/driver/fuel";
import { orderReviewDataSchema, orderReviewKey, type OrderReviewRow } from "@/lib/driver/order-review";
import { orderReceiptDataSchema } from "@/lib/driver/order-receipts";
import { ReceiptDialog } from "@/components/order-receipts";
import styles from "./order-receipts.module.css";

type ReviewData = z.infer<typeof orderReviewDataSchema>;
type Receipt = z.infer<typeof orderReceiptDataSchema>["receipts"][number];
type ReviewContext = {
  data: ReviewData | null; blocked: boolean; busy: boolean;
  open: (orderId: string, name: string) => void;
};
const Context = createContext<ReviewContext | null>(null);
function label(row: OrderReviewRow) {
  return row.kind === "fuel" ? "燃油費" : financeCategoryLabels[row.claim.category];
}
function PendingPhotos({ row }: { row: OrderReviewRow }) {
  const [receipts, setReceipts] = useState<Receipt[] | null>(null);
  const [selected, setSelected] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const bucket = row.kind === "fuel" ? "driver-fuel-receipts" : "driver-finance-receipts";
        const items = row.kind === "fuel" ? row.claim.receipts.map(path => ({ path, detail: "燃油費" })) :
          row.claim.expenses.flatMap(item => item.receipts.map(path => ({ path, detail: item.detail })));
        const paths = [...new Set(items.map(item => item.path))];
        const signed = paths.length ? await createClient().storage.from(bucket).createSignedUrls(paths, 300) : null;
        if (signed?.error || (paths.length && !signed?.data)) throw new Error("Cannot read pending receipts.");
        const urls = new Map(signed?.data?.map(item => [item.path, item]));
        const photos: Receipt[] = items.map(item => {
          const value = urls.get(item.path);
          if (!value?.signedUrl || value.error) throw new Error("Pending receipt unavailable.");
          return { ...item, bucket, category: row.kind === "fuel" ? "fuel" : row.claim.category === "trip" ? "trip" : "company",
            url: value.signedUrl };
        });
        if (!active) return;
        setReceipts(photos);
        timer = setTimeout(() => { setReceipts(null); setSelected(null); void load(); }, 240000);
      } catch (cause) {
        if (!active) return;
        console.error("Pending receipt read failed.", cause instanceof Error ? cause.name : "UnknownError");
        setError("无法读取申報小票，請刷新小票后再核对。");
      }
    }
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [row, revision]);
  return <div className="mt-2">
    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> :
      receipts === null ? <p role="status" className="text-xs text-gray-500">读取小票中…</p> :
      receipts.length === 0 ? <p className="text-xs text-gray-500">未上传小票</p> :
      <div className={styles.thumbnails}>{receipts.map((receipt, index) =>
        <button key={`${receipt.path}-${index}`} type="button" className={styles.thumbnail}
          aria-label={`${receipt.detail}小票 ${index + 1}，点击放大`} title={receipt.detail} onClick={() => setSelected(receipt)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={receipt.url} alt={receipt.detail} loading="lazy"
            onError={() => setError("小票加载失败，請刷新小票后再核对。")} />
        </button>)}</div>}
    <button type="button" className="mt-1 text-xs text-blue-700" onClick={() => {
      setReceipts(null); setSelected(null); setError(""); setRevision(value => value + 1);
    }}>刷新小票</button>
    {selected && <ReceiptDialog receipt={selected} close={() => setSelected(null)} />}
  </div>;
}

function ReviewDialog({ rows, name, busy, blocked, error, notice, close, review }: {
  rows: OrderReviewRow[]; name: string; busy: boolean; blocked: boolean; close: () => void;
  error: string; notice: string;
  review: (row: OrderReviewRow, decision: "approved" | "rejected", note: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  function dismiss() {
    if (busy) return;
    if (rows.some(row => notes[orderReviewKey(row)]?.trim()) && !window.confirm("关闭会放弃尚未提交的审核备注，是否继续？")) return;
    close();
  }
  return <dialog ref={dialog} className={styles.dialog} aria-label="訂単财务审核"
    onCancel={event => { event.preventDefault(); dismiss(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); dismiss(); } }}
    onClick={event => { if (event.target === event.currentTarget) dismiss(); }}>
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="min-w-0 break-words font-semibold">{name} · 運転士申報审核</h2>
        <button type="button" disabled={busy} onClick={dismiss} className="rounded border px-3 py-1">关闭</button>
      </div>
      <p className="mb-3 text-xs text-gray-600">仅审核待审核申報。批准才入账；驳回相当于从訂単待审核区删除，不计入金額，但保留記録并允许運転士重報。已批准申報不能在此撤销。</p>
      {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="mb-3 text-sm text-emerald-800">{notice}</p>}
      {blocked && <p role="alert" className="mb-3 text-sm text-red-700">訂単有未完成保存或保存错误，請先处理后再审核。</p>}
      {!rows.length && <p className="py-4 text-sm text-gray-500">本訂単本月没有待审核申報。</p>}
      <div className="space-y-3">{rows.map(row => {
        const key = orderReviewKey(row);
        const amount = row.kind === "fuel" ? row.claim.amount :
          row.claim.category === "overtime" ? null : row.claim.expenses.reduce((total, item) => total + item.amount, 0);
        return <section key={key} className="rounded border p-3" aria-label={`${row.date} ${label(row)}待审核`}>
          <div className="flex flex-wrap justify-between gap-2 text-sm font-semibold">
            <h3 className="min-w-0 break-words">{row.date} · {row.driverName} · {label(row)}</h3>
            <span>{amount === null && row.kind === "finance" ? `${row.claim.overtimeHours} 小時` : `${amount?.toLocaleString("ja-JP")} JPY`}</span>
          </div>
          {row.kind === "finance" && row.claim.expenses.map(item =>
            <div key={item.id} className="mt-1 flex justify-between gap-3 text-sm">
              <span className="min-w-0 break-words">{item.detail}</span><span className="shrink-0">{item.amount.toLocaleString("ja-JP")} JPY</span>
            </div>)}
          {row.kind === "finance" && row.claim.category === "overtime" &&
            <p className="mt-1 text-xs text-gray-600">批准后替换该日超時小時数，按后台单价重算金額。</p>}
          {row.kind === "fuel" && <p className="mt-1 text-xs text-gray-600">批准后追加到该訂単当天燃油費，不计運転士立替或应発工資。</p>}
          {(row.kind === "fuel" || row.claim.category !== "overtime") && <PendingPhotos key={`${key}-${row.claim.version}`} row={row} />}
          <label className="mt-3 block text-xs">审核备注（驳回必填）
            <input aria-label={`${row.date} ${label(row)}审核备注`} maxLength={500} disabled={busy || blocked}
              className="mt-1 w-full rounded border p-2 text-sm" value={notes[key] ?? ""}
              onChange={event => setNotes(current => ({ ...current, [key]: event.target.value }))} />
          </label>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || blocked} className="rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50"
              onClick={() => void review(row, "approved", notes[key] ?? "")}>批准入账</button>
            <button type="button" disabled={busy || blocked} className="rounded border border-red-300 px-3 py-2 text-sm text-red-700 disabled:opacity-50"
              onClick={() => void review(row, "rejected", notes[key] ?? "")}>驳回移除</button>
          </div>
        </section>;
      })}</div>
    </div>
  </dialog>;
}

export function OrderFinanceReviewProvider({ month, enabled, blocked, onApproved, children }: {
  month: string; enabled: boolean; blocked: boolean; onApproved: (signal: AbortSignal) => Promise<void>; children: ReactNode;
}) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<{ orderId: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const lock = useRef(false);
  const writeController = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let controller: AbortController | null = null;
    function invalidate() { ++generation.current; }
    async function load() {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch(`/api/order-finance-review?month=${encodeURIComponent(month)}`,
          { cache: "no-store", signal: request.signal });
        const result = await response.json();
        if (!active || request.signal.aborted) return;
        if (!response.ok) throw new Error(result.error || "无法读取訂単待审核申報。");
        setData(orderReviewDataSchema.parse(result));
      } catch (cause) {
        if (!active || request.signal.aborted) return;
        console.error("Order finance review load failed.", cause instanceof Error ? cause.name : "UnknownError");
        setError("无法读取待审核申報，請点“刷新待审核”重试。");
      }
    }
    function clear() {
      invalidate(); controller?.abort(); writeController.current?.abort(); lock.current = false;
      setData(null); setSelected(null); setError(""); setNotice(""); setBusy(false);
    }
    function visibility() { clear(); if (document.visibilityState === "visible") void load(); }
    const { data: subscription } = createClient().auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") { active = false; clear(); }
    });
    document.addEventListener("visibilitychange", visibility);
    if (document.visibilityState === "visible") void load();
    return () => {
      active = false; invalidate(); controller?.abort(); writeController.current?.abort(); lock.current = false;
      subscription.subscription.unsubscribe(); document.removeEventListener("visibilitychange", visibility);
    };
  }, [month, enabled, revision]);
  async function review(row: OrderReviewRow, decision: "approved" | "rejected", note: string) {
    if (lock.current || blocked) return;
    if (decision === "rejected" && !note.trim()) { setError("驳回時請填写原因，便于運転士重新申報。"); return; }
    if (!window.confirm(decision === "approved" ? `确认${row.date}的${label(row)}入账？請核对是否已手工录入相同数据。` :
      "确认驳回并从待审核区移除？不计入金額，保留审核記録，運転士可重新申報。")) return;
    const current = generation.current;
    const controller = new AbortController();
    writeController.current = controller;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const body = row.kind === "fuel" ? { fuelId: row.claim.id, expectedVersion: row.claim.version, decision, note } :
        { assignmentId: row.claim.assignmentId, category: row.claim.category, expectedVersion: row.claim.version, decision, note };
      const response = await fetch("/api/driver-finance-review", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal,
      });
      const result = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) throw new Error(result.error || "审核未获确认，請刷新核对后再操作。");
      const saved = row.kind === "fuel" ? fuelClaimSchema.parse(result.fuelClaim) : financeClaimSchema.parse(result.claim);
      if (saved.status !== decision || saved.version !== row.claim.version + 1 ||
        saved.assignmentId !== row.claim.assignmentId ||
        (row.kind === "fuel" ? !("id" in saved) || saved.id !== row.claim.id :
          !("category" in saved) || saved.category !== row.claim.category)) throw new Error("审核返回结果不匹配，請刷新核对。");
      setData(previous => previous ? { ...previous, rows: previous.rows.filter(item => orderReviewKey(item) !== orderReviewKey(row)) } : previous);
      setNotice(decision === "approved" ? "已批准入账。" : "已驳回并移出待审核区，未计入金額；記録保留，運転士可重新申報。");
      if (decision === "approved") {
        try { await onApproved(controller.signal); }
        catch (cause) {
          if (current !== generation.current) return;
          console.error("Approved order totals refresh failed.", cause instanceof Error ? cause.name : "UnknownError");
          setError("已批准入账，但列表金額刷新失败，請刷新页面核对，勿重复批准。");
        }
      }
    } catch (cause) {
      if (current !== generation.current) return;
      console.error("Order finance review failed.", cause instanceof Error ? cause.name : "UnknownError");
      setError(cause instanceof Error ? cause.message : "审核未获确认，請刷新核对。");
    } finally {
      if (current === generation.current) { lock.current = false; setBusy(false); }
    }
  }
  return <Context.Provider value={{ data: enabled ? data : { enabled: false, rows: [] }, blocked, busy,
    open: (orderId, name) => { if (!lock.current) { setSelected({ orderId, name }); setError(""); setNotice(""); } } }}>
    {enabled && data?.enabled !== false && <div className="mb-3 text-sm">
      <button type="button" disabled={busy} className="text-blue-700 disabled:opacity-50" onClick={() => {
        setData(null); setSelected(null); setError(""); setNotice(""); setRevision(value => value + 1);
      }}>刷新待审核</button>
      {!data && !error && <span className="ml-3 text-gray-500" role="status">读取待审核申報中…</span>}
      {error && <p role="alert" className="mt-1 text-red-700">{error}</p>}
      {notice && <p role="status" className="mt-1 text-emerald-800">{notice}</p>}
    </div>}
    {children}
    {selected && data?.enabled && <ReviewDialog rows={data.rows.filter(row => row.orderId === selected.orderId)}
      name={selected.name} busy={busy} blocked={blocked} error={error} notice={notice}
      close={() => setSelected(null)} review={review} />}
  </Context.Provider>;
}

export function OrderFinanceReviewButton({ orderId, name }: { orderId: string; name: string }) {
  const context = useContext(Context);
  if (!context?.data?.enabled) return null;
  const count = context.data.rows.filter(row => row.orderId === orderId).length;
  return <button type="button" disabled={context.busy || context.blocked || !count} aria-haspopup="dialog"
    className={`mt-1 block text-left text-xs ${count ? "font-semibold text-amber-700 hover:underline" : "text-gray-400"} disabled:cursor-default`}
    onClick={() => context.open(orderId, name)}>{count ? `運転士申報待审核 ${count} 项` : "无待审核申報"}</button>;
}
