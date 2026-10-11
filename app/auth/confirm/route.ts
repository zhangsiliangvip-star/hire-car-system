import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function redirectWithoutCaching(url: URL) {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

const otpTypes = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function getSafeNextPath(value: string | null, origin: string) {
  if (!value) return "/";
  const destination = new URL(value, origin);
  return destination.origin === origin
    ? `${destination.pathname}${destination.search}${destination.hash}`
    : "/";
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const nextPath = getSafeNextPath(searchParams.get("next"), request.nextUrl.origin);
  const supabase = await createClient();
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("Failed to exchange Supabase auth code.", error);
      return redirectWithoutCaching(
        new URL("/login?error=auth_callback_failed", request.url),
      );
    }
  } else if (tokenHash && type && otpTypes.has(type as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (error) {
      console.error("Failed to verify Supabase email token.", error);
      return redirectWithoutCaching(
        new URL("/login?error=auth_callback_failed", request.url),
      );
    }
  } else {
    return redirectWithoutCaching(
      new URL("/login?error=auth_callback_failed", request.url),
    );
  }

  return redirectWithoutCaching(new URL(nextPath, request.url));
}
