import type { AuditedRecord } from "@/lib/audit";
import { formatAuditTime } from "@/lib/audit";

export function LastOperation({ record }: { record: (AuditedRecord & { id: string }) | undefined }) {
  return (
    <span className="mt-1 block text-xs font-normal text-gray-500">
      {record?.lastOperation
        ? `最后操作：${record.lastOperation.actorName}｜${formatAuditTime(record.lastOperation.at)}（日本時間）`
        : "历史記録／尚无操作信息"}
    </span>
  );
}
