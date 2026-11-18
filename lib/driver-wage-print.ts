import { printA4Html } from "@/lib/print-a4";
import { companyExportHtml } from "@/lib/company-export";

type DriverWageRow = {
  serviceDate: string;
  time: string;
  customer: string;
  vehicleNumber: string;
  isOutsourcedVehicle?: boolean;
  driverAdvances: number;
  overtimeHours: number;
  overtimeFee: number;
  percentageWage: number;
  fixedWage: number;
  bonusWage: number;
  totalWage: number;
  accountingAssignee: string;
};

export type DriverWagePrintData = {
  driver: string;
  month: string;
  region: string;
  rows: DriverWageRow[];
  manualItems: { name: string; amount: number }[];
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function wageVehicleNumber(value: string) {
  const suffix = value.normalize("NFKC").trim().match(/([0-9][0-9\s.・･·\-‐‑–—−]*)$/u)?.[1];
  return suffix ? suffix.replace(/\D/g, "").slice(-4) : "";
}

export function prepareDriverWageExport(data: DriverWagePrintData) {
  const rows = [...data.rows].sort((first, second) =>
    `${first.serviceDate} ${first.time}`.localeCompare(`${second.serviceDate} ${second.time}`));
  const totals = rows.reduce((total, row) => ({
    driverAdvances: total.driverAdvances + row.driverAdvances,
    overtimeHours: total.overtimeHours + row.overtimeHours,
    overtimeFee: total.overtimeFee + row.overtimeFee,
    percentageWage: total.percentageWage + row.percentageWage,
    fixedWage: total.fixedWage + row.fixedWage,
    bonusWage: total.bonusWage + row.bonusWage,
    totalWage: total.totalWage + row.totalWage,
  }), { driverAdvances: 0, overtimeHours: 0, overtimeFee: 0, percentageWage: 0, fixedWage: 0, bonusWage: 0, totalWage: 0 });
  const manualWageTotal = data.manualItems.reduce((total, item) => total + item.amount, 0);
  const days = new Set(rows.map((row) => row.serviceDate)).size;
  return { rows, totals, manualWageTotal, days };
}

export function buildDriverWagePrintHtml(data: DriverWagePrintData) {
  const { rows, totals, manualWageTotal, days } = prepareDriverWageExport(data);
  const number = (value: number) => value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  const sum = (key: keyof typeof totals) => totals[key];
  const cell = (value: number) => `<td class="number">${number(value)}</td>`;
  const totalWage = totals.totalWage;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(data.month)}月給与明細</title>
  <style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { padding: 0; margin: 0; background: white; color: #172033; }
  body { font: 13px Arial, "Microsoft YaHei", sans-serif; }
  .sheet { width: 190mm; height: auto; overflow: visible; }
  .content.expand-pages { width: 190mm; }
  h1 { margin: 0 0 5px; font-size: 22px; text-align: center; letter-spacing: 2px; }
  header { border-bottom: 2px solid #263b53; padding-bottom: 5px; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; overflow-wrap: anywhere; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 6px 0; }
  .summary div { border: 1px solid #bac3cd; padding: 4px 8px; }
  .summary strong { display: block; margin-top: 1px; font-size: 20px; }
  h2 { font-size: 14px; margin: 7px 0 4px; break-after: avoid; page-break-after: avoid; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #bac3cd; padding: 4px 2px; overflow-wrap: anywhere; }
  th { background: #edf1f5; font-size: 13px; text-align: center; }
  td { text-align: center; }
  tbody td { font-size: 13px; line-height: 1.3; }
  .number { text-align: right; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .order-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  thead { display: table-header-group; }
  tfoot { display: table-row-group; font-weight: bold; background: #f4f6f8; }
  tr, header, .summary { break-inside: avoid; page-break-inside: avoid; }
  </style></head><body><div class="sheet"><article class="content expand-pages">
  <header><h1>${escapeHtml(data.month)}月給与明細</h1><div class="meta">
  <span><strong>${companyExportHtml(data.driver, escapeHtml)}</strong></span>
  <span>有記録日数：${days} 日</span></div></header>
  <div class="summary"><div>立替<strong>¥${number(sum("driverAdvances"))}</strong></div>
  <div>工資総额<strong>¥${number(totalWage)}</strong></div>
  <div>追加項目<strong>¥${number(manualWageTotal)}</strong></div>
  <div>支付総额<strong>¥${number(sum("driverAdvances") + totalWage + manualWageTotal)}</strong></div></div>
  <h2>每日工資明細（日期升序，同日多单分别列示）</h2>
  <table><colgroup><col style="width:8%"><col style="width:24%"><col style="width:7%"><col style="width:10%"><col style="width:5%"><col style="width:9%"><col style="width:7%"><col style="width:10%"><col style="width:9%"><col style="width:11%"></colgroup>
  <thead><tr><th>服务日期</th><th>訂単名称</th><th>車番</th><th>立替</th><th>超時<br>h</th><th>超時工資</th><th>奖励</th><th>比例工資</th><th>固定工資</th><th>支付総额</th></tr></thead>
  <tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.serviceDate.slice(5))}</td>
  <td class="order-name" title="${escapeHtml(row.customer)}">${escapeHtml(row.customer)}</td>
  <td>${row.isOutsourcedVehicle ? "" : wageVehicleNumber(row.vehicleNumber)}</td>${cell(row.driverAdvances)}${cell(row.overtimeHours)}
  ${cell(row.overtimeFee)}${cell(row.bonusWage)}${cell(row.percentageWage)}${cell(row.fixedWage)}${cell(row.driverAdvances + row.totalWage)}</tr>`).join("")}</tbody>
  <tfoot><tr><td colspan="3">月度合计</td>${cell(sum("driverAdvances"))}${cell(sum("overtimeHours"))}${cell(sum("overtimeFee"))}${cell(sum("bonusWage"))}${cell(sum("percentageWage"))}${cell(sum("fixedWage"))}${cell(sum("driverAdvances") + sum("totalWage"))}</tr></tfoot></table>
  ${data.manualItems.length > 0 ? `<h2>追加項目</h2><table><thead><tr><th>项目名称</th><th>金額（JPY）</th></tr></thead><tbody>${data.manualItems.map((item) => `<tr><td>${escapeHtml(item.name)}</td>${cell(item.amount)}</tr>`).join("")}</tbody><tfoot><tr><td>追加項目合计</td>${cell(manualWageTotal)}</tr></tfoot></table>` : ""}
  </article></div></body></html>`;
}

export async function printDriverWages(data: DriverWagePrintData) {
  await printA4Html(buildDriverWagePrintHtml(data), `${data.month}月給与明細打印`);
}

export type CompanyWagePrintData = {
  month: string;
  company: string;
  region: string;
  rows: (DriverWageRow & { driver: string; regionId?: string; regionName: string })[];
  manualItems: { driver: string; companyName: string; name: string; amount: number }[];
};

export function prepareCompanyWageExport(data: CompanyWagePrintData) {
  const groups = new Map<string, {
    driver: string; region: string; dates: Set<string>;
    fixed: number; percentage: number; overtime: number; bonus: number; wages: number; advances: number;
  }>();
  for (const row of data.rows) {
    const key = JSON.stringify([row.regionId, row.driver]);
    const group = groups.get(key) || {
      driver: row.driver, region: row.regionName, dates: new Set<string>(),
      fixed: 0, percentage: 0, overtime: 0, bonus: 0, wages: 0, advances: 0,
    };
    group.dates.add(row.serviceDate);
    group.fixed += row.fixedWage;
    group.percentage += row.percentageWage;
    group.overtime += row.overtimeFee;
    group.bonus += row.bonusWage;
    group.wages += row.totalWage;
    group.advances += row.driverAdvances;
    groups.set(key, group);
  }
  const rows = [...groups.values()].sort((first, second) =>
    first.region.localeCompare(second.region) || first.driver.localeCompare(second.driver));
  const manualWageTotal = data.manualItems.reduce((total, item) => total + item.amount, 0);
  return { rows, manualWageTotal };
}

export function buildCompanyWagePrintHtml(data: CompanyWagePrintData) {
  const { rows, manualWageTotal } = prepareCompanyWageExport(data);
  const number = (value: number) => value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  const cell = (value: number) => `<td class="number">${number(value)}</td>`;
  const sum = (key: "fixed" | "percentage" | "overtime" | "bonus" | "wages" | "advances") =>
    rows.reduce((total, row) => total + row[key], 0);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>所属会社全员工資総表</title><style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; color: #172033; background: white; }
  body { font: 13px Arial, "Microsoft YaHei", sans-serif; }
  .sheet { width: 190mm; height: auto; overflow: visible; }
  .content.expand-pages { width: 190mm; }
  h1 { margin: 0 0 5px; font-size: 22px; text-align: center; letter-spacing: 2px; }
  header { border-bottom: 2px solid #263b53; padding-bottom: 5px; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; overflow-wrap: anywhere; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 6px 0; }
  .summary div { border: 1px solid #bac3cd; padding: 4px 8px; }
  .summary strong { display: block; margin-top: 1px; font-size: 20px; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; }
  th, td { border: 1px solid #bac3cd; padding: 4px 2px; overflow-wrap: anywhere; text-align: center; }
  th, tfoot { background: #edf1f5; font-weight: bold; }
  thead { display: table-header-group; }
  tfoot { display: table-row-group; }
  tr, header, .summary { break-inside: avoid; page-break-inside: avoid; }
  h2 { font-size: 14px; margin: 7px 0 4px; break-after: avoid; page-break-after: avoid; }
  tbody td { font-size: 13px; line-height: 1.3; }
  .number { text-align: right; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
  </style></head><body><div class="sheet"><article class="content expand-pages">
  <header><h1>所属会社全员工資総表</h1><div class="meta">
  <span>所属会社：<strong>${companyExportHtml(data.company, escapeHtml)}</strong></span>
  <span>月份：${escapeHtml(data.month)}</span><span>運転士人数：${rows.length} 人</span></div></header>
  <div class="summary"><div>立替<strong>¥${number(sum("advances"))}</strong></div>
  <div>工資総额<strong>¥${number(sum("wages"))}</strong></div>
  <div>追加項目<strong>¥${number(manualWageTotal)}</strong></div>
  <div>支付総额<strong>¥${number(sum("advances") + sum("wages") + manualWageTotal)}</strong></div></div>
  <table><colgroup><col style="width:4%"><col style="width:18%"><col style="width:7%">
  <col style="width:12%"><col style="width:10%"><col style="width:9%"><col style="width:11%"><col style="width:12%"><col style="width:17%"></colgroup>
  <thead><tr><th>序号</th><th>運転士</th><th>記録<br>日数</th><th>立替</th><th>超時工資</th><th>奖励</th><th>比例工資</th><th>固定工資</th><th>支付総额</th></tr></thead>
  <tbody>${rows.map((row, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(row.driver)}</td>
  ${cell(row.dates.size)}${cell(row.advances)}${cell(row.overtime)}${cell(row.bonus)}${cell(row.percentage)}${cell(row.fixed)}${cell(row.advances + row.wages)}</tr>`).join("")}</tbody>
  <tfoot><tr><td colspan="3">合计</td>${cell(sum("advances"))}${cell(sum("overtime"))}${cell(sum("bonus"))}${cell(sum("percentage"))}${cell(sum("fixed"))}${cell(sum("advances") + sum("wages"))}</tr></tfoot></table>
  ${data.manualItems.length > 0 ? `<h2>追加項目</h2><table><thead><tr><th>運転士</th><th>所属会社</th><th>项目</th><th>金額（JPY）</th></tr></thead><tbody>${data.manualItems.map((item) => `<tr><td>${escapeHtml(item.driver)}</td><td>${companyExportHtml(item.companyName || "未设置", escapeHtml)}</td><td>${escapeHtml(item.name)}</td>${cell(item.amount)}</tr>`).join("")}</tbody><tfoot><tr><td colspan="3">追加項目合计</td>${cell(manualWageTotal)}</tr></tfoot></table>` : ""}
  </article></div></body></html>`;
}

export async function printCompanyWages(data: CompanyWagePrintData) {
  await printA4Html(buildCompanyWagePrintHtml(data), "所属会社全员工資総表打印");
}
