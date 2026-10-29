import { jsonResponse } from "@/lib/api-response";
import { requireDriver } from "@/lib/driver/authorization";
import { acknowledgeSchema, assignmentIdSchema, tripEventSchema } from "@/lib/driver/orders";
import { isDriverPwaTestMode } from "@/lib/driver/test-runtime";

export function isDriverActionOrigin(request: Request, isolatedDevelopment = false) {
  const origin = request.headers.get("origin");
  const internalOrigin = new URL(request.url).origin;
  if (origin === internalOrigin) return true;
  // Next dev binds to 0.0.0.0 but the phone sends its actual LAN origin.
  return isolatedDevelopment && internalOrigin === "http://0.0.0.0:3100" &&
    ["http://172.20.10.4:3100", "http://localhost:3100", "http://127.0.0.1:3100"].some(
      (allowed) => origin === allowed && request.headers.get("host") === new URL(allowed).host,
    );
}

export async function assignmentAction(
  request: Request,
  context: { params: Promise<{ id: string }> },
  action: "acknowledge" | "event",
) {
  try {
    const identity = await requireDriver();
    if (identity.response) return identity.response;
    if (!isDriverActionOrigin(request, process.env.NODE_ENV === "development" && isDriverPwaTestMode())) {
      console.error("Driver action origin rejected.");
      return jsonResponse({ error: "请求来源无效。" }, { status: 403 });
    }
    if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
      return jsonResponse({ error: "请使用 JSON 提交。" }, { status: 415 });
    }
    const { id } = await context.params;
    if (!assignmentIdSchema.safeParse(id).success) {
      return jsonResponse({ error: "行程不存在或已撤派。" }, { status: 404 });
    }
    const text = await request.text();
    if (text.length > 1024) return jsonResponse({ error: "请求内容过大。" }, { status: 413 });
    let body: unknown;
    try { body = JSON.parse(text); } catch {
      return jsonResponse({ error: "请求内容不是有效的 JSON。" }, { status: 400 });
    }
    const parsed = action === "acknowledge"
      ? acknowledgeSchema.transform((value) => ({ ...value, state: "acknowledged" })).safeParse(body)
      : tripEventSchema.safeParse(body);
    if (!parsed.success) return jsonResponse({ error: "行程参数无效，请刷新行程。" }, { status: 400 });
    const args = {
      target_assignment: id, expected_version: parsed.data.expectedVersion,
      target_request: parsed.data.requestId,
    };
    const state = parsed.data.state;
    const { data, error } = action === "acknowledge"
      ? await identity.supabase.rpc("acknowledge_driver_assignment", args)
      : await identity.supabase.rpc("transition_driver_assignment", { ...args, target_state: state });
    if (error) {
      const status = error.code === "P0002" ? 404 : error.code === "42501" ? 403 :
        ["40001", "23505"].includes(error.code) ? 409 : error.code === "22023" ? 422 : 503;
      console.error("Driver assignment action rejected.", { action, code: error.code });
      return jsonResponse({ error: status === 409 ? "行程已变化，请刷新后重试。" :
        status === 404 ? "行程不存在或已撤派。" : "无法更新行程，请刷新或联系调度。" }, { status });
    }
    if (!Number.isSafeInteger(data) || data === null || data < 1) {
      throw new Error("Invalid assignment action version.");
    }
    return jsonResponse({ version: data, status: state });
  } catch (error) {
    console.error("Driver assignment action failed.", error);
    return jsonResponse({ error: "无法更新行程，请稍后重试。" }, { status: 500 });
  }
}
