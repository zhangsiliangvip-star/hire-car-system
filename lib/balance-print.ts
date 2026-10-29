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
    [row.requestAmount, row.bankRequestAmount, row.cashRequestAmount, row.unassignedRequestAmount, row.incomeTotal, row.expenseTotal].map((value) =>
      `<td class="number">${yen(value)}</td>`).join("") +
    `<td class="number ${row.net < 0 ? "loss" : "profit"}">${yen(row.net)}</td>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>收支平衡月度報表</title><style>
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
  .request-breakdown { margin-top: 8px; font-size: 10px; line-height: 1.7; }
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
  </style></head><body><div class="sheet"><article class="content">
  <header><h1>收支平衡月度報表</h1><div class="meta">
  <span>服务月份：${escapeHtml(data.month)}</span><span>分区：${escapeHtml(data.region)}</span>
  <span>所属会社：${escapeHtml(data.company)}</span><span>单位：JPY</span></div></header>
  <div class="summary"><div>请求总和<strong>${yen(requestAmount)}</strong>
  <p class="request-breakdown">口座入金：${yen(totals.bankRequestAmount)}<br>现金入金：${yen(totals.cashRequestAmount)}<br>未设置入金方式：${yen(totals.unassignedRequestAmount)}</p></div>
  <div>其他收入总和<strong>${yen(incomeTotal)}</strong></div>
  <div>支出总和<strong>${yen(expenseTotal)}</strong></div>
  <div class="${resultClass}">${resultLabel}<strong>${yen(net)}</strong></div></div>
  <h2>所属会社收支明細</h2><table class="company-summary"><colgroup>${"<col style=\"width:12.5%\">".repeat(8)}</colgroup>
  <thead><tr><th>所属会社</th><th>请求总和</th><th>口座入金</th><th>现金入金</th><th>未设置入金方式</th><th>其他收入（手动）</th><th>支出总和（手动）</th><th>当月利润／亏损</th></tr></thead>
  <tbody>${rows.length ? rows.map((row) =>
    `<tr><td>${escapeHtml(row.companyName || "未填写")}</td>${cells(row)}</tr>`).join("")
    : '<tr><td colspan="8">暂无收支记录</td></tr>'}</tbody>
  <tfoot><tr><td>合计</td>${cells(totals)}</tr></tfoot></table>
  <h2>手动其他收入明細</h2><table><colgroup><col style="width:30%"><col style="width:40%"><col style="width:30%"></colgroup>
  <thead><tr><th>所属会社</th><th>收入项目</th><th class="number">金额（JPY）</th></tr></thead>
  <tbody>${incomes.length ? incomes.map((row) =>
    `<tr><td>${escapeHtml(row.companyName || "未填写")}</td><td>${escapeHtml(row.name)}</td><td class="number">${yen(row.amount)}</td></tr>`).join("")
    : '<tr><td colspan="3">暂无其他收入项目</td></tr>'}</tbody>
  <tfoot><tr><td colspan="2">其他收入合计</td><td class="number">${yen(incomeTotal)}</td></tr></tfoot></table>
  <h2>手动支出明細</h2><table><colgroup><col style="width:30%"><col style="width:40%"><col style="width:30%"></colgroup>
  <thead><tr><th>所属会社</th><th>支出项目</th><th class="number">金额（JPY）</th></tr></thead>
  <tbody>${expenses.length ? expenses.map((row) =>
    `<tr><td>${escapeHtml(row.companyName || "未填写")}</td><td>${escapeHtml(row.name)}</td><td class="number">${yen(row.amount)}</td></tr>`).join("")
    : '<tr><td colspan="3">暂无支出项目</td></tr>'}</tbody>
  <tfoot><tr><td colspan="2">手动支出合计</td><td class="number">${yen(expenseTotal)}</td></tr></tfoot></table>
  <div class="result ${resultClass}"><span>${resultLabel}</span><span>${yen(net)}</span></div>
  <p class="notes">当月利润／亏损＝请求总金额＋手动其他收入总和－手动支出总和。不自动扣除車両費用、司机工資、立替或其他运营支出。<br>
  整单请求金额＝訂単价格＋全日期ETC旅報＋司机立替旅報＋会社立替旅報＋超時请求（旅報），全部归首个服务日所在月份（排除休运日），跨月不分摊。<br>
  请求按訂単所属会社归集，手动收入和支出按项目所属会社及录入月份归集；其他统计和工資算法不变。<br>
  请求按訂単入金方式細分为口座入金、现金入金及未设置入金方式，不以入金日期判断实收；三项之和等于请求总和，不重复计入利润。<br>
  本表沿用页面所选月份、分区与所属会社范围。收入和支出金额采用当前页面输入值，空白按0计算，导出不会自动保存。<br>
  内部财务資料，请妥善保管。</p>
  </article></div></body></html>`;
}

export async function printBalance(data: BalancePrintData) {
  await printA4Html(buildBalancePrintHtml(data), "收支平衡月度報表打印");
}

export function buildCompanyAdvancePrintHtml(data: BalancePrintData) {
  const { payments, paymentAmounts, paymentTotal } = data.summary;
  if (![paymentTotal, ...Object.values(paymentAmounts)].every((value) =>
    Number.isSafeInteger(value) && value >= 0,
  )) {
    throw new Error("外注司机出金合计无效或超出金额范围。");
  }
  const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;
  const methods = ["paypay", "微信", "支付宝", "口座", ""] as const;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>外注司机出金明細</title><style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; color: #172033; background: white; }
  body { font: 11px Arial, "Microsoft YaHei", sans-serif; }
  .sheet { width: 190mm; height: 276mm; overflow: hidden; }
  .content.fit-page-width { width: 190mm; transform-origin: top left; }
  h1 { text-align: center; font-size: 24px; margin: 0 0 14px; }
  h2 { font-size: 15px; margin: 18px 0 8px; }
  .meta, .notes { line-height: 1.8; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #bac3cd; padding: 7px; overflow-wrap: anywhere; text-align: left; }
  th, tfoot { background: #edf1f5; font-weight: bold; }
  .number { text-align: right; font-variant-numeric: tabular-nums; }
  </style></head><body><div class="sheet"><article class="content fit-page-width">
  <h1>外注司机出金明細</h1>
  <p class="meta">服务月份：${escapeHtml(data.month)}　分区：${escapeHtml(data.region)}　所属会社：${escapeHtml(data.company)}　单位：JPY</p>
  <h2>外注司机出金方式汇总</h2><table><thead><tr><th>外注司机出金方式</th><th class="number">总金额（JPY）</th></tr></thead>
  <tbody>${methods.map((method) => `<tr><td>${method || "未设置出金方式"}</td><td class="number">${yen(paymentAmounts[method])}</td></tr>`).join("")}</tbody>
  <tfoot><tr><td>合计</td><td class="number">${yen(paymentTotal)}</td></tr></tfoot></table>
  ${methods.map((method) => {
    const entries = payments.filter((row) => row.method === method);
    return `<section><h2>${method || "未设置出金方式"}明細</h2><table>
    <thead><tr><th>日期</th><th>訂単名称</th><th>所属会社</th><th>外注司机出金状態</th><th>外注司机备注</th><th class="number">金额（JPY）</th></tr></thead>
    <tbody>${entries.length ? entries.map((row) =>
      `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.customer)}</td><td>${escapeHtml(row.companyName || "未填写")}</td><td>${escapeHtml(row.status || "未選択")}</td><td style="white-space:pre-wrap">${escapeHtml(row.note || "")}</td><td class="number">${yen(row.amount)}</td></tr>`).join("")
      : '<tr><td colspan="6">暂无出金记录</td></tr>'}</tbody>
    <tfoot><tr><td colspan="5">${method || "未设置出金方式"}合计</td><td class="number">${yen(paymentAmounts[method])}</td></tr></tfoot></table></section>`;
  }).join("")}
  <p class="notes">仅供对账，不重复计入收支平衡。沿用页面所选月份、分区与所属会社范围，按訂単首个服务月归集訂単全部日期的外注司机費用。使用已保存的财务记录，未设置出金方式单列以免漏账。</p>
  </article></div></body></html>`;
}

export async function printCompanyAdvances(data: BalancePrintData) {
  await printA4Html(buildCompanyAdvancePrintHtml(data), "外注司机出金明細打印");
}
