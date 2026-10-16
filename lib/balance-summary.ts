import type { Order } from "@/lib/domain";

type BalanceOrderTotals = {
  companyName: string;
  requestAmount: number;
  depositMethod: Order["depositMethod"];
};

export type BalanceExpense = { companyName: string; name: string; amount: number };
export type BalanceCompanyRow = Omit<BalanceOrderTotals, "depositMethod"> & {
  bankRequestAmount: number;
  cashRequestAmount: number;
  unassignedRequestAmount: number;
  incomeTotal: number;
  expenseTotal: number;
  net: number;
};

export function getBalanceServiceMonth(
  order: Pick<Order, "offDates">,
  dateKeys: string[],
) {
  const offDates = new Set(order.offDates);
  const firstServiceDate = dateKeys.filter((date) => !offDates.has(date)).sort()[0];
  if (!firstServiceDate) throw new Error("订单没有服务日，请检查用车日期和休运日。");
  return firstServiceDate.slice(0, 7);
}

export function summarizeBalance(
  companyFilter: string,
  companyNames: string[],
  orderTotals: BalanceOrderTotals[],
  manualExpenses: BalanceExpense[],
  manualIncomes: BalanceExpense[] = [],
) {
  const groups = new Map<string, BalanceCompanyRow>();
  const groupFor = (name: string) => {
    let row = groups.get(name);
    if (!row) {
      row = { companyName: name, requestAmount: 0, bankRequestAmount: 0, cashRequestAmount: 0, unassignedRequestAmount: 0, incomeTotal: 0, expenseTotal: 0, net: 0 };
      groups.set(name, row);
    }
    return row;
  };
  const check = (amount: number) => {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("收支金额无效或超出范围，请检查财务记录。");
    return amount;
  };
  const matches = (name: string) => companyFilter === "" ||
    name === (companyFilter === "__unassigned_company__" ? "" : companyFilter);
  companyNames.filter(matches).forEach(groupFor);
  if (matches("")) groupFor("");
  for (const order of orderTotals.filter((row) => matches(row.companyName))) {
    const row = groupFor(order.companyName);
    row.requestAmount += check(order.requestAmount);
    if (order.depositMethod === "口座入金") row.bankRequestAmount += order.requestAmount;
    else if (order.depositMethod === "现金入金") row.cashRequestAmount += order.requestAmount;
    else if (order.depositMethod === "") row.unassignedRequestAmount += order.requestAmount;
    else throw new Error("订单入金方式无效，请检查订单资料。");
  }
  const expenses = manualExpenses.filter((row) => matches(row.companyName));
  for (const item of expenses) groupFor(item.companyName).expenseTotal += check(item.amount);
  const incomes = manualIncomes.filter((row) => matches(row.companyName));
  for (const item of incomes) groupFor(item.companyName).incomeTotal += check(item.amount);
  const rows = [...groups.values()].sort((a, b) => a.companyName.localeCompare(b.companyName));
  const totals = { requestAmount: 0, bankRequestAmount: 0, cashRequestAmount: 0, unassignedRequestAmount: 0, incomeTotal: 0, expenseTotal: 0, net: 0 };
  for (const row of rows) {
    row.net = row.requestAmount + row.incomeTotal - row.expenseTotal;
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
      if (!Number.isSafeInteger(row[key])) throw new Error("收支合计超出金额范围，请缩小筛选范围。");
      totals[key] += row[key];
      if (!Number.isSafeInteger(totals[key])) throw new Error("收支合计超出金额范围，请缩小筛选范围。");
    }
  }
  return { rows, expenses, incomes, totals };
}

export type BalanceSummary = ReturnType<typeof summarizeBalance>;
