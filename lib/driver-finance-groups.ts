import type { Order } from "@/lib/domain";
import { groupOrdersByImportBatch } from "@/lib/order-batches";

export type DriverFinanceGroupDetail = {
  id: string;
  orderId: string;
  serviceDate: string;
  isRedDay: boolean;
  time: string;
  customer: string;
  vehicleNumber: string;
  driver: string;
  driverAdvances: number;
  overtimeFee: number;
  bonusWage: number;
  percentageWage: number;
  fixedWage: number;
  totalWage: number;
};

export function groupDriverFinanceByBatch(
  orders: readonly Order[],
  details: readonly DriverFinanceGroupDetail[],
  month: string,
) {
  const detailsByOrderId = new Map<string, DriverFinanceGroupDetail[]>();
  for (const detail of details) {
    const orderDetails = detailsByOrderId.get(detail.orderId) ?? [];
    orderDetails.push(detail);
    detailsByOrderId.set(detail.orderId, orderDetails);
  }

  return groupOrdersByImportBatch(orders).flatMap((batch) => {
    const startDate = batch.reduce(
      (earliest, order) => order.date < earliest ? order.date : earliest,
      batch[0].date,
    );
    if (!startDate.startsWith(`${month}-`)) return [];

    const orderIds = new Set(batch.map((order) => order.id));
    const batchDetails = [...orderIds].flatMap((orderId) => detailsByOrderId.get(orderId) ?? []);
    if (batchDetails.length === 0) return [];

    const driverDetails = new Map<string, DriverFinanceGroupDetail[]>();
    for (const detail of batchDetails) {
      const rows = driverDetails.get(detail.driver) ?? [];
      rows.push(detail);
      driverDetails.set(detail.driver, rows);
    }

    const uniqueValues = (values: string[]) => [...new Set(values.filter(Boolean))];
    return [{
      key: batch[0].importBatchId
        ? `${batch[0].regionId || ""}:${batch[0].importBatchId}`
        : `order:${batch[0].id}`,
      startDate,
      orders: batch,
      customers: uniqueValues(batch.map((order) => order.customer || "未填写")),
      drivers: [...driverDetails.entries()]
        .sort(([first], [second]) => first.localeCompare(second, "ja"))
        .map(([driver, rows]) => ({
          driver,
          rows: rows.slice().sort((first, second) =>
            `${first.serviceDate} ${first.time}`.localeCompare(`${second.serviceDate} ${second.time}`),
          ),
          vehicles: uniqueValues(rows.map((row) => row.vehicleNumber)),
          totals: rows.reduce((totals, row) => ({
            driverAdvances: totals.driverAdvances + row.driverAdvances,
            overtimeFee: totals.overtimeFee + row.overtimeFee,
            bonusWage: totals.bonusWage + row.bonusWage,
            percentageWage: totals.percentageWage + row.percentageWage,
            fixedWage: totals.fixedWage + row.fixedWage,
            paymentTotal: totals.paymentTotal + row.driverAdvances + row.totalWage,
          }), {
            driverAdvances: 0,
            overtimeFee: 0,
            bonusWage: 0,
            percentageWage: 0,
            fixedWage: 0,
            paymentTotal: 0,
          }),
        })),
    }];
  }).sort((first, second) => first.startDate.localeCompare(second.startDate));
}
