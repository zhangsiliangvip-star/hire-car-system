import DriverReport from "./report";
import DriverNavigation from "@/app/driver/navigation";
import { shiftMonthSchema } from "@/lib/driver/shifts";

export default async function ReportPage({ searchParams }: {
  searchParams: Promise<{ reportId?: string | string[]; month?: string | string[] }>;
}) {
  const { reportId, month } = await searchParams;
  if (month !== undefined && (typeof month !== "string" || !shiftMonthSchema.safeParse(month).success || month.startsWith("0000")))
    return <main className="driver-main"><DriverNavigation active="report" />
      <p className="driver-error" role="alert">日報链接月份无效，請返回日歴重新選択。</p></main>;
  const target = Array.isArray(reportId) ? "" : reportId;
  return <DriverReport key={`${target ?? "new"}-${month ?? ""}`} initialReportId={target}
    returnMonth={typeof month === "string" ? month : undefined} />;
}
