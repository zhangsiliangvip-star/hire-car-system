import { printA4Html } from "@/lib/print-a4";
import { summarizeRequestAmounts } from "@/lib/request-amount-summary";
import type { Order } from "@/lib/domain";

type OrderFinancePrintRow = {
  date: string;
  customer: string;
  source: string;
  invoiceStatus: string;
  paid: boolean;
  depositStatus?: string;
  depositMethod: Order["depositMethod"];
  requestAmount: number;
  profit: number;
};

type OrderFinancePrintData = {
  month: string;
  region: string;
  source: string;
  company: string;
  depositStatus: string;
  invoiceStatus: string;
  rows: OrderFinancePrintRow[];
  orderCount?: number;
  requestAmounts?: ReturnType<typeof summarizeRequestAmounts>;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function buildOrderFinancePrintHtml(data: OrderFinancePrintData) {
  const requestAmounts = data.requestAmounts ?? summarizeRequestAmounts(data.rows);
  const number = (value: number) => value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  const sum = (key: "requestAmount" | "profit") =>
    data.rows.reduce((total, row) => total + row[key], 0);
  const cell = (value: number) => `<td class="number">${number(value)}</td>`;
  const rate = sum("requestAmount") === 0 ? 0 : sum("profit") / sum("requestAmount") * 100;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>経理統計月度财务表</title><style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; color: #172033; }
  body { font: 12px Arial, "Microsoft YaHei", sans-serif; }
  .sheet { width: 190mm; min-height: 276mm; height: auto; overflow: visible; }
  .content.expand-pages { width: 190mm; transform-origin: top left; }
  h1 { font-size: 23px; text-align: center; margin: 0 0 14px; }
  header { border-bottom: 2px solid #263b53; padding-bottom: 12px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 12px; overflow-wrap: anywhere; }
  .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 14px 0; }
  .summary div { border: 1px solid #bac3cd; padding: 10px; }
  .summary strong { display: block; font-size: 20px; margin-top: 6px; }
  .request-breakdown { margin-top: 8px; font-size: 12px; line-height: 1.7; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #bac3cd; padding: 6px 3px; overflow-wrap: anywhere; }
  th, tfoot { background: #edf1f5; font-weight: bold; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  td { text-align: center; }
  .number { text-align: right; font-variant-numeric: tabular-nums; }
  .complete { color: #15803d; } .pending { color: #dc2626; }
  .notes { margin-top: 14px; line-height: 1.8; }
  </style></head><body><div class="sheet"><article class="content expand-pages">
  <header><h1>経理統計月度财务表</h1><div class="meta">
  <span>月份：${escapeHtml(data.month)}</span><span>分区：${escapeHtml(data.region)}</span><span>币种：JPY</span>
  <span>来源：${escapeHtml(data.source)}</span><span>所属会社：${escapeHtml(data.company)}</span>
  <span>請求書状態：${escapeHtml(data.invoiceStatus)}</span><span>入金状態：${escapeHtml(data.depositStatus)}</span><span>团数：${data.rows.length}</span><span>訂単数：${data.orderCount ?? data.rows.length}</span></div></header>
  <div class="summary"><div>総請求金額<strong>¥${number(sum("requestAmount"))}</strong>
  <p class="request-breakdown">口座入金：¥${number(requestAmounts.bank)}<br>現金入金：¥${number(requestAmounts.cash)}<br>未设置入金方式：¥${number(requestAmounts.unassigned)}</p></div>
  <div>利润総和<strong>¥${number(sum("profit"))}</strong></div><div>利润率<strong>${number(rate)}%</strong></div></div>
  <table><colgroup><col style="width:12%"><col style="width:28%"><col style="width:15%">
  <col style="width:12%"><col style="width:12%"><col style="width:11%"><col style="width:10%"></colgroup>
  <thead><tr><th>訂単日期</th><th>团／訂単名称</th><th>来源</th><th>請求書<br>状態</th><th>入金<br>状態</th><th>請求金額</th><th>訂単<br>総利润</th></tr></thead>
  <tbody>${data.rows.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.customer || "未填写")}</td>
  <td>${escapeHtml(row.source || "未填写")}</td>
  <td class="${row.invoiceStatus === "已完成" || row.invoiceStatus === "全部已完成" ? "complete" : row.invoiceStatus.includes("部分") ? "" : "pending"}">${escapeHtml(row.invoiceStatus)}</td>
  <td class="${row.depositStatus === "入金済み" || row.depositStatus === "全部入金済み" || (!row.depositStatus && row.paid) ? "complete" : row.depositStatus?.includes("部分") ? "" : "pending"}">${escapeHtml(row.depositStatus ?? (row.paid ? "入金済み" : "未入金"))}</td>
  ${cell(row.requestAmount)}${cell(row.profit)}</tr>`).join("")}</tbody>
  <tfoot><tr><td colspan="4">筛选范围合计</td>${cell(sum("requestAmount"))}${cell(sum("profit"))}</tr></tfoot></table>
  <p class="notes">依据当前月份、分区及筛选条件的已保存記録生成，金額口径与経理統計列表一致。<br>
  総請求金額按訂単入金方式分类，不要求填写入金日期，不代表已实际收款；未设置入金方式另列，三项之和等于総請求金額。<br>
  财务数据仅供内部核对，請妥善保管。</p>
  </article></div></body></html>`;
}

export async function printOrderFinance(data: OrderFinancePrintData) {
  await printA4Html(buildOrderFinancePrintHtml(data), "経理統計月度财务表打印");
}
