import { z } from "zod";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AccountProfile } from "@/lib/domain";
import { jsonResponse } from "@/lib/api-response";
import { readAllPages } from "@/lib/supabase/pagination";
import { verifyDeletePassword } from "@/lib/delete-password";

const inviteSchema = z.object({
  email: z.email().max(320),
  fullName: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  position: z.string().trim().min(1).max(200),
  role: z.enum(["admin", "user"]),
}).strict();

const updateSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  position: z.string().trim().min(1).max(200),
  role: z.enum(["admin", "user"]),
}).strict();

const deleteSchema = z.object({
  userId: z.string().uuid(),
  deletePassword: z.string().max(1024),
}).strict();

function toAccountProfile(row: {
  id: string;
  email: string;
  full_name: string;
  company: string;
  position: string;
  role: AccountProfile["role"];
  email_confirmed: boolean;
}): AccountProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    company: row.company,
    position: row.position,
    role: row.role,
    emailConfirmed: row.email_confirmed,
  };
}

async function requireAdmin() {
  const identity = await getAuthenticatedProfile();
  if (!identity.profile) {
    return { identity, response: jsonResponse({ error: "请先登录。" }, { status: 401 }) };
  }
  if (identity.profile.role !== "admin") {
    return { identity, response: jsonResponse({ error: "仅管理员可以管理账号。" }, { status: 403 }) };
  }
  return { identity, response: null };
}

export async function GET() {
  try {
    const { identity, response } = await requireAdmin();
    if (response) return response;

    const data = await readAllPages((from, to) =>
      identity.supabase
        .from("profiles")
        .select("id, email, full_name, company, position, role, email_confirmed")
        .order("created_at")
        .order("id")
        .range(from, to),
    );

    return jsonResponse(data.map(toAccountProfile));
  } catch (error) {
    console.error("Failed to list user accounts.", error);
    return jsonResponse({ error: "无法读取账号列表。" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { response } = await requireAdmin();
    if (response) return response;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
    }
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: "请填写有效的邮箱、姓名、所属会社、职位和角色。" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(
      parsed.data.email.trim().toLowerCase(),
      {
        data: {
          full_name: parsed.data.fullName,
          company: parsed.data.company,
          position: parsed.data.position,
        },
        redirectTo: new URL("/auth/confirm?next=/reset-password", request.url).toString(),
      },
    );

    if (error || !data.user) {
      console.error("Failed to invite user.", error);
      return jsonResponse(
        { error: "无法发送邀请，请确认邮箱未注册并检查 Supabase 邮件配置。" },
        { status: 400 },
      );
    }

    const { error: profileError } = await admin
      .from("profiles")
      .update({ role: parsed.data.role })
      .eq("id", data.user.id);
    if (profileError) throw profileError;

    return jsonResponse({ ok: true, userId: data.user.id }, { status: 201 });
  } catch (error) {
    console.error("Failed to create user invitation.", error);
    return jsonResponse({ error: "发送邀请失败，请稍后重试。" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const { identity, response } = await requireAdmin();
    if (response) return response;
    if (!identity.profile) {
      return jsonResponse({ error: "请先登录。" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
    }
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: "提交的账号资料不完整。" }, { status: 400 });
    }
    if (parsed.data.userId === identity.profile.id && parsed.data.role !== "admin") {
      return jsonResponse({ error: "不能移除当前登录账号的管理员权限。" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .update({
        full_name: parsed.data.fullName,
        company: parsed.data.company,
        position: parsed.data.position,
        role: parsed.data.role,
      })
      .eq("id", parsed.data.userId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return jsonResponse({ error: "该账号不存在或已删除。" }, { status: 404 });
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Failed to update user profile.", error);
    return jsonResponse({ error: "保存账号资料失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { identity, response } = await requireAdmin();
    if (response) return response;
    if (!identity.profile) {
      return jsonResponse({ error: "请先登录。" }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
    }
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: "提交的账号编号无效。" }, { status: 400 });
    }
    const passwordCheck = verifyDeletePassword(parsed.data.deletePassword);
    if (!passwordCheck.configured) {
      return jsonResponse({ error: "服务器尚未配置删除专用密码。" }, { status: 503 });
    }
    if (!passwordCheck.valid) {
      return jsonResponse({ error: "删除专用密码错误，请检查后重试。" }, { status: 403 });
    }
    if (parsed.data.userId === identity.profile.id) {
      return jsonResponse({ error: "不能删除当前登录的管理员账号。" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", parsed.data.userId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) {
      return jsonResponse({ error: "该账号不存在或已删除。" }, { status: 404 });
    }

    if (target.role === "admin") {
      const { count, error: countError } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");
      if (countError) throw countError;
      if ((count ?? 0) <= 1) {
        return jsonResponse({ error: "不能删除系统中的最后一个管理员。" }, { status: 400 });
      }
    }

    const { error } = await admin.auth.admin.deleteUser(parsed.data.userId);
    if (error) throw error;
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Failed to delete user account.", error);
    return jsonResponse({ error: "删除账号失败。" }, { status: 500 });
  }
}
