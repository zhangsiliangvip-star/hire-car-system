export function normalizeOrderTimeInput(value: string) {
  const trimmed = value.trim();
  const colonTime = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  const digits = /^\d{3,4}$/.exec(trimmed);
  const hours = colonTime ? Number(colonTime[1]) : digits ? Number(trimmed.slice(0, -2)) : NaN;
  const minutes = colonTime ? Number(colonTime[2]) : digits ? Number(trimmed.slice(-2)) : NaN;

  if (!Number.isInteger(hours) || hours < 0 || hours > 23 ||
    !Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
    return value;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
