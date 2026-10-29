import { z } from "zod";
import { jsonResponse } from "@/lib/api-response";
import { requireDriver } from "@/lib/driver/authorization";
import { shiftMonthSchema } from "@/lib/driver/shifts";
import { driverCalendarRange, driverCalendarSchema, projectDriverCalendarRow } from "@/lib/driver/calendar";

export async function GET(request: Request) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    const query = z.object({ month: shiftMonthSchema }).strict()
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return jsonResponse({ error: "请选择有效月份。" }, { status: 400 });
    const range = driverCalendarRange(query.data.month);
    const { data, error } = await identity.supabase.rpc("driver_calendar", { range_start: range.start, range_end: range.end });
    if (error || !data) {
      console.error("Driver calendar query failed.", { code: error?.code });
      return jsonResponse({ error: "无法读取日历，请重试。" }, { status: 503 });
    }
    return jsonResponse(driverCalendarSchema.parse({ month: query.data.month, entries: data.map(projectDriverCalendarRow) }));
  } catch (error) {
    console.error("Driver calendar request failed.", error);
    return jsonResponse({ error: "无法读取日历。" }, { status: 500 });
  }
}
