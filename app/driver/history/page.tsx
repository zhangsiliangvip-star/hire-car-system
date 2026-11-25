import DriverHistory from "./history";
import DriverNavigation from "@/app/driver/navigation";
import { shiftMonthSchema } from "@/lib/driver/shifts";

export default async function HistoryPage({ searchParams }: {
  searchParams: Promise<{ month?: string | string[] }>;
}) {
  const { month } = await searchParams;
  if (month !== undefined && (typeof month !== "string" || !shiftMonthSchema.safeParse(month).success || month.startsWith("0000")))
    return <main className="driver-main"><DriverNavigation active="history" />
      <p className="driver-error" role="alert">日歴月份无效，請重新打开日歴。</p></main>;
  return <DriverHistory initialMonth={typeof month === "string" ? month : undefined} />;
}
