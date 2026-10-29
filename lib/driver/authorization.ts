import "server-only";
import { jsonResponse } from "@/lib/api-response";
import { isDriverPwaEnabled } from "@/lib/driver/test-runtime";
import { createClient } from "@/lib/supabase/server";

export async function requireDriver() {
  if (!isDriverPwaEnabled()) {
    return { response: jsonResponse({ error: "運転士功能尚未开放。" }, { status: 404 }) };
  }
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError && authError.name !== "AuthSessionMissingError") {
    console.error("Driver session verification failed.", { code: authError.code });
    return { response: jsonResponse({ error: "无法核验登录状態。" }, { status: 503 }) };
  }
  if (!user) return { response: jsonResponse({ error: "请先登录。" }, { status: 401 }) };
  const { data, error } = await supabase.rpc("driver_identity");
  if (error || !data || data.length > 1) {
    console.error("Driver identity verification failed.", { code: error?.code });
    return { response: jsonResponse({ error: "无法核验運転士身份。" }, { status: 503 }) };
  }
  if (data.length !== 1) {
    return { response: jsonResponse({ error: "運転士身份未启用或已撤销，请联系管理员。" }, { status: 403 }) };
  }
  return { response: null, supabase, identity: data[0] };
}
