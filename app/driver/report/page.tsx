import DriverReport from "./report";
import DriverNavigation from "@/app/driver/navigation";
import { z } from "zod";
import { shiftMonthSchema } from "@/lib/driver/shifts";

export default async function ReportPage({ searchParams }: {
  searchParams: Promise<{ reportId?: string | string[]; month?: string | string[]; date?: string | string[] }>;
}) {
  const { reportId, month, date } = await searchParams;
  if (month !== undefined && (typeof month !== "string" || !shiftMonthSchema.safeParse(month).success || month.startsWith("0000")))
    return <main className="driver-main"><DriverNavigation active="report" />
      <p className="driver-error" role="alert">日報链接月份无效，請返回日歴重新選択。</p></main>;
  if (date !== undefined && (typeof date !== "string" || !z.iso.date().safeParse(date).success))
    return <main className="driver-main"><DriverNavigation active="report" />
      <p className="driver-error" role="alert">日報链接日期无效，請返回日歴重新選択。</p></main>;
  const target = Array.isArray(reportId) ? "" : reportId;
  return <DriverReport key={`${target ?? "new"}-${month ?? ""}-${date ?? ""}`} initialReportId={target}
    initialDate={typeof date === "string" ? date : undefined}
    returnMonth={typeof month === "string" ? month : undefined} />;
}
