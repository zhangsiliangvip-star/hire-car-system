"use client";

import { useRef, useState } from "react";

type Props = {
  assignmentId: string;
  notes: string;
  disabled: boolean;
  onSavingChange: (saving: boolean) => void;
  onSaved: (notes: string) => void;
  onConflict: () => void;
};

export default function DriverTripNotes({ assignmentId, notes, disabled, onSavingChange, onSaved, onConflict }: Props) {
  const [draft, setDraft] = useState<{ notes: string; expectedNotes: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const savingRef = useRef(false);

  async function save() {
    if (!draft || disabled || savingRef.current) return;
    savingRef.current = true;
    setSaving(true); onSavingChange(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/driver/assignments/${assignmentId}/notes`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        if (response.status === 409) onConflict();
        throw new Error(typeof data === "object" && data !== null && "error" in data && typeof data.error === "string"
          ? data.error : "備考未保存，请重试。");
      }
      if (typeof data !== "object" || data === null || !("notes" in data) || data.notes !== draft.notes)
        throw new Error("備考保存未获确认，请重试或联系调度。");
      onSaved(draft.notes); setDraft(null); setNotice("備考已保存并同步。");
    } catch (cause) {
      console.error("Driver trip notes save failed.", cause);
      setError(cause instanceof Error ? cause.message : "備考未保存，请重试。");
    } finally {
      savingRef.current = false; setSaving(false); onSavingChange(false);
    }
  }

  return <div className="driver-trip-notes">
    <label className="driver-muted" htmlFor={`notes-${assignmentId}`}>備考</label>
    <textarea id={`notes-${assignmentId}`} value={draft?.notes ?? notes} rows={2} maxLength={5000}
      disabled={disabled || saving} placeholder="填写備考"
      onChange={event => {
        const value = event.target.value;
        setDraft(current => ({ notes: value, expectedNotes: current?.expectedNotes ?? notes }));
        setError(""); setNotice("");
      }} />
    {draft && <div className="driver-toolbar">
      <button type="button" className="driver-header-button" disabled={disabled || saving} onClick={() => void save()}>
        {saving ? "正在保存…" : "保存備考"}
      </button>
      <button type="button" className="driver-header-button" disabled={disabled || saving}
        onClick={() => { setDraft(null); setError(""); setNotice(""); }}>取消编辑</button>
    </div>}
    {error && <p className="driver-error" role="alert">{error}</p>}
    {notice && <p className="driver-notice" role="status">{notice}</p>}
  </div>;
}
