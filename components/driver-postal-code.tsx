"use client";

import { useEffect, useRef, useState } from "react";
import { driverPostalCodeSchema } from "@/lib/driver-address";
import { readJsonSafely, buildApiErrorMessage } from "@/lib/api-client";

type Props = {
  value: string; address: string;
  onChange: (value: string) => void;
  onAddress: (postalCode: string, address: string, previousAddress: string) => void;
};

export function DriverPostalCode({ value, address, onChange, onAddress }: Props) {
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancel() {
    request.current?.abort();
    if (timer.current) clearTimeout(timer.current);
  }
  useEffect(() => () => {
    request.current?.abort();
    if (timer.current) clearTimeout(timer.current);
  }, [address]);

  async function lookup(input: string) {
    cancel();
    const code = driverPostalCodeSchema.safeParse(input);
    if (!code.success || !code.data) { setMessage(""); return; }
    const controller = new AbortController();
    request.current = controller;
    setFailed(false); setMessage("正在查询地址…");
    try {
      const response = await fetch(`/api/postal-address?postalCode=${encodeURIComponent(code.data)}`, { signal: controller.signal });
      const data = await readJsonSafely(response);
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(buildApiErrorMessage(response, data, "邮编地址查询失败。"));
      if (typeof data !== "object" || data === null || !("address" in data) || typeof data.address !== "string" ||
        !data.address || !("postalCode" in data) || data.postalCode !== code.data) throw new Error("邮编查询结果无效，請重试。");
      if (address.trim().startsWith(data.address)) {
        setMessage("地址已匹配，保留原番地及楼名。"); return;
      }
      if (address.trim() && !window.confirm(`查询地址：${data.address}\n是否替换当前住所？番地、楼名需重新补充。`)) {
        setMessage("已保留原住所。"); return;
      }
      onAddress(code.data, data.address, address);
      setMessage("已查到地址；請核对住所并补充番地、楼名。");
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Driver postal lookup failed.", error instanceof Error ? error.name : "UnknownError");
      setFailed(true); setMessage(error instanceof Error ? error.message : "地址查询失败，請重试或手动填写。");
    }
  }

  return <div className="driver-editor-field">
    <label>郵便番号
      <input type="text" autoComplete="postal-code" maxLength={12} placeholder="例：123-4567"
        className="mt-1 w-full rounded border p-2" value={value}
        onChange={event => {
          const next = event.target.value;
          const code = driverPostalCodeSchema.safeParse(next);
          const formatted = code.success && code.data ? code.data : next;
          cancel(); setMessage(""); setFailed(false); onChange(formatted);
          if (code.success && code.data) timer.current = setTimeout(() => { void lookup(formatted); }, 400);
        }} />
    </label>
    <button type="button" className="mt-1 text-xs text-blue-700 underline" onClick={() => void lookup(value)}>住所を検索</button>
    {message && <p role={failed ? "alert" : "status"} className={`mt-1 text-xs ${failed ? "text-red-600" : "text-blue-700"}`}>{message}</p>}
  </div>;
}
