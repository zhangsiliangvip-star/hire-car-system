"use client";

import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { createClient } from "@/lib/supabase/browser";
import { orderReceiptDataSchema, orderReceiptLabels } from "@/lib/driver/order-receipts";
import { buildOrderReceiptPrintHtml } from "@/lib/order-receipt-print";
import { printA4Html } from "@/lib/print-a4";
import styles from "./order-receipts.module.css";

type ReceiptData = z.infer<typeof orderReceiptDataSchema>;
type Receipt = ReceiptData["receipts"][number];
const receiptKey = (receipt: Receipt) => JSON.stringify([receipt.bucket, receipt.path]);

export function ReceiptDialog({ receipt, close }: {
  receipt: Pick<Receipt, "url" | "detail"> & Partial<Pick<Receipt, "category">>;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  return <dialog ref={dialog} className={styles.dialog} aria-label="小票大图"
    onCancel={event => { event.stopPropagation(); close(); }} onClose={close}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <div className={styles.viewer}>
      <header className={styles.toolbar}>
        <strong>{receipt.category ? `${orderReceiptLabels[receipt.category]} · ` : ""}{receipt.detail}</strong>
        <button type="button" onClick={close} autoFocus className={styles.close}>关闭</button>
      </header>
      {failed ? <p role="alert">图片加载失败，請关闭后重新点击票据重试。</p> :
        // Private short-lived signed URLs must not go through an image optimization cache.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={receipt.url} alt={`${receipt.category ? `${orderReceiptLabels[receipt.category]}：` : ""}${receipt.detail}`}
          className={styles.large} onError={() => setFailed(true)} />}
    </div>
  </dialog>;
}

export function OrderReceipts({ orderId, date, blocked = false, onChanged, onSwitching }: {
  orderId: string; date: string; blocked?: boolean; onChanged?: (signal: AbortSignal) => Promise<void>;
  onSwitching?: (busy: boolean) => void;
}) {
  const [data, setData] = useState<ReceiptData | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Receipt | null>(null);
  const [revision, setRevision] = useState(0);
  const [checked, setChecked] = useState<string[]>([]);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");
  const printRequest = useRef<AbortController | null>(null);
  const switchRequest = useRef<AbortController | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchNotice, setSwitchNotice] = useState("");
  const [switchError, setSwitchError] = useState("");
  const switchBusyCallback = useRef(onSwitching);
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const response = await fetch(`/api/order-receipts?orderId=${encodeURIComponent(orderId)}&date=${encodeURIComponent(date)}`,
          { cache: "no-store", signal: request.signal });
        const result: unknown = await response.json();
        if (!response.ok) throw new Error("无法读取已批准的小票，請刷新重试。");
        const parsed = orderReceiptDataSchema.parse(result);
        if (!active || request.signal.aborted || document.visibilityState !== "visible") return;
        setData(parsed); setError(""); setSelected(null); setChecked([]);
        if (parsed.enabled) timer = setTimeout(() => { clear(); void load(); }, 240000);
      } catch (cause) {
        if (!active || request.signal.aborted) return;
        console.error("Order receipts load failed.", cause);
        setError("无法读取已批准的小票，請点“小票刷新”重试。");
      }
    }
    function clear() {
      controller?.abort(); clearTimeout(timer); printRequest.current?.abort(); printRequest.current = null;
      if (switchRequest.current) { switchRequest.current.abort(); switchBusyCallback.current?.(false); }
      switchRequest.current = null; setSwitching(false); setSwitchNotice(""); setSwitchError("");
      setData(null); setSelected(null); setChecked([]); setError(""); setPrintError(""); setPrinting(false);
      setSwitchError(""); setSwitchNotice("");
    }
    function visibility() {
      clear();
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", visibility);
    const { data: subscription } = createClient().auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") { active = false; clear(); }
    });
    if (document.visibilityState === "visible") void load();
    return () => {
      active = false; controller?.abort(); clearTimeout(timer);
      printRequest.current?.abort(); printRequest.current = null;
      if (switchRequest.current) { switchRequest.current.abort(); switchBusyCallback.current?.(false); }
      switchRequest.current = null;
      document.removeEventListener("visibilitychange", visibility);
      subscription.subscription.unsubscribe();
    };
  }, [orderId, date, revision]);
  useEffect(() => { switchBusyCallback.current = onSwitching; }, [onSwitching]);
  const printable = data?.receipts.filter(receipt =>
    receipt.category !== "fuel" && checked.includes(receiptKey(receipt))) ?? [];
  function toggle(receipts: Receipt[], include: boolean) {
    const keys = receipts.map(receiptKey);
    setChecked(current => include ? Array.from(new Set([...current, ...keys])) : current.filter(key => !keys.includes(key)));
  }
  async function printReceipts() {
    if (printRequest.current || printable.length === 0) return;
    const request = new AbortController();
    printRequest.current = request; setPrinting(true); setPrintError("");
    try {
      await printA4Html(buildOrderReceiptPrintHtml(printable, date), `${date} 立替小票`, {
        signal: request.signal,
        imageErrorMessage: "小票图片载入失败，請点击“小票刷新”后重新勾选打印。",
      });
    } catch (cause) {
      if (!request.signal.aborted) {
        console.error("Order receipt printing failed.", cause);
        setPrintError("立替小票打印失败，請点击“小票刷新”后重新勾选打印。");
      }
    } finally {
      if (printRequest.current === request) { printRequest.current = null; setPrinting(false); }
    }
  }
  async function switchCategory(advance: NonNullable<ReceiptData["advances"]>[number], expenseId?: string, deleting = false) {
        if (blocked || !onChanged || switchRequest.current) return;
        if (deleting) {
          const expense = advance.expenses?.find(item => item.id === expenseId);
          if (!expense) return;
          if (!window.confirm(`削除「${expense.detail}」¥${expense.amount.toLocaleString("ja-JP")}？该条明细和票据关联将移除，并扣回当天立替金额，保留操作记录。`)) return;
        }
        const request = new AbortController();
        switchRequest.current = request; setSwitching(true); setSwitchNotice(""); setSwitchError("");
        switchBusyCallback.current?.(true);
        let saved = false;
        try {
          const response = await fetch("/api/order-receipts", {
            method: "POST", headers: { "Content-Type": "application/json" }, signal: request.signal,
            body: JSON.stringify({ orderId, date, claimId: advance.claimId, expectedVersion: advance.version,
              ...(expenseId ? { expenseId } : {}),
              ...(deleting ? { action: "delete" } : { category: advance.category === "company" ? "trip" : "company" }) }),
          });
          const result: unknown = await response.json();
          if (!response.ok) throw new Error(typeof result === "object" && result !== null && "error" in result &&
            typeof result.error === "string" ? result.error : "立替切换失败，請刷新核对。");
          if (typeof result !== "object" || result === null ||
            (deleting ? !("deleted" in result) || result.deleted !== true : !("switched" in result) || result.switched !== true))
            throw new Error("切换结果无效，請刷新核对。");
          saved = true;
          if (request.signal.aborted) return;
          setData(null); setChecked([]); setSelected(null);
          await onChanged(request.signal);
          if (!request.signal.aborted) setSwitchNotice(deleting ? "已削除明细及票据关联，立替金额已扣回，订单财务已同步。" :
            "已切换立替类别，金额和票据一起转移，订单财务已同步。");
        } catch (cause) {
          if (!request.signal.aborted) {
            console.error("Advance category switch failed.", cause);
            setSwitchError(saved ? (deleting ? "明细已削除，但订单汇总刷新失败。請刷新页面核对，勿重复操作。" :
              "类别已切换，但订单汇总刷新失败。請刷新页面核对，勿重复切换。") :
              cause instanceof Error ? cause.message : "立替切换失败，請刷新核对。");
          }
        } finally {
          if (switchRequest.current === request) {
            switchRequest.current = null; setSwitching(false);
            switchBusyCallback.current?.(false);
            if (saved) setRevision(value => value + 1);
          }
        }
  }
  if (data?.enabled === false) return null;
  return <section className={styles.receipts} aria-label="立替小票">
    <div className={styles.toolbar}><span>立替小票</span>
    </div>
    {printError && <p role="alert" className={styles.error}>{printError}</p>}
    {switchNotice && <p role="status">{switchNotice}</p>}
    {switchError && <p role="alert" className={styles.error}>{switchError}</p>}
    {onChanged && !!data?.advances?.length && <div className={styles.switches}>
      <div className={styles.advanceColumns}>
        {(["company", "trip"] as const).map(category => {
          const advances = data.advances?.filter(advance => advance.category === category) ?? [];
          return <section key={category} className={styles.advanceColumn} aria-label={`${orderReceiptLabels[category]}明细列表`}>
            <h4 className={styles.advanceHeading}>
              <span>{orderReceiptLabels[category]}</span>
              <span className={styles.advanceAmount}>¥{advances.reduce((total, advance) =>
                total + advance.amount, 0).toLocaleString("ja-JP")}</span>
            </h4>
            {advances.length === 0 ? <p className={styles.empty}>暂无明细</p> :
              advances.flatMap(advance => (advance.expenses ?? [undefined]).map(expense =>
                <div className={styles.advanceRow} key={`${advance.claimId}-${expense?.id ?? "all"}`}>
                  <span className={styles.advanceDetail}>{expense?.detail ?? advance.detail}</span>
                  <span className={styles.advanceAmount}>¥{(expense?.amount ?? advance.amount).toLocaleString("ja-JP")}</span>
                  <div className={styles.rowActions}>
                  <button type="button" className={styles.smallAction} disabled={blocked || switching || printing}
                    aria-label={`将${expense?.detail ?? advance.detail}切换为${orderReceiptLabels[category === "company" ? "trip" : "company"]}`}
                    title={blocked ? "請先保存訂単修改后再切换" : "仅此条明细的金额及全部票据一起转移"}
                    onClick={() => { void switchCategory(advance, expense?.id); }}>
                    {category === "company" ? "旅报" : "社报"}
                  </button>
                  {expense && <button type="button" className={`${styles.smallAction} ${styles.deleteAction}`}
                    disabled={blocked || switching || printing} aria-label={`削除${expense.detail}`}
                    onClick={() => { void switchCategory(advance, expense.id, true); }}>削除</button>}
                  </div>
                </div>))}
          </section>;
        })}
      </div>
      {blocked && <p>請先保存訂単修改后再切换立替类别。</p>}
    </div>}
    <div className={styles.photoArea}>
    {error ? <p role="alert" className={styles.error}>{error}</p> :
      !data ? <p role="status">正在读取小票…</p> :
      data.receipts.length === 0 ? <p className={styles.empty}>本日暂无已批准的小票</p> :
      <div className={styles.groups}>
        {(["company", "trip", "fuel"] as const).map(category => {
          const receipts = data.receipts.filter(item => item.category === category);
          return receipts.length > 0 && <div key={category}>
            <h4>{category === "fuel" ? orderReceiptLabels[category] :
              <label className={styles.check}><input type="checkbox" disabled={printing}
                checked={receipts.every(receipt => checked.includes(receiptKey(receipt)))}
                aria-label={`全选${orderReceiptLabels[category]}小票`}
                onChange={event => toggle(receipts, event.target.checked)} />{orderReceiptLabels[category]}</label>}</h4>
            <div className={styles.thumbnails}>{receipts.map((receipt, index) =>
              <div key={`${receipt.path}-${index}`} className={styles.receipt}>
              <button type="button" className={styles.thumbnail}
                title={`${receipt.detail} · 点击放大`} aria-label={`${orderReceiptLabels[category]}小票 ${index + 1}：${receipt.detail}，点击放大`}
                onClick={() => setSelected(receipt)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={receipt.url} alt={receipt.detail} loading="lazy"
                  onError={() => setError("部分小票图片加载失败，請点“小票刷新”重试。")} />
              </button>
              {category !== "fuel" && <label className={styles.check}>
                <input type="checkbox" disabled={printing} checked={checked.includes(receiptKey(receipt))}
                  aria-label={`打印${orderReceiptLabels[category]}小票 ${index + 1}：${receipt.detail}`}
                  onChange={event => toggle([receipt], event.target.checked)} />打印
              </label>}
              </div>)}</div>
          </div>;
        })}
      </div>}
    <div className={styles.actions}>
      <button type="button" disabled={switching} className={styles.refresh} onClick={() => {
        printRequest.current?.abort(); printRequest.current = null;
        setData(null); setSelected(null); setChecked([]); setError(""); setPrintError(""); setPrinting(false);
        setRevision(value => value + 1);
      }}>小票刷新</button>
      <button type="button" className={styles.print} disabled={switching || printing || !printable.length || !!error}
        onClick={() => { void printReceipts(); }}>{printing ? "正在组合小票…" : `立替小票批量打印${printable.length ? `（${printable.length}张）` : ""}`}</button>
    </div>
    </div>
    {selected && <ReceiptDialog receipt={selected} close={() => setSelected(null)} />}
  </section>;
}
