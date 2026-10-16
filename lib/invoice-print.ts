import { printA4Html } from "@/lib/print-a4";
import { isCompanySealDataUrl } from "@/lib/company-seal";

type InvoiceData = {
  number: string;
  issuedDate: string;
  startDate: string;
  endDate: string;
  customer: string;
  recipient: string;
  contact: string;
  recipientAddress: string;
  company: string;
  phone: string;
  address: string;
  bankAccount: string;
  taxRegistrationNumber: string;
  sealImage?: string;
  orderPrice: number;
  etcTrip: number;
  driverAdvanceTrip: number;
  companyAdvanceTrip: number;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function buildInvoicePrintHtml(data: InvoiceData) {
  if (!isCompanySealDataUrl(data.sealImage || "")) throw new Error("会社印章无效，请重新上传后导出。");
  const amounts = [data.orderPrice, data.etcTrip, data.driverAdvanceTrip, data.companyAdvanceTrip];
  if (amounts.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("请求书金额必须是非负日元整数。");
  }
  const total = amounts.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) throw new Error("请求书合计超出金额范围。");
  const tax = Number(BigInt(total) * BigInt(10) / BigInt(110));
  const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;
  const items = [
    [`${data.customer} ／ 運行料金`, data.orderPrice],
    ["ETC料金", data.etcTrip],
    ["運転士立替金", data.driverAdvanceTrip],
    ["会社立替金", data.companyAdvanceTrip],
  ] as const;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>請求書</title><style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; color: #18293a; background: white; }
  body { font: 12px Arial, "Yu Gothic", "Microsoft YaHei", sans-serif; }
  .sheet { width: 190mm; height: 276mm; overflow: hidden; }
  .content { width: 190mm; transform-origin: top left; padding: 8mm 4mm; }
  h1 { text-align: center; font-size: 30px; letter-spacing: 12px; margin: 0 0 24px; }
  .document-meta { text-align: right; font-size: 10px; margin-bottom: 20px; overflow-wrap: anywhere; }
  .parties { display: grid; grid-template-columns: 1.15fr 1fr; gap: 24px; }
  .recipient { font-size: 20px; border-bottom: 1px solid #273d53; padding-bottom: 8px; }
  .lines { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.9; }
  h2 { font-size: 16px; margin: 0 0 8px; }
  .issuer-heading { display: flex; align-items: center; gap: 8px; white-space: normal; margin-bottom: 8px; }
  .issuer-heading h2 { flex: 1; min-width: 0; margin: 0; }
  .seal { width: 22mm; height: 22mm; flex: 0 0 22mm; object-fit: contain; }
  .total { border-bottom: 3px solid #273d53; padding: 14px 8px; margin: 24px 0; display: flex; justify-content: space-between; align-items: baseline; }
  .total strong { font-size: 28px; }
  .period { margin: 18px 0 10px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #aeb9c3; padding: 14px 8px; overflow-wrap: anywhere; }
  th { background: #edf1f5; }
  .number { text-align: right; font-variant-numeric: tabular-nums; }
  .tax { margin-left: auto; width: 60%; margin-top: 14px; }
  .tax td { padding: 8px; }
  .bank { border: 1px solid #aeb9c3; padding: 14px; margin-top: 24px; }
  footer { margin-top: 18px; font-size: 10px; line-height: 1.8; }
  </style></head><body><div class="sheet"><article class="content">
  <h1>請求書</h1><div class="document-meta">請求書番号：${escapeHtml(data.number)}<br>発行日：${escapeHtml(data.issuedDate)}</div>
  <div class="parties"><div><div class="recipient">${escapeHtml(data.recipient)} 御中</div>
  <p class="lines">${escapeHtml(data.recipientAddress)}${data.contact ? `\nご担当：${escapeHtml(data.contact)} 様` : ""}</p>
  <p>下記のとおりご請求申し上げます。</p></div>
  <div class="lines"><div class="issuer-heading"><h2>${escapeHtml(data.company)}</h2>${data.sealImage ? `<img class="seal" src="${escapeHtml(data.sealImage)}" alt="会社印">` : ""}</div>${escapeHtml(data.address)}<br>TEL：${escapeHtml(data.phone)}
  <br>登録番号：${escapeHtml(data.taxRegistrationNumber)}</div></div>
  <div class="total"><span>ご請求金額（税込）</span><strong>${yen(total)}</strong></div>
  <p class="period">取引年月日（運行期間）：${escapeHtml(data.startDate)} ～ ${escapeHtml(data.endDate)}</p>
  <table><colgroup><col style="width:65%"><col style="width:10%"><col style="width:25%"></colgroup>
  <thead><tr><th>請求内容</th><th>税率</th><th>金額（税込）</th></tr></thead>
  <tbody>${items.filter(([, amount], index) => index === 0 || amount > 0).map(([label, amount]) => `<tr><td>${escapeHtml(label)}</td><td>10%</td><td class="number">${yen(amount)}</td></tr>`).join("")}</tbody></table>
  <table class="tax"><tbody><tr><td>10%対象額（税込）</td><td class="number">${yen(total)}</td></tr>
  <tr><td>うち消費税額（10%）</td><td class="number">${yen(tax)}</td></tr>
  <tr><td>合計（税込）</td><td class="number">${yen(total)}</td></tr></tbody></table>
  <div class="bank"><h2>お振込先</h2><div class="lines">${escapeHtml(data.bankAccount)}</div></div>
  <footer>※ 全項目は消費税10%を含む金額です。消費税額は本請求書の10%対象額に対して一括計算し、1円未満を切り捨てています。<br>
  ※ お支払条件は別途お取り決めの内容に従います。</footer>
  </article></div></body></html>`;
}

export async function printInvoice(data: InvoiceData) {
  await printA4Html(buildInvoicePrintHtml(data), "請求書打印");
}
