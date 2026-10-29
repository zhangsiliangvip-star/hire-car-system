import { getOrderDriverLabelEntries } from "@/lib/order-drivers";

type DriverNameLabelProps = {
  name: string;
  isExternal?: boolean;
  className?: string;
};

export function DriverNameLabel({ name, isExternal = false, className = "" }: DriverNameLabelProps) {
  return (
    <span className={`inline-flex min-w-0 max-w-full items-center gap-1 ${className}`}>
      {isExternal && (
        <span className="shrink-0 rounded bg-amber-600 px-1 py-0.5 text-[9px] font-bold leading-none text-white">
          外注
        </span>
      )}
      <span className="min-w-0">{name}</span>
    </span>
  );
}

export function OrderDriverLabels({ order, className = "" }: {
  order: Parameters<typeof getOrderDriverLabelEntries>[0];
  className?: string;
}) {
  const entries = getOrderDriverLabelEntries(order);
  if (!entries.length) {
    return <DriverNameLabel name="未安排" className={className} />;
  }
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1 ${className}`}>
      {entries.map(({ label, isExternal }, index) => (
        <span key={`${isExternal ? "external" : "staff"}-${label}-${index}`} className="inline-flex min-w-0 items-center gap-x-1">
          {index > 0 && <span aria-hidden="true">／</span>}
          <DriverNameLabel name={label || "未安排"} isExternal={isExternal} />
        </span>
      ))}
    </span>
  );
}
