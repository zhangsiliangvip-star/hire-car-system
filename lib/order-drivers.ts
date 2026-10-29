import type { Order } from "@/lib/domain";

type DriverAssignment = {
  driver?: string | null;
  financeByDate?: Record<string, {
    driver?: string | null;
    driverPaymentType?: string;
    companyAdvancePaymentNote?: string | null;
  } | undefined> | null;
};

export function getServiceDriver(order: DriverAssignment, date: string): string {
  const finance = order.financeByDate?.[date];
  if (finance?.driverPaymentType === "company_advance") return "";
  return finance?.driver ?? order.driver ?? "";
}

function getServiceDriverPresentation(order: DriverAssignment, date: string): { label: string; isExternal: boolean } {
  const finance = order.financeByDate?.[date];
  if (finance?.driverPaymentType === "company_advance") {
    const label = finance.companyAdvancePaymentNote?.split(/\r?\n/)
      .find(line => line.startsWith("外注司机："))?.slice("外注司机：".length).trim() || "";
    return { label, isExternal: Boolean(label) };
  }
  return { label: getServiceDriver(order, date), isExternal: false };
}

export function getOrderDriverNames(order: Pick<Order, "date" | "endDate" | "offDates" | "driver" | "financeByDate">,
  includeDate: (date: string) => boolean = () => true): string[] {
  const start = new Date(`${order.date}T00:00:00Z`).getTime();
  const end = new Date(`${order.endDate || order.date}T00:00:00Z`).getTime();
  const count = Math.min(Math.floor((end - start) / 86_400_000) + 1, 3660);
  const names = new Set<string>();
  for (let index = 0; index < count; index++) {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    if (!order.offDates.includes(date) && includeDate(date)) names.add(getServiceDriver(order, date));
  }
  return [...names];
}

export function getOrderDriverLabel(order: Parameters<typeof getOrderDriverNames>[0]): string {
  return getOrderDriverLabelEntries(order)
    .map(({ label }) => label || "未安排").join("／") || "未安排";
}

export function getOrderDriverLabelEntries(order: Parameters<typeof getOrderDriverNames>[0]) {
  const start = new Date(`${order.date}T00:00:00Z`).getTime();
  const end = new Date(`${order.endDate || order.date}T00:00:00Z`).getTime();
  const count = Math.min(Math.floor((end - start) / 86_400_000) + 1, 3660);
  const entries = new Map<string, { label: string; isExternal: boolean }>();
  for (let index = 0; index < count; index++) {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    if (!order.offDates.includes(date)) {
      const presentation = getServiceDriverPresentation(order, date);
      entries.set(`${presentation.isExternal ? "external" : "staff"}:${presentation.label}`, presentation);
    }
  }
  return [...entries.values()];
}

export function getDriverSegments(order: Pick<Order, "driver" | "financeByDate" | "offDates">, dates: string[]) {
  const segments: { driver: string; label: string; isExternal: boolean; start: number; end: number }[] = [];
  dates.forEach((date, index) => {
    if (order.offDates.includes(date)) return;
    const driver = getServiceDriver(order, date);
    const { label, isExternal } = getServiceDriverPresentation(order, date);
    const previous = segments[segments.length - 1];
    if (previous && previous.driver === driver && previous.label === label &&
      previous.isExternal === isExternal && previous.end === index) previous.end++;
    else segments.push({ driver, label, isExternal, start: index, end: index + 1 });
  });
  return segments;
}
