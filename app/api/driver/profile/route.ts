import { jsonResponse } from "@/lib/api-response";
import { requireDriver } from "@/lib/driver/authorization";
import { isDriverActionOrigin } from "@/lib/driver/assignment-action";
import { isDriverPwaTestMode } from "@/lib/driver/test-runtime";
import { driverProfileCommandSchema, driverProfileSchema } from "@/lib/driver/profile";

export async function GET() {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    const { data, error } = await identity.supabase.rpc("driver_own_profile");
    if (error) throw error;
    return jsonResponse(driverProfileSchema.parse(data));
  } catch (error) {
    console.error("Driver profile read failed.", error);
    return jsonResponse({ error: "无法读取本人资料，请重试。" }, { status: 503 });
  }
}
export async function POST(request: Request) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    if (!isDriverActionOrigin(request, process.env.NODE_ENV === "development" && isDriverPwaTestMode()))
      return jsonResponse({ error: "请求来源无效。" }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return jsonResponse({ error: "请使用JSON提交。" }, { status: 415 });
    const text = await request.text();
    if (text.length > 8192) return jsonResponse({ error: "资料过长。" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return jsonResponse({ error: "JSON无效。" }, { status: 400 }); }
    const parsed = driverProfileCommandSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "请检查联系方式及免許日期，所有项目均可留空。" }, { status: 400 });
    const item = parsed.data;
    const { data, error } = await identity.supabase.rpc("update_driver_own_profile", {
      expected_version: item.expectedVersion, action: item.action,
      contacts: item.action === "skip" ? {} : { phone: item.phone, wechat: item.wechat, whatsapp: item.whatsapp, licenseExpiry: item.licenseExpiry },
    });
    if (error) {
      console.error("Driver profile update rejected.", { code: error.code });
      return jsonResponse({ error: error.code === "40001" ? "资料已变化，请刷新后核对再保存。" : "资料未保存，请重试。" },
        { status: error.code === "40001" ? 409 : error.code === "42501" ? 403 : 503 });
    }
    return jsonResponse(driverProfileSchema.parse(data));
  } catch (error) {
    console.error("Driver profile update failed.", error);
    return jsonResponse({ error: "资料保存失败。" }, { status: 503 });
  }
}
