"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    if (password !== confirmPassword) {
      setErrorMessage("两次输入的密码不一致。");
      return;
    }
    if (password.length < 8) {
      setErrorMessage("密码至少需要 8 个字符。");
      return;
    }

    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      router.replace("/");
    } catch (error) {
      console.error("Failed to update the user's password.", error);
      setErrorMessage("密码更新失败，请重新打开邮件中的链接后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <form onSubmit={updatePassword} className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">设置新密码</h1>
        <label className="mt-6 block text-sm font-medium">
          新密码
          <input
            required
            minLength={8}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded border p-2"
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          确认新密码
          <input
            required
            minLength={8}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className="mt-1 w-full rounded border p-2"
          />
        </label>
        {errorMessage && <p role="alert" className="mt-3 text-sm text-rose-700">{errorMessage}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-5 w-full rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {isSubmitting ? "正在保存…" : "保存密码"}
        </button>
      </form>
    </main>
  );
}
