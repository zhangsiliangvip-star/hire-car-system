"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";
import { sessionCookieName, type AuthScope } from "@/lib/supabase/session";

const clients: Partial<Record<AuthScope, SupabaseClient<Database>>> = {};

export function createClient(scope: AuthScope = "staff") {
  const browser = typeof window !== "undefined";
  const existing = browser ? clients[scope] : undefined;
  if (existing) return existing;
  const { url, publishableKey } = getSupabaseConfig();
  const client = createBrowserClient<Database>(url, publishableKey, {
    isSingleton: false,
    cookieOptions: { name: sessionCookieName(url, scope) },
    ...(scope === "driver" ? { auth: { persistSession: true, autoRefreshToken: browser } } : {}),
  });
  if (browser) clients[scope] = client;
  return client;
}
