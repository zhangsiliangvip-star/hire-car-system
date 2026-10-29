import { notFound, redirect } from "next/navigation";
import { isDriverPwaEnabled } from "@/lib/driver/test-runtime";
import { getAuthenticatedProfile } from "@/lib/supabase/authorization";
import Review from "./review";
import "../driver/driver.css";
import "../driver/finance/finance.css";

export const dynamic = "force-dynamic";
export default async function Page() {
  if (!isDriverPwaEnabled()) notFound();
  const { profile } = await getAuthenticatedProfile();
  if (!profile) redirect("/login?next=%2Fdriver-finance-review");
  if (profile.role !== "admin") notFound();
  return <div className="driver-app"><div className="driver-test-banner">隔离测试环境 · 管理员审核</div><Review /></div>;
}
