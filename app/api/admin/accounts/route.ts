import { z } from "zod";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AccountProfile } from "@/lib/domain";
import { jsonResponse } from "@/lib/api-response";
import { readAllPages } from "@/lib/supabase/pagination";
import { verifyDeletePassword } from "@/lib/delete-password";
import { isDriverPwaEnabled } from "@/lib/driver/test-runtime";

const createSchema = z.object({
  email: z.email().max(320),
  fullName: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  position: z.string().trim().min(1).max(200),
  regionId: z.string().uuid(),
  role: z.enum(["admin", "user"]),
  password: z.string().min(8).max(128),
}).strict();

const passwordSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(8).max(128),
}).strict();

const updateSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(200),
  company: z.string().trim().min(1).max(200),
  position: z.string().trim().min(1).max(200),
  regionId: z.string().uuid(),
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
  region_id: string;
  role: AccountProfile["role"];
  email_confirmed: boolean;
}): AccountProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    company: row.company,
    position: row.position,
    regionId: row.region_id,
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
        .select("id, email, full_name, company, position, region_id, role, email_confirmed")
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
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: "请填写有效的账号資料；设置密码時需为 8 至 128 个字符。" }, { status: 400 });
    }

    const admin = createAdminClient();
    const metadata = {
      full_name: parsed.data.fullName,
      company: parsed.data.company,
      position: parsed.data.position,
      region_id: parsed.data.regionId,
    };
    const { data, error } = await admin.auth.admin.createUser({
          email: parsed.data.email.trim().toLowerCase(),
          password: parsed.data.password,
          email_confirm: true,
          user_metadata: metadata,
        });

    if (error || !data.user) {
      console.error("Failed to create account.", { code: error?.code, status: error?.status });
      if (error?.code === "weak_password") {
        return jsonResponse({ error: "密码不符合认证服务的强度要求，请使用更强的密码。" }, { status: 400 });
      }
      if (error?.status === 429 || error?.code === "over_request_rate_limit") {
        return jsonResponse(
          { error: "账号创建请求过于频繁，请勿连续重试，稍后再试。" },
          { status: 429 },
        );
      }
      if (error?.code === "email_exists" || error?.code === "user_already_exists") {
        return jsonResponse(
          { error: "该邮箱已注册，请在账号列表中编辑该用户并设置密码，不要重复新增。" },
          { status: 409 },
        );
      }
      if (error?.message.includes("Database error saving new user")) {
        return jsonResponse(
          { error: "认证服务保存新用户時発生数据库错误。请管理员检查 Supabase 的 Auth／Postgres 日志、用户資料触発器及数据库迁移。" },
          { status: 500 },
        );
      }
      return jsonResponse(
        { error: "无法创建账号，请管理员检查 Supabase 认证日志。" },
        { status: error?.status && error.status >= 500 ? 502 : 400 },
      );
    }

    const { data: savedProfile, error: profileError } = await admin
      .from("profiles")
      .update({
        role: parsed.data.role, region_id: parsed.data.regionId,
        ...(isDriverPwaEnabled() ? { account_type: "staff" as const } : {}),
      })
      .eq("id", data.user.id)
      .select("id")
      .maybeSingle();
    if (profileError || !savedProfile) {
      console.error("Account created but profile setup failed.", { code: profileError?.code });
      return jsonResponse(
        { error: "认证账号已创建，但用户資料配置失败。请勿重复新增；修复 profiles 权限或触発器后，在账号列表核对地域和角色。", userId: data.user.id },
        { status: 500 },
      );
    }

    return jsonResponse({ ok: true, userId: data.user.id }, { status: 201 });
  } catch (error) {
    console.error("Failed to create account.", { name: error instanceof Error ? error.name : "UnknownError" });
    return jsonResponse({ error: "创建账号请求未完成，请先核对账号列表再重试。" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const { response } = await requireAdmin();
    if (response) return response;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
    }
    const parsed = passwordSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: "请提供有效的用户编号及 8 至 128 个字符的新密码。" }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data: target, error: targetError } = await admin
      .from("profiles").select("role").eq("id", parsed.data.userId).maybeSingle();
    if (targetError) {
      console.error("Failed to read password reset target profile.", { code: targetError.code });
      return jsonResponse(
        { error: targetError.code === "42501"
          ? "设置密码未执行：服务端没有 profiles 表的读取权限（42501）。请在 Supabase SQL Editor 应用 20261029000000_account_profile_service_permissions.sql 后重试。"
          : "设置密码未执行：无法读取目标用户資料，请管理员检查数据库日志。" },
        { status: 500 },
      );
    }
    if (!target) return jsonResponse({ error: "该账号不存在或已删除。" }, { status: 404 });
    const { error } = await admin.auth.admin.updateUserById(parsed.data.userId, {
      password: parsed.data.password,
      email_confirm: true,
    });
    if (error) {
      console.error("Failed to set user password.", { code: error.code, status: error.status });
      return jsonResponse(
        { error: error.code === "weak_password"
          ? "密码不符合认证服务的强度要求，请使用更强的密码。"
          : "设置密码失败，请检查认证服务日志；如用户已被删除，请刷新账号列表。" },
        { status: error.status && error.status >= 500 ? 502 : 400 },
      );
    }
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("Failed to set user password.", { name: error instanceof Error ? error.name : "UnknownError" });
    return jsonResponse({ error: "设置密码失败，请检查账号資料权限及认证服务。" }, { status: 500 });
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
      return jsonResponse({ error: "提交的账号資料不完整。" }, { status: 400 });
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
        region_id: parsed.data.regionId,
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
    return jsonResponse({ error: "保存账号資料失败。" }, { status: 500 });
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
