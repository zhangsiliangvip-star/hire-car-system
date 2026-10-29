import { jsonResponse } from "@/lib/api-response";
import { requireDriver } from "@/lib/driver/authorization";

export async function GET() {
  try {
    const result = await requireDriver();
    if (result.response) return result.response;
    const identity = result.identity;
    const { data: greetings, error } = await result.supabase.rpc("driver_portal_greetings");
    if (error) throw error;
    if (typeof greetings !== "object" || greetings === null || Array.isArray(greetings) ||
      !("globalSlogan" in greetings) || typeof greetings.globalSlogan !== "string" ||
      !("personalSlogan" in greetings) || typeof greetings.personalSlogan !== "string") {
      throw new Error("Driver greeting response is invalid.");
    }
    return jsonResponse({
      driverId: identity.driver_id,
      regionId: identity.region_id,
      name: identity.driver_name,
      version: identity.version,
      globalSlogan: greetings.globalSlogan,
      personalSlogan: greetings.personalSlogan,
    });
  } catch (error) {
    console.error("Driver identity request failed.", error);
    return jsonResponse({ error: "无法读取司机身份，请稍后重试。" }, { status: 500 });
  }
}
