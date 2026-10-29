import { jsonResponse } from "@/lib/api-response";
import { requireDriver } from "@/lib/driver/authorization";
import { assignmentIdSchema, projectDriverTripDetail, projectHistoricalDriverTrip, serviceDateSchema, type DriverTrip } from "@/lib/driver/orders";
import { reportDefaultsSchema } from "@/lib/driver/reports";

export async function GET(request: Request) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    const supabase = identity.supabase;
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => key !== "date" && key !== "assignmentId") ||
        params.getAll("date").length > 1 || params.getAll("assignmentId").length > 1) {
      return jsonResponse({ error: "无效的查询参数。" }, { status: 400 });
    }
    const assignment = params.get("assignmentId");
    const date = params.get("date");
    if ((assignment !== null && date !== null) || (assignment === null && date === null) ||
        (assignment !== null ? !assignmentIdSchema.safeParse(assignment).success : !serviceDateSchema.safeParse(date).success)) {
      return jsonResponse({ error: "请選択有效日期或行程。" }, { status: 400 });
    }
    async function withVehicleNumbers(trips: DriverTrip[]) {
      if (!trips.length) return trips;
      const serviceDate = trips[0].date;
      const { data, error } = await supabase.rpc("driver_report_defaults", { target_date: serviceDate });
      if (error) {
        console.error("Driver trip vehicle numbers rejected.", { code: error.code });
        throw new Error("Vehicle numbers unavailable.");
      }
      const defaults = reportDefaultsSchema.parse(data);
      if (defaults.serviceDate !== serviceDate || new Set(defaults.orders.map(order => order.assignmentId)).size !== defaults.orders.length)
        throw new Error("Unexpected vehicle number projection.");
      return trips.map(trip => {
        const order = defaults.orders.find(order => order.assignmentId === trip.assignmentId);
        if (!order || trip.date !== serviceDate) throw new Error("Trip vehicle number missing.");
        return { ...trip, vehicleNumber: order.vehicleNumber };
      });
    }
    if (assignment) {
      const { data, error } = await identity.supabase.rpc("driver_trip_detail", { target_assignment: assignment });
      if (error || !data) {
        console.error("Driver trip detail query failed.", { code: error?.code });
        return jsonResponse({ error: "无法读取行程，请重试。" }, { status: 503 });
      }
      if (data.length === 0) return jsonResponse({ error: "行程不存在或已撤派。" }, { status: 404 });
      if (data.length !== 1 || data[0].assignment_id !== assignment) throw new Error("Unexpected trip detail.");
      return jsonResponse({ trips: await withVehicleNumbers(data.map(projectDriverTripDetail)) });
    }
    const { data, error } = await identity.supabase.rpc("driver_orders", { target_date: date ?? undefined });
    if (error || !data) {
      console.error("Driver orders query failed.", { code: error?.code });
      return jsonResponse({ error: "无法读取行程，请重试。" }, { status: 503 });
    }
    const trips: DriverTrip[] = [];
    for (let offset = 0; offset < data.length; offset += 10) {
      const batch = await Promise.all(data.slice(offset, offset + 10).map(async row => {
        const detail = await identity.supabase.rpc("driver_trip_detail", { target_assignment: row.assignment_id });
        if (detail.error || !detail.data || detail.data.length !== 1) {
          console.error("Driver list detail query rejected.", { code: detail.error?.code });
          throw new Error("Driver list details unavailable.");
        }
        const current = detail.data[0];
        if (current.assignment_id !== row.assignment_id || current.order_id !== row.order_id || current.service_date !== date)
          throw new Error("Unexpected driver list details.");
        return projectDriverTripDetail(current);
      }));
      trips.push(...batch);
    }
    const { data: historyRows, error: historyError } = await supabase.rpc("driver_historical_orders", { target_date: date! });
    if (historyError || !historyRows) {
      console.error("Driver historical orders query failed.", { code: historyError?.code });
      return jsonResponse({ error: "无法读取历史行程，请重试。" }, { status: 503 });
    }
    const historicalTrips = historyRows.map(projectHistoricalDriverTrip);
    const orderIds = new Set(trips.map(trip => trip.orderId));
    if (historicalTrips.some(trip => orderIds.has(trip.orderId))) throw new Error("Historical order duplicates an assignment.");
    const currentTrips = await withVehicleNumbers(trips);
    return jsonResponse({
      trips: [...currentTrips, ...historicalTrips].sort((a, b) => a.time.localeCompare(b.time) || a.orderId.localeCompare(b.orderId)),
    });
  } catch (error) {
    console.error("Driver orders request failed.", error);
    return jsonResponse({ error: "无法读取行程。" }, { status: 500 });
  }
}
