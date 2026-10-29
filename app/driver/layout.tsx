import { notFound } from "next/navigation";
import { isDriverPwaEnabled, isDriverPwaTestMode } from "@/lib/driver/test-runtime";
import DriverBrand from "@/app/driver/driver-brand";
import "./driver.css";

export const dynamic = "force-dynamic";
export function generateMetadata() {
  return { title: isDriverPwaTestMode() ? "GO RIDE · 司机端测试" : "GO RIDE · 司机端" };
}

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  if (!isDriverPwaEnabled()) notFound();
  return <div className="driver-app" lang="zh-CN">
    {isDriverPwaTestMode() && <div className="driver-test-banner">独立测试环境 · 非正式派单</div>}
    <DriverBrand />
    {children}
  </div>;
}
