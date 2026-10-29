import { jsonResponse } from "@/lib/api-response";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import { isDriverPwaEnabled } from "@/lib/driver/test-runtime";
import { japanDate } from "@/lib/driver/orders";
import { executionStatusDataSchema } from "@/lib/driver/execution-status";

export async function GET(request: Request) {
  try {
    const date = japanDate();
    if (!isDriverPwaEnabled()) return jsonResponse({ enabled: false, date, rows: [] });
    const { supabase, profile } = await getAuthenticatedProfile();
    if (!profile) return jsonResponse({ error: "需要后台账号。" }, { status: 403 });
    if (new URL(request.url).search) return jsonResponse({ error: "不支持该查询参数。" }, { status: 400 });
    const { data, error } = await supabase.rpc("staff_driver_execution_status");
    if (error) {
      console.error("Driver execution status rejected.", { code: error.code });
      return jsonResponse({ error: "運転士状態读取失败，请重试。" }, { status: 503 });
    }
    return jsonResponse(executionStatusDataSchema.parse({ enabled: true, ...executionStatusDataSchema.omit({ enabled: true }).parse(data) }));
  } catch (error) {
    console.error("Driver execution status failed.", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse({ error: "運転士状態读取失败，请重试。" }, { status: 503 });
  }
}
