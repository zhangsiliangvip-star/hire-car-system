import { printA4Html } from "@/lib/print-a4";

export type OrderExpensePrintRow = {
  date: string;
  driver: string;
  vehicleNumber: string;
  offDate: boolean;
  etcCompany: number;
  etcTrip: number;
  fuelCost: number;
  fuelLiters: number;
  driverAdvanceCompany: number;
  driverAdvanceTrip: number;
  companyAdvanceCompany: number;
  companyAdvanceTrip: number;
  overtime: number;
  wages: number;
};

type ExpensePrintData = {
  name: string;
  period: string;
  note: string;
  rows: OrderExpensePrintRow[];
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function buildOrderExpensePrintHtml(data: ExpensePrintData) {
  const number = (value: number) =>
    value.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
  const sum = (key: keyof Omit<OrderExpensePrintRow, "date" | "driver" | "vehicleNumber" | "offDate">) =>
    data.rows.reduce((total, row) => total + row[key], 0);
  const unitPrice = (cost: number, liters: number) => liters > 0 ? number(cost / liters) : "—";
  const detail = (label: string, value: string, span = 1) =>
    `<td colspan="${span}"><small>${label}</small><strong>${value}</strong></td>`;
  const dailyRows = [...data.rows].sort((first, second) => first.date.localeCompare(second.date))
    .map((row) => `<section class="day">
    <div class="day-heading"><strong>${escapeHtml(row.date)}${row.offDate ? "（休运）" : ""}</strong>
    <span>運転士：${escapeHtml(row.driver || "—")}</span><span>車両番号：${escapeHtml(row.vehicleNumber || "—")}</span></div>
    <table><tbody><tr>
    ${detail("ETC（社報）", number(row.etcCompany))}${detail("ETC（旅報）", number(row.etcTrip))}
    ${detail("燃油費", number(row.fuelCost))}${detail("燃油消耗（L）", number(row.fuelLiters))}
    ${detail("油价（JPY/L）", unitPrice(row.fuelCost, row.fuelLiters))}${detail("超時工資（工資内数）", number(row.overtime))}
    </tr><tr>${detail("運転士立替（社報）", number(row.driverAdvanceCompany))}${detail("運転士立替（旅報）", number(row.driverAdvanceTrip))}
    ${detail("会社立替（社報）", number(row.companyAdvanceCompany))}${detail("会社立替（旅報）", number(row.companyAdvanceTrip))}
    ${detail("運転士工資（含超時及奖励）", number(row.wages), 2)}
    </tr></tbody></table></section>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <title>团务費用明細</title><style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; color: #172033; background: white; }
    body { font: 12px Arial, "Microsoft YaHei", sans-serif; }
    .sheet { width: 190mm; height: 276mm; overflow: hidden; }
    .content { width: 190mm; transform-origin: top left; }
    header { border-bottom: 2px solid #263b53; padding-bottom: 12px; }
    h1 { margin: 0 0 10px; font-size: 23px; letter-spacing: 3px; }
    .meta { display: flex; gap: 20px; flex-wrap: wrap; }
    .name { font-size: 14px; font-weight: bold; overflow-wrap: anywhere; }
    h2 { margin: 16px 0 6px; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    td { border: 1px solid #bac3cd; padding: 4px; overflow-wrap: anywhere; width: 16.666%; }
    td strong { display: block; text-align: right; font-variant-numeric: tabular-nums; margin-top: 3px; }
    .day { margin-top: 8px; break-inside: avoid; }
    .day-heading { display: flex; flex-wrap: wrap; gap: 6px 18px; background: #edf1f5; border: 1px solid #bac3cd; border-bottom: 0; padding: 5px; overflow-wrap: anywhere; }
    small { display: block; color: #555; font-size: 12px; }
    .cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 14px; }
    .card { border: 1px solid #bac3cd; padding: 9px; }
    .card strong { display: block; font-size: 18px; margin-top: 5px; }
    .note { border: 1px solid #bac3cd; padding: 8px; min-height: 50px; white-space: pre-wrap; overflow-wrap: anywhere; }
    footer { margin-top: 12px; font-size: 12px; color: #555; }
    </style></head><body><div class="sheet"><article class="content">
    <header><h1>团务費用明細</h1><p class="name">${escapeHtml(data.name || "未填写訂単名称")}</p>
    <div class="meta"><span>行程日期：${escapeHtml(data.period)}</span><span>金額单位：JPY ／ 燃油：L ／ 油价：JPY/L</span></div></header>
    <h2>每日運転士与成本明細</h2>${dailyRows}
    <h2>整单費用汇総</h2>
    <table><tbody><tr>
    ${detail("ETC（社報）合计", number(sum("etcCompany")))}${detail("ETC（旅報）合计", number(sum("etcTrip")))}
    ${detail("燃油費合计", number(sum("fuelCost")))}${detail("燃油消耗合计（L）", number(sum("fuelLiters")))}
    ${detail("平均油价（JPY/L）", unitPrice(sum("fuelCost"), sum("fuelLiters")))}${detail("超時工資合计（工資内数）", number(sum("overtime")))}
    </tr><tr>${detail("運転士立替（社報）合计", number(sum("driverAdvanceCompany")))}${detail("運転士立替（旅報）合计", number(sum("driverAdvanceTrip")))}
    ${detail("会社立替（社報）合计", number(sum("companyAdvanceCompany")))}${detail("会社立替（旅報）合计", number(sum("companyAdvanceTrip")))}
    ${detail("運転士工資合计（含超時及奖励）", number(sum("wages")), 2)}</tr></tbody></table>
    <div class="cards">
    <div class="card">ETC 総额<strong>${number(sum("etcCompany") + sum("etcTrip"))}</strong></div>
    <div class="card">燃油費合计<strong>${number(sum("fuelCost"))}</strong></div>
    <div class="card">運転士立替合计<strong>${number(sum("driverAdvanceCompany") + sum("driverAdvanceTrip"))}</strong></div>
    <div class="card">会社立替合计<strong>${number(sum("companyAdvanceCompany") + sum("companyAdvanceTrip"))}</strong></div>
    <div class="card">運転士工資合计<strong>${number(sum("wages"))}</strong></div></div>
    <h2>备注</h2><div class="note">${escapeHtml(data.note)}</div>
    <footer>按当前财务编辑内容生成（未自動保存）。油价合计按総燃油費 ÷ 総消耗计算。超時工資已包含在運転士工資中，請勿重复计入。</footer>
    </article></div></body></html>`;
}

export async function printOrderExpenses(data: ExpensePrintData) {
  await printA4Html(buildOrderExpensePrintHtml(data), "团务費用明細打印");
}
