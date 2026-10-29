import type { OrderFinance } from "@/lib/domain";

export function withCompanyAdvanceDriver(finance: OrderFinance, name: string): OrderFinance {
  const trimmedName = name.trim();
  if (!trimmedName) return { ...finance, driver: "" };
  const note = (finance.companyAdvancePaymentNote || "").split("\n")
    .filter(line => !line.startsWith("外注司机：")).join("\n");
  return { ...finance, driver: "",
    companyAdvancePaymentNote: [`外注司机：${trimmedName}`, note].filter(Boolean).join("\n") };
}

export function setReservationDriverPayment(
  finance: OrderFinance, type: NonNullable<OrderFinance["driverPaymentType"]>, name: string,
): OrderFinance {
  if (type === "company_advance") {
    return withCompanyAdvanceDriver({ ...finance, driverPaymentType: type,
      overtimeRequestAmount: finance.overtimeRequestRate !== undefined
        ? Math.round(finance.driverOvertimeHours * finance.overtimeRequestRate)
        : finance.overtimeRequestAmount ?? (finance.driverOvertimeRate > 0
          ? Math.round(finance.driverOvertimeHours * finance.driverOvertimeRate) : finance.driverOvertimeFee),
      driverWageMode: "fixed", driverWage: 0, driverBonusWage: 0,
      driverOvertimeRate: 0, driverOvertimeFee: 0,
    }, name || finance.driver);
  }
  return { ...finance, driverPaymentType: type, driver: finance.driver || name,
    externalDriverFee: 0 };
}

export function hasValidDriverPayment(finance: OrderFinance): boolean {
  if (finance.driverPaymentType === "company_advance") {
    return finance.driver === "" && finance.driverWageMode === "fixed" &&
      finance.driverWage === 0 && finance.driverBonusWage === 0 &&
      finance.driverOvertimeRate === 0 && finance.driverOvertimeFee === 0;
  }
  return finance.driverPaymentType !== "wage" || (finance.externalDriverFee ?? 0) === 0;
}

export function isDriverWageEntry(finance: Pick<OrderFinance, "driver" | "driverPaymentType">): boolean {
  return Boolean(finance.driver) && finance.driverPaymentType !== "company_advance";
}
