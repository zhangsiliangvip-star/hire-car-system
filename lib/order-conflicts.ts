export type ConflictCheckOrder = {
  id?: number | string;
  regionId?: string | null;
  vehicle: string;
  driver?: string | null;
  date: string;
  endDate?: string | null;
  offDates?: string[] | null;
  time: string;
  status: string;
  financeByDate?: Record<string, { vehicle?: string | null; driver?: string | null } | undefined> | null;
};

export type OrderConflictReason = "vehicle" | "driver";

export type OrderConflict<T> = {
  order: T;
  reasons: OrderConflictReason[];
  vehicles: string[];
  drivers: string[];
};

const SAME_DAY_CONFLICT_MINUTES = 120;

function timeToMinutes(time: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function normalizeName(value: string | null | undefined) {
  return (value || "").trim();
}

/** Active (non-rest) dates mapped to that day's effective vehicle and driver. */
function getDailyAssignments(order: ConflictCheckOrder) {
  const start = new Date(`${order.date}T00:00:00Z`).getTime();
  const end = new Date(`${order.endDate || order.date}T00:00:00Z`).getTime();
  const offDates = new Set(order.offDates || []);
  const dates =
    !Number.isFinite(start) || !Number.isFinite(end) || end < start
      ? [order.date]
      : Array.from(
          { length: Math.min(Math.floor((end - start) / 86_400_000) + 1, 3660) },
          (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10),
        );

  const assignments = new Map<string, { vehicle: string; driver: string }>();
  for (const date of dates) {
    if (offDates.has(date)) continue;
    const finance = order.financeByDate?.[date];
    assignments.set(date, {
      vehicle: normalizeName(finance?.vehicle) || normalizeName(order.vehicle),
      driver: normalizeName(finance?.driver) || normalizeName(order.driver),
    });
  }
  return assignments;
}

function isMultiDay(order: ConflictCheckOrder) {
  return Boolean(order.endDate && order.endDate > order.date);
}

/**
 * Non-cancelled orders in the same region sharing an active date with the same
 * vehicle or the same driver. When both orders are single-day with valid
 * times, they only conflict if departures are less than 2 hours apart.
 */
export function findOrderConflicts<T extends ConflictCheckOrder>(
  draft: ConflictCheckOrder,
  orders: T[],
  excludeId?: T["id"] | null,
): OrderConflict<T>[] {
  if (draft.status === "キャンセル") return [];
  const draftDays = getDailyAssignments(draft);
  if (draftDays.size === 0) return [];
  const draftTime = timeToMinutes(draft.time);
  const conflicts: OrderConflict<T>[] = [];

  for (const order of orders) {
    if (
      (excludeId !== undefined && excludeId !== null && order.id === excludeId) ||
      order.status === "キャンセル" ||
      (order.regionId ?? null) !== (draft.regionId ?? null)
    ) {
      continue;
    }

    if (!isMultiDay(order) && !isMultiDay(draft)) {
      const existingTime = timeToMinutes(order.time);
      if (
        draftTime !== null &&
        existingTime !== null &&
        Math.abs(existingTime - draftTime) >= SAME_DAY_CONFLICT_MINUTES
      ) {
        continue;
      }
    }

    const vehicles = new Set<string>();
    const drivers = new Set<string>();
    for (const [date, existing] of getDailyAssignments(order)) {
      const requested = draftDays.get(date);
      if (!requested) continue;
      if (requested.vehicle && requested.vehicle === existing.vehicle) {
        vehicles.add(existing.vehicle);
      }
      if (requested.driver && requested.driver === existing.driver) {
        drivers.add(existing.driver);
      }
    }

    const reasons: OrderConflictReason[] = [];
    if (vehicles.size > 0) reasons.push("vehicle");
    if (drivers.size > 0) reasons.push("driver");
    if (reasons.length > 0) {
      conflicts.push({ order, reasons, vehicles: [...vehicles], drivers: [...drivers] });
    }
  }

  return conflicts;
}
