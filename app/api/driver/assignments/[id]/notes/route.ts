import { jsonResponse } from "@/lib/api-response";
import { requireDriver } from "@/lib/driver/authorization";
import { isDriverActionOrigin } from "@/lib/driver/assignment-action";
import { assignmentIdSchema, driverNotesSchema } from "@/lib/driver/orders";
import { isDriverPwaTestMode } from "@/lib/driver/test-runtime";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    if (!isDriverActionOrigin(request, process.env.NODE_ENV === "development" && isDriverPwaTestMode()))
      return jsonResponse({ error: "請求来源无效。" }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
      return jsonResponse({ error: "请使用JSON提交。" }, { status: 415 });
    const { id } = await context.params;
    if (!assignmentIdSchema.safeParse(id).success)
      return jsonResponse({ error: "行程不存在或已撤派。" }, { status: 404 });
    const text = await request.text();
    if (text.length > 100_000) return jsonResponse({ error: "備考内容过长。" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); } catch {
      return jsonResponse({ error: "JSON无效。" }, { status: 400 });
    }
    const parsed = driverNotesSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "備考最多5000字，请检查后重试。" }, { status: 400 });
    const { data, error } = await identity.supabase.rpc("update_driver_order_notes", {
      target_assignment: id, expected_notes: parsed.data.expectedNotes, target_notes: parsed.data.notes,
    });
    if (error) {
      console.error("Driver order notes update rejected.", { code: error.code });
      const status = error.code === "40001" ? 409 : error.code === "42501" ? 403 :
        error.code === "P0002" ? 404 : error.code === "22023" ? 422 : 503;
      return jsonResponse({ error: status === 409
        ? "備考已被修改。输入已保留，请取消编辑，核对最新備考后重新填写。"
        : status === 404 || status === 403 ? "行程已撤派或无权修改備考。" : "備考未保存，请重试。" }, { status });
    }
    if (typeof data !== "string" || data !== parsed.data.notes)
      throw new Error("Unexpected saved driver notes.");
    return jsonResponse({ notes: data });
  } catch (error) {
    console.error("Driver order notes update failed.", error);
    return jsonResponse({ error: "備考保存未获确认，请重试或联系调度。" }, { status: 503 });
  }
}
