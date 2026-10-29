"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import DriverNavigation from "@/app/driver/navigation";
import { createClient } from "@/lib/supabase/browser";
import { driverProfileSchema, driverProfileCommandSchema } from "@/lib/driver/profile";
import type { z } from "zod";

type Profile = z.infer<typeof driverProfileSchema>;
export default function DriverProfile() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saved, setSaved] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const lock = useRef(false);
  const dirty = JSON.stringify(profile) !== JSON.stringify(saved);
  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    async function load() {
      try {
        const response = await fetch("/api/driver/profile", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { router.replace("/driver/login"); return; }
        const result = await response.json();
        if (controller.signal.aborted || current !== generation.current) return;
        if (!response.ok) throw new Error(result.error || "資料读取失败。");
        const data = driverProfileSchema.parse(result); setProfile(data); setSaved(data);
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("Driver profile load failed.", cause);
        setError(cause instanceof Error ? cause.message : "資料读取失败。");
      }
    }
    function clear() { ++generation.current; controller.abort(); setProfile(null); setSaved(null); setBusy(false); setError(""); lock.current = false; }
    function hide() { if (document.visibilityState === "hidden") clear(); else setRevision(value => value + 1); }
    const { data: subscription } = createClient().auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") { clear(); router.replace("/driver/login"); }
    });
    document.addEventListener("visibilitychange", hide);
    void load();
    return () => { generation.current = current + 1; controller.abort(); subscription.subscription.unsubscribe(); document.removeEventListener("visibilitychange", hide); };
  }, [revision, router]);
  function canLeave() { return !dirty || window.confirm("离开会放弃尚未保存的个人資料，是否继续？"); }
  async function submit(action: "save" | "skip") {
    if (lock.current || !profile) return;
    if (action === "skip" && !canLeave()) return;
    const parsed = driverProfileCommandSchema.safeParse(action === "skip" ? { action, expectedVersion: profile.version }
      : { action, expectedVersion: profile.version, phone: profile.phone, wechat: profile.wechat, whatsapp: profile.whatsapp, licenseExpiry: profile.licenseExpiry });
    if (!parsed.success) { setError("请检查联系方式及免許日期，所有项目均可留空。"); return; }
    const current = generation.current;
    lock.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/driver/profile", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) throw new Error(result.error || "資料未保存。");
      const data = driverProfileSchema.parse(result); setProfile(data); setSaved(data);
      router.replace("/driver");
    } catch (cause) {
      if (current !== generation.current) return;
      console.error("Driver profile submit failed.", cause);
      setError(cause instanceof Error ? cause.message : "資料未保存。");
    } finally { if (current === generation.current) { lock.current = false; setBusy(false); } }
  }
  return <main className="driver-main">
    <DriverNavigation busy={busy} canLeave={canLeave} />
    <h1>个人資料</h1>
    <p className="driver-muted">欢迎使用運転士端。以下项目均可不填，也可先跳过，之后从行程页“个人資料”补填。保存后同步到后台運転士记录。切后台会清除未保存内容。</p>
    {error && <p className="driver-error" role="alert">{error}<button className="driver-link" disabled={busy} onClick={() => {
      if (!canLeave()) return;
      setProfile(null); setSaved(null); setError(""); setRevision(value => value + 1);
    }}>重新读取</button></p>}
    {!profile ? !error && <p className="driver-empty">正在读取个人資料…</p> : <form onSubmit={event => { event.preventDefault(); void submit("save"); }}>
      {([["phone", "携帯番号"], ["wechat", "微信号"], ["whatsapp", "WhatsApp"], ["licenseExpiry", "免許有効期限"]] as const).map(([field, label]) =>
        <label className="driver-field" key={field}>{label}（可选）<input type={field === "licenseExpiry" ? "date" : field === "phone" ? "tel" : "text"}
          value={profile[field]} maxLength={field === "phone" ? 100 : 200} disabled={busy}
          onChange={event => setProfile(current => current ? { ...current, [field]: event.target.value } : current)} /></label>)}
      <button className="driver-button" disabled={busy}>{busy ? "正在处理…" : "保存并进入行程"}</button>
      <button className="driver-link" type="button" disabled={busy} onClick={() => void submit("skip")}>暂時跳过，进入行程</button>
    </form>}
  </main>;
}
