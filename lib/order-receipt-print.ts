import type { z } from "zod";
import { orderReceiptLabels, type orderReceiptDataSchema } from "@/lib/driver/order-receipts";

type Receipt = z.infer<typeof orderReceiptDataSchema>["receipts"][number];

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function buildOrderReceiptPrintHtml(receipts: Receipt[], date: string) {
  const advances = receipts.filter(receipt => receipt.category === "company" || receipt.category === "trip");
  if (advances.length === 0) throw new Error("請先勾选需要打印的立替小票。");
  const pages: string[] = [];
  for (let start = 0; start < advances.length; start += 6) {
    const group = advances.slice(start, start + 6);
    const columns = Math.min(3, group.length);
    pages.push(`<section class="page">
      <header><strong>立替小票</strong><span>${escapeHtml(date)}</span></header>
      <div class="collage" style="grid-template-columns:repeat(${columns},minmax(0,1fr));grid-template-rows:repeat(${Math.ceil(group.length / columns)},minmax(0,1fr))">
        ${group.map(receipt => `<figure>
          <figcaption>${escapeHtml(orderReceiptLabels[receipt.category])} · ${escapeHtml(receipt.detail)}</figcaption>
          <img src="${escapeHtml(receipt.url)}" alt="${escapeHtml(receipt.detail)}" referrerpolicy="no-referrer">
        </figure>`).join("")}
      </div>
      <footer>${start / 6 + 1} / ${Math.ceil(advances.length / 6)}</footer>
    </section>`);
  }
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
    <title>${escapeHtml(date)} 立替小票</title><style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #111827; font-family: Arial, "Noto Sans JP", sans-serif; }
    .sheet { width: 277mm; }
    .page { height: 187mm; break-after: page; page-break-after: always; }
    .page:last-child { break-after: auto; page-break-after: auto; }
    header { height: 12mm; display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
    .collage { display: grid; gap: 3mm; height: 165mm; }
    figure { margin: 0; padding: 2mm; border: 1px solid #d1d5db; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    figcaption { font-size: 11px; line-height: 1.4; margin-bottom: 2mm; overflow-wrap: anywhere; }
    img { width: 100%; min-height: 0; flex: 1; object-fit: contain; }
    footer { height: 10mm; text-align: center; padding-top: 3mm; font-size: 11px; }
    </style></head><body><div class="sheet"><div class="content expand-pages">${pages.join("")}</div></div></body></html>`;
}
