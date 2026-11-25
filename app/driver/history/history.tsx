"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import DriverNavigation from "@/app/driver/navigation";
import { driverCalendarSchema, type DriverCalendarEntry } from "@/lib/driver/calendar";
import { financeDataSchema, type FinanceData } from "@/lib/driver/finance";
import { japanDate } from "@/lib/driver/orders";
import { reportHistorySchema } from "@/lib/driver/reports";
import { createClient } from "@/lib/supabase/browser";

type Report = z.infer<typeof reportHistorySchema>[number];
type MonthData = {
  month: string;
  orders: DriverCalendarEntry[] | null;
  finance: FinanceData | null;
  reports: Report[] | null;
  errors: string[];
};

const yen = (amount: number) => `¥${amount.toLocaleString("ja-JP")}`;
const statusLabels = { pending: "待后台确认", approved: "已确认入账", rejected: "已退回" };

export default function DriverHistory({ initialMonth }: { initialMonth?: string } = {}) {
  const [month, setMonth] = useState(() => initialMonth ?? japanDate().slice(0, 7));
  const [data, setData] = useState<MonthData | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function read(url: string, label: string) {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (response.status === 401) {
        location.replace("/driver/login?next=%2Fdriver%2Fhistory");
        throw new Error("登录已失效。");
      }
      if (!response.ok) throw new Error(`${label}读取失败，請重新打开页面重试。`);
      return response.json();
    }
    async function load() {
      const results = await Promise.allSettled([
        read(`/api/driver/calendar?month=${encodeURIComponent(month)}`, "訂単").then(value => {
          const parsed = driverCalendarSchema.parse(value);
          if (parsed.month !== month) throw new Error("訂単月份不一致，請重新打开页面重试。");
          return parsed.entries;
        }),
        read(`/api/driver/finance?month=${encodeURIComponent(month)}`, "财务").then(value => {
          const parsed = financeDataSchema.parse(value);
          if ([...parsed.trips, ...parsed.fuelClaims, ...parsed.wages].some(item => !item.date.startsWith(`${month}-`)))
            throw new Error("财务月份不一致，請重新打开页面重试。");
          return parsed;
        }),
        read(`/api/driver/report-history?month=${encodeURIComponent(month)}`, "日報").then(value => {
          const parsed = z.object({ reports: reportHistorySchema }).strict().parse(value).reports;
          if (parsed.some(item => !item.serviceDate.startsWith(`${month}-`))) throw new Error("日報月份不一致，請重新打开页面重试。");
          return parsed;
        }),
      ]);
      if (!active || controller.signal.aborted || document.visibilityState !== "visible") return;
      const errors = results.flatMap((result, index) => {
        if (result.status === "fulfilled") return [];
        console.error("Driver history load failed.", result.reason);
        return [`${["訂単", "财务", "日報"][index]}读取失败，請重新打开页面重试。`];
      });
      setData({ month,
        orders: results[0].status === "fulfilled" ? results[0].value : null,
        finance: results[1].status === "fulfilled" ? results[1].value : null,
        reports: results[2].status === "fulfilled" ? results[2].value : null,
        errors,
      });
    }
    function visibility() {
      if (document.visibilityState === "hidden") { controller.abort(); setData(null); }
      else setRevision(value => value + 1);
    }
    document.addEventListener("visibilitychange", visibility);
    const { data: subscription } = createClient("driver").auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") { controller.abort(); setData(null); location.replace("/driver/login"); }
    });
    void load();
    return () => {
      active = false; controller.abort(); subscription.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [month, revision]);

  const loaded = data?.month === month ? data : null;
  const dates = loaded ? [...new Set([
    ...(loaded.orders ?? []).map(item => item.date),
    ...(loaded.finance?.trips ?? []).filter(item => item.claims.length || item.existingOvertimeHours > 0).map(item => item.date),
    ...(loaded.finance?.fuelClaims ?? []).map(item => item.date),
    ...(loaded.finance?.wages ?? []).map(item => item.date),
    ...(loaded.reports ?? []).map(item => item.serviceDate),
  ])].sort((a, b) => b.localeCompare(a)) : [];
  return <main className="driver-main">
    <DriverNavigation active="history" />
    <h1>履歴</h1>
    <label className="driver-field">查询月份<input type="month" value={month} min="0001-01"
      onChange={event => { if (event.target.value) setMonth(event.target.value); }} /></label>
    {!loaded ? <p className="driver-empty" role="status">正在读取履歴…</p> : <>
      {loaded.errors.map(error => <p className="driver-error" role="alert" key={error}>{error}</p>)}
      {!dates.length && !loaded.errors.length && <p className="driver-empty">本月暂无訂単、财务或日報記録。</p>}
      {dates.map(date => {
        const orders = loaded.orders?.filter(item => item.date === date) ?? [];
        const trips = loaded.finance?.trips.filter(item => item.date === date &&
          (item.claims.length || item.existingOvertimeHours > 0)) ?? [];
        const fuel = loaded.finance?.fuelClaims.filter(item => item.date === date) ?? [];
        const wages = loaded.finance?.wages.filter(item => item.date === date) ?? [];
        const reports = loaded.reports?.filter(item => item.serviceDate === date) ?? [];
        const claims = trips.flatMap(trip => trip.claims
          .filter(claim => claim.category === "company" || claim.category === "trip")
          .map(claim => ({ trip, claim })));
        const fuelTotal = fuel.reduce((sum, claim) => sum + claim.amount, 0);
        const dailyWage = wages.reduce((sum, wage) => sum + wage.base + wage.bonus + wage.overtime, 0);
        return <section className="driver-card" key={date} aria-label={`${date}履歴`}>
          <h2>{date}</h2>
          <div className="driver-row"><span>订单名称</span>
            <strong>{orders.length ? orders.map(order => order.orderName || "訂単内容未填写").join("、") : "当日无订单"}</strong>
          </div>
          {claims.length ? claims.map(({ trip, claim }) => <div className="driver-row" key={`${trip.assignmentId}-${claim.category}`}>
            <span>立替</span>
            <Link className="driver-link" href={`/driver/finance?date=${date}&assignmentId=${trip.assignmentId}`}>
              {trip.pickup} → {trip.destination} · {yen(claim.expenses.reduce((sum, item) => sum + item.amount, 0))}
              {" · "}{statusLabels[claim.status]} · 修改
            </Link>
          </div>) : <div className="driver-row"><span>立替</span><strong>{yen(0)}</strong></div>}
          <div className="driver-row"><span>燃油费</span>
            <Link className="driver-link" href={`/driver/finance?date=${date}`}>{yen(fuelTotal)} · 查看/修改</Link>
          </div>
          <div className="driver-row"><span>当日工资</span>
            {wages.length
              ? <Link className="driver-link" href={`/driver/finance?date=${date}&view=wages`}>{yen(dailyWage)} · 查看</Link>
              : <strong>未核算</strong>}
          </div>
          <div className="driver-row"><span>当日日报</span>
            {reports.length ? reports.map(report => <Link className="driver-link" key={report.id}
              href={`/driver/report?reportId=${report.id}&month=${month}`}>
              {report.returnedAt ? "已归库 · 查看/修改" : "进行中 · 查看/修改"}
            </Link>) : loaded.reports
              ? <Link className="driver-link driver-report-missing" href={`/driver/report?date=${date}`}>日报未完成</Link>
              : <strong className="driver-report-missing">日报读取失败</strong>}
          </div>
        </section>;
      })}
    </>}
  </main>;
}
