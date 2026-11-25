import { z } from "zod";
import { jsonResponse } from "@/lib/api-response";
import { requireDriver } from "@/lib/driver/authorization";
import { reportHistorySchema, reportSchema } from "@/lib/driver/reports";
import { shiftMonthSchema } from "@/lib/driver/shifts";

export async function GET(request: Request) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    const params = new URL(request.url).searchParams;
    const keys = [...params.keys()];
    if (keys.length !== 1) return jsonResponse({ error: "請選択有效月份或日報。" }, { status: 400 });
    if (keys[0] === "month") {
      const month = shiftMonthSchema.safeParse(params.get("month"));
      if (!month.success || month.data.startsWith("0000"))
        return jsonResponse({ error: "請選択有效月份。" }, { status: 400 });
      const { data, error } = await identity.supabase.rpc("driver_report_history", { target_month: month.data });
      if (error) {
        console.error("Driver report history read rejected.", { code: error.code });
        return jsonResponse({ error: "无法读取历史日報，請重试。" }, { status: 503 });
      }
      const reports = reportHistorySchema.parse(data);
      if (reports.some(report => !report.serviceDate.startsWith(`${month.data}-`)))
        throw new Error("Report history month mismatch.");
      return jsonResponse({ reports });
    }
    if (keys[0] === "reportId") {
      const reportId = z.uuid().safeParse(params.get("reportId"));
      if (!reportId.success) return jsonResponse({ error: "日報链接无效。" }, { status: 400 });
      const { data, error } = await identity.supabase.rpc("driver_report_detail", { target_report: reportId.data });
      if (error) {
        console.error("Driver report detail read rejected.", { code: error.code });
        return jsonResponse({ error: "无法读取历史日報，請重试。" }, { status: 503 });
      }
      if (data === null) return jsonResponse({ error: "日報不存在或无权查看。" }, { status: 404 });
      const report = reportSchema.parse(data);
      if (report.id !== reportId.data) throw new Error("Report identity mismatch.");
      return jsonResponse({ report });
    }
    return jsonResponse({ error: "請選択有效月份或日報。" }, { status: 400 });
  } catch (error) {
    console.error("Driver report history read failed.", error);
    return jsonResponse({ error: "无法读取历史日報。" }, { status: 500 });
  }
}
