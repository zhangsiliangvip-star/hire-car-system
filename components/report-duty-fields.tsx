"use client";

import { useState } from "react";
import { defaultDutyEndDate, type DailyReport } from "@/lib/driver/reports";

export function ReportDutyFields({ header, serviceDate, disabled, inputClassName }: {
  header?: DailyReport["header"]; serviceDate: string; disabled: boolean; inputClassName?: string;
}) {
  const [startDate, setStartDate] = useState(header?.dutyStartDate ?? serviceDate);
  const [endDate, setEndDate] = useState(header?.dutyEndDate ?? defaultDutyEndDate(serviceDate, header?.dutyStartTime ?? "", header?.dutyEndTime ?? ""));
  const [start, setStart] = useState(header?.dutyStartTime ?? "");
  const [end, setEnd] = useState(header?.dutyEndTime ?? "");
  const [manualEnd, setManualEnd] = useState(Boolean(header?.dutyEndDate));
  return <>
    <label className="flex min-w-0 flex-col gap-1 text-sm">出勤点呼日期<input className={inputClassName} name="dutyStartDate" aria-label="出勤点呼日期" type="date" required={Boolean(start)}
      disabled={disabled} value={startDate} onChange={e => {
        setStartDate(e.target.value);
        if (!manualEnd && e.target.value) setEndDate(defaultDutyEndDate(e.target.value, start, end));
      }} /></label>
    <label className="flex min-w-0 flex-col gap-1 text-sm">退勤点呼日期<input className={inputClassName} name="dutyEndDate" aria-label="退勤点呼日期" type="date" required={Boolean(end)}
      disabled={disabled} value={endDate} onChange={e => { setEndDate(e.target.value); setManualEnd(true); }} /></label>
    <label className="flex min-w-0 flex-col gap-1 text-sm">出勤点呼時間<input className={inputClassName} name="dutyStartTime" aria-label="出勤点呼時間" type="time" step="60"
      disabled={disabled} value={start} onChange={e => {
        setStart(e.target.value);
        if (!manualEnd && startDate) setEndDate(defaultDutyEndDate(startDate, e.target.value, end));
      }} /></label>
    <label className="flex min-w-0 flex-col gap-1 text-sm">退勤点呼時間<input className={inputClassName} name="dutyEndTime" aria-label="退勤点呼時間" type="time" step="60"
      disabled={disabled} value={end} onChange={e => {
        setEnd(e.target.value);
        if (!manualEnd && startDate) setEndDate(defaultDutyEndDate(startDate, start, e.target.value));
      }} /></label>
  </>;
}
