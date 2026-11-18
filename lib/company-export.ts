import { splitVehicleOwner } from "@/lib/vehicle-compliance";

export function companyExportLines(value: string) {
  const { company, office } = splitVehicleOwner(value);
  return office ? [company, office] : [value];
}

export function companyExportHtml(value: string, escape: (text: string) => string, suffix = "") {
  const lines = companyExportLines(value);
  if (lines.length === 1) return escape(value + suffix);
  return `${escape(lines[0])}<span style="display:block;white-space:nowrap">${escape(lines[1] + suffix)}</span>`;
}
