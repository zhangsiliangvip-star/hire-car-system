import { jsonResponse } from "@/lib/api-response";
import { requireDriver } from "@/lib/driver/authorization";
import { isDriverActionOrigin } from "@/lib/driver/assignment-action";
import { isDriverPwaTestMode } from "@/lib/driver/test-runtime";
import { reportCommandSchema, reportDataSchema, reportSchema, reportTimeErrors } from "@/lib/driver/reports";

export async function GET(request: Request) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    if (new URL(request.url).search) return jsonResponse({ error: "不支持该查询参数。" }, { status: 400 });
    const { data, error } = await identity.supabase.rpc("driver_reports");
    if (error) {
      console.error("Driver reports read rejected.", { code: error.code });
      return jsonResponse({ error: "无法读取日報，請重试。" }, { status: 503 });
    }
    return jsonResponse(reportDataSchema.parse(data));
  } catch (error) {
    console.error("Driver reports read failed.", error);
    return jsonResponse({ error: "无法读取日報。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    if (new URL(request.url).search) return jsonResponse({ error: "不支持该查询参数。" }, { status: 400 });
    if (!isDriverActionOrigin(request, process.env.NODE_ENV === "development" && isDriverPwaTestMode())) {
      console.error("Driver report origin rejected.");
      return jsonResponse({ error: "請求来源无效。" }, { status: 403 });
    }
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      return jsonResponse({ error: "請使用JSON提交。" }, { status: 415 });
    }
    const text = await request.text();
    const limit = 131072;
    if (text.length > limit) return jsonResponse({ error: "請求过大。" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); } catch {
      return jsonResponse({ error: text.length > 4096 ? "請求过大。" : "JSON格式无效。" }, { status: text.length > 4096 ? 413 : 400 });
    }
    if (text.length > 4096 && (typeof body !== "object" || body === null || !("action" in body) || body.action !== "edit_stops"))
      return jsonResponse({ error: "請求过大。" }, { status: 413 });
    const parsed = reportCommandSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "請检查地点、公里表和日期時間。" }, { status: 400 });
    const { data, error } = await identity.supabase.rpc("driver_report_command", {
      target_report: parsed.data.reportId, expected_version: parsed.data.expectedVersion,
      target_request: parsed.data.requestId, target_action: parsed.data.action,
      payload: parsed.data.payload,
    });
    if (error) {
      console.error("Driver report command rejected.", { code: error.code, action: parsed.data.action });
      if (error.code && reportTimeErrors[error.code])
        return jsonResponse({ error: reportTimeErrors[error.code] }, { status: 422 });
      const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 :
        ["40001", "23505"].includes(error.code) ? 409 :
        ["22023", "22007", "22008", "22P02", "23514"].includes(error.code) ? 422 : 503;
      return jsonResponse({ error: status === 409 ? "日報已变化或操作重复，請刷新后核对。" :
        status === 422 && parsed.data.action === "remove_stop" ? "只能删除全空经由地；已有地点、公里数或時間的記録不能删除。" :
        status === 422 ? "記録顺序无效：請检查時間先后、公里表不能倒退，并在归库前填写完整所有经由地的到着、出発時間。" :
        status === 404 ? "日報或经由地不存在。" : "日報操作未获确认，請重试或联系管理员。" }, { status });
    }
    return jsonResponse({ report: reportSchema.parse(data) });
  } catch (error) {
    console.error("Driver report command failed.", error);
    return jsonResponse({ error: "无法保存日報，請刷新核对后重试。" }, { status: 500 });
  }
}
