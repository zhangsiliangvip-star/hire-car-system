import { z } from "zod";
import { jsonResponse } from "@/lib/api-response";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import { isDriverPwaEnabled, isDriverPwaTestMode } from "@/lib/driver/test-runtime";
import { isDriverActionOrigin } from "@/lib/driver/assignment-action";
import { financeClaimSchema, financeReviewSchema } from "@/lib/driver/finance";
import { fuelClaimSchema, fuelReviewSchema, fuelReviewRowSchema } from "@/lib/driver/fuel";

export async function GET(request: Request) {
  try {
    if (!isDriverPwaEnabled()) return jsonResponse({ error: "测试功能未开放。" }, { status: 404 });
    const { supabase, profile } = await getAuthenticatedProfile();
    if (profile?.role !== "admin") return jsonResponse({ error: "需要后台管理员。" }, { status: 403 });
    const query = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict()
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return jsonResponse({ error: "月份无效。" }, { status: 400 });
    const { data, error } = await supabase.rpc("admin_driver_finance", { target_month: query.data.month });
    if (error) throw error;
    const rows = z.array(z.object({ driverName: z.string(), date: z.iso.date(), pickup: z.string(),
      destination: z.string(), claim: financeClaimSchema }).strict()).parse(data);
    const fuel = await supabase.rpc("admin_driver_daily_fuel", { target_month: query.data.month });
    if (fuel.error) throw fuel.error;
    return jsonResponse({ rows, fuelRows: z.array(fuelReviewRowSchema).parse(fuel.data) });
  } catch (error) {
    console.error("Driver finance review read failed.", error);
    return jsonResponse({ error: "无法读取待审财务。" }, { status: 503 });
  }
}
export async function POST(request: Request) {
  try {
    if (!isDriverPwaEnabled()) return jsonResponse({ error: "测试功能未开放。" }, { status: 404 });
    const { supabase, profile } = await getAuthenticatedProfile();
    if (profile?.role !== "admin") return jsonResponse({ error: "需要后台管理员。" }, { status: 403 });
    if (!isDriverActionOrigin(request, process.env.NODE_ENV === "development" && isDriverPwaTestMode()))
      return jsonResponse({ error: "請求来源无效。" }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return jsonResponse({ error: "请使用JSON提交。" }, { status: 415 });
    const text = await request.text();
    if (text.length > 4096) return jsonResponse({ error: "請求过大。" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return jsonResponse({ error: "JSON无效。" }, { status: 400 }); }
    if (typeof body === "object" && body !== null && "fuelId" in body) {
      const fuel = fuelReviewSchema.safeParse(body);
      if (!fuel.success) return jsonResponse({ error: "燃油費审核无效，退回時请填写原因。" }, { status: 400 });
      const { fuelId, expectedVersion, decision, note } = fuel.data;
      const { data, error } = await supabase.rpc("review_driver_daily_fuel", {
        target_fuel: fuelId, expected_version: expectedVersion, decision, note,
      });
      if (error) {
        console.error("Daily fuel review rejected.", { code: error.code });
        return jsonResponse({ error: "燃油費审核未完成，訂単燃油費或申報状態可能已变化，请刷新核对或退回重提。" },
          { status: error.code === "40001" ? 409 : error.code === "42501" ? 403 : 503 });
      }
      return jsonResponse({ fuelClaim: fuelClaimSchema.parse(data) });
    }
    const parsed = financeReviewSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "审核内容无效，退回時请填写原因。" }, { status: 400 });
    const { assignmentId, category, expectedVersion, decision, note } = parsed.data;
    const { data, error } = await supabase.rpc("review_driver_finance", {
      target_assignment: assignmentId, expected_version: expectedVersion, decision, note,
      target_category: category,
    });
    if (error) {
      console.error("Driver finance review rejected.", { code: error.code });
      return jsonResponse({ error: "审核未完成：訂単、運転士或财务已变化，或申報已处理。请刷新；财务冲突请退回后重新申報。" }, { status: 409 });
    }
    return jsonResponse({ claim: financeClaimSchema.parse(data) });
  } catch (error) {
    console.error("Driver finance review failed.", error);
    return jsonResponse({ error: "无法确认财务，请刷新核对。" }, { status: 503 });
  }
}
