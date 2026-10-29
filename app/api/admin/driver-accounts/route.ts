import { z } from "zod";
import { jsonResponse } from "@/lib/api-response";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import { isDriverPwaEnabled, isDriverPwaTestMode } from "@/lib/driver/test-runtime";
import { isDriverActionOrigin } from "@/lib/driver/assignment-action";
import { driverAccountCreateSchema, driverLoginDataSchema, driverPasswordSchema } from "@/lib/driver/profile";

const targetSchema = z.object({
  driverId: z.uuid(), name: z.string(), regionId: z.uuid(),
  userId: z.uuid().nullable(), status: z.enum(["active", "suspended", "revoked"]).nullable(),
  version: z.number().int().positive().nullable(),
}).strict();
async function authorize() {
  if (!isDriverPwaEnabled()) return { response: jsonResponse({ error: "運転士账号管理尚未开放。" }, { status: 404 }) };
  const identity = await getAuthenticatedProfile();
  if (!identity.profile) return { response: jsonResponse({ error: "仅后台工作人员可管理運転士登录。" }, { status: 403 }) };
  return { response: null, supabase: identity.supabase, profile: identity.profile };
}
export async function GET() {
  try {
    if (!isDriverPwaEnabled()) return jsonResponse({
      enabled: false, canManage: false, isAdmin: false, manageableRegionId: null, accounts: [],
    });
    const identity = await authorize();
    if (identity.response) return identity.response;
    const { data, error } = await identity.supabase.rpc("admin_driver_logins");
    if (error) throw error;
    return jsonResponse(driverLoginDataSchema.parse({
      enabled: true, canManage: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      isAdmin: identity.profile.role === "admin", manageableRegionId: identity.profile.regionId,
      accounts: data,
    }));
  } catch (error) {
    console.error("Driver logins read failed.", { name: error instanceof Error ? error.name : "DatabaseError" });
    return jsonResponse({ error: "无法读取運転士登录信息。" }, { status: 503 });
  }
}
async function write(request: Request, creating: boolean) {
  try {
    const identity = await authorize();
    if (identity.response) return identity.response;
    if (!isDriverActionOrigin(request, process.env.NODE_ENV === "development" && isDriverPwaTestMode()))
      return jsonResponse({ error: "請求来源无效。" }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return jsonResponse({ error: "请使用JSON提交。" }, { status: 415 });
    const text = await request.text();
    if (text.length > 4096) return jsonResponse({ error: "請求过大。" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return jsonResponse({ error: "JSON无效。" }, { status: 400 }); }
    const parsed = (creating ? driverAccountCreateSchema : driverPasswordSchema).safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "请检查運転士、邮箱及密码（8至128字符）。" }, { status: 400 });
    const item = parsed.data;
    const target = await identity.supabase.rpc("admin_driver_login_target", { target_driver: item.driverId });
    if (target.error) {
      console.error("Driver login target rejected.", { code: target.error.code });
      return jsonResponse({ error: "運転士不存在或无权管理。" }, { status: target.error.code === "42501" ? 403 : 404 });
    }
    const driver = targetSchema.parse(target.data);
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY)
      return jsonResponse({ error: "未配置当前环境的服务端账号管理密钥，尚未创建或修改任何登录账号。" }, { status: 503 });
    const admin = createAdminClient();
    if (!creating && "userId" in item) {
      if (driver.userId !== item.userId || driver.version !== item.expectedVersion || driver.status === "revoked")
        return jsonResponse({ error: "運転士绑定已变化或已撤销，请刷新核对。" }, { status: 409 });
      const { error } = await admin.auth.admin.updateUserById(item.userId, { password: item.password });
      if (error) {
        console.error("Driver password reset failed.", { code: error.code, status: error.status });
        return jsonResponse({ error: error.code === "weak_password" ? "密码强度不足，请使用更强的密码。" : "密码重置未获确认，请检查认证服务后重试。" }, { status: error.status === 429 ? 429 : 503 });
      }
      return jsonResponse({ ok: true });
    }
    if (!("email" in item)) return jsonResponse({ error: "创建内容无效。" }, { status: 400 });
    if (driver.userId) return jsonResponse({ error: "该運転士已有登录账号，请刷新后使用重置密码。" }, { status: 409 });
    const { data, error } = await admin.auth.admin.createUser({
      email: item.email, password: item.password, email_confirm: true,
      user_metadata: { full_name: driver.name, region_id: driver.regionId },
    });
    if (error || !data.user) {
      console.error("Driver auth creation failed.", { code: error?.code, status: error?.status });
      return jsonResponse({ error: ["email_exists", "user_already_exists"].includes(error?.code || "")
        ? "该邮箱已存在，未绑定也未修改原账号；请使用独立運転士邮箱。"
        : error?.code === "weak_password" ? "密码强度不足，请使用更强的密码。" : "運転士认证账号创建未获确认，请先核对认证记录，勿连续重复新增。" },
        { status: ["email_exists", "user_already_exists"].includes(error?.code || "") ? 409 : error?.status === 429 ? 429 : 503 });
    }
    const binding = await identity.supabase.rpc("bind_driver_identity", { target_user: data.user.id, target_driver: driver.driverId });
    if (binding.error) {
      console.error("Driver account created but binding failed.", { code: binding.error.code, userId: data.user.id });
      return jsonResponse({ error: `认证账号已创建但運転士绑定未完成，账号暂不可用于運転士端。请勿重复新增；管理员需核对并完成绑定（用户ID：${data.user.id}）。` }, { status: 503 });
    }
    return jsonResponse({ ok: true }, { status: 201 });
  } catch (error) {
    // Never log a request or authentication error object that could contain a password.
    console.error("Driver account action failed.", { name: error instanceof Error ? error.name : "UnknownError" });
    return jsonResponse({ error: "账号操作未获确认，请核对后重试。" }, { status: 503 });
  }
}
export function POST(request: Request) { return write(request, true); }
export function PUT(request: Request) { return write(request, false); }
