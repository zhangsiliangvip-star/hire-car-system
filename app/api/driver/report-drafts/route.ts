import { jsonResponse } from "@/lib/api-response";
import { requireDriver } from "@/lib/driver/authorization";
import { isDriverActionOrigin } from "@/lib/driver/assignment-action";
import { isDriverPwaTestMode } from "@/lib/driver/test-runtime";
import { reportCloudDraftSchema } from "@/lib/driver/report-draft";
import { z } from "zod";

export async function DELETE(request: Request) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some(key => key !== "date") || url.searchParams.getAll("date").length !== 1)
      return jsonResponse({ error: "請求参数无效。" }, { status: 400 });
    if (!isDriverActionOrigin(request, process.env.NODE_ENV === "development" && isDriverPwaTestMode()))
      return jsonResponse({ error: "請求来源无效。" }, { status: 403 });
    const serviceDate = z.iso.date().safeParse(url.searchParams.get("date"));
    if (!serviceDate.success) return jsonResponse({ error: "日報日期无效。" }, { status: 400 });
    const { error } = await identity.supabase.rpc("driver_report_draft_delete", {
      target_service_date: serviceDate.data,
    });
    if (error) {
      console.error("Driver report draft deletion rejected.", { code: error.code });
      return jsonResponse({ error: "无法删除线上草稿，請重试。" }, { status: error.code === "42501" ? 403 : 503 });
    }
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Driver report draft deletion failed.", error);
    return jsonResponse({ error: "无法删除线上草稿，請重试。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    if (new URL(request.url).search) return jsonResponse({ error: "不支持该查询参数。" }, { status: 400 });
    if (!isDriverActionOrigin(request, process.env.NODE_ENV === "development" && isDriverPwaTestMode()))
      return jsonResponse({ error: "請求来源无效。" }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
      return jsonResponse({ error: "請使用JSON提交。" }, { status: 415 });
    const text = await request.text();
    if (text.length > 131072) return jsonResponse({ error: "請求过大。" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return jsonResponse({ error: "JSON格式无效。" }, { status: 400 }); }
    const parsed = reportCloudDraftSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "日报草稿内容无效，請刷新后重试。" }, { status: 400 });
    const draft = parsed.data;
    const { data, error } = await identity.supabase.rpc("driver_report_draft_save", {
      target_service_date: draft.serviceDate,
      target_report: draft.reportId,
      target_version: draft.version,
      target_assignment: draft.assignment,
      target_fields: draft.fields,
      target_stop_ids: draft.stopIds,
    });
    if (error) {
      console.error("Driver report draft save rejected.", { code: error.code });
      const status = error.code === "42501" ? 403 : error.code === "40001" ? 409 :
        ["22023", "22P02", "23514"].includes(error.code ?? "") ? 422 : 503;
      return jsonResponse({ error: status === 409 ? "日报状态已变化，請刷新后核对。" :
        status === 422 ? "日报草稿内容无效，請检查后重试。" : "日报草稿保存失败，請重试。" }, { status });
    }
    return jsonResponse({ draft: reportCloudDraftSchema.parse(data) });
  } catch (error) {
    console.error("Driver report draft save failed.", error);
    return jsonResponse({ error: "无法保存日报草稿，請刷新后重试。" }, { status: 500 });
  }
}
