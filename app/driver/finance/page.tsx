import DriverFinance from "./finance";
import DriverNavigation from "@/app/driver/navigation";
import { z } from "zod";
import { shiftMonthSchema } from "@/lib/driver/shifts";

export default async function Page({ searchParams }: {
  searchParams: Promise<{ date?: string | string[]; month?: string | string[];
    assignmentId?: string | string[]; view?: string | string[] }>;
}) {
  const { date, month, assignmentId, view } = await searchParams;
  const valid = (date === undefined || (typeof date === "string" && z.iso.date().safeParse(date).success)) &&
    (month === undefined || (typeof month === "string" && shiftMonthSchema.safeParse(month).success && !month.startsWith("0000"))) &&
    (assignmentId === undefined || (typeof assignmentId === "string" && z.uuid().safeParse(assignmentId).success && typeof date === "string")) &&
    (view === undefined || view === "wages") &&
    !(typeof date === "string" && typeof month === "string" && !date.startsWith(`${month}-`));
  if (!valid) return <main className="driver-main"><DriverNavigation active="finance" />
    <p className="driver-error" role="alert">财务链接无效，請返回日歴重新選択。</p></main>;
  const initialDate = typeof date === "string" ? date : typeof month === "string" ? `${month}-01` : undefined;
  return <DriverFinance key={`${initialDate ?? ""}-${assignmentId ?? ""}-${view ?? ""}`}
    initialDate={initialDate} initialAssignmentId={typeof assignmentId === "string" ? assignmentId : undefined}
    initialView={view === "wages" ? "wages" : undefined} />;
}
