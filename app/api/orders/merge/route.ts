import { z } from "zod";
import { jsonResponse } from "@/lib/api-response";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import { isDriverActionOrigin } from "@/lib/driver/assignment-action";

const operation = z.object({
  actorId: z.uuid().nullable(), actorName: z.string().max(500), at: z.string().max(100),
}).strict().nullable();
const command = z.object({
  targetId: z.uuid(), sourceId: z.uuid(),
  targetVersion: operation, sourceVersion: operation,
}).strict().refine(value => value.targetId !== value.sourceId);

export async function POST(request: Request) {
  try {
    const { supabase, profile } = await getAuthenticatedProfile();
    if (!profile) return jsonResponse({ error: "请先登录后台。" }, { status: 401 });
    if (!isDriverActionOrigin(request, false))
      return jsonResponse({ error: "请求来源无效。" }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return jsonResponse({ error: "请使用JSON提交。" }, { status: 415 });
    const text = await request.text();
    if (text.length > 8192) return jsonResponse({ error: "请求过大。" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); }
    catch { return jsonResponse({ error: "JSON无效。" }, { status: 400 }); }
    const parsed = command.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "合并参数无效，请重新选择订单。" }, { status: 400 });
    const item = parsed.data;
    const { data, error } = await supabase.rpc("merge_split_orders", {
      target_order: item.targetId, source_order: item.sourceId,
      target_version: item.targetVersion, source_version: item.sourceVersion,
    });
    if (error) {
      console.error("Order merge rejected.", { code: error.code });
      if (error.code === "PGRST202")
        return jsonResponse({ error: "数据库尚未应用订单合并迁移，请先执行 20261123000000_merge_split_orders.sql。" }, { status: 503 });
      if (error.code === "42501") return jsonResponse({ error: "无权合并这些订单。" }, { status: 403 });
      if (["22023", "40001", "P0002", "23505"].includes(error.code))
        return jsonResponse({ error: "订单已变化、日期不相邻、信息或财务冲突，或已生成請求書编号。请刷新后核对，未合并任何订单。" }, { status: 409 });
      return jsonResponse({ error: "合并未获确认，请刷新核对后重试。" }, { status: 503 });
    }
    if (data !== item.targetId) {
      console.error("Order merge returned an unexpected identifier.");
      return jsonResponse({ error: "合并结果未获确认，请重新载入核对订单，勿重复提交。" }, { status: 503 });
    }
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Order merge failed.", { name: error instanceof Error ? error.name : "UnknownError" });
    return jsonResponse({ error: "合并结果未获确认，请重新载入核对订单。" }, { status: 503 });
  }
}
