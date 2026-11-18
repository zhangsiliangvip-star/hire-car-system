export function formatMobilePhone(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  const digits = text.replace(/[\s\-－ー−()（）]/g, "");
  return /^0\d{10}$/.test(digits) ? `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}` : text;
}
