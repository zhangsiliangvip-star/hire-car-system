import type { Company, Driver, DriverWageItem } from "@/lib/domain";
import type { DriverWagePrintData } from "@/lib/driver-wage-print";
import { getJapanDate } from "@/lib/vehicle-compliance";
import { splitDriverAddress } from "@/lib/driver-address";
import { formatMobilePhone } from "@/lib/phone-format";

export type DriverPaymentRow = DriverWagePrintData["rows"][number] & {
  driver: string; company: string; regionId?: string;
};
export type DriverPaymentSummary = {
  key: string; driver: string; company: string; regionId?: string;
  rows: DriverPaymentRow[]; manualItems: DriverWageItem[];
  advances: number; overtime: number; bonus: number; percentage: number; fixed: number;
  manual: number; remuneration: number; total: number;
};
export type DriverPaymentInvoice = {
  month: string; issuedDate: string; driver: Driver; company: Company; summary: DriverPaymentSummary;
};

function sum(values: number[]) {
  const total = values.reduce((result, value) => {
    if (!Number.isSafeInteger(value)) throw new Error("支付金额须为有效的日元整数。");
    const next = result + value;
    if (!Number.isSafeInteger(next)) throw new Error("支付金额合计超出安全范围。");
    return next;
  }, 0);
  return total;
}

function validateMonth(month: string) {
  if (!/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("請填写有效的支付月份。");
}

function validateInvoiceDates(month: string, issuedDate: string) {
  validateMonth(month);
  const date = new Date(`${issuedDate}T00:00:00Z`);
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(issuedDate) ||
    !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== issuedDate) {
    throw new Error("請填写有效的発行日。");
  }
}

export function summarizeDriverPayments(rows: readonly DriverPaymentRow[], items: readonly DriverWageItem[], month: string,
  drivers?: readonly Driver[]) {
  validateMonth(month);
  const payer = (driver: string, company: string, regionId?: string) => {
    if (!drivers) return company;
    const matches = drivers.filter(record => record.regionId === regionId && record.name === driver);
    return matches.length === 1 ? matches[0].companyName?.trim() || "" : "";
  };
  const groups = new Map<string, DriverPaymentSummary>();
  const group = (driver: string, company: string, regionId?: string) => {
    const key = JSON.stringify([regionId, company, driver]);
    let result = groups.get(key);
    if (!result) {
      result = { key, driver, company, regionId, rows: [], manualItems: [],
        advances: 0, overtime: 0, bonus: 0, percentage: 0, fixed: 0, manual: 0, remuneration: 0, total: 0 };
      groups.set(key, result);
    }
    return result;
  };
  rows.filter(row => row.driver && row.serviceDate.startsWith(`${month}-`))
    .forEach(row => group(row.driver, payer(row.driver, row.company, row.regionId), row.regionId).rows.push(row));
  items.filter(item => item.month === month)
    .forEach(item => group(item.driver, payer(item.driver, item.companyName, item.regionId), item.regionId).manualItems.push(item));
  return [...groups.values()].map(result => {
    result.advances = sum(result.rows.map(row => row.driverAdvances));
    result.overtime = sum(result.rows.map(row => row.overtimeFee));
    result.bonus = sum(result.rows.map(row => row.bonusWage));
    result.percentage = sum(result.rows.map(row => row.percentageWage));
    result.fixed = sum(result.rows.map(row => row.fixedWage));
    result.manual = sum(result.manualItems.map(item => item.amount));
    result.remuneration = sum([...result.rows.map(row => row.totalWage), result.manual]);
    if (sum([result.overtime, result.bonus, result.percentage, result.fixed, result.manual]) !== result.remuneration) {
      throw new Error(`「${result.driver}」报酬分项与支付数据不一致，請核对工資设置。`);
    }
    result.total = sum([result.advances, result.remuneration]);
    return result;
  }).sort((a, b) => a.driver.localeCompare(b.driver, "ja") || a.company.localeCompare(b.company, "ja"));
}

export function createDriverPaymentInvoice(summary: DriverPaymentSummary, month: string,
  drivers: readonly Driver[], companies: readonly Company[], issuedDate = getJapanDate()): DriverPaymentInvoice {
  validateInvoiceDates(month, issuedDate);
  if (!summary.regionId) throw new Error("請先为该支付记录设置地域。");
  const matchingDrivers = drivers.filter(driver => driver.regionId === summary.regionId && driver.name === summary.driver);
  if (matchingDrivers.length !== 1) throw new Error(`「${summary.driver}」未找到唯一司机资料，請先补全资料及银行口座。`);
  const payer = matchingDrivers[0].companyName?.trim();
  if (!payer) throw new Error(`「${summary.driver}」尚未填写所属会社，請在司机编辑中补全。`);
  const matchingCompanies = companies.filter(company => company.regionId === summary.regionId && company.name.trim() === payer);
  if (matchingCompanies.length !== 1) throw new Error(`「${payer}」未找到唯一会社资料，請先在会社管理中补全该地域的所属会社。`);
  return { month, issuedDate, summary, driver: matchingDrivers[0], company: matchingCompanies[0] };
}

export function validatePaymentInvoiceDownload(invoice: DriverPaymentInvoice) {
  validateInvoiceDates(invoice.month, invoice.issuedDate);
  if (invoice.summary.total <= 0) throw new Error(`「${invoice.driver.name}」支付总额须大于零才能生成請求書。`);
  const driver = invoice.driver;
  if (![driver.bankName, driver.bankBranch, driver.bankAccountType, driver.bankAccountNumber, driver.bankAccountHolder]
    .every(value => value?.trim())) throw new Error(`「${driver.name}」银行口座资料不完整，請在司机编辑中补全。`);
}

const escape = (value: string) => value.replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

export function buildDriverPaymentInvoiceHtml(invoice: DriverPaymentInvoice) {
  const { driver, company, summary, month, issuedDate } = invoice;
  validateInvoiceDates(month, issuedDate);
  const amountText = (amount: number) => amount.toLocaleString("ja-JP");
  const contractAmount = sum([summary.percentage, summary.fixed, summary.overtime, summary.bonus]);
  const lines: [string, number][] = [];
  if (contractAmount !== 0) lines.push(["業務委託", contractAmount]);
  if (summary.advances !== 0) lines.push(["立替金", summary.advances]);
  lines.push(...summary.manualItems.map(item => [item.name, item.amount] as [string, number]));
  if (sum(lines.map(([, amount]) => amount)) !== summary.total) {
    throw new Error("請求書明细与支付总额不一致，請核对数据后重新生成。");
  }
  const monthNumber = Number(month.split("-")[1]);
  const invoiceDate = issuedDate.split("-").map(Number).join("/");
  const due = new Date(`${issuedDate}T00:00:00Z`);
  const issuedDay = due.getUTCDate();
  due.setUTCMonth(due.getUTCMonth() + 2, 0);
  due.setUTCDate(Math.min(issuedDay, due.getUTCDate()));
  if (due.getUTCFullYear() > 9999) throw new Error("支払期限超出有效日期范围，請调整発行日。");
  const dueDate = `${due.getUTCFullYear()}/${due.getUTCMonth() + 1}/${due.getUTCDate()}`;
  const address = splitDriverAddress(driver.address, driver.postalCode);
  const driverAddress = address.address.split(/\r?\n/).map(escape).join("<br>");
  const bank = `${escape(driver.bankName || "銀行未登録")} ${escape(driver.bankBranch || "支店未登録")} ` +
    `${escape(driver.bankAccountType || "口座種別未登録")} ${escape(driver.bankAccountNumber || "口座番号未登録")}` +
    `<br>${escape(driver.bankAccountHolder || "口座名義未登録")}`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>請求書 ${escape(driver.name)} ${escape(month)}</title>
  <style>
  @page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}
  body{margin:0;color:#18324f;background:#fff;font:13px/1.65 Arial,"Yu Gothic","Microsoft YaHei",sans-serif}
  .sheet,.content{width:190mm}.content{padding:10mm 5mm 6mm}
  h1{text-align:center;color:#1d4ed8;font-size:23px;font-weight:400;letter-spacing:12px;margin:0 0 18px}
  header{display:grid;grid-template-columns:66% 34%;gap:0;min-height:110px}
  .payer{font-size:20px;margin:0;padding:0 18px 0 0;font-weight:400;overflow-wrap:anywhere}
  .invoice-meta{display:grid;grid-template-columns:65px 1fr;align-content:start;line-height:1.8}
  .intro{display:grid;grid-template-columns:65% 35%;gap:0;margin:20px 0 22px}
  .request-message{margin:0 0 2px}.issuer{padding-left:22px;overflow-wrap:anywhere;line-height:1.8}
  .issuer strong{font-weight:600}.issuer-company{font-size:12px}
  .details{display:grid;grid-template-columns:100px 1fr;line-height:1.7}
  .details-label{background:#eaf3ff;color:#1e40af;text-align:center;padding:1px 5px}
  .details-value{padding:1px 5px;min-height:24px;overflow-wrap:anywhere}
  .summary{display:grid;grid-template-columns:100px 1fr;width:61%;border:1px solid #93baf5;margin:0 0 22px}
  .summary span{background:#eaf3ff;color:#1e40af;text-align:center;padding:6px}
  .summary strong{font-size:21px;text-align:center;font-weight:400;padding:4px;overflow-wrap:anywhere}
  table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:13px}
  td,th{border:1px solid #bfd4ef;padding:2px 4px;overflow-wrap:anywhere;line-height:1.6;vertical-align:top}
  thead th{background:#eaf3ff;color:#1e40af;font-weight:400;text-align:center;border-color:#bfd4ef}
  .amount{text-align:right;font-variant-numeric:tabular-nums}.quantity{text-align:right}.unit{text-align:center}
  tbody tr{min-height:24px}tbody td{height:24px}.blank td{height:24px}
  tfoot td{border:0}tfoot .total-label{background:#eaf3ff;color:#1e40af;text-align:center}
  tfoot .amount{border:1px solid #bfd4ef}
  .notes{margin-top:22px}.notes h2{font-size:13px;font-weight:400;text-align:center;color:#1e40af;background:#eaf3ff;margin:0;padding:2px}
  </style></head><body><div class="sheet"><article class="content">
  <h1>請求書</h1><header><h2 class="payer">${escape(company.name)} 御中</h2>
  <div class="invoice-meta"><span>No</span><span></span><span>請求日</span><span>${invoiceDate}</span></div></header>
  <div class="intro"><div><p class="request-message">下記のとおり、御請求申し上げます。</p>
  <div class="details"><div class="details-label">件名</div><div class="details-value">${monthNumber}月分業務委託</div>
  <div class="details-label">支払期限</div><div class="details-value">${dueDate}</div>
  <div class="details-label">振込先</div><div class="details-value bank">${bank}</div></div></div>
  <div class="issuer"><strong>${escape(driver.name)}</strong>${address.postalCode ? `<div>〒${escape(address.postalCode)}</div>` : ""}${driverAddress ? `<div>${driverAddress}</div>` : ""}
  ${driver.phone ? `<div>TEL：${escape(formatMobilePhone(driver.phone))}</div>` : ""}</div></div>
  <div class="summary"><span>合計</span><strong>${amountText(summary.total)} 円</strong></div>
  <table aria-label="請求明細"><colgroup><col style="width:49%"><col style="width:12%"><col style="width:8%"><col style="width:15%"><col style="width:16%"></colgroup>
  <thead><tr><th>摘要</th><th>数量</th><th>単位</th><th>単価</th><th>金額</th></tr></thead><tbody>
  ${lines.map(([name, amount]) => `<tr class="invoice-line"><td>${escape(name)}</td><td class="quantity">1</td><td class="unit">式</td><td class="amount">${amountText(amount)}</td><td class="amount">${amountText(amount)}</td></tr>`).join("")}
  ${Array.from({ length: Math.max(0, 14 - lines.length) }, () => '<tr class="blank"><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>').join("")}
  </tbody><tfoot><tr><td colspan="3"></td><td class="total-label">合計</td><td class="amount">${amountText(summary.total)}</td></tr></tfoot></table>
  <section class="notes"><h2>備考</h2></section>
  </article></div></body></html>`;
}
