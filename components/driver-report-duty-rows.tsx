"use client";

import { useState } from "react";
import { formatManualClock, type DailyReport } from "@/lib/driver/reports";

export function DriverReportDutyRows({ position, header, disabled, draft }: {
  position: "start" | "end"; header?: DailyReport["header"]; disabled: boolean;
  draft?: Record<string, string>;
}) {
  const [start, setStart] = useState(draft?.["report-header/dutyStartTime"] ?? header?.dutyStartTime ?? "");
  const [end, setEnd] = useState(draft?.["report-header/dutyEndTime"] ?? header?.dutyEndTime ?? "");

  if (position === "start") return <tbody aria-label="出勤点呼">
    <tr className="driver-sheet-duty">
      <th scope="row">出勤点呼</th>
      <td colSpan={4}><div className="driver-duty-inline driver-duty-single">
        <label>出勤点呼时间<input form="report-header" name="dutyStartTime" aria-label="出勤点呼時間"
          type="text" inputMode="numeric" maxLength={5} placeholder="0800" data-manual-time
          pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" disabled={disabled} value={start}
          onChange={event => setStart(event.target.value)}
          onBlur={event => setStart(formatManualClock(event.target.value))} /></label>
      </div></td>
    </tr>
  </tbody>;

  return <tbody aria-label="退勤点呼">
    <tr className="driver-sheet-duty">
      <th scope="row">退勤点呼</th>
      <td colSpan={4}><div className="driver-duty-inline driver-duty-end">
        <label>退勤时间<input form="report-header" name="dutyEndTime" aria-label="退勤点呼時間"
          type="text" inputMode="numeric" maxLength={5} placeholder="0800" data-manual-time
          pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" disabled={disabled} value={end}
          onChange={event => setEnd(event.target.value)}
          onBlur={event => setEnd(formatManualClock(event.target.value))} /></label>
      </div></td>
    </tr>
  </tbody>;
}
