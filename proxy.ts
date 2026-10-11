import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";

export async function proxy(request: NextRequest) {
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
    pathname.startsWith("/auth/confirm");

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
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "next",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
