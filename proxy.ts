import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";
import { isDriverPath, isDriverPwaEnabled } from "@/lib/driver/test-runtime";

export async function proxy(request: NextRequest) {
  if (process.env.NODE_ENV === "development" && request.nextUrl.pathname === "/_next/hmr") {
    return NextResponse.next();
  }
  const { url, publishableKey } = getSupabaseConfig();
  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([name, value]) =>
          response.headers.set(name, value),
        );
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();
  if (error && error.name !== "AuthSessionMissingError") throw error;

  const pathname = request.nextUrl.pathname;
  const isPublicRoute =
    pathname === "/login" ||
    pathname === "/forgot-password" ||
    pathname.startsWith("/auth/confirm") ||
    (pathname === "/driver/login" && isDriverPwaEnabled());

  if (data?.claims?.sub && (pathname === "/login" || (pathname === "/driver/login" && isDriverPwaEnabled()))) {
    const target = await signedInDestination(pathname);
    if (target) {
      const redirect = NextResponse.redirect(new URL(target, request.url));
      response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
      redirect.headers.set("Cache-Control", "private, no-store, max-age=0");
      return redirect;
    }
  }

  // Skips the login form for an existing session; any failed role check falls back to showing the form.
  async function signedInDestination(loginPath: string) {
    if (!isDriverPwaEnabled()) return safeNextPath(request.nextUrl.searchParams.get("next"));
    if (loginPath === "/login") {
      const { data: isStaff, error: staffError } = await supabase.rpc("is_staff");
      if (!staffError && isStaff === true) return safeNextPath(request.nextUrl.searchParams.get("next"));
    }
    const { data: driver, error: driverError } = await supabase.rpc("driver_identity");
    return !driverError && driver?.length === 1 ? "/driver" : null;
  }

  if (!data?.claims?.sub && !isPublicRoute) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "请先登录。" },
        {
          status: 401,
          headers: { "Cache-Control": "private, no-store, max-age=0" },
        },
      );
    }
    const loginUrl = new URL(
      isDriverPath(pathname) && isDriverPwaEnabled() ? "/driver/login" : "/login",
      request.url,
    );
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
  }

  if (
    data?.claims?.sub &&
    isDriverPwaEnabled() &&
    !isPublicRoute &&
    !isDriverPath(pathname)
  ) {
    const { data: isStaff, error: staffError } = await supabase.rpc("is_staff");
    if (staffError) {
      console.error("Failed to verify test staff access.", { code: staffError.code });
      return NextResponse.json(
        { error: "无法核验账号权限，请稍后重试。" },
        { status: 503, headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" } },
      );
    }
    if (isStaff !== true) {
      return NextResponse.json(
        { error: "当前账号无权访问后台，请使用司机专属入口。" },
        { status: 403, headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" } },
      );
    }
  }

  return response;
}

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  const origin = "http://localhost";
  const destination = new URL(value, origin);
  if (destination.origin !== origin || destination.pathname === "/login" || destination.pathname === "/driver/login") return "/";
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
