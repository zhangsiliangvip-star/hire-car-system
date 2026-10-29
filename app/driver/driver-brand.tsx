"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function DriverBrand() {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { error: signOutError } = await createClient().auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;
      location.replace("/driver/login");
    } catch (cause) {
      console.error("Driver logout failed.", cause);
      setError("退出失败，请重试，勿将设备交给他人。");
      setBusy(false);
    }
  }

  return <header className="driver-brand">
    <span className="driver-brand-title">GO RIDE <span>司机端</span></span>
    {pathname !== "/driver/login" && <div className="driver-brand-actions">
      <Link className="driver-header-button" href="/driver/profile">个人資料</Link>
      <button className="driver-header-button" type="button" disabled={busy} onClick={() => void logout()}>
        {busy ? "退出中…" : "退出登录"}
      </button>
    </div>}
    {error && <p className="driver-brand-error" role="alert">{error}</p>}
  </header>;
}
