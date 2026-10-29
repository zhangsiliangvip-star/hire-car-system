import { jsonResponse } from "@/lib/api-response";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import { isDriverPwaEnabled, isDriverPwaTestMode } from "@/lib/driver/test-runtime";
import { isDriverActionOrigin } from "@/lib/driver/assignment-action";
import { shiftStatusQuerySchema, shiftStatusSchema } from "@/lib/driver/shifts";

export async function POST(request: Request) {
  try {
    if (!isDriverPwaEnabled()) return jsonResponse({ enabled: false, days: [] });
    const { supabase, profile } = await getAuthenticatedProfile();
    if (!profile) return jsonResponse({ error: "需要后台账号。" }, { status: 403 });
    if (!isDriverActionOrigin(request, process.env.NODE_ENV === "development" && isDriverPwaTestMode()))
      return jsonResponse({ error: "请求来源无效。" }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return jsonResponse({ error: "请使用JSON提交。" }, { status: 415 });
    const text = await request.text();
    if (text.length > 65536) return jsonResponse({ error: "日期过多。" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return jsonResponse({ error: "JSON无效。" }, { status: 400 }); }
    const parsed = shiftStatusQuerySchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "行程日期无效。" }, { status: 400 });
    const { data, error } = await supabase.rpc("staff_driver_rest_days", { service_dates: parsed.data.dates });
    if (error) throw error;
    return jsonResponse(shiftStatusSchema.parse({ enabled: true, days: data }));
  } catch (error) {
    console.error("Driver rest indicator read failed.", error);
    return jsonResponse({ error: "休息提示读取失败，不能据此判断司机可出勤，请重试。" }, { status: 503 });
  }
}
