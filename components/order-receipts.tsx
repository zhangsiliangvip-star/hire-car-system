"use client";

import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { createClient } from "@/lib/supabase/browser";
import { orderReceiptDataSchema, orderReceiptLabels } from "@/lib/driver/order-receipts";
import styles from "./order-receipts.module.css";

type ReceiptData = z.infer<typeof orderReceiptDataSchema>;
type Receipt = ReceiptData["receipts"][number];

export function ReceiptDialog({ receipt, close }: { receipt: Receipt; close: () => void }) {
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
        <strong>{orderReceiptLabels[receipt.category]} · {receipt.detail}</strong>
        <button type="button" onClick={close} autoFocus className={styles.close}>关闭</button>
      </header>
      {failed ? <p role="alert">图片加载失败，請关闭后点击“小票刷新”重试。</p> :
        // Private short-lived signed URLs must not go through an image optimization cache.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={receipt.url} alt={`${orderReceiptLabels[receipt.category]}：${receipt.detail}`}
          className={styles.large} onError={() => setFailed(true)} />}
    </div>
  </dialog>;
}

export function OrderReceipts({ orderId, date }: { orderId: string; date: string }) {
  const [data, setData] = useState<ReceiptData | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Receipt | null>(null);
  const [revision, setRevision] = useState(0);
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
        setData(parsed); setError(""); setSelected(null);
        if (parsed.enabled) timer = setTimeout(() => { setData(null); setSelected(null); void load(); }, 240000);
      } catch (cause) {
        if (!active || request.signal.aborted) return;
        console.error("Order receipts load failed.", cause);
        setError("无法读取已批准的小票，請点“小票刷新”重试。");
      }
    }
    function clear() { controller?.abort(); clearTimeout(timer); setData(null); setSelected(null); setError(""); }
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
      document.removeEventListener("visibilitychange", visibility);
      subscription.subscription.unsubscribe();
    };
  }, [orderId, date, revision]);
  if (data?.enabled === false) return null;
  return <section className={styles.receipts} aria-label="運転士已批准小票">
    <div className={styles.toolbar}><span>運転士小票（仅已批准）</span>
      <button type="button" className={styles.refresh} onClick={() => {
        setData(null); setSelected(null); setError(""); setRevision(value => value + 1);
      }}>小票刷新</button>
    </div>
    {error ? <p role="alert" className={styles.error}>{error}</p> :
      !data ? <p role="status">正在读取小票…</p> :
      data.receipts.length === 0 ? <p className={styles.empty}>本日暂无已批准的小票</p> :
      <div className={styles.groups}>
        {(["company", "trip", "fuel"] as const).map(category => {
          const receipts = data.receipts.filter(item => item.category === category);
          return receipts.length > 0 && <div key={category}>
            <h4>{orderReceiptLabels[category]}</h4>
            <div className={styles.thumbnails}>{receipts.map((receipt, index) =>
              <button type="button" key={`${receipt.path}-${index}`} className={styles.thumbnail}
                title={`${receipt.detail} · 点击放大`} aria-label={`${orderReceiptLabels[category]}小票 ${index + 1}：${receipt.detail}，点击放大`}
                onClick={() => setSelected(receipt)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={receipt.url} alt={receipt.detail} loading="lazy"
                  onError={() => setError("部分小票图片加载失败，請点“小票刷新”重试。")} />
              </button>)}</div>
          </div>;
        })}
      </div>}
    {selected && <ReceiptDialog receipt={selected} close={() => setSelected(null)} />}
  </section>;
}
