"use client";

import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function sendResetLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        { redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password` },
      );
      if (error) throw error;
      setMessage("若该邮箱对应有效账号，密码重设邮件将会発送至该邮箱。");
    } catch (error) {
      console.error("Failed to request a password reset.", error);
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
      if (code === "over_email_send_rate_limit") {
        setErrorMessage("重设邮件請求受到発送频率限制。请先检查收件箱和垃圾邮件，稍后再试，勿连续点击発送。");
      } else if (status === 429) {
        setErrorMessage("請求过于频繁，登录服务暂時限制発送。请稍后再试；如持续出現，请管理员检查邮件発送额度。");
      } else if (status === 500 || code === "unexpected_failure") {
        setErrorMessage("登录服务未能発送邮件，请管理员检查开発环境的邮件服务配置和认证日志。");
      } else {
        setErrorMessage("発送重设邮件失败，请检查网络或联系管理员核查登录服务。");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <form onSubmit={sendResetLink} className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">重设密码</h1>
        <p className="mt-1 text-sm text-gray-600">我们会向已注册的邮箱発送安全链接。</p>
        <label className="mt-6 block text-sm font-medium">
          邮箱
          <input
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded border p-2"
          />
        </label>
        {message && <p role="status" className="mt-3 text-sm text-emerald-700">{message}</p>}
        {errorMessage && <p role="alert" className="mt-3 text-sm text-rose-700">{errorMessage}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-5 w-full rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {isSubmitting ? "正在発送…" : "発送邮件"}
        </button>
        <a href="/login" className="mt-4 block text-center text-sm text-blue-700 hover:underline">
          返回登录
        </a>
      </form>
    </main>
  );
}
