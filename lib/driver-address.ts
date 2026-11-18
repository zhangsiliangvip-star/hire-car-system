import { z } from "zod";

export const driverPostalCodeSchema = z.string().trim().default("")
  .transform(value => {
    const normalized = value.normalize("NFKC").replace(/^〒\s*/, "").replace(/[‐‑－−ー]/g, "-");
    return /^\d{7}$/.test(normalized) ? `${normalized.slice(0, 3)}-${normalized.slice(3)}` : normalized;
  })
  .pipe(z.string().regex(/^(?:\d{3}-\d{4})?$/));

export function splitDriverAddress(address = "", postalCode = "") {
  const prefix = address.match(/^\s*〒?\s*([0-9０-９]{3})[-‐‑－−ー]?\s*([0-9０-９]{4})(?![0-9０-９])\s*/);
  const normalized = driverPostalCodeSchema.parse(postalCode);
  if (!prefix) return { postalCode: normalized, address: address.trim() };
  const extracted = `${prefix[1]}-${prefix[2]}`.normalize("NFKC");
  if (normalized && normalized !== extracted) return { postalCode: normalized, address: address.trim() };
  return { postalCode: normalized || extracted, address: address.slice(prefix[0].length).trim() };
}
