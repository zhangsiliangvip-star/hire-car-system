import { jsonResponse } from "@/lib/api-response";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import { driverPostalCodeSchema } from "@/lib/driver-address";
import { readPostalAddress } from "@/lib/postal-address";

export async function GET(request: Request) {
  try {
    const { profile } = await getAuthenticatedProfile();
    if (!profile) return jsonResponse({ error: "需要后台账号。" }, { status: 403 });
    const postalCode = driverPostalCodeSchema.safeParse(new URL(request.url).searchParams.get("postalCode"));
    if (!postalCode.success || !postalCode.data) {
      return jsonResponse({ error: "請输入有效的7位郵便番号。" }, { status: 400 });
    }
    const code = postalCode.data.replace("-", "");
    const response = await fetch(`https://yubinbango.github.io/yubinbango-data/data/${code.slice(0, 3)}.js`,
      { next: { revalidate: 86400 }, signal: AbortSignal.timeout(8000) });
    if (response.status === 404) return jsonResponse({ error: "未找到对应地址，請核对邮编或手动填写。" }, { status: 404 });
    if (!response.ok) throw new Error(`Postal dataset request failed: ${response.status}`);
    const address = readPostalAddress(await response.text(), code);
    if (!address) return jsonResponse({ error: "未找到对应地址，請核对邮编或手动填写。" }, { status: 404 });
    return jsonResponse({ postalCode: postalCode.data, address });
  } catch (error) {
    console.error("Postal address lookup failed.", error instanceof Error ? error.name : "UnknownError");
    return jsonResponse({ error: "邮编地址查询失败，請重试或手动填写住所。" }, { status: 503 });
  }
}
