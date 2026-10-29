import { printA4Html } from "@/lib/print-a4";
import { summarizeRequestAmounts } from "@/lib/request-amount-summary";
import type { Order } from "@/lib/domain";

type OrderFinancePrintRow = {
  date: string;
  customer: string;
  source: string;
  driver: string;
  vehicleNumber: string;
  invoiceStatus: string;
  paid: boolean;
  depositMethod: Order["depositMethod"];
  requestAmount: number;
  driverAdvances: number;
  companyExpenses: number;
  driverWages: number;
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
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function buildOrderFinancePrintHtml(data: OrderFinancePrintData) {
  const requestAmounts = summarizeRequestAmounts(data.rows);
  const number = (value: number) => value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  const sum = (key: "requestAmount" | "driverAdvances" | "companyExpenses" | "driverWages" | "profit") =>
    data.rows.reduce((total, row) => total + row[key], 0);
  const cell = (value: number) => `<td class="number">${number(value)}</td>`;
  const rate = sum("requestAmount") === 0 ? 0 : sum("profit") / sum("requestAmount") * 100;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>経理統計月度财务表</title><style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; color: #172033; }
  body { font: 9px Arial, "Microsoft YaHei", sans-serif; }
  .sheet { width: 190mm; height: 276mm; overflow: hidden; }
  .content { width: 190mm; transform-origin: top left; }
  h1 { font-size: 23px; text-align: center; margin: 0 0 14px; }
  header { border-bottom: 2px solid #263b53; padding-bottom: 12px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 11px; overflow-wrap: anywhere; }
  .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 14px 0; }
  .summary div { border: 1px solid #bac3cd; padding: 10px; }
  .summary strong { display: block; font-size: 18px; margin-top: 6px; }
  .request-breakdown { margin-top: 8px; font-size: 10px; line-height: 1.7; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #bac3cd; padding: 6px 3px; overflow-wrap: anywhere; }
  th, tfoot { background: #edf1f5; font-weight: bold; }
  td { text-align: center; }
  .number { text-align: right; font-variant-numeric: tabular-nums; }
  .complete { color: #15803d; } .pending { color: #dc2626; }
  .notes { margin-top: 14px; line-height: 1.8; }
  </style></head><body><div class="sheet"><article class="content">
  <header><h1>経理統計月度财务表</h1><div class="meta">
  <span>月份：${escapeHtml(data.month)}</span><span>分区：${escapeHtml(data.region)}</span><span>币种：JPY</span>
  <span>来源：${escapeHtml(data.source)}</span><span>所属会社：${escapeHtml(data.company)}</span>
  <span>請求書状态：${escapeHtml(data.invoiceStatus)}</span><span>入金状态：${escapeHtml(data.depositStatus)}</span><span>訂単数：${data.rows.length}</span></div></header>
  <div class="summary"><div>总请求金额<strong>¥${number(sum("requestAmount"))}</strong>
  <p class="request-breakdown">口座入金：¥${number(requestAmounts.bank)}<br>现金入金：¥${number(requestAmounts.cash)}<br>未设置入金方式：¥${number(requestAmounts.unassigned)}</p></div>
  <div>利润总和<strong>¥${number(sum("profit"))}</strong></div><div>利润率<strong>${number(rate)}%</strong></div></div>
  <table><colgroup><col style="width:9%"><col style="width:14%"><col style="width:9%"><col style="width:7%">
  <col style="width:8%"><col style="width:7%"><col style="width:7%"><col style="width:8%"><col style="width:8%">
  <col style="width:8%"><col style="width:8%"><col style="width:7%"></colgroup>
  <thead><tr><th>訂単日期</th><th>訂単名称</th><th>来源</th><th>司机</th><th>車両番号</th><th>請求書<br>状态</th><th>入金<br>状态</th><th>请求金额</th><th>司机<br>总立替</th><th>会社<br>总支出</th><th>司机<br>总工资</th><th>訂単<br>总利润</th></tr></thead>
  <tbody>${data.rows.map((row) => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.customer || "未填写")}</td>
  <td>${escapeHtml(row.source || "未填写")}</td><td>${escapeHtml(row.driver || "未安排")}</td><td>${escapeHtml(row.vehicleNumber)}</td>
  <td class="${row.invoiceStatus === "已完成" ? "complete" : "pending"}">${escapeHtml(row.invoiceStatus)}</td>
  <td class="${row.paid ? "complete" : "pending"}">${row.paid ? "入金済み" : "未入金"}</td>
  ${cell(row.requestAmount)}${cell(row.driverAdvances)}${cell(row.companyExpenses)}${cell(row.driverWages)}${cell(row.profit)}</tr>`).join("")}</tbody>
  <tfoot><tr><td colspan="7">筛选范围合计</td>${cell(sum("requestAmount"))}${cell(sum("driverAdvances"))}${cell(sum("companyExpenses"))}${cell(sum("driverWages"))}${cell(sum("profit"))}</tr></tfoot></table>
  <p class="notes">依据当前月份、分区及筛选条件的已保存记录生成，金额口径与経理統計列表一致。<br>
  总请求金额按訂単入金方式分类，不要求填写入金日期，不代表已实际收款；未设置入金方式另列，三项之和等于总请求金额。<br>
  司机总立替与司机工资分别列示。财务数据仅供内部核对，请妥善保管。</p>
  </article></div></body></html>`;
}

export async function printOrderFinance(data: OrderFinancePrintData) {
  await printA4Html(buildOrderFinancePrintHtml(data), "経理統計月度财务表打印");
}
