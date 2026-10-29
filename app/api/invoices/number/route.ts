import { z } from "zod";
import { jsonResponse } from "@/lib/api-response";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";

const schema = z.object({
  orderId: z.string().uuid(),
  companyId: z.string().uuid(),
}).strict();

export async function POST(request: Request) {
  try {
    const { supabase, user, profile } = await getAuthenticatedProfile();
    if (!user || !profile) return jsonResponse({ error: "請先登录。" }, { status: 401 });
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "請求内容不是有效的 JSON。" }, { status: 400 });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "訂単或会社编号格式不正确。" }, { status: 400 });
    const { data, error } = await supabase.rpc("allocate_invoice_number", {
      p_order_id: parsed.data.orderId,
      p_company_id: parsed.data.companyId,
    });
    if (error) {
      console.error("Failed to allocate invoice number:", error);
      return jsonResponse({ error: `請求書编号分配失败：${error.message}` }, {
        status: error.code === "42501" ? 403 : error.code === "22023" ? 409 : 500,
      });
    }
    if (typeof data !== "string" || !/^INV-\d{6,}$/.test(data)) {
      throw new Error("数据库返回的請求書编号格式不正确。");
    }
    return jsonResponse({ number: data });
  } catch (error) {
    console.error("Invoice number request failed:", error);
    return jsonResponse({ error: "請求書编号分配失败，請刷新后重试。" }, { status: 500 });
  }
}
