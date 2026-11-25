"use client";

import Link from "next/link";
import DriverNavigation from "@/app/driver/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { z } from "zod";
import { createClient } from "@/lib/supabase/browser";
import { japanDate } from "@/lib/driver/orders";
import { buildDriverCalendar, buildDriverCalendarFinance, driverCalendarRange, driverCalendarSchema, type DriverCalendarEntry } from "@/lib/driver/calendar";
import { financeDataSchema } from "@/lib/driver/finance";
import { reportHistorySchema } from "@/lib/driver/reports";
import { shiftDataSchema } from "@/lib/driver/shifts";
import { getJapaneseHolidays } from "@/lib/japanese-holidays";
import "./calendar.css";

const statusClasses: Record<string, string> = {
  仮予約: "is-tentative", 予約確定: "is-confirmed", 運行中: "is-running", 完了: "is-done",
};
const weekdays = ["日", "月", "火", "水", "木", "金", "土"];

function moveMonth(month: string, offset: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function DriverCalendar() {
  const today = japanDate();
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [data, setData] = useState<{ month: string; entries: DriverCalendarEntry[]; rest: string[];
    finance: ReturnType<typeof financeDataSchema.parse>; reports: ReturnType<typeof reportHistorySchema.parse> } | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledMonth = useRef("");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      try {
        const [calendar, shifts, finance, reports] = await Promise.all([
          fetch(`/api/driver/calendar?month=${month}`, { cache: "no-store", signal: controller.signal }),
          fetch(`/api/driver/shifts?month=${month}`, { cache: "no-store", signal: controller.signal }),
          fetch(`/api/driver/finance?month=${month}`, { cache: "no-store", signal: controller.signal }),
          fetch(`/api/driver/report-history?month=${month}`, { cache: "no-store", signal: controller.signal }),
        ]);
        if ([calendar, shifts, finance, reports].some(response => response.status === 401)) {
          location.replace("/driver/login?next=%2Fdriver%2Fcalendar"); return;
        }
        const [result, financeResult, reportsResult] = await Promise.all([
          calendar.json(), finance.json(), reports.json(),
        ]);
        if (!calendar.ok) throw new Error(result.error || "无法读取日歴，請重试。");
        if (!finance.ok) throw new Error(financeResult.error || "无法读取财务，請重试。");
        if (!reports.ok) throw new Error(reportsResult.error || "无法读取日報，請重试。");
        const parsed = driverCalendarSchema.parse(result);
        if (parsed.month !== month) throw new Error("月份不一致，請重试。");
        const parsedFinance = financeDataSchema.parse(financeResult);
        const parsedReports = z.object({ reports: reportHistorySchema }).strict().parse(reportsResult).reports;
        let rest: string[] = [];
        if (shifts.ok) {
          const shift = shiftDataSchema.safeParse(await shifts.json());
          if (shift.success && shift.data.month === month) rest = shift.data.dates;
        }
        if (active) { setData({ month, entries: parsed.entries, rest, finance: parsedFinance,
          reports: parsedReports }); setError(""); }
      } catch (cause) {
        if (controller.signal.aborted || !active) return;
        console.error("Driver calendar load failed.", cause);
        setError(cause instanceof Error ? cause.message : "无法读取日歴。");
      }
    }
    function visibility() { if (document.visibilityState === "visible") void load(); }
    document.addEventListener("visibilitychange", visibility);
    const { data: subscription } = createClient("driver").auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") { setData(null); location.replace("/driver/login"); }
    });
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    return () => {
      active = false; controller.abort(); clearInterval(timer); subscription.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [month, revision]);

  const loaded = data?.month === month ? data : null;
  const range = driverCalendarRange(month);
  const holidays = getJapaneseHolidays(Number(month.slice(0, 4)));
  const restDates = new Set(loaded?.rest ?? []);
  const dates = Array.from({ length: range.days }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const weekday = new Date(`${date}T00:00:00`).getDay();
    const holiday = holidays.has(date);
    return { date, label: `${Number(month.slice(5))}/${index + 1}`, weekday: weekdays[weekday],
      red: holiday || weekday === 0 || weekday === 6, holiday, rest: restDates.has(date) };
  });
  const vehicles = loaded ? buildDriverCalendar(loaded.entries, dates.map(day => day.date)) : [];
  const dailyFinance = loaded ? buildDriverCalendarFinance(dates.map(day => day.date), loaded.finance,
    loaded.reports) : [];

  useEffect(() => {
    const element = scroller.current;
    if (!loaded || !element || scrolledMonth.current === loaded.month) return;
    scrolledMonth.current = loaded.month;
    const target = element.querySelector<HTMLElement>(`[data-calendar-date="${today}"]`);
    const vehicleWidth = element.querySelector<HTMLElement>(".driver-calendar-vehicle")?.offsetWidth ?? 0;
    element.scrollLeft = target ? Math.max(0, target.offsetLeft - vehicleWidth) : 0;
  }, [loaded, today]);

  function changeMonth(next: string) {
    if (next === month) return;
    setError(""); setMonth(next);
  }
  return <main className="driver-main driver-calendar">
    <DriverNavigation />
    <div className="driver-page-header"><Link className="driver-link" href="/driver">‹ 返回我的行程</Link></div>
    <h1>我的日歴</h1>
    <div className="driver-calendar-toolbar">
      <button type="button" aria-label="上个月" onClick={() => changeMonth(moveMonth(month, -1))}>‹</button>
      <strong>{month.slice(0, 4)}年{Number(month.slice(5))}月</strong>
      <button type="button" aria-label="下个月" onClick={() => changeMonth(moveMonth(month, 1))}>›</button>
      <button type="button" className="driver-calendar-today" aria-pressed={month === today.slice(0, 7)}
        onClick={() => { scrolledMonth.current = ""; if (month === today.slice(0, 7)) setRevision(value => value + 1); else changeMonth(today.slice(0, 7)); }}>今天</button>
    </div>
    <p className="driver-muted">只显示分配给你的訂単及使用車両；红色「休」为你提交的希望休。工资、申報与日報按日期汇总，申報金额包含待审核项目。</p>
    {error && <p className="driver-error" role="alert">{error}</p>}
    {!loaded ? (!error && <p className="driver-empty" role="status">正在读取日歴…</p>) : <>
      <div className="driver-calendar-scroll" ref={scroller}>
        <div className="driver-calendar-grid" style={{ "--calendar-days": dates.length } as CSSProperties}>
          <div className="driver-calendar-row driver-calendar-head">
            <div className="driver-calendar-vehicle">車両</div>
            {dates.map(day => <div key={day.date} data-calendar-date={day.date}
              className={`driver-calendar-date${day.date === today ? " is-today" : ""}${day.red ? " is-red" : ""}`}>
              <b>{day.label}</b><span>{day.weekday}</span>
              {day.holiday && <small>休日</small>}
              {day.rest && <small className="driver-calendar-rest">休</small>}
            </div>)}
          </div>
          {vehicles.map(vehicle => <div key={vehicle.key} className="driver-calendar-row"
            style={{ gridTemplateRows: `repeat(${vehicle.lanes}, auto)` }}>
            <div className="driver-calendar-vehicle" style={{ gridRow: `1 / span ${vehicle.lanes}` }}>
              <strong>{vehicle.vehicleNumber || "未登记番号"}</strong>
              {vehicle.vehicle && <span>{vehicle.vehicle}</span>}
            </div>
            {dates.map((day, index) => <div key={day.date} aria-hidden="true"
              className={`driver-calendar-cell${day.date === today ? " is-today" : ""}`}
              style={{ gridColumn: index + 2, gridRow: `1 / span ${vehicle.lanes}` }} />)}
            {vehicle.segments.map(segment => <div key={`${segment.orderId}:${segment.start}`}
              className={`driver-calendar-order ${statusClasses[segment.status] ?? ""}`}
              style={{ gridColumn: `${segment.start + 2} / ${segment.end + 2}`, gridRow: segment.lane + 1 }}>
              <strong>{segment.orderName || "訂単内容未填写"}</strong>
              <span>{segment.time || "時間待定"}</span>
              {segment.summaries.some(Boolean) && <div className="driver-calendar-summaries"
                style={{ gridTemplateColumns: `repeat(${segment.end - segment.start}, minmax(0, 1fr))` }}>
                {segment.summaries.map((summary, index) => <span key={index}>{summary}</span>)}
              </div>}
            </div>)}
          </div>)}
          <div className="driver-calendar-row driver-calendar-finance-row">
          <div className="driver-calendar-vehicle driver-calendar-finance-label">
            <strong>日工资 / 财务 / 日報</strong>
            {loaded.finance.manualItems.some(item => item.amount !== 0)
              ? <span>月度调整 ¥{loaded.finance.manualItems.reduce((sum, item) => sum + item.amount, 0).toLocaleString("ja-JP")}</span>
              : <span>按日汇总</span>}
          </div>
          {dailyFinance.map((day, index) => <div key={dates[index].date}
            className={`driver-calendar-finance-cell${dates[index].date === today ? " is-today" : ""}`}
            aria-label={`${dates[index].date}财务与日報`}>
            {day.wage !== null ? <Link className="driver-calendar-daily-wage"
              href={`/driver/finance?date=${dates[index].date}&view=wages`}>
              日工资 {`¥${day.wage.toLocaleString("ja-JP")}`}
            </Link> : <span className="driver-calendar-daily-wage">日工资 暂无</span>}
            {day.advances > 0 && <Link href={`/driver/finance?date=${dates[index].date}`}>
              立替 {`¥${day.advances.toLocaleString("ja-JP")}`}
            </Link>}
            {day.company > 0 && <Link href={`/driver/finance?date=${dates[index].date}`}>
              社報 {`¥${day.company.toLocaleString("ja-JP")}`}
            </Link>}
            {day.trip > 0 && <Link href={`/driver/finance?date=${dates[index].date}`}>
              旅報 {`¥${day.trip.toLocaleString("ja-JP")}`}
            </Link>}
            {day.fuel > 0 && <Link href={`/driver/finance?date=${dates[index].date}`}>
              燃油 {`¥${day.fuel.toLocaleString("ja-JP")}`}
            </Link>}
            {day.reports.length ? day.reports.map(report => <Link key={report.id}
              className="driver-calendar-report-link"
              href={`/driver/report?reportId=${report.id}&date=${report.serviceDate}`}>
              日報 {report.returnedAt ? "已归库 · 查看/修改" : "进行中 · 查看"}
            </Link>) : <Link className="driver-calendar-report-link"
              href={`/driver/report?date=${dates[index].date}`}>填写日報</Link>}
          </div>)}
          </div>
        </div>
      </div>
      {!vehicles.length && <div className="driver-card driver-empty">本月暂无分配给你的訂単。</div>}
    </>}
  </main>;
}
