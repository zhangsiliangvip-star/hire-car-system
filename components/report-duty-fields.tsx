"use client";

import { useState } from "react";
import { defaultDutyEndDate, formatManualClock, type DailyReport } from "@/lib/driver/reports";

export function ReportDutyFields({ header, serviceDate, disabled, inputClassName, manualTimeInput = false, draft }: {
  header?: DailyReport["header"]; serviceDate: string; disabled: boolean; inputClassName?: string; manualTimeInput?: boolean;
  draft?: Record<string, string>;
}) {
  const [startDate, setStartDate] = useState(draft?.["report-header/dutyStartDate"] ?? header?.dutyStartDate ?? serviceDate);
  const [endDate, setEndDate] = useState(draft?.["report-header/dutyEndDate"] ?? header?.dutyEndDate ?? defaultDutyEndDate(serviceDate, header?.dutyStartTime ?? "", header?.dutyEndTime ?? ""));
  const [start, setStart] = useState(draft?.["report-header/dutyStartTime"] ?? header?.dutyStartTime ?? "");
  const [end, setEnd] = useState(draft?.["report-header/dutyEndTime"] ?? header?.dutyEndTime ?? "");
  const [manualEnd, setManualEnd] = useState(draft ? draft["report-header/dutyEndManual"] === "1" : Boolean(header?.dutyEndDate));
  return <>
    {manualTimeInput && <input type="hidden" name="dutyEndManual" value={manualEnd ? "1" : "0"} />}
    <label className="flex min-w-0 flex-col gap-1 text-sm">出勤点呼日期<input className={inputClassName} name="dutyStartDate" aria-label="出勤点呼日期" type="date" required={Boolean(start)}
      disabled={disabled} value={startDate} onChange={e => {
        setStartDate(e.target.value);
        if (!manualEnd && e.target.value) setEndDate(defaultDutyEndDate(e.target.value, start, end));
      }} /></label>
    <label className="flex min-w-0 flex-col gap-1 text-sm">退勤点呼日期<input className={inputClassName} name="dutyEndDate" aria-label="退勤点呼日期" type="date" required={Boolean(end)}
      disabled={disabled} value={endDate} onChange={e => { setEndDate(e.target.value); setManualEnd(true); }} /></label>
    <label className="flex min-w-0 flex-col gap-1 text-sm">出勤点呼時間<input className={inputClassName} name="dutyStartTime" aria-label="出勤点呼時間"
      type={manualTimeInput ? "text" : "time"} inputMode={manualTimeInput ? "numeric" : undefined}
      maxLength={manualTimeInput ? 5 : undefined} placeholder={manualTimeInput ? "0800" : undefined}
      disabled={disabled} value={start} onChange={e => {
        setStart(e.target.value);
        if (!manualEnd && startDate) setEndDate(defaultDutyEndDate(startDate, formatManualClock(e.target.value), formatManualClock(end)));
      }} onBlur={manualTimeInput ? e => {
        const value = formatManualClock(e.target.value);
        setStart(value);
        if (!manualEnd && startDate) setEndDate(defaultDutyEndDate(startDate, value, formatManualClock(end)));
      } : undefined} /></label>
    <label className="flex min-w-0 flex-col gap-1 text-sm">退勤点呼時間<input className={inputClassName} name="dutyEndTime" aria-label="退勤点呼時間"
      type={manualTimeInput ? "text" : "time"} inputMode={manualTimeInput ? "numeric" : undefined}
      maxLength={manualTimeInput ? 5 : undefined} placeholder={manualTimeInput ? "0800" : undefined}
      disabled={disabled} value={end} onChange={e => {
        setEnd(e.target.value);
        if (!manualEnd && startDate) setEndDate(defaultDutyEndDate(startDate, formatManualClock(start), formatManualClock(e.target.value)));
      }} onBlur={manualTimeInput ? e => {
        const value = formatManualClock(e.target.value);
        setEnd(value);
        if (!manualEnd && startDate) setEndDate(defaultDutyEndDate(startDate, formatManualClock(start), value));
      } : undefined} /></label>
  </>;
}
