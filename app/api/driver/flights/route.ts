import { jsonResponse } from "@/lib/api-response";
import { requireDriver } from "@/lib/driver/authorization";
import { assignmentIdSchema, projectDriverTripDetail } from "@/lib/driver/orders";
import { AviationstackError, getAviationstackFlightStatus, inferArrivalAirportFromPickup } from "@/lib/aviationstack";

export async function GET(request: Request) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;

    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => key !== "assignmentId") ||
        params.getAll("assignmentId").length !== 1 ||
        !assignmentIdSchema.safeParse(params.get("assignmentId")).success) {
      return jsonResponse({ error: "无效的行程参数。" }, { status: 400 });
    }

    const assignmentId = params.get("assignmentId")!;
    const { data, error } = await identity.supabase.rpc("driver_trip_detail", {
      target_assignment: assignmentId,
    });
    if (error || !data) {
      console.error("Driver flight assignment query failed.", { code: error?.code });
      return jsonResponse({ error: "无法读取行程航班信息。" }, { status: 503 });
    }
    if (data.length === 0) return jsonResponse({ error: "行程不存在或已撤派。" }, { status: 404 });
    if (data.length !== 1 || data[0].assignment_id !== assignmentId) {
      throw new Error("Unexpected driver flight assignment.");
    }

    const trip = projectDriverTripDetail(data[0]);
    const flightNumber = trip.details?.flightNumber.trim();
    if (!flightNumber) return jsonResponse({ error: "该行程未填写航班号。" }, { status: 404 });
    const arrivalAirport = inferArrivalAirportFromPickup(trip.pickup);
    if (!arrivalAirport) {
      return jsonResponse({
        error: "无法从上车地点识别到达机场，请在预约中注明机场名称或代码（羽田/HND、成田/NRT、关西/KIX、新千岁/CTS、伊丹/ITM）。",
      }, { status: 422 });
    }

    return jsonResponse({
      flight: await getAviationstackFlightStatus(flightNumber, trip.date, arrivalAirport),
    });
  } catch (error) {
    if (error instanceof AviationstackError) {
      console.error("Aviationstack flight lookup failed.", { code: error.code });
      const message = error.code === "not_configured"
        ? "航班查询服务尚未配置，请管理员设置 AVIATIONSTACK_API_KEY。"
        : "航班数据暂时不可用，请稍后重试。";
      return jsonResponse({ error: message }, { status: 503 });
    }
    console.error("Driver flight status request failed.", error);
    return jsonResponse({ error: "无法读取航班状态。" }, { status: 500 });
  }
}
