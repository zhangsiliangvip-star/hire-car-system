import { z } from "zod";
import { jsonResponse } from "@/lib/api-response";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import { isDriverPwaEnabled } from "@/lib/driver/test-runtime";
import { orderReceiptQuerySchema, orderReceiptSchema } from "@/lib/driver/order-receipts";

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
    return jsonResponse({ enabled: true, receipts });
  } catch (error) {
    console.error("Order receipts read failed.", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse({ error: "小票读取失败，请重试。" }, { status: 503 });
  }
}
