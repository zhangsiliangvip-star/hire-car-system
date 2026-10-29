import { jsonResponse } from "@/lib/api-response";
import { requireDriver } from "@/lib/driver/authorization";
import { isDriverActionOrigin } from "@/lib/driver/assignment-action";
import { isDriverPwaTestMode } from "@/lib/driver/test-runtime";
import { fuelClaimSchema, fuelSubmissionSchema } from "@/lib/driver/fuel";

export async function POST(request: Request) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    if (!isDriverActionOrigin(request, process.env.NODE_ENV === "development" && isDriverPwaTestMode()))
      return jsonResponse({ error: "請求来源无效。" }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
      return jsonResponse({ error: "请使用JSON提交。" }, { status: 415 });
    const text = await request.text();
    if (text.length > 4096) return jsonResponse({ error: "請求过大。" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return jsonResponse({ error: "JSON无效。" }, { status: 400 }); }
    const parsed = fuelSubmissionSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "请检查日期、关联訂単、燃油費和油票。" }, { status: 400 });
    const { date, assignmentId, expectedVersion, requestId, amount, receipts } = parsed.data;
    const { data, error } = await identity.supabase.rpc("submit_driver_daily_fuel", {
      target_date: date, expected_version: expectedVersion, target_request: requestId, amount, receipts,
      target_assignment: assignmentId,
    });
    if (error) {
      console.error("Driver daily fuel rejected.", { code: error.code });
      return jsonResponse({ error: "燃油費申報未确认：请核对当天行程、油票及申報状態，刷新后重试。" },
        { status: error.code === "40001" ? 409 : error.code === "42501" ? 403 : error.code === "22023" ? 422 : 503 });
    }
    return jsonResponse({ claim: fuelClaimSchema.parse(data) });
  } catch (error) {
    console.error("Driver daily fuel failed.", error);
    return jsonResponse({ error: "燃油費申報失败，请刷新核对。" }, { status: 500 });
  }
}
