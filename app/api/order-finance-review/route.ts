import { z } from "zod";
import { jsonResponse } from "@/lib/api-response";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import { isDriverPwaEnabled } from "@/lib/driver/test-runtime";
import { orderReviewRowSchema } from "@/lib/driver/order-review";

export async function GET(request: Request) {
  try {
    if (!isDriverPwaEnabled()) return jsonResponse({ enabled: false, rows: [] });
    const { supabase, profile } = await getAuthenticatedProfile();
    if (profile?.role !== "admin") return jsonResponse({ error: "需要后台管理员。" }, { status: 403 });
    const params = new URL(request.url).searchParams;
    const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).safeParse(params.get("month"));
    if (!month.success || params.getAll("month").length !== 1 || [...params.keys()].some(key => key !== "month"))
      return jsonResponse({ error: "月份无效。" }, { status: 400 });
    const { data, error } = await supabase.rpc("admin_order_finance_pending", { target_month: month.data });
    if (error) {
      console.error("Order finance pending read rejected.", { code: error.code });
      return jsonResponse({ error: "无法读取訂単待审核申報，請刷新重试。" }, { status: 503 });
    }
    return jsonResponse({ enabled: true, rows: z.array(orderReviewRowSchema).parse(data) });
  } catch (error) {
    console.error("Order finance pending read failed.", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse({ error: "无法读取訂単待审核申報，請重试。" }, { status: 503 });
  }
}
