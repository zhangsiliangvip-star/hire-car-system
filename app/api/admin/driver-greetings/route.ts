import { z } from "zod";
import { jsonResponse } from "@/lib/api-response";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";

const sloganSchema = z.object({ slogan: z.string().max(100) }).strict();

async function authorize() {
  const { supabase, profile } = await getAuthenticatedProfile();
  if (!profile) return { response: jsonResponse({ error: "仅后台工作人员可管理司机标语。" }, { status: 403 }) };
  return { response: null, supabase, profile };
}

export async function GET() {
  try {
    const identity = await authorize();
    if (identity.response) return identity.response;
    const { data, error } = await identity.supabase.rpc("driver_portal_greetings");
    if (error) throw error;
    if (typeof data !== "object" || data === null || Array.isArray(data) ||
      !("globalSlogan" in data) || typeof data.globalSlogan !== "string") {
      throw new Error("Driver greeting response is invalid.");
    }
    return jsonResponse({ slogan: data.globalSlogan });
  } catch (error) {
    console.error("Driver global slogan read failed.", { name: error instanceof Error ? error.name : "DatabaseError" });
    return jsonResponse({ error: "无法读取全体标语，请刷新重试。" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const identity = await authorize();
    if (identity.response) return identity.response;
    if (identity.profile.role !== "admin")
      return jsonResponse({ error: "仅管理员可以修改全体标语。" }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return jsonResponse({ error: "请使用JSON提交。" }, { status: 415 });
    let body: unknown;
    try { body = await request.json(); } catch { return jsonResponse({ error: "JSON无效。" }, { status: 400 }); }
    const parsed = sloganSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "全体标语最多100字。" }, { status: 400 });
    const { data, error } = await identity.supabase.rpc("admin_update_driver_global_slogan", {
      target_slogan: parsed.data.slogan.trim(),
    });
    if (error) {
      console.error("Driver global slogan update rejected.", { code: error.code });
      return jsonResponse({ error: error.code === "42501" ? "仅管理员可以修改全体标语。" : "全体标语保存失败，请重试。" },
        { status: error.code === "42501" ? 403 : 503 });
    }
    if (typeof data !== "string") throw new Error("Driver slogan update response is invalid.");
    return jsonResponse({ slogan: data });
  } catch (error) {
    console.error("Driver global slogan update failed.", { name: error instanceof Error ? error.name : "UnknownError" });
    return jsonResponse({ error: "全体标语保存未获确认，请检查后重试。" }, { status: 503 });
  }
}
