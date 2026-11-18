"use client";

import { useId, useState } from "react";
import {
  japaneseEras, toGregorianDate, toJapaneseEraDate,
  type JapaneseEraDate,
} from "@/lib/japanese-era-date";

export function JapaneseEraDateInput({ label, value, onChange, onValidationChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onValidationChange: (valid: boolean) => void;
}) {
  const id = useId();
  const [fields, setFields] = useState(() => toJapaneseEraDate(value));
  const [savedValue, setSavedValue] = useState(value);
  const [error, setError] = useState("");
  if (value !== savedValue) {
    setSavedValue(value);
    setFields(toJapaneseEraDate(value));
  }

  function update(next: JapaneseEraDate) {
    setFields(next);
    try {
      const converted = toGregorianDate(next);
      setError("");
      onValidationChange(true);
      setSavedValue(converted);
      onChange(converted);
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      setError(error.message);
      onValidationChange(false);
    }
  }

  return <fieldset className="min-w-0 text-sm font-medium" aria-describedby={`${id}-result`}>
    <legend>{label}（和历）</legend>
    <div className="mt-1 grid grid-cols-4 gap-1">
      <select aria-label={`${label}年号`} value={fields.era}
        className="min-w-0 rounded border p-2"
        onChange={event => {
          const era = japaneseEras.find(item => item.name === event.target.value);
          if (era) update({ ...fields, era: era.name });
        }}>
        {japaneseEras.map(era => <option key={era.name} value={era.name}>{era.name}</option>)}
      </select>
      {(["year", "month", "day"] as const).map((field, index) => {
        const unit = ["年", "月", "日"][index];
        return <label key={field} className="flex min-w-0 items-center gap-1">
          <input type="number" inputMode="numeric" min={1} max={field === "year" ? 9999 : field === "month" ? 12 : 31}
            aria-label={`${label}${unit}`} aria-invalid={Boolean(error)}
            className="w-full min-w-0 rounded border p-2" value={fields[field]}
            onChange={event => update({ ...fields, [field]: event.target.value })} />
          {unit}
        </label>;
      })}
    </div>
    <div id={`${id}-result`} className="mt-2 text-xs font-normal" aria-live="polite">
      {error ? <p role="alert" className="text-red-700">{error}</p> :
        <p className="text-slate-600">西历：{value || "未设置"}（元年请输入1）</p>}
    </div>
    <button type="button" className="mt-1 text-xs text-blue-700 underline"
      onClick={() => update({ era: "令和", year: "", month: "", day: "" })}>清空日期</button>
  </fieldset>;
}
