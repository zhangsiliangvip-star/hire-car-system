import { z } from "zod";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import { jsonResponse } from "@/lib/api-response";
import { auditTableNames } from "@/lib/audit";

const filtersSchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  table: z.enum(auditTableNames).optional(),
  action: z.enum(["INSERT", "UPDATE", "DELETE"]).optional(),
  actor: z.string().trim().min(1).max(200).optional(),
  region: z.string().uuid().optional(),
  record: z.string().uuid().optional(),
  start: z.iso.date().optional(),
  end: z.iso.date().optional(),
}).strict().refine((value) => !value.start || !value.end || value.start <= value.end, {
  message: "开始日期不能晚于结束日期。",
});

export async function GET(request: Request) {
  try {
    const { supabase, profile } = await getAuthenticatedProfile();
    if (!profile) return jsonResponse({ error: "请先登录。" }, { status: 401 });
    if (profile.role !== "admin") {
      return jsonResponse({ error: "仅管理员可以查看操作记录。" }, { status: 403 });
    }
    const parsed = filtersSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return jsonResponse({ error: "操作记录筛选条件无效，请检查日期或页码。" }, { status: 400 });
    }
    const filters = parsed.data;
    let query = supabase.from("audit_logs").select("*")
      .order("occurred_at", { ascending: false }).order("id", { ascending: false });
    if (filters.table) query = query.eq("table_name", filters.table);
    if (filters.action) query = query.eq("action", filters.action);
    if (filters.region) query = query.eq("region_id", filters.region);
    if (filters.record) query = query.eq("record_id", filters.record);
    if (filters.actor) {
      query = query.ilike("actor_name", `%${filters.actor.replace(/[\\%_]/g, "\\$&")}%`);
    }
    if (filters.start) query = query.gte("occurred_at", `${filters.start}T00:00:00+09:00`);
    if (filters.end) query = query.lte("occurred_at", `${filters.end}T23:59:59.999999+09:00`);
    const offset = (filters.page - 1) * 50;
    const { data, error } = await query.range(offset, offset + 50);
    if (error) throw error;
    return jsonResponse({
      logs: (data ?? []).slice(0, 50), hasNext: (data?.length ?? 0) > 50, page: filters.page,
    });
  } catch (error) {
    console.error("Failed to load audit history.", error);
    return jsonResponse({ error: "无法读取操作记录，请检查网络及操作留痕数据库迁移。" }, { status: 500 });
  }
}
