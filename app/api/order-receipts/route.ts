import { z } from "zod";
import { jsonResponse } from "@/lib/api-response";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import { isDriverPwaEnabled, isDriverPwaTestMode } from "@/lib/driver/test-runtime";
import { isDriverActionOrigin } from "@/lib/driver/assignment-action";
import { advanceDeleteSchema, advanceSwitchSchema, orderAdvanceSchema, orderReceiptQuerySchema, orderReceiptSchema } from "@/lib/driver/order-receipts";

export async function GET(request: Request) {
  try {
    if (!isDriverPwaEnabled()) return jsonResponse({ enabled: false, receipts: [] });
    const { supabase, profile } = await getAuthenticatedProfile();
    if (!profile) return jsonResponse({ error: "需要后台账号。" }, { status: 403 });
    const params = new URL(request.url).searchParams;
    const parsed = orderReceiptQuerySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success || [...params.keys()].some(key => params.getAll(key).length !== 1))
      return jsonResponse({ error: "訂単或日期无效。" }, { status: 400 });
    const { data, error } = await supabase.rpc("staff_order_receipts", {
      target_order: parsed.data.orderId, target_date: parsed.data.date,
    });
    if (error) {
      console.error("Order receipts read rejected.", { code: error.code });
      return jsonResponse({ error: "无法读取该訂単已批准的小票。" }, { status: error.code === "42501" ? 403 : 503 });
    }
    const rows = z.array(orderReceiptSchema).parse(data);
    const receipts = [];
    for (const bucket of ["driver-finance-receipts", "driver-fuel-receipts"] as const) {
      const items = rows.filter(row => row.bucket === bucket);
      if (!items.length) continue;
      const paths = [...new Set(items.map(item => item.path))];
      const signed = await supabase.storage.from(bucket).createSignedUrls(paths, 300);
      if (signed.error || !signed.data) throw new Error("Receipt signing failed.");
      const urls = new Map(signed.data.map(item => [item.path, item]));
      for (const item of items) {
        const signedItem = urls.get(item.path);
        if (!signedItem || signedItem.error || !signedItem.signedUrl) throw new Error("Receipt unavailable.");
        receipts.push({ ...item, url: z.url().parse(signedItem.signedUrl) });
      }
    }
    const advances = await supabase.rpc("staff_order_advances", {
      target_order: parsed.data.orderId, target_date: parsed.data.date,
    });
    if (advances.error) throw advances.error;
    return jsonResponse({ enabled: true, receipts, advances: z.array(orderAdvanceSchema).parse(advances.data) });
  } catch (error) {
    console.error("Order receipts read failed.", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse({ error: "小票读取失败，請重试。" }, { status: 503 });
  }

}

export async function POST(request: Request) {
    try {
      if (!isDriverPwaEnabled()) return jsonResponse({ error: "功能未开放。" }, { status: 404 });
      const { supabase, profile } = await getAuthenticatedProfile();
      if (!profile) return jsonResponse({ error: "需要后台账号。" }, { status: 403 });
      if (!isDriverActionOrigin(request, process.env.NODE_ENV === "development" && isDriverPwaTestMode()))
        return jsonResponse({ error: "請求来源无效。" }, { status: 403 });
      if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
        return jsonResponse({ error: "請使用JSON提交。" }, { status: 415 });
      const text = await request.text();
      if (text.length > 4096) return jsonResponse({ error: "請求过大。" }, { status: 413 });
      let body: unknown;
      try { body = JSON.parse(text); } catch { return jsonResponse({ error: "JSON无效。" }, { status: 400 }); }
      const parsed = z.union([advanceSwitchSchema, advanceDeleteSchema]).safeParse(body);
      if (!parsed.success) return jsonResponse({ error: "立替切换内容无效。" }, { status: 400 });
      const value = parsed.data;
      const deleting = "action" in value;
      const result = deleting ? await supabase.rpc("staff_delete_advance_item", {
        target_order: value.orderId, target_date: value.date, target_claim: value.claimId,
        expected_version: value.expectedVersion, target_expense: value.expenseId,
      }) : await supabase.rpc("staff_switch_advance_item", {
        target_order: value.orderId, target_date: value.date, target_claim: value.claimId,
        expected_version: value.expectedVersion, target_category: value.category,
        target_expense: value.expenseId ?? null,
      });
      if (result.error) {
        console.error("Staff advance switch rejected.", { code: result.error.code });
        return jsonResponse({ error: deleting ? "削除未完成：申報、订单或已入账金额已变化。請刷新核对。" : "切换未完成：申報或已入账金额已变化、目标类别待审核，或超出明细/金额限制。請刷新核对。" },
          { status: result.error.code === "42501" ? 403 : result.error.code === "40001" ? 409 :
            result.error.code === "22023" ? 400 : 503 });
      }
      return jsonResponse(deleting ? z.object({ deleted: z.literal(true) }).strict().parse(result.data) :
        z.object({ switched: z.literal(true) }).strict().parse(result.data));
    } catch (cause) {
      console.error("Staff advance switch failed.", cause);
      return jsonResponse({ error: "立替操作结果未能确认，請刷新核对，勿重复操作。" }, { status: 503 });
  }
}
