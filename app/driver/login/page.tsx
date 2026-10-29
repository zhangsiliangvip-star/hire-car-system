"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { driverProfileSchema } from "@/lib/driver/profile";

export default function DriverLogin() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: String(form.get("email")).trim().toLowerCase(),
        password: String(form.get("password")),
      });
      if (authError) {
        console.error("Driver sign-in rejected.", { code: authError.code });
        setError(authError.status === 429 ? "登录过于频繁，請稍后重试。" :
          authError.code === "invalid_credentials" ? "邮箱或密码不正确，請使用管理员绑定的運転士账号。" :
          "无法登录，請检查网络、邮箱验证状態或联系管理员。");
        return;
      }
      const response = await fetch("/api/driver/me", { cache: "no-store" });
      if (!response.ok) {
        const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
        if (signOutError) throw signOutError;
        setError("账号未启用为運転士、已挂起或暂時无法验证，請联系管理员。");
        return;
      }
      const profileResponse = await fetch("/api/driver/profile", { cache: "no-store" });
      if (!profileResponse.ok) throw new Error("无法核验首次登录資料状態。");
      const profile = driverProfileSchema.parse(await profileResponse.json());
      router.replace(profile.prompted ? "/driver" : "/driver/profile");
    } catch (cause) {
      console.error("Driver login failed.", cause);
      setError("无法连接登录服务，請检查网络后重试。");
    } finally { setBusy(false); }
  }
  return <main className="driver-main">
    <p className="driver-muted">一路从容，专注每一程。</p>
    <h1>運転士登录</h1>
    <p className="driver-muted">請使用管理员绑定的運転士账号。<br />運転士账号和后台工作人员账号不可混用。</p>
    <form onSubmit={login} aria-busy={busy}>
      <label className="driver-field">登录邮箱<input name="email" type="email" autoComplete="username" autoCapitalize="none" required /></label>
      <label className="driver-field">密码<input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="driver-error" role="alert">{error}</p>}
      <button className="driver-button" disabled={busy}>{busy ? "正在核验…" : "登录運転士端"}</button>
    </form>
    <p className="driver-muted" style={{ marginTop: 24 }}>支持联网查看本人派单、确认接单和记录执行进度，不提供离线写入或定位。</p>
  </main>;
}
