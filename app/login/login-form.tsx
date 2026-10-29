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
        console.error("Sign-in rejected.", { code: error.code, status: error.status });
        if (error.code === "invalid_credentials") {
          setErrorMessage("登录邮箱或密码不正确。请确认使用的是本地开発环境的密码；如忘记密码，请点击下方“忘记密码？”。");
        } else if (error.code === "email_not_confirmed") {
          setErrorMessage("邮箱尚未验证，请先完成邀请邮件中的验证。");
        } else if (error.status === 429) {
          setErrorMessage("登录请求过于频繁，请稍后再试。");
        } else if (!error.status || error.status >= 500) {
          setErrorMessage("暂時无法连接登录服务，请检查网络或稍后重试。");
        } else {
          setErrorMessage(`登录服务拒绝了请求（${error.code ?? error.status}），请联系管理员核查。`);
        }
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
    <main className="auth-screen login-screen flex min-h-dvh items-center justify-center px-4 py-8 text-slate-900 sm:px-8">
      <div className="w-full min-w-0 max-w-[960px]">
        <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-xl shadow-slate-900/5 lg:grid lg:grid-cols-2">
          <section className="login-brand relative flex flex-col justify-between overflow-hidden px-6 py-7 text-white sm:px-10 sm:py-10 lg:p-12">
            <div className="relative z-10">
              <div className="mb-5 flex items-center gap-3 lg:mb-16">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/20 bg-white/10" aria-hidden="true">
                  <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m5 10 2-5h10l2 5M4 10h16v8H4zM7 18v2m10-2v2M7 13h2m6 0h2M4 10l-2-1m18 1 2-1" />
                  </svg>
                </span>
                <span className="text-xs font-semibold tracking-[0.22em] text-slate-300">DISPATCH WORKSPACE</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">ハイヤー配車管理</h1>
              <p className="mt-3 text-sm leading-7 text-slate-300">让每一次出行，都井然有序。</p>
            </div>
            <div className="relative z-10 mt-12 hidden border-t border-white/15 pt-6 lg:block">
              <p className="text-xs tracking-widest text-slate-400">東京 · 大阪 · 北海道</p>
              <p className="mt-3 text-sm leading-7 text-slate-300">预约排車、财务核算与业务协作，<br />在一个清晰的工作台中完成。</p>
            </div>
          </section>
          <form onSubmit={signIn} aria-label="账号登录" aria-busy={isSubmitting}
            className="min-w-0 px-6 py-8 sm:px-10 sm:py-10 lg:p-12">
        <p className="text-xs font-semibold tracking-[0.18em] text-blue-700">WELCOME BACK</p>
        <h2 className="mt-3 text-2xl font-bold tracking-tight">欢迎登录</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">请使用管理员创建的邮箱账号和密码，进入工作台。</p>
        <label className="mt-8 block text-sm font-medium text-slate-700">
          邮箱
          <input
            required
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="请输入登录邮箱"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 min-h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base placeholder:text-slate-400 focus:border-blue-500 focus:bg-white"
          />
        </label>
        <label className="mt-5 block text-sm font-medium text-slate-700">
          密码
          <input
            required
            type="password"
            autoComplete="current-password"
            placeholder="请输入密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 min-h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-base placeholder:text-slate-400 focus:border-blue-500 focus:bg-white"
          />
        </label>
        {errorMessage && <p role="alert" className="mt-4 break-words rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">{errorMessage}</p>}
        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-7 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-blue-700 px-4 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-blue-800 disabled:cursor-wait disabled:opacity-60"
        >
          {isSubmitting ? "正在登录…" : "登录"}
          {!isSubmitting && <span aria-hidden="true">→</span>}
        </button>
        <a href="/forgot-password" className="mt-3 flex min-h-11 items-center justify-center text-sm text-slate-500 hover:text-blue-700 hover:underline">
          忘记密码？
        </a>
          </form>
        </div>
        <p className="mt-6 text-center text-xs leading-6 text-slate-500">内部业务管理系统 · 仅限授权人员使用</p>
      </div>
    </main>
  );
}
