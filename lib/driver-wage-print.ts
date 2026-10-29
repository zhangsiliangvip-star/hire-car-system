import { printA4Html } from "@/lib/print-a4";

type DriverWageRow = {
  serviceDate: string;
  time: string;
  customer: string;
  vehicleNumber: string;
  driverAdvances: number;
  overtimeHours: number;
  overtimeFee: number;
  percentageWage: number;
  fixedWage: number;
  bonusWage: number;
  totalWage: number;
  accountingAssignee: string;
};

type DriverWagePrintData = {
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

export function buildDriverWagePrintHtml(data: DriverWagePrintData) {
  const rows = [...data.rows].sort((first, second) =>
    `${first.serviceDate} ${first.time}`.localeCompare(`${second.serviceDate} ${second.time}`));
  const number = (value: number) => value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  const sum = (key: "driverAdvances" | "overtimeHours" | "overtimeFee" | "percentageWage" | "fixedWage" | "bonusWage" | "totalWage") =>
    rows.reduce((total, row) => total + row[key], 0);
  const cell = (value: number) => `<td class="number">${number(value)}</td>`;
  const manualWageTotal = data.manualItems.reduce((total, item) => total + item.amount, 0);
  const totalWage = sum("totalWage") + manualWageTotal;
  const days = new Set(rows.map((row) => row.serviceDate)).size;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>司机月度工资表</title>
  <style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { padding: 0; margin: 0; background: white; color: #172033; }
  body { font: 10px Arial, "Microsoft YaHei", sans-serif; }
  .sheet { width: 190mm; height: 276mm; overflow: hidden; }
  .content { width: 190mm; transform-origin: top left; }
  h1 { margin: 0 0 14px; font-size: 24px; text-align: center; letter-spacing: 4px; }
  header { border-bottom: 2px solid #263b53; padding-bottom: 12px; }
  .meta { display: flex; flex-wrap: wrap; gap: 10px 24px; font-size: 12px; overflow-wrap: anywhere; }
  .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 14px 0; }
  .summary div { border: 1px solid #bac3cd; padding: 10px; }
  .summary strong { display: block; margin-top: 6px; font-size: 19px; }
  h2 { font-size: 12px; margin: 14px 0 6px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #bac3cd; padding: 6px 3px; overflow-wrap: anywhere; }
  th { background: #edf1f5; font-size: 9px; text-align: center; }
  td { text-align: center; }
  .number { text-align: right; font-variant-numeric: tabular-nums; }
  small { display: block; color: #555; margin-top: 3px; }
  tfoot { font-weight: bold; background: #f4f6f8; }
  .notes { margin-top: 16px; border: 1px solid #bac3cd; padding: 10px; line-height: 1.8; }
  footer { font-size: 9px; color: #555; margin-top: 14px; }
  </style></head><body><div class="sheet"><article class="content">
  <header><h1>司机月度工资表</h1><div class="meta">
  <span>司机：<strong>${escapeHtml(data.driver)}</strong></span><span>工资月份：${escapeHtml(data.month)}</span>
  <span>分区：${escapeHtml(data.region)}</span><span>币种：JPY</span></div></header>
  <p>有记录日数：${days} 日</p>
  <div class="summary"><div>司机立替（工资外）<strong>¥${number(sum("driverAdvances"))}</strong></div>
  <div>工资总额<strong>¥${number(totalWage)}</strong></div>
  <div>支付总额<strong>¥${number(sum("driverAdvances") + totalWage)}</strong></div></div>
  <h2>每日工资明细（日期升序，同日多单分别列示）</h2>
  <table><colgroup><col style="width:10%"><col style="width:17%"><col style="width:10%"><col style="width:9%"><col style="width:5%"><col style="width:8%"><col style="width:7%"><col style="width:8%"><col style="width:8%"><col style="width:9%"><col style="width:9%"></colgroup>
  <thead><tr><th>服务日期</th><th>订单名称／核算担当</th><th>車両番号</th><th>司机立替</th><th>超时<br>h</th><th>超时工资</th><th>奖励</th><th>比例工资</th><th>固定工资</th><th>工资总额</th><th>支付总额</th></tr></thead>
  <tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.serviceDate)}</td>
  <td>${escapeHtml(row.customer)}<small>核算：${escapeHtml(row.accountingAssignee || "—")}</small></td>
  <td>${escapeHtml(row.vehicleNumber || "—")}</td>${cell(row.driverAdvances)}${cell(row.overtimeHours)}
  ${cell(row.overtimeFee)}${cell(row.bonusWage)}${cell(row.percentageWage)}${cell(row.fixedWage)}${cell(row.totalWage)}${cell(row.driverAdvances + row.totalWage)}</tr>`).join("")}</tbody>
  <tfoot><tr><td colspan="3">月度合计</td>${cell(sum("driverAdvances"))}${cell(sum("overtimeHours"))}${cell(sum("overtimeFee"))}${cell(sum("bonusWage"))}${cell(sum("percentageWage"))}${cell(sum("fixedWage"))}${cell(sum("totalWage"))}${cell(sum("driverAdvances") + sum("totalWage"))}</tr></tfoot></table>
  ${data.manualItems.length > 0 ? `<h2>其他手动工资项目</h2><table><thead><tr><th>项目名称</th><th>金额（JPY）</th></tr></thead><tbody>${data.manualItems.map((item) => `<tr><td>${escapeHtml(item.name)}</td>${cell(item.amount)}</tr>`).join("")}</tbody><tfoot><tr><td>手动项目合计</td>${cell(manualWageTotal)}</tr></tfoot></table>` : ""}
  <div class="notes">工资总额 = 超时工资 ＋ 奖励 ＋ 比例工资 ＋ 固定工资 ＋ 手动工资项目。<br>
  支付总额 = 司机立替 ＋ 工资总额；司机立替不计入工资，不含会社立替。未扣除税费或其他扣款，不代表扣税后实发工资或已支付金额。<br>
  有记录日数按不同服务日期去重统计，不作为考勤认定。</div>
  <footer>依据当前所选月份、分区和司机的已保存财务记录生成。订单价格、请求金额及利润不在本表中显示。</footer>
  </article></div></body></html>`;
}

export async function printDriverWages(data: DriverWagePrintData) {
  await printA4Html(buildDriverWagePrintHtml(data), "司机月度工资表打印");
}

type CompanyWagePrintData = {
  month: string;
  company: string;
  region: string;
  rows: (DriverWageRow & { driver: string; regionId?: string; regionName: string })[];
  manualItems: { driver: string; companyName: string; name: string; amount: number }[];
};

export function buildCompanyWagePrintHtml(data: CompanyWagePrintData) {
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
  const number = (value: number) => value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  const cell = (value: number) => `<td class="number">${number(value)}</td>`;
  const manualWageTotal = data.manualItems.reduce((total, item) => total + item.amount, 0);
  const sum = (key: "fixed" | "percentage" | "overtime" | "bonus" | "wages" | "advances") =>
    rows.reduce((total, row) => total + row[key], 0);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>所属会社全员工资总表</title><style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; color: #172033; background: white; }
  body { font: 10px Arial, "Microsoft YaHei", sans-serif; }
  .sheet { width: 190mm; height: 276mm; overflow: hidden; }
  .content { width: 190mm; transform-origin: top left; }
  h1 { margin: 0 0 15px; font-size: 23px; text-align: center; letter-spacing: 2px; }
  header { border-bottom: 2px solid #263b53; padding-bottom: 12px; }
  .meta { display: flex; flex-wrap: wrap; gap: 10px 22px; font-size: 12px; overflow-wrap: anywhere; }
  .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 16px 0; }
  .summary div { border: 1px solid #bac3cd; padding: 12px; }
  .summary strong { display: block; font-size: 19px; margin-top: 6px; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; }
  th, td { border: 1px solid #bac3cd; padding: 7px 3px; overflow-wrap: anywhere; text-align: center; }
  th, tfoot { background: #edf1f5; font-weight: bold; }
  .number { text-align: right; font-variant-numeric: tabular-nums; }
  small { display: block; margin-top: 3px; color: #555; }
  .notes { border: 1px solid #bac3cd; padding: 10px; margin-top: 18px; line-height: 1.8; }
  </style></head><body><div class="sheet"><article class="content">
  <header><h1>所属会社全员工资总表</h1><div class="meta">
  <span>所属会社：<strong>${escapeHtml(data.company)}</strong></span>
  <span>月份：${escapeHtml(data.month)}</span><span>分区：${escapeHtml(data.region)}</span><span>币种：JPY</span></div></header>
  <p>司机人数：${rows.length} 人</p>
  <div class="summary"><div>司机立替（工资外）<strong>¥${number(sum("advances"))}</strong></div>
  <div>工资总额<strong>¥${number(sum("wages") + manualWageTotal)}</strong></div>
  <div>支付总额<strong>¥${number(sum("advances") + sum("wages") + manualWageTotal)}</strong></div></div>
  <table><colgroup><col style="width:4%"><col style="width:16%"><col style="width:6%">
  <col style="width:11%"><col style="width:9%"><col style="width:8%"><col style="width:10%"><col style="width:10%"><col style="width:13%"><col style="width:13%"></colgroup>
  <thead><tr><th>序号</th><th>司机／分区</th><th>记录<br>日数</th><th>司机立替</th><th>超时工资</th><th>奖励</th><th>比例工资</th><th>固定工资</th><th>工资总额</th><th>支付总额</th></tr></thead>
  <tbody>${rows.map((row, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(row.driver)}<small>${escapeHtml(row.region)}</small></td>
  ${cell(row.dates.size)}${cell(row.advances)}${cell(row.overtime)}${cell(row.bonus)}${cell(row.percentage)}${cell(row.fixed)}${cell(row.wages)}${cell(row.advances + row.wages)}</tr>`).join("")}</tbody>
  <tfoot><tr><td colspan="3">合计</td>${cell(sum("advances"))}${cell(sum("overtime"))}${cell(sum("bonus"))}${cell(sum("percentage"))}${cell(sum("fixed"))}${cell(sum("wages"))}${cell(sum("advances") + sum("wages"))}</tr></tfoot></table>
  ${data.manualItems.length > 0 ? `<h2>其他手动工资项目</h2><table><thead><tr><th>司机</th><th>所属会社</th><th>项目</th><th>金额（JPY）</th></tr></thead><tbody>${data.manualItems.map((item) => `<tr><td>${escapeHtml(item.driver)}</td><td>${escapeHtml(item.companyName || "未设置")}</td><td>${escapeHtml(item.name)}</td>${cell(item.amount)}</tr>`).join("")}</tbody><tfoot><tr><td colspan="3">手动项目合计</td>${cell(manualWageTotal)}</tr></tfoot></table>` : ""}
  <div class="notes">按订单所属会社归集所选月份的全部司机，不受单个司机筛选影响。<br>
  同名司机跨分区分别列示；同一司机同一天的多笔订单，记录日数只计一次。无财务记录的司机不列入本表。<br>
  工资总额 = 超时工资 ＋ 奖励 ＋ 比例工资 ＋ 固定工资 ＋ 手动工资项目。支付总额 = 司机立替 ＋ 工资总额。<br>
  司机立替不计入工资，不含会社立替。未扣除税费或其他扣款，不代表扣税后实发工资或已支付金额。</div>
  </article></div></body></html>`;
}

export async function printCompanyWages(data: CompanyWagePrintData) {
  await printA4Html(buildCompanyWagePrintHtml(data), "所属会社全员工资总表打印");
}
