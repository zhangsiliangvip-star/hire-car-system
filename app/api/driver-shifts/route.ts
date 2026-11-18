import { z } from "zod";
import { jsonResponse } from "@/lib/api-response";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import { isDriverActionOrigin } from "@/lib/driver/assignment-action";
import { shiftDataSchema, shiftMonthSchema, shiftSubmissionSchema } from "@/lib/driver/shifts";

const querySchema = z.object({ driverId: z.uuid(), month: shiftMonthSchema }).strict();
const submissionSchema = z.object({ driverId: z.uuid(), shift: shiftSubmissionSchema }).strict();

function databaseError(error: { code?: string }) {
  const conflict = error.code === "40001";
  const migration = error.code === "PGRST202" || error.code === "42883";
  return jsonResponse({ error: conflict ? "休息日期已被更新，請刷新核对后重新保存。"
    : migration ? "后台休息日功能尚未完成数据库迁移（20261124000000），請联系管理员。"
    : "休息日期操作失败，請核对权限后重试。" },
  { status: conflict ? 409 : error.code === "42501" ? 403 : error.code === "22023" ? 422 : 503 });
}

export async function GET(request: Request) {
  try {
    const { supabase, profile } = await getAuthenticatedProfile();
    if (!profile) return jsonResponse({ error: "需要后台账号。" }, { status: 403 });
    const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return jsonResponse({ error: "請选择有效運転士及月份。" }, { status: 400 });
    const { data, error } = await supabase.rpc("staff_driver_monthly_shift", {
      target_driver: query.data.driverId, target_month: query.data.month,
    });
    if (error) {
      console.error("Staff shift read rejected.", { code: error.code });
      return databaseError(error);
    }
    return jsonResponse(shiftDataSchema.parse(data));
  } catch (error) {
    console.error("Staff shift read failed.", error);
    return jsonResponse({ error: "休息日期读取失败，請重试。" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, profile } = await getAuthenticatedProfile();
    if (!profile) return jsonResponse({ error: "需要后台账号。" }, { status: 403 });
    if (!isDriverActionOrigin(request))
      return jsonResponse({ error: "請求来源无效。" }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return jsonResponse({ error: "請使用JSON提交。" }, { status: 415 });
    const text = await request.text();
    if (text.length > 8192) return jsonResponse({ error: "請求过大。" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return jsonResponse({ error: "JSON无效。" }, { status: 400 }); }
    const parsed = submissionSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "請检查運転士、月份、休息日期及备注。" }, { status: 400 });
    const { driverId, shift } = parsed.data;
    const { data, error } = await supabase.rpc("staff_submit_driver_monthly_shift", {
      target_driver: driverId, target_month: shift.month, expected_version: shift.expectedVersion,
      target_request: shift.requestId, rest_dates: shift.dates, note: shift.note,
    });
    if (error) {
      console.error("Staff shift submission rejected.", { code: error.code });
      return databaseError(error);
    }
    return jsonResponse(shiftDataSchema.parse(data));
  } catch (error) {
    console.error("Staff shift submission failed.", error);
    return jsonResponse({ error: "休息日期保存未获确认，請刷新核对后重试。" }, { status: 503 });
  }
}
