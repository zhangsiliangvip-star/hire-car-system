export function formatDriverPhone(value: string) {
  const normalized = value.normalize("NFKC");
  return /^\d{11}$/.test(normalized)
    ? `${normalized.slice(0, 3)}-${normalized.slice(3, 7)}-${normalized.slice(7)}`
    : value;
}
