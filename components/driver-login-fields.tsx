"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/browser";
import { driverLoginDataSchema } from "@/lib/driver/profile";
import type { z } from "zod";

type LoginData = z.infer<typeof driverLoginDataSchema>;
const LoginContext = createContext<{
  data: LoginData | null; error: string; reload: () => void;
}>({ data: null, error: "", reload() {} });
export function DriverLoginProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<LoginData | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/admin/driver-accounts", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(result.error || "登录信息读取失败。");
        setData(driverLoginDataSchema.parse(result)); setError("");
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("Driver account list failed.", cause);
        setError(cause instanceof Error ? cause.message : "登录信息读取失败。");
      }
    }
    function hide() { if (document.visibilityState === "hidden") { controller.abort(); setData(null); } else setRevision(value => value + 1); }
    const { data: subscription } = createClient().auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") { controller.abort(); setData(null); }
    });
    document.addEventListener("visibilitychange", hide);
    void load();
    return () => { controller.abort(); subscription.subscription.unsubscribe(); document.removeEventListener("visibilitychange", hide); };
  }, [revision]);
  return <LoginContext.Provider value={{ data, error, reload: () => setRevision(value => value + 1) }}>{children}</LoginContext.Provider>;
}
export function DriverLoginFields({ driverId, name, regionId }: { driverId: string; name: string; regionId?: string }) {
  const { data, error: loadError, reload } = useContext(LoginContext);
  const account = data?.accounts.find(item => item.driverId === driverId);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    function clear() { ++generation.current; setPassword(""); setVisible(false); setEmail(""); setNotice(""); setError(""); }
    function hide() { if (document.visibilityState === "hidden") clear(); }
    const { data: subscription } = createClient().auth.onAuthStateChange(event => { if (event === "SIGNED_OUT") clear(); });
    document.addEventListener("visibilitychange", hide);
    return () => { clear(); subscription.subscription.unsubscribe(); document.removeEventListener("visibilitychange", hide); };
  }, []);
  async function save() {
    if (lock.current) return;
    if (!window.confirm(account ? `重置${name}的登录密码？保存后无法查看原密码。` : `为${name}创建独立運転士登录账号？`)) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const current = generation.current;
    try {
      const response = await fetch("/api/admin/driver-accounts", { method: account ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(account
          ? { driverId, userId: account.userId, expectedVersion: account.version, password }
          : { driverId, email: email.trim().toLowerCase(), password }) });
      const result = await response.json();
      if (current !== generation.current) return;
      setPassword(""); setVisible(false);
      if (!response.ok) throw new Error(result.error || "账号操作未确认。");
      setNotice(account ? "密码已重置，請告知運転士。" : "账号已创建并绑定。"); reload();
    } catch (cause) {
      if (current !== generation.current) return;
      setPassword(""); setVisible(false);
      console.error("Driver login management failed.", { name: cause instanceof Error ? cause.name : "UnknownError" });
      setError(cause instanceof Error ? cause.message : "账号操作失败。");
    } finally { lock.current = false; setBusy(false); }
  }
  const canManageDriver = Boolean(data?.canManage && (data.isAdmin ||
    (regionId && data.manageableRegionId === regionId)));
  const disabled = busy || !canManageDriver || Boolean(loadError) || account?.status === "revoked";
  return <>
    <td data-label="登录邮箱" className="px-4 py-3">
      {!canManageDriver && !loadError && <p className="text-xs text-gray-500">仅管理员或本地域账号可管理</p>}
      {canManageDriver && account ? <><span>{account.email}</span><p className="text-xs text-gray-500">{account.status === "active" ? "已启用" : account.status === "suspended" ? "已暂停" : "已撤销"}</p></>
        : canManageDriver ? <input aria-label={`${name}登录邮箱`} type="email" autoComplete="off" disabled={disabled}
          className="h-10 w-full rounded-md border px-3 text-sm" value={email} onChange={event => setEmail(event.target.value)} placeholder="運転士登录邮箱" /> : null}
      {loadError && <p role="alert" className="text-xs text-red-600">{loadError}<button onClick={reload}>重试</button></p>}
      {data && !data.enabled && <p className="text-xs text-gray-500">運転士登录管理尚未开放</p>}
      {data?.enabled && !data.canManage && <p className="max-w-xs text-xs text-amber-700">尚未配置隔离库账号管理密钥，创建／重置暂不可用。</p>}
    </td>
    <td data-label="登录密码" className="px-4 py-3">
      {canManageDriver && <>
      <div className="driver-login-controls grid grid-cols-[minmax(0,1fr)_3rem_5rem] items-center gap-2">
        <input aria-label={`${name}${account ? "新密码" : "初始密码"}`} type={visible ? "text" : "password"}
          autoComplete="new-password" minLength={8} maxLength={128} disabled={disabled}
          className="h-10 w-full rounded-md border px-3 text-sm" value={password} onChange={event => setPassword(event.target.value)} placeholder={account ? "输入新密码" : "设置初始密码"} />
        <button type="button" disabled={disabled} aria-label={`${name}${visible ? "隐藏密码" : "显示密码"}`}
          onClick={() => setVisible(value => !value)} className="h-10 rounded-md border border-blue-200 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-40">{visible ? "隐藏" : "显示"}</button>
        <button type="button" disabled={disabled || password.length < 8 || (!account && !email.trim())}
          onClick={() => void save()} className="h-10 whitespace-nowrap rounded-md border border-blue-200 text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-40">{busy ? "处理中…" : account ? "重置密码" : "创建登录"}</button>
      </div>
      {error && <p role="alert" className="max-w-xs text-xs text-red-600">{error}</p>}
      {notice && <p role="status" className="text-xs text-green-700">{notice}</p>}
      </>}
    </td>
  </>;
}
