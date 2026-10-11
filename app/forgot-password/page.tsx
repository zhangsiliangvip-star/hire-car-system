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
      setMessage("若该邮箱对应有效账号，密码重设邮件将会发送至该邮箱。");
    } catch (error) {
      console.error("Failed to request a password reset.", error);
      setErrorMessage("发送重设邮件失败，请检查邮箱或稍后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <form onSubmit={sendResetLink} className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">重设密码</h1>
        <p className="mt-1 text-sm text-gray-600">我们会向已邀请的邮箱发送安全链接。</p>
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
          {isSubmitting ? "正在发送…" : "发送邮件"}
        </button>
        <a href="/login" className="mt-4 block text-center text-sm text-blue-700 hover:underline">
          返回登录
        </a>
      </form>
    </main>
  );
}
