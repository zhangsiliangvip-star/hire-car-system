import { tripStatusLabels } from "@/lib/driver/orders";
import type { ExecutionStatusData } from "@/lib/driver/execution-status";

export function DriverExecutionBadge({ row, date }: {
  row: ExecutionStatusData["rows"][number] | undefined; date: string;
}) {
  if (!row || row.date !== date) return null;
  const label = row.status === "assigned" ? "未确认" : tripStatusLabels[row.status];
  return <span aria-label={`運転士状態：${label}`} title={`${date} · 運転士手机端：${label}`}
    className="inline-block max-w-full truncate rounded border border-sky-300 bg-sky-50 px-1 text-[10px] font-semibold leading-4 text-sky-900">
    {label}
  </span>;
}
