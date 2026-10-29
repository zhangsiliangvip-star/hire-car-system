import { z } from "zod";
import { jsonResponse } from "@/lib/api-response";
import { requireDriver } from "@/lib/driver/authorization";
import { isDriverActionOrigin } from "@/lib/driver/assignment-action";
import { isDriverPwaTestMode } from "@/lib/driver/test-runtime";
import { shiftDataSchema, shiftMonthSchema, shiftSubmissionSchema } from "@/lib/driver/shifts";

export async function GET(request: Request) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    const query = z.object({ month: shiftMonthSchema }).strict()
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return jsonResponse({ error: "请選択有效月份。" }, { status: 400 });
    const { data, error } = await identity.supabase.rpc("driver_monthly_shift", { target_month: query.data.month });
    if (error) throw error;
    return jsonResponse(shiftDataSchema.parse(data));
  } catch (error) {
    console.error("Driver shift read failed.", error);
    return jsonResponse({ error: "休息日期读取失败，请重试。" }, { status: 503 });
  }
}
export async function POST(request: Request) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    if (!isDriverActionOrigin(request, process.env.NODE_ENV === "development" && isDriverPwaTestMode()))
      return jsonResponse({ error: "請求来源无效。" }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return jsonResponse({ error: "请使用JSON提交。" }, { status: 415 });
    const text = await request.text();
    if (text.length > 8192) return jsonResponse({ error: "請求过大。" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return jsonResponse({ error: "JSON无效。" }, { status: 400 }); }
    const parsed = shiftSubmissionSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "请检查本月休息日期及备注（最多1000字）。" }, { status: 400 });
    const item = parsed.data;
    const { data, error } = await identity.supabase.rpc("submit_driver_monthly_shift", {
      target_month: item.month, expected_version: item.expectedVersion, target_request: item.requestId,
      rest_dates: item.dates, note: item.note,
    });
    if (error) {
      console.error("Driver shift submission rejected.", { code: error.code });
      return jsonResponse({ error: error.code === "40001" ? "休息日期已被更新，请刷新核对后重新提交。" : "シフト提交失败，请核对后重试。" },
        { status: error.code === "40001" ? 409 : error.code === "42501" ? 403 : error.code === "22023" ? 422 : 503 });
    }
    return jsonResponse(shiftDataSchema.parse(data));
  } catch (error) {
    console.error("Driver shift submission failed.", error);
    return jsonResponse({ error: "シフト提交失败，请核对后重试。" }, { status: 503 });
  }
}
