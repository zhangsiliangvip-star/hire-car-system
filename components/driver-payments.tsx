"use client";

import { useEffect, useRef, useState } from "react";
import type { Company, Driver, DriverWageItem } from "@/lib/domain";
import { buildDriverPaymentInvoiceHtml, createDriverPaymentInvoice, summarizeDriverPayments,
  type DriverPaymentRow, type DriverPaymentSummary } from "@/lib/driver-payment";
import { downloadDriverPaymentInvoices } from "@/lib/driver-payment-download";
import { getJapanDate, splitVehicleOwner } from "@/lib/vehicle-compliance";

type Props = {
  month: string; onMonthChange: (month: string) => void; regionId: string | null;
  rows: DriverPaymentRow[]; manualItems: DriverWageItem[]; drivers: Driver[]; companies: Company[];
  canEdit: boolean; pendingSave: boolean;
  onSaveItem: (item: Omit<DriverWageItem, "id"> & { id?: string }) => Promise<boolean>;
  onDeleteItem: (item: DriverWageItem) => void;
};
const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;

export function DriverPayments({ month, onMonthChange, regionId, rows, manualItems, drivers, companies,
  canEdit, pendingSave, onSaveItem, onDeleteItem }: Props) {
  const [company, setCompany] = useState("");
  const [driver, setDriver] = useState("");
  const [issuedDate, setIssuedDate] = useState(getJapanDate);
  const [preview, setPreview] = useState<DriverPaymentSummary | null>(null);
  const [wageDetailKey, setWageDetailKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ driver: string; company: string; regionId: string } | null>(null);
  const [itemId, setItemId] = useState<string>();
  const [itemName, setItemName] = useState("");
  const [itemAmount, setItemAmount] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [driverSearch, setDriverSearch] = useState("");
  const [showDriverPicker, setShowDriverPicker] = useState(false);
  const driverPickerRef = useRef<HTMLElement>(null);
  const lock = useRef(false);
  useEffect(() => {
    if (!showDriverPicker) return;
    const previous = document.activeElement;
    driverPickerRef.current?.querySelector<HTMLElement>("#payment-driver-picker-title")?.focus();
    return () => { if (previous instanceof HTMLElement) previous.focus(); };
  }, [showDriverPicker]);
  function selectDriver(name: string) {
    setDriver(name); setDriverSearch(""); setShowDriverPicker(false);
  }
  const companyOptions = [...new Set([...companies.map(item => item.name), ...drivers.map(item => item.companyName?.trim())])].filter(Boolean).sort();
  const yearOptions = [...new Set([
    ...Array.from({ length: 81 }, (_, index) => String(2020 + index)),
    month.slice(0, 4), ...rows.map(item => item.serviceDate.slice(0, 4)),
    ...manualItems.map(item => item.month.slice(0, 4)),
  ])].filter(year => /^(?!0000)\d{4}$/.test(year)).sort();
  function changeMonth(value: string) {
    onMonthChange(value); setDriver(""); setDriverSearch(""); setPreview(null); setWageDetailKey(null);
  }
  let summaries: DriverPaymentSummary[] = [], summaryError = "";
  try { summaries = summarizeDriverPayments(rows, manualItems, month, drivers); }
  catch (cause) { summaryError = cause instanceof Error ? cause.message : "支付数据汇总失败。"; }
  const payable = summaries.filter(item => item.rows.some(row =>
    row.totalWage !== 0 || row.driverAdvances !== 0) || item.manualItems.some(item => item.amount !== 0));
  const scoped = payable.filter(item => !company || item.company === company);
  const selectedDriver = scoped.some(item => item.driver === driver) ? driver : "";
  const searchText = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
  const keywords = searchText(driverSearch).trim().split(/\s+/).filter(Boolean);
  const matched = scoped.filter(item => {
    const reading = drivers.find(record => record.regionId === item.regionId && record.name === item.driver)?.reading || "";
    const text = searchText(`${item.driver} ${reading} ${item.company}`);
    return keywords.every(keyword => text.includes(keyword));
  });
  const driverOptions = [...new Set(matched.map(item => item.driver))].sort((a, b) => a.localeCompare(b, "ja"));
  const visible = scoped.filter(item => !selectedDriver || item.driver === selectedDriver);
  const wageDetail = summaries.find(item => item.key === wageDetailKey);
  const editorItems = editing ? manualItems.filter(item => item.month === month &&
    item.regionId === editing.regionId && item.driver === editing.driver) : [];
  function canDiscardItem() {
    return !(itemName || itemAmount) || window.confirm("放弃尚未保存的项目输入？");
  }
  function resetItem() { setItemId(undefined); setItemName(""); setItemAmount(""); }
  function openEditor(target?: DriverPaymentSummary) {
    setError(""); setNotice("");
    if (!canEdit) { setError("仅管理员可以管理手動项目。"); return; }
    const name = target?.driver || selectedDriver;
    const matches = drivers.filter(record => record.regionId === regionId && record.name === name);
    const payer = matches.length === 1 ? matches[0].companyName?.trim() : "";
    if (!regionId || !name || !payer) { setError("請先选择一个具体地域和運転士，并在司机资料填写所属会社。"); return; }
    setEditing({ driver: name, company: payer, regionId }); resetItem();
  }
  async function saveItem() {
    if (!editing || lock.current) return;
    if (pendingSave) { setError("数据仍在保存或保存失败，請确认保存成功后再操作。"); return; }
    const amount = Number(itemAmount);
    if (!itemName.trim() || itemName.trim().length > 200 || !/^-?\d+$/.test(itemAmount.trim()) ||
      !Number.isSafeInteger(amount) || Math.abs(amount) > 99_999_999_999_999) {
      setError("請填写1–200字的项目名称及有效日元整数金额，负数表示扣减。"); return;
    }
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const saved = await onSaveItem({ id: itemId, regionId: editing.regionId,
        month, driver: editing.driver, companyName: editorItems.find(item => item.id === itemId)?.companyName ?? editing.company,
        name: itemName.trim(), amount });
      if (!saved) throw new Error("项目保存未获确认，請核对页面顶部错误并重试；暂勿下载請求書。");
      resetItem(); setNotice("已保存；給料統計与支払管理共用该项目，只计算一次。");
    } catch (cause) {
      console.error("Driver payment item save failed.", cause);
      setError(cause instanceof Error ? cause.message : "手動项目保存失败。");
    } finally { lock.current = false; setBusy(false); }
  }
  async function download(targets: DriverPaymentSummary[], batch: boolean) {
    if (lock.current) return;
    setError(""); setNotice("");
    if (!regionId) { setError("請先选择一个具体地域后下载。"); return; }
    if (pendingSave || summaryError) { setError(summaryError || "数据仍在保存或保存失败，請确认保存成功后再下载。"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedDate)) { setError("請填写有效的発行日。"); return; }
    lock.current = true; setBusy(true); setProgress("");
    try {
      const invoices = targets.map(item => createDriverPaymentInvoice(item, month, drivers, companies, issuedDate));
      const saved = await downloadDriverPaymentInvoices(invoices, batch, (done, total) => setProgress(`${done} / ${total}`));
      setNotice(saved === "cancelled" ? "已取消下载，未保存文件。" :
        batch ? `已将${invoices.length}份請求書PDF保存到所选文件夹。` : "已生成請求書PDF下载。");
    } catch (cause) {
      console.error("Driver payment invoice download failed.", cause);
      setError(cause instanceof Error ? cause.message : "請求書下载失败，請重试。");
    } finally { lock.current = false; setBusy(false); setProgress(""); }
  }
  let previewHtml = "", previewError = "";
  if (preview) {
    try { previewHtml = buildDriverPaymentInvoiceHtml(createDriverPaymentInvoice(preview, month, drivers, companies, issuedDate)); }
    catch (cause) { previewError = cause instanceof Error ? cause.message : "請求書预览失败。"; }
  }
  return <section className="p-4 md:p-6" aria-label="支払管理">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-bold">支払管理</h2>
        <p className="mt-1 text-xs text-slate-500">业务委托报酬 · 已保存月度数据 · 报酬与立替金分列 · 不自动加税或扣税</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !canEdit} onClick={() => openEditor()}
          className="rounded border border-blue-200 bg-white px-3 py-2 text-sm text-blue-700 disabled:opacity-50">＋ 手動项目</button>
        <button type="button" disabled={busy || pendingSave || Boolean(summaryError)} onClick={() => void download(visible, true)}
          className="table-action-button table-action-button--export disabled:opacity-50">
          {busy ? `处理中… ${progress}` : "批量下载請求書（选择文件夹）"}</button>
      </div>
    </div>
    <div className="mb-4 flex flex-wrap gap-3 rounded-xl border bg-white p-3 text-sm">
      <label>年份<select aria-label="支払年份" value={month.slice(0, 4)} disabled={busy || Boolean(editing)}
        onChange={event => changeMonth(`${event.target.value}-${month.slice(5, 7)}`)}
        className="ml-2 rounded border bg-white p-2">
        {yearOptions.map(year => <option key={year} value={year}>{year}年</option>)}
      </select></label>
      <label>月份<select aria-label="支払月份" value={month.slice(5, 7)} disabled={busy || Boolean(editing)}
        onChange={event => changeMonth(`${month.slice(0, 4)}-${event.target.value}`)}
        className="ml-2 rounded border bg-white p-2">
        {Array.from({ length: 12 }, (_, index) => {
          const value = String(index + 1).padStart(2, "0");
          return <option key={value} value={value}>{index + 1}月</option>;
        })}
      </select></label>
      <label>所属会社<select aria-label="支払付款会社" value={company} disabled={busy}
        onChange={event => { setCompany(event.target.value); setDriver(""); setPreview(null); }}
        className="ml-2 rounded border p-2"><option value="">全部会社</option>
        {companyOptions.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>発行日<input aria-label="請求書発行日" type="date" value={issuedDate} disabled={busy}
        onChange={event => setIssuedDate(event.target.value)} className="ml-2 rounded border p-2" /></label>
      <button type="button" aria-label="筛选司机" aria-haspopup="dialog" aria-expanded={showDriverPicker}
        disabled={busy} onClick={() => { setDriverSearch(""); setShowDriverPicker(true); }}
        className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 font-semibold text-blue-700 disabled:opacity-50">
        筛选司机 · {selectedDriver || "全部運転士"}
      </button>
    </div>
    {showDriverPicker && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm"
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
        if (event.key === "Tab") {
          const elements = driverPickerRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
          if (!elements?.length) return;
          const first = elements[0], last = elements[elements.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement?.id === "payment-driver-picker-title")) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}>
    <section ref={driverPickerRef} role="dialog" aria-modal="true" aria-labelledby="payment-driver-picker-title"
      aria-label="支払運転士選択" className="editor-dialog max-h-[90dvh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
      <div className="dialog-floating-header mb-4 flex items-center justify-between gap-3">
        <h3 id="payment-driver-picker-title" tabIndex={-1} className="text-xl font-bold text-slate-800 outline-none">運転士を選択</h3>
        <button type="button" aria-label="关闭司机筛选" onClick={() => { setDriverSearch(""); setShowDriverPicker(false); }}
          className="rounded-lg px-3 py-1 text-2xl text-slate-500">×</button>
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="mt-1 text-xs text-slate-500">仅显示当月有工資、立替金或手动金额的運転士；输入姓名、读音或会社可模糊查找。</p>
        <input type="search" autoComplete="off" aria-label="搜索支払運転士" placeholder="搜索姓名・读音・会社"
          value={driverSearch} disabled={busy} onChange={event => setDriverSearch(event.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm sm:w-72" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <button type="button" disabled={busy} aria-pressed={!selectedDriver} onClick={() => selectDriver("")}
          className={`min-h-20 rounded-xl border p-3 text-left disabled:opacity-50 ${!selectedDriver ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
          <span className="block text-sm font-semibold">全部運転士</span>
        </button>
        {driverOptions.map(name => <button key={name} type="button" aria-label={`支払運転士：${name}`} aria-pressed={selectedDriver === name}
            disabled={busy} onClick={() => selectDriver(name)}
            className={`min-h-20 min-w-0 break-words rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${selectedDriver === name ? "border-blue-600 bg-blue-50 text-blue-800 shadow-sm" : "border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50"}`}>
            <span className="block text-sm font-semibold">{name}</span>
          </button>)}
      </div>
      {!driverOptions.length && <p role="status" className="mt-3 text-sm text-slate-500">{driverSearch.trim() ? "没有匹配的運転士，请调整搜索文字。" : "本月没有符合条件的支払数据。"}</p>}
    </section></div>}
    {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
    {summaryError && <p role="alert" className="mb-3 text-sm text-red-600">{summaryError}</p>}
    {notice && <p role="status" className="mb-3 text-sm text-emerald-700">{notice}</p>}
    {pendingSave && <p role="status" className="mb-3 text-sm text-amber-800">数据尚未确认保存，请先完成保存；請求書下载暂不可用。</p>}
    <div className="list-panel overflow-x-auto border bg-white">
      <table className="management-table w-full min-w-[1250px] table-fixed text-center text-sm" data-table="driver-payments">
        <colgroup><col style={{ width: "16%" }} />{Array.from({ length: 7 }, (_, index) =>
          <col key={index} style={{ width: "10%" }} />)}<col style={{ width: "14%" }} /></colgroup>
        <thead><tr>{["運転士姓名", "運転士立替", "超時工資", "奖励工資", "運転士比例工資", "運転士固定工資",
          "手動项目", "支付総額", "操作"].map(label => <th key={label} className="px-3 py-3 font-semibold">{label}</th>)}</tr></thead>
        <tbody>{visible.length ? visible.map(item => <tr key={item.key} className="border-t">
          <td className="px-3 py-3 font-medium">{item.driver}
            <span className="mt-1 block text-xs text-slate-500">{splitVehicleOwner(item.company).company || "未设置会社"}</span>
            {splitVehicleOwner(item.company).office && <span className="mt-1 block text-xs text-slate-500">{splitVehicleOwner(item.company).office}</span>}
          </td>
          {[item.advances, item.overtime, item.bonus, item.percentage, item.fixed, item.manual].map((amount, index) =>
            <td key={index} className="px-3 py-3 tabular-nums">{yen(amount)}</td>)}
          <td className="px-3 py-3 font-bold tabular-nums">{yen(item.total)}</td>
          <td className="px-3 py-3"><div className="flex flex-wrap justify-center gap-2">
            <button type="button" disabled={busy} onClick={() => setWageDetailKey(item.key)}
              className="table-action-button table-action-button--edit">給料明細</button>
            <button type="button" disabled={busy} onClick={() => setPreview(item)}
              className="table-action-button table-action-button--export">预览</button>
            <button type="button" disabled={busy || pendingSave} onClick={() => void download([item], false)}
              className="table-action-button table-action-button--export">PDF</button>
          </div></td>
        </tr>) : <tr><td colSpan={9} className="p-8 text-slate-500">{summaryError ? "无法汇总，請核对数据后重试。" : "本月暂无支付记录，可选择付款会社和運転士添加手動项目。"}</td></tr>}</tbody>
      </table>
    </div>
    <p className="mt-3 text-xs text-slate-500">手動项目与給料統計同步，正数追加、负数扣减。請求書不保存编号、开票歴史或付款状态；仅供业务委托报酬使用。</p>
    {wageDetail && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="payment-wage-title"
        className="editor-dialog editor-dialog--wide max-h-[95vh] overflow-y-auto bg-white p-6">
        <div className="dialog-floating-header mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h3 id="payment-wage-title" className="font-bold">給料明細 · {wageDetail.driver} · {month}</h3>
            <p className="mt-1 text-sm text-slate-500">{wageDetail.company || "未设置会社"}</p></div>
          <div className="flex items-center gap-3">
            <button type="button" disabled={busy || !canEdit} onClick={() => openEditor(wageDetail)}
              className="table-action-button table-action-button--edit">手動项目</button>
            <button type="button" aria-label="关闭給料明細" onClick={() => setWageDetailKey(null)} className="text-2xl">×</button>
          </div>
        </div>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {([["運転士立替", wageDetail.advances], ["工資総額（手動项目含む）", wageDetail.remuneration],
            ["支付総額", wageDetail.total]] as const).map(([label, amount]) =>
            <div key={label} className="rounded-xl border border-blue-100 bg-blue-50 p-3 text-sm">
              {label}<strong className="mt-1 block text-xl tabular-nums">{yen(amount)}</strong>
            </div>)}
        </div>
        <h4 className="mb-2 font-semibold">每日給料明細</h4>
        <div className="list-panel overflow-x-auto border bg-white">
          <table className="management-table w-full min-w-[1200px] text-center text-sm" aria-label="每日給料明細">
            <thead><tr>{["服务日期", "訂単名称", "車両番号", "運転士立替", "超時（h）", "超時工資", "奖励工資",
              "比例工資", "固定工資", "支付総額"].map(label => <th key={label} className="px-3 py-3">{label}</th>)}</tr></thead>
            <tbody>{[...wageDetail.rows].sort((a, b) => `${a.serviceDate} ${a.time}`.localeCompare(`${b.serviceDate} ${b.time}`))
              .map((row, index) => <tr key={index} className="border-t">
                <td className="whitespace-nowrap px-3 py-3">{row.serviceDate}</td>
                <td className="px-3 py-3">{row.customer}<span className="mt-1 block text-xs text-slate-500">核算：{row.accountingAssignee || "—"}</span></td>
                <td className="px-3 py-3">{row.isOutsourcedVehicle ? "" : row.vehicleNumber || "—"}</td>
                {[row.driverAdvances, row.overtimeHours, row.overtimeFee, row.bonusWage, row.percentageWage, row.fixedWage,
                  row.driverAdvances + row.totalWage].map((amount, column) =>
                  <td key={column} className="px-3 py-3 tabular-nums">{column === 1 ? amount.toLocaleString("ja-JP") : yen(amount)}</td>)}
              </tr>)}
              {!wageDetail.rows.length && <tr><td colSpan={10} className="p-6 text-slate-500">本月暂无每日工資记录。</td></tr>}
            </tbody>
          </table>
        </div>
        <h4 className="mb-2 mt-4 font-semibold">手動项目</h4>
        <div className="space-y-2">{wageDetail.manualItems.map(item =>
          <div key={item.id} className="flex justify-between gap-3 rounded border p-3 text-sm">
            <span className="min-w-0 break-words">{item.name}</span><strong className="whitespace-nowrap tabular-nums">{yen(item.amount)}</strong>
          </div>)}
          {!wageDetail.manualItems.length && <p className="text-sm text-slate-500">暂无手動项目。</p>}
        </div>
        <p className="mt-4 text-xs text-slate-500">支付総額＝運転士立替＋比例工資＋固定工資＋超時工資＋奖励工資＋手動项目。手動项目只计算一次；未自动加税或扣税。</p>
      </section>
    </div>}
    {editing && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="payment-items-title"
        className="editor-dialog editor-dialog--compact max-h-[90vh] overflow-y-auto bg-white p-6">
        <div className="dialog-floating-header mb-4 flex items-center justify-between gap-3">
          <h3 id="payment-items-title" className="font-bold">手動项目 · {editing.driver} · {month}</h3>
          <button type="button" disabled={busy} aria-label="关闭手動项目" onClick={() => {
            if (!canDiscardItem()) return;
            setEditing(null); resetItem();
          }} className="text-2xl">×</button></div>
        <p className="mb-3 text-sm text-slate-500">{editing.company} · 与給料統計共用，金额只计算一次。</p>
        {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
        <div className="mb-4 space-y-2">{editorItems.map(item => <div key={item.id} className="flex flex-wrap items-center gap-3 rounded border p-3 text-sm">
          <span className="min-w-0 flex-1 break-words">{item.name}</span><strong>{yen(item.amount)}</strong>
          <button type="button" disabled={busy} className="table-action-button table-action-button--edit"
            onClick={() => { if (!canDiscardItem()) return;
              setItemId(item.id); setItemName(item.name); setItemAmount(String(item.amount)); }}>编辑</button>
          <button type="button" disabled={busy} className="table-action-button table-action-button--delete"
            onClick={() => onDeleteItem(item)}>削除</button>
        </div>)}</div>
        <form onSubmit={event => { event.preventDefault(); void saveItem(); }}>
          <div className="editor-fields"><label className="text-sm">项目名称<input aria-label="支払项目名称" value={itemName}
            maxLength={200} required disabled={busy} onChange={event => setItemName(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
            <label className="text-sm">项目金额（JPY）<input aria-label="支払项目金额" type="number" step="1" required
              min="-99999999999999" max="99999999999999" value={itemAmount} disabled={busy}
              onChange={event => setItemAmount(event.target.value)} className="mt-1 w-full rounded border p-2" /></label></div>
          <div className="mt-4 flex justify-end gap-2">
            {itemId && <button type="button" disabled={busy} onClick={() => { if (canDiscardItem()) resetItem(); }}
              className="rounded border px-3 py-2 text-sm">新增另一项目</button>}
            <button type="submit" disabled={busy || pendingSave} className="rounded bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-50">
              {busy ? "保存中…" : "保存项目"}</button>
          </div>
        </form>
      </section>
    </div>}
    {preview && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="payment-preview-title"
        className="editor-dialog editor-dialog--wide max-h-[95vh] overflow-y-auto bg-white p-6">
        <div className="dialog-floating-header mb-3 flex items-center justify-between gap-3">
          <h3 id="payment-preview-title" className="font-bold">請求書预览 · {preview.driver}</h3>
          <div className="flex gap-3"><button type="button" disabled={busy || pendingSave} onClick={() => void download([preview], false)}
            className="table-action-button table-action-button--export">下载PDF</button>
            <button type="button" disabled={busy} aria-label="关闭請求書预览" onClick={() => setPreview(null)} className="text-2xl">×</button></div>
        </div>
        {(previewError || error) && <p role="alert" className="mb-3 text-sm text-red-600">{previewError || error}</p>}
        {previewHtml && <iframe title="運転士請求書预览" sandbox="" srcDoc={previewHtml} className="h-[70vh] w-full rounded border bg-white" />}
      </section>
    </div>}
  </section>;
}
