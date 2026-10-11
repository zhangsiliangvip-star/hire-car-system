"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

export default function LoginForm({
  initialErrorMessage,
  nextPath,
}: {
  initialErrorMessage: string;
  nextPath: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) {
        setErrorMessage("邮箱或密码错误，或账号尚未激活。");
        return;
      }
      router.replace(nextPath);
    } catch (error) {
      console.error("Failed to sign in.", error);
      setErrorMessage(
        error instanceof Error ? error.message : "登录失败，请检查网络和 Supabase 配置。",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <form onSubmit={signIn} className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">ハイヤー配車管理</h1>
        <p className="mt-1 text-sm text-gray-600">请使用已邀请的邮箱账号登录。</p>
        <label className="mt-6 block text-sm font-medium">
          邮箱
          <input
            required
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded border p-2"
          />
        </label>
        <label className="mt-4 block text-sm font-medium">
          密码
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded border p-2"
          />
        </label>
        {errorMessage && <p role="alert" className="mt-3 text-sm text-rose-700">{errorMessage}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-5 w-full rounded bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
        >
          {isSubmitting ? "正在登录…" : "登录"}
        </button>
        <a href="/forgot-password" className="mt-4 block text-center text-sm text-blue-700 hover:underline">
          忘记密码？
        </a>
      </form>
    </main>
  );
}
