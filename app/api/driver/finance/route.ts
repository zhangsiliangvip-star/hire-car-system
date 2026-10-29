import { z } from "zod";
import { jsonResponse } from "@/lib/api-response";
import { requireDriver } from "@/lib/driver/authorization";
import { isDriverActionOrigin } from "@/lib/driver/assignment-action";
import { isDriverPwaTestMode } from "@/lib/driver/test-runtime";
import { financeClaimSchema, financeDataSchema, financeSubmissionSchema } from "@/lib/driver/finance";
import { fuelClaimSchema } from "@/lib/driver/fuel";

export async function GET(request: Request) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict().safeParse(query);
    if (!parsed.success) return jsonResponse({ error: "请選択有效月份。" }, { status: 400 });
    const links = await identity.supabase.rpc("ensure_driver_historical_finance_links", {
      target_month: parsed.data.month,
    });
    if (links.error) {
      console.error("Driver historical finance links rejected.", { code: links.error.code });
      return jsonResponse({ error: "历史訂単财务入口读取失败，请重试。" }, { status: 503 });
    }
    const { data, error } = await identity.supabase.rpc("driver_finance_data", { target_month: parsed.data.month });
    if (error) {
      console.error("Driver finance read rejected.", { code: error.code });
      return jsonResponse({ error: "财务读取失败，请重试或联系管理员。" }, { status: 503 });
    }
    const fuel = await identity.supabase.rpc("driver_daily_fuel_data", { target_month: parsed.data.month });
    if (fuel.error) {
      console.error("Driver daily fuel read rejected.", { code: fuel.error.code });
      return jsonResponse({ error: "燃油費申報读取失败，请重试。" }, { status: 503 });
    }
    const historical = await identity.supabase.rpc("driver_historical_finance_data", {
      target_month: parsed.data.month,
    });
    if (historical.error) {
      console.error("Driver historical finance read rejected.", { code: historical.error.code });
      return jsonResponse({ error: "历史訂単财务读取失败，请重试。" }, { status: 503 });
    }
    const historicalTrips = z.array(financeDataSchema.shape.trips.element).parse(
      z.object({ trips: z.array(financeDataSchema.shape.trips.element) }).strict().parse(historical.data).trips,
    );
    const fuelClaims = z.array(fuelClaimSchema).parse(fuel.data);
    const finance = financeDataSchema.omit({ fuelClaims: true }).parse(data);
    return jsonResponse(financeDataSchema.parse({
      ...finance, trips: [...finance.trips, ...historicalTrips], fuelClaims,
    }));
  } catch (error) {
    console.error("Driver finance read failed.", error);
    return jsonResponse({ error: "无法读取财务。" }, { status: 500 });
  }
}
export async function POST(request: Request) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    if (!isDriverActionOrigin(request, process.env.NODE_ENV === "development" && isDriverPwaTestMode()))
      return jsonResponse({ error: "請求来源无效。" }, { status: 403 });
    if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
      return jsonResponse({ error: "请使用JSON提交。" }, { status: 415 });
    const text = await request.text();
    if (text.length > 65536) return jsonResponse({ error: "明細过多。" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); } catch { return jsonResponse({ error: "JSON无效。" }, { status: 400 }); }
    const parsed = financeSubmissionSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "请检查明細、金額和超時小時数。" }, { status: 400 });
    const item = parsed.data;
    const { data, error } = item.historical
      ? await identity.supabase.rpc("submit_driver_historical_finance", {
      target_link: item.assignmentId, expected_version: item.expectedVersion,
      target_category: item.category, target_request: item.requestId,
      items: item.expenses, hours: item.overtimeHours,
    })
      : await identity.supabase.rpc("submit_driver_finance", {
      target_assignment: item.assignmentId, expected_version: item.expectedVersion,
      target_category: item.category,
      target_request: item.requestId, items: item.expenses, hours: item.overtimeHours,
    });
    if (error) {
      console.error("Driver finance submission rejected.", { code: error.code });
      return jsonResponse({ error: error.code === "40001" ? "此申報已提交或已变化，请刷新核对。" :
        "申報未获确认，请检查行程权限和票据后重试。" }, { status: error.code === "40001" ? 409 :
        error.code === "42501" ? 403 : ["22023", "22P02", "23514"].includes(error.code) ? 422 : 503 });
    }
    return jsonResponse({ claim: financeClaimSchema.parse(data) });
  } catch (error) {
    console.error("Driver finance submission failed.", error);
    return jsonResponse({ error: "提交失败，请核对后重试。" }, { status: 500 });
  }
}
