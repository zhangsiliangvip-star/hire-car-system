import { jsonResponse } from "@/lib/api-response";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import { isDriverPwaEnabled, isDriverPwaTestMode } from "@/lib/driver/test-runtime";
import { reportTimeErrors } from "@/lib/driver/reports";
import { isDriverActionOrigin } from "@/lib/driver/assignment-action";
import { operationCommandSchema, operationDataSchema, operationQuerySchema, operationResultSchema } from "@/lib/operations-reports";

export async function GET(request: Request) {
  try {
    if (!isDriverPwaEnabled()) return jsonResponse({ enabled: false, rows: [] });
    const { supabase, profile } = await getAuthenticatedProfile();
    if (!profile) return jsonResponse({ error: "需要后台账号。" }, { status: 403 });
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => params.getAll(key).length !== 1))
      return jsonResponse({ error: "筛选参数重复。" }, { status: 400 });
    const parsed = operationQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) return jsonResponse({ error: "请填写有效月份及地域。" }, { status: 400 });
    const { data, error } = await supabase.rpc("staff_operation_reports", {
      target_month: parsed.data.month, target_region: parsed.data.region ?? null,
    });
    if (error) {
      console.error("Operations report read rejected.", { code: error.code });
      return jsonResponse({ error: "无法读取运行日报，请刷新重试。" }, { status: error.code === "42501" ? 403 : 503 });
    }
    return jsonResponse(operationDataSchema.parse({ enabled: true, rows: data }));
  } catch (error) {
    console.error("Operations report read failed.", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse({ error: "运行日报读取失败。" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    if (!isDriverPwaEnabled()) return jsonResponse({ error: "运行日报尚未启用。" }, { status: 403 });
    const { supabase, profile } = await getAuthenticatedProfile();
    if (!profile) return jsonResponse({ error: "需要后台账号。" }, { status: 403 });
    if (new URL(request.url).search) return jsonResponse({ error: "不支持查询参数。" }, { status: 400 });
    if (!isDriverActionOrigin(request, process.env.NODE_ENV === "development" && isDriverPwaTestMode()))
      return jsonResponse({ error: "请求来源无效。" }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
      return jsonResponse({ error: "请使用JSON提交。" }, { status: 415 });
    const text = await request.text();
    if (text.length > 131072) return jsonResponse({ error: "请求过大。" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return jsonResponse({ error: "JSON格式无效。" }, { status: 400 }); }
    const parsed = operationCommandSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "请检查日期、点呼、地点、公里数和修改原因。" }, { status: 400 });
    const { data, error } = await supabase.rpc("staff_operation_report_command", { command: parsed.data });
    if (error) {
      console.error("Operations report command rejected.", { action: parsed.data.action, code: error.code });
      if (error.code && reportTimeErrors[error.code])
        return jsonResponse({ error: reportTimeErrors[error.code] }, { status: 422 });
      const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 :
        ["40001", "23505"].includes(error.code) ? 409 :
        ["22023", "22007", "22008", "22P02", "23514"].includes(error.code) ? 422 : 503;
      return jsonResponse({ error: status === 409 ? "日报已被司机或后台修改，请关闭后刷新核对。" :
        status === 404 ? "日报已不存在，请刷新列表。" :
        status === 422 ? "保存失败：请检查时间先后、公里数倒退及未完成的经由地／休息；允许提前填写，但顺序必须正确。" :
        "日报操作未获确认，请刷新核对后重试。" }, { status });
    }
    const result = operationResultSchema.parse(data);
    const expectedId = parsed.data.action === "edit" ? parsed.data.report.id : parsed.data.reportId;
    if (result.action !== parsed.data.action || (result.action === "edit" ? result.report.id : result.deletedId) !== expectedId)
      throw new Error("Unexpected operations result.");
    if (result.action === "edit" && parsed.data.action === "edit" && result.report.version <= parsed.data.report.version)
      throw new Error("Unexpected operations report version.");
    return jsonResponse(result);
  } catch (error) {
    console.error("Operations report write failed.", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse({ error: "操作结果未获确认，请刷新核对，勿直接重复提交。" }, { status: 503 });
  }
}
