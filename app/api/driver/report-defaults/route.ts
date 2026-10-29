import { z } from "zod";
import { jsonResponse } from "@/lib/api-response";
import { requireDriver } from "@/lib/driver/authorization";
import { reportDefaultsSchema } from "@/lib/driver/reports";

export async function GET(request: Request) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    const params = new URL(request.url).searchParams;
    const date = z.iso.date().safeParse(params.get("date"));
    if (!date.success || [...params.keys()].some(key => key !== "date") || params.getAll("date").length !== 1)
      return jsonResponse({ error: "请选择有效的日报日期。" }, { status: 400 });
    const { data, error } = await identity.supabase.rpc("driver_report_defaults", { target_date: date.data });
    if (error) {
      console.error("Driver report defaults rejected.", { code: error.code });
      return jsonResponse({ error: "无法读取当天訂単和车库，请重试。" }, { status: 503 });
    }
    return jsonResponse(reportDefaultsSchema.parse(data));
  } catch (error) {
    console.error("Driver report defaults failed.", error);
    return jsonResponse({ error: "无法读取日报默认信息，请重试。" }, { status: 500 });
  }
}
