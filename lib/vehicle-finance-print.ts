import { printA4Html } from "@/lib/print-a4";
import { totalVehicleSummaries, type VehicleMonthlySummary } from "@/lib/vehicle-finance-summary";

type VehicleFinanceRow = {
  serviceDate: string;
  customer: string;
  driver: string;
  vehicleNumber: string;
  requestAmount: number;
  driverAdvances: number;
  companyExpenses: number;
  driverWages: number;
  profit: number;
};

type VehicleFinancePrintData = {
  month: string;
  region: string;
  vehicleNumber: string;
  rows: VehicleFinanceRow[];
  monthly: {
    parkingFee: string;
    insuranceFee: string;
    inspectionFee: string;
    repairFee: string;
    supplies: { description: string; amount: string }[];
    startOdometer: string;
    endOdometer: string;
  } | null;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function buildVehicleFinancePrintHtml(data: VehicleFinancePrintData) {
  const number = (value: number) => value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  const yen = (value: number) => `¥${number(value)}`;
  const sum = (key: "requestAmount" | "driverAdvances" | "companyExpenses" | "driverWages" | "profit") =>
    data.rows.reduce((total, row) => total + row[key], 0);
  const cell = (value: number) => `<td class="number">${number(value)}</td>`;
  const amount = (value: string, label: string, limit = 99_999_999_999_999) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > limit) {
      throw new Error(`${label}须为有效范围内的非负整数。`);
    }
    return parsed;
  };
  let monthlyHtml = "";
  let netSummary = "";
  if (data.monthly) {
    const monthly = data.monthly;
    const fees = [
      ["停車场費用", amount(monthly.parkingFee, "停車场費用")],
      ["保险費用", amount(monthly.insuranceFee, "保险費用")],
      ["点检／車检費用", amount(monthly.inspectionFee, "点检／車检費用")],
      ["维修費用", amount(monthly.repairFee, "维修費用")],
    ] as const;
    const supplies = monthly.supplies
      .filter((supply) => supply.description.trim() || supply.amount.trim())
      .map((supply) => {
        if (!supply.description.trim() || !supply.amount.trim()) {
          throw new Error("请为每条备品填写名称和非负整数金额后再导出。");
        }
        if (supply.description.trim().length > 300) throw new Error("备品名称最多300个字符。");
        return { description: supply.description.trim(), amount: amount(supply.amount, "备品金额") };
      });
    if (supplies.length > 100) throw new Error("备品明细最多100条。");
    const suppliesTotal = supplies.reduce((total, supply) => total + supply.amount, 0);
    const expenses = fees.reduce((total, [, value]) => total + value, suppliesTotal);
    if (!Number.isSafeInteger(expenses)) throw new Error("月度費用合计超出金额范围。");
    const start = monthly.startOdometer.trim() ? amount(monthly.startOdometer, "月初公里数", 99_999_999_999) : null;
    const end = monthly.endOdometer.trim() ? amount(monthly.endOdometer, "月末公里数", 99_999_999_999) : null;
    if (start !== null && end !== null && end < start) throw new Error("月末公里数不能小于月初公里数。");
    const distance = start !== null && end !== null ? end - start : null;
    const net = sum("profit") - expenses;
    netSummary = `<div>月度費用<strong>${yen(expenses)}</strong></div><div>扣除費用后利润<strong>${yen(net)}</strong></div>`;
    monthlyHtml = `<h2>月度固定費用与备品</h2><table><thead><tr><th>停車场費用</th><th>保险費用</th><th>点检／車检費用</th><th>维修費用</th><th>备品費用合计</th><th>月度費用合计</th></tr></thead>
    <tbody><tr>${fees.map(([, value]) => cell(value)).join("")}${cell(suppliesTotal)}${cell(expenses)}</tr></tbody></table>
    <div class="supplies"><strong>备品明细：</strong>${supplies.length
      ? supplies.map((supply) => `${escapeHtml(supply.description)}：${yen(supply.amount)}`).join("；")
      : "无"}</div>
    <h2>里程与收益</h2><table><thead><tr><th>月初公里数</th><th>月末公里数</th><th>当月走行公里数</th><th>每公里利润（JPY/km）</th></tr></thead>
    <tbody><tr><td>${start === null ? "—" : number(start)}</td><td>${end === null ? "—" : number(end)}</td>
    <td>${distance === null ? "—" : number(distance)}</td><td>${distance !== null && distance > 0 ? number(net / distance) : "—"}</td></tr></tbody></table>`;
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>車両統計月度财务表</title><style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; color: #172033; }
  body { font: 10px Arial, "Microsoft YaHei", sans-serif; }
  .sheet { width: 190mm; height: 276mm; overflow: hidden; }
  .content { width: 190mm; transform-origin: top left; }
  h1 { margin: 0 0 14px; font-size: 23px; text-align: center; letter-spacing: 2px; }
  header { border-bottom: 2px solid #263b53; padding-bottom: 12px; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 20px; font-size: 12px; overflow-wrap: anywhere; }
  .summary { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
  .summary div { flex: 1 1 120px; border: 1px solid #bac3cd; padding: 9px; }
  .summary strong { display: block; font-size: 16px; margin-top: 6px; }
  h2 { font-size: 12px; margin: 14px 0 6px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #bac3cd; padding: 6px 3px; overflow-wrap: anywhere; }
  th, tfoot { background: #edf1f5; font-weight: bold; }
  th { font-size: 9px; }
  td { text-align: center; }
  .number { text-align: right; font-variant-numeric: tabular-nums; }
  .supplies, .notes { margin-top: 10px; line-height: 1.8; overflow-wrap: anywhere; }
  </style></head><body><div class="sheet"><article class="content">
  <header><h1>車両統計月度财务表</h1><div class="meta"><span>月份：${escapeHtml(data.month)}</span>
  <span>車両番号：${escapeHtml(data.vehicleNumber)}</span><span>分区：${escapeHtml(data.region)}</span><span>币种：JPY ／ 里程：km</span></div></header>
  <div class="summary"><div>请求金额合计<strong>${yen(sum("requestAmount"))}</strong></div>
  <div>訂単利润总和<strong>${yen(sum("profit"))}</strong></div>${netSummary}</div>
  <h2>每日运营明细</h2>
  <table><colgroup><col style="width:11%"><col style="width:18%"><col style="width:10%"><col style="width:9%">
  <col style="width:11%"><col style="width:10%"><col style="width:10%"><col style="width:10%"><col style="width:11%"></colgroup>
  <thead><tr><th>服务日期</th><th>訂単名称</th><th>車両番号</th><th>司机</th><th>请求金额</th><th>司机立替</th><th>会社支出</th><th>司机工资</th><th>訂単利润</th></tr></thead>
  <tbody>${data.rows.map((row) => `<tr><td>${escapeHtml(row.serviceDate)}</td><td>${escapeHtml(row.customer)}</td>
  <td>${escapeHtml(row.vehicleNumber)}</td><td>${escapeHtml(row.driver)}</td>${cell(row.requestAmount)}${cell(row.driverAdvances)}
  ${cell(row.companyExpenses)}${cell(row.driverWages)}${cell(row.profit)}</tr>`).join("")}</tbody>
  <tfoot><tr><td colspan="4">合计</td>${cell(sum("requestAmount"))}${cell(sum("driverAdvances"))}${cell(sum("companyExpenses"))}${cell(sum("driverWages"))}${cell(sum("profit"))}</tr></tfoot></table>
  ${monthlyHtml}
  <p class="notes">${data.monthly
    ? "运营明细采用已保存的日财务记录；月度費用和里程采用当前页面填写内容，导出不会自动保存。扣除費用后利润＝訂単利润总和－月度費用；每公里利润＝扣除費用后利润÷走行公里数。"
    : "全部車両模式仅汇总运营明细，不包含車両月度固定費用、备品和里程。请筛选具体車両查看完整月度費用及净利润。"}
  <br>司机立替与工资分别列示，财务口径与車両統計列表一致。内部资料，请妥善保管。</p>
  </article></div></body></html>`;
}

export async function printVehicleFinance(data: VehicleFinancePrintData) {
  await printA4Html(buildVehicleFinancePrintHtml(data), "車両統計月度财务表打印");
}

type VehicleSummaryPrintData = {
  month: string;
  region: string;
  rows: VehicleMonthlySummary[];
  regionNames: Record<string, string>;
};

export function buildVehicleSummaryPrintHtml(data: VehicleSummaryPrintData) {
  const number = (value: number) => value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  const cell = (value: number) => `<td class="number">${number(value)}</td>`;
  const totals = totalVehicleSummaries(data.rows);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>全車両月度统计表</title><style>
  @page { size: A4 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: white; color: #172033; }
  body { font: 10px Arial, "Microsoft YaHei", sans-serif; }
  .sheet { width: 190mm; height: 276mm; overflow: hidden; }
  .content { width: 190mm; transform-origin: top left; }
  h1 { font-size: 23px; text-align: center; margin: 0 0 14px; }
  .meta { display: flex; gap: 18px; flex-wrap: wrap; border-bottom: 2px solid #263b53; padding-bottom: 12px; }
  .summary { margin: 14px 0; padding: 12px; border: 1px solid #bac3cd; font-size: 13px; }
  .summary strong { font-size: 21px; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; }
  th, td { padding: 7px 3px; border: 1px solid #bac3cd; overflow-wrap: anywhere; text-align: center; }
  th, tfoot { background: #edf1f5; font-weight: bold; }
  .number { text-align: right; font-variant-numeric: tabular-nums; }
  small { display: block; color: #555; }
  .notes { margin-top: 14px; line-height: 1.8; }
  </style></head><body><div class="sheet"><article class="content">
  <h1>全車両月度统计表</h1><div class="meta"><span>服务月份：${escapeHtml(data.month)}</span>
  <span>分区：${escapeHtml(data.region)}</span><span>車両数：${data.rows.length}</span><span>单位：JPY</span></div>
  <div class="summary">利润汇总（已扣固定費用与备品）：<strong>¥${number(totals.profit)}</strong></div>
  <table><colgroup><col style="width:10%"><col style="width:18%"><col style="width:12%">
  <col style="width:11%"><col style="width:12%"><col style="width:11%"><col style="width:13%"><col style="width:13%"></colgroup>
  <thead><tr><th>服务月份</th><th>車両番号</th><th>请求总金额</th><th>司机立替</th><th>会社支付</th><th>司机工资</th><th>固定費用与备品</th><th>訂単利润<br>（扣費后）</th></tr></thead>
  <tbody>${data.rows.map((row) => `<tr><td>${escapeHtml(row.month)}</td><td>${escapeHtml(row.vehicleNumber)}
  <small>${escapeHtml(data.regionNames[row.regionId || ""] || "未知地域")}</small></td>
  ${cell(row.requestAmount)}${cell(row.driverAdvances)}${cell(row.companyExpenses)}${cell(row.driverWages)}${cell(row.fixedExpenses)}${cell(row.profit)}</tr>`).join("")}</tbody>
  <tfoot><tr><td colspan="2">合计／利润汇总</td>${cell(totals.requestAmount)}${cell(totals.driverAdvances)}${cell(totals.companyExpenses)}${cell(totals.driverWages)}${cell(totals.fixedExpenses)}${cell(totals.profit)}</tr></tfoot></table>
  <p class="notes">訂単利润＝请求总金额－司机立替－会社支付－司机工资－固定費用与备品。<br>
  月度費用优先采用所选月份已保存的记录；未登记时仅采用車両资料的默认停車场費及保险費。无运营记录車両仍列示固定成本；未匹配到車両资料的历史记录单独标注，固定成本未知，暂记0。<br>
  本表包含外注車両，番号旁标注“外注”；未登记番号时明确提示。按車両及分区归集，未保存的单車費用编辑不计入。内部财务资料，请妥善保管。</p>
  </article></div></body></html>`;
}

export async function printVehicleSummary(data: VehicleSummaryPrintData) {
  await printA4Html(buildVehicleSummaryPrintHtml(data), "全車両月度统计表打印");
}
