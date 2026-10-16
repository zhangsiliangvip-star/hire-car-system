import { printA4Html } from "@/lib/print-a4";
import type { BalanceSummary } from "@/lib/balance-summary";

type BalancePrintData = {
  month: string;
  region: string;
  company: string;
  summary: BalanceSummary;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function buildBalancePrintHtml(data: BalancePrintData) {
  const { rows, expenses, incomes, totals } = data.summary;
  const { requestAmount, incomeTotal, expenseTotal, net } = totals;
  if (!Object.values(totals).every(Number.isSafeInteger)) {
    throw new Error("收支合计超出金额范围，请缩小筛选范围。");
  }
  const resultLabel = net < 0 ? "当月亏损" : "当月利润";
  const resultClass = net < 0 ? "loss" : "profit";
  const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;
  const cells = (row: BalanceSummary["totals"]) =>
    [row.requestAmount, row.incomeTotal, row.expenseTotal].map((value) =>
      `<td class="number">${yen(value)}</td>`).join("") +
    `<td class="number ${row.net < 0 ? "loss" : "profit"}">${yen(row.net)}</td>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>收支平衡月度报表</title><style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; color: #172033; }
  body { font: 11px Arial, "Microsoft YaHei", sans-serif; }
  .sheet { width: 190mm; height: 276mm; overflow: hidden; }
  .content { width: 190mm; transform-origin: top left; }
  h1 { font-size: 24px; text-align: center; margin: 0 0 14px; }
  header { border-bottom: 2px solid #263b53; padding-bottom: 12px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 20px; overflow-wrap: anywhere; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px 0; }
  .summary div { border: 1px solid #bac3cd; padding: 12px; }
  .summary strong { display: block; font-size: 18px; margin-top: 8px; overflow-wrap: anywhere; }
  h2 { font-size: 14px; margin: 16px 0 8px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #bac3cd; padding: 7px 8px; overflow-wrap: anywhere; text-align: left; }
  .company-summary { font-size: 11px; }
  .company-summary th, .company-summary td { padding: 7px 3px; }
  th, tfoot { background: #edf1f5; font-weight: bold; }
  .number { text-align: right; font-variant-numeric: tabular-nums; }
  .profit { color: #000; } .loss { color: #dc2626; }
  .result { display: flex; justify-content: space-between; gap: 12px; margin-top: 18px; border: 2px solid #263b53; padding: 14px; font-size: 19px; font-weight: bold; }
  .notes { margin-top: 14px; line-height: 1.8; }
  .signatures { display: flex; justify-content: space-between; gap: 10px; margin-top: 28px; padding-bottom: 10px; }
  </style></head><body><div class="sheet"><article class="content">
  <header><h1>收支平衡月度报表</h1><div class="meta">
  <span>服务月份：${escapeHtml(data.month)}</span><span>分区：${escapeHtml(data.region)}</span>
  <span>所属会社：${escapeHtml(data.company)}</span><span>单位：JPY</span></div></header>
  <div class="summary"><div>请求总和<strong>${yen(requestAmount)}</strong></div>
  <div>其他收入总和<strong>${yen(incomeTotal)}</strong></div>
  <div>支出总和<strong>${yen(expenseTotal)}</strong></div>
  <div class="${resultClass}">${resultLabel}<strong>${yen(net)}</strong></div></div>
  <h2>所属会社收支明细</h2><table class="company-summary"><colgroup>${"<col style=\"width:20%\">".repeat(5)}</colgroup>
  <thead><tr><th>所属会社</th><th>请求总和</th><th>其他收入（手动）</th><th>支出总和（手动）</th><th>当月利润／亏损</th></tr></thead>
  <tbody>${rows.length ? rows.map((row) =>
    `<tr><td>${escapeHtml(row.companyName || "未填写")}</td>${cells(row)}</tr>`).join("")
    : '<tr><td colspan="5">暂无收支记录</td></tr>'}</tbody>
  <tfoot><tr><td>合计</td>${cells(totals)}</tr></tfoot></table>
  <h2>手动其他收入明细</h2><table><colgroup><col style="width:30%"><col style="width:40%"><col style="width:30%"></colgroup>
  <thead><tr><th>所属会社</th><th>收入项目</th><th class="number">金额（JPY）</th></tr></thead>
  <tbody>${incomes.length ? incomes.map((row) =>
    `<tr><td>${escapeHtml(row.companyName || "未填写")}</td><td>${escapeHtml(row.name)}</td><td class="number">${yen(row.amount)}</td></tr>`).join("")
    : '<tr><td colspan="3">暂无其他收入项目</td></tr>'}</tbody>
  <tfoot><tr><td colspan="2">其他收入合计</td><td class="number">${yen(incomeTotal)}</td></tr></tfoot></table>
  <h2>手动支出明细</h2><table><colgroup><col style="width:30%"><col style="width:40%"><col style="width:30%"></colgroup>
  <thead><tr><th>所属会社</th><th>支出项目</th><th class="number">金额（JPY）</th></tr></thead>
  <tbody>${expenses.length ? expenses.map((row) =>
    `<tr><td>${escapeHtml(row.companyName || "未填写")}</td><td>${escapeHtml(row.name)}</td><td class="number">${yen(row.amount)}</td></tr>`).join("")
    : '<tr><td colspan="3">暂无支出项目</td></tr>'}</tbody>
  <tfoot><tr><td colspan="2">手动支出合计</td><td class="number">${yen(expenseTotal)}</td></tr></tfoot></table>
  <div class="result ${resultClass}"><span>${resultLabel}</span><span>${yen(net)}</span></div>
  <p class="notes">当月利润／亏损＝请求总金额＋手动其他收入总和－手动支出总和。不自动扣除车辆费用、司机工资、立替或其他运营支出。<br>
  整单请求金额＝订单价格＋全日期ETC旅报＋司机立替旅报＋会社立替旅报＋超时费，全部归首个服务日所在月份（排除休运日），跨月不分摊。<br>
  请求按订单所属会社归集，手动收入和支出按项目所属会社及录入月份归集；其他统计和工资算法不变。<br>
  本表沿用页面所选月份、分区与所属会社范围。收入和支出金额采用当前页面输入值，空白按0计算，导出不会自动保存。<br>
  内部财务资料，请妥善保管。</p>
  <div class="signatures"><span>制表：________________</span><span>审核：________________</span><span>日期：________________</span></div>
  </article></div></body></html>`;
}

export async function printBalance(data: BalancePrintData) {
  await printA4Html(buildBalancePrintHtml(data), "收支平衡月度报表打印");
}
