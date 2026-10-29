"use client";

import DriverNavigation from "@/app/driver/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { createClient } from "@/lib/supabase/browser";
import { createDriverRequestId, japanDate } from "@/lib/driver/orders";
import { expenseTotals, financeClaimSchema, financeDataSchema, financeSubmissionSchema,
  financeCategoryLabels, type Expense, type FinanceData, type FinanceCategory } from "@/lib/driver/finance";
import "./finance.css";
import { fuelClaimSchema, fuelSubmissionSchema } from "@/lib/driver/fuel";

const yen = (value: number) => `¥${value.toLocaleString("ja-JP")}`;
const labels = { pending: "待后台确认", approved: "已确认入账", rejected: "已退回，请修改后提交" };
export default function DriverFinance() {
  const [month, setMonth] = useState(() => japanDate().slice(0, 7));
  const [date, setDate] = useState(() => japanDate());
  const [data, setData] = useState<FinanceData | null>(null);
  const [selected, setSelected] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [hours, setHours] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [receipt, setReceipt] = useState("");
  const [view, setView] = useState<"claims" | "wages">("claims");
  const [fuelAmount, setFuelAmount] = useState("");
  const [fuelReceipts, setFuelReceipts] = useState<string[]>([]);
  const [fuelAssignment, setFuelAssignment] = useState("");
  const lock = useRef(false);
  const generation = useRef(0);
  const pickingReceipt = useRef(false);
  const selectedDate = useRef(date);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const trip = data?.trips.find(item => item.assignmentId === selected);
  const overtimeClaim = trip?.claims.find(item => item.category === "overtime");
  const overtimeReadOnly = Boolean(overtimeClaim && overtimeClaim.status !== "rejected");
  const fuelClaim = data?.fuelClaims.find(item => item.date === date);
  const fuelReadOnly = Boolean(fuelClaim && fuelClaim.status !== "rejected");
  const advanceSections = (["company", "trip"] as const).map(category => {
    const claim = trip?.claims.find(item => item.category === category);
    return { category, claim, readOnly: Boolean(claim && claim.status !== "rejected") };
  });
  const orderDirty = (["company", "trip"] as const).some(type =>
    JSON.stringify(expenses.filter(item => item.type === type)) !==
    JSON.stringify(trip?.claims.find(item => item.category === type)?.expenses || [])) ||
    Number(hours || 0) !== (overtimeClaim?.overtimeHours ?? trip?.existingOvertimeHours ?? 0);
  const dirty = orderDirty ||
    Number(fuelAmount || 0) !== (fuelClaim?.amount || 0) ||
    JSON.stringify(fuelReceipts) !== JSON.stringify(fuelClaim?.receipts || []) ||
    fuelAssignment !== (fuelClaim?.assignmentId || "");

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    async function load() {
      try {
        const response = await fetch(`/api/driver/finance?month=${encodeURIComponent(month)}`,
          { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { location.replace("/driver/login?next=%2Fdriver%2Ffinance"); return; }
        const result = await response.json();
        if (controller.signal.aborted || generation.current !== current) return;
        if (!response.ok) throw new Error(result.error || "无法读取财务。");
        const parsed = financeDataSchema.parse(result);
        setData(parsed);
        const fuel = parsed.fuelClaims.find(item => item.date === selectedDate.current);
        setFuelAmount(fuel ? String(fuel.amount) : ""); setFuelReceipts(fuel?.receipts || []); setFuelAssignment(fuel?.assignmentId || "");
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("Driver finance load failed.", cause);
        setError(cause instanceof Error ? cause.message : "无法读取财务。");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    function hide() {
      // Native phone photo pickers temporarily hide the page before delivering the file.
      if (pickingReceipt.current) { setReceipt(""); return; }
      if (document.visibilityState === "hidden") {
        ++generation.current; controller.abort(); lock.current = false; pending.current = null;
        setBusy(false); setLoading(true); setData(null); setSelected(""); setExpenses([]); setHours("");
        setReceipt(""); setNotice(""); setError("");
        setFuelAmount(""); setFuelReceipts([]); setFuelAssignment("");
      }
      else setRevision(value => value + 1);
    }
    const { data: subscription } = createClient().auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") {
        pickingReceipt.current = false;
        ++generation.current; controller.abort(); setData(null); setSelected(""); setExpenses([]); setHours("");
        setReceipt(""); setNotice(""); setError(""); pending.current = null; location.replace("/driver/login");
        setFuelAmount(""); setFuelReceipts([]); setFuelAssignment("");
      }
    });
    function cancelPicker() { pickingReceipt.current = false; }
    document.addEventListener("visibilitychange", hide);
    document.addEventListener("cancel", cancelPicker, true);
    return () => {
      generation.current = current + 1; controller.abort(); subscription.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", hide); document.removeEventListener("cancel", cancelPicker, true);
    };
  }, [month, revision]);

  function canLeave() { return !dirty || window.confirm("切换会放弃尚未提交的明细，是否继续？"); }
  function changeDate(next: string) {
    if (!next || next === date || !canLeave()) return;
    const nextMonth = next.slice(0, 7);
    if (nextMonth !== month) {
      setLoading(true); setData(null); setMonth(nextMonth);
    }
    const fuel = nextMonth === month ? data?.fuelClaims.find(item => item.date === next) : null;
    selectedDate.current = next;
    setDate(next); setSelected(""); setExpenses([]); setHours(""); setReceipt(""); setNotice(""); setError("");
    setFuelAmount(fuel ? String(fuel.amount) : ""); setFuelReceipts(fuel?.receipts || []); setFuelAssignment(fuel?.assignmentId || "");
    pending.current = null;
  }
  function choose(id: string) {
    if (id === selected || (orderDirty && !window.confirm("切换訂単会放弃该訂単尚未提交的明细，是否继续？"))) return;
    const item = data?.trips.find(item => item.assignmentId === id);
    setSelected(id); setExpenses(item?.claims.flatMap(claim => claim.expenses) || []);
    setHours(item ? String(item.claims.find(claim => claim.category === "overtime")?.overtimeHours ?? item.existingOvertimeHours) : "");
    setNotice(""); setError(""); setReceipt(""); pending.current = null;
  }
  function edit(id: string, patch: Partial<Expense>) {
    setExpenses(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  }
  async function upload(id: string, files: FileList | null) {
    const isFuel = id === "fuel";
    if (!files?.length || lock.current || (!isFuel && !trip)) return;
    const selectedFiles = Array.from(files);
    const expense = expenses.find(item => item.id === id);
    if (!isFuel && (!expense || !trip)) { setError("请先選択訂単和費用明细。"); return; }
    const receiptCount = isFuel ? fuelReceipts.length : expense?.receipts.length || 0;
    if (receiptCount + selectedFiles.length > 5) { setError("每条明细最多5张票据。"); return; }
    const pathPrefix = isFuel ? date : trip && expense ? `${trip.assignmentId}/${expense.type}` : "";
    if (!pathPrefix) { setError("无法确定票据所属訂単。"); return; }
    if (selectedFiles.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5242880)) {
      setError("票据请使用5MB以内的JPG、PNG或WebP照片。"); return;
    }
    lock.current = true; setBusy(true); setError("");
    const current = generation.current;
    try {
      const supabase = createClient();
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (current !== generation.current) return;
      if (authError || !auth.user) throw new Error("登录已失效，请重新登录。");
      for (const file of selectedFiles) {
        const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
        const path = `${auth.user.id}/${pathPrefix}/${createDriverRequestId()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from(isFuel ? "driver-fuel-receipts" : "driver-finance-receipts")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (current !== generation.current) return;
        if (uploadError) throw new Error(`票据上传失败：${uploadError.message}；已上传的票据仍保留，请核对后重试。`);
        if (isFuel) setFuelReceipts(items => [...items, path]);
        else setExpenses(items => items.map(item => item.id === id ? { ...item, receipts: [...item.receipts, path] } : item));
      }
    } catch (cause) {
      if (current !== generation.current) return;
      console.error("Driver receipt upload failed.", cause); setError(cause instanceof Error ? cause.message : "票据上传失败。");
    } finally { if (current === generation.current) { lock.current = false; setBusy(false); } }
  }
  async function viewReceipt(path: string, bucket = "driver-finance-receipts") {
    const current = generation.current;
    try {
      const { data: signed, error: signingError } = await createClient().storage.from(bucket).createSignedUrl(path, 60);
      if (current !== generation.current) return;
      if (signingError || !signed) throw new Error("票据读取失败，请重试。");
      setReceipt(signed.signedUrl);
    } catch (cause) { if (current === generation.current) { console.error("Receipt read failed.", cause); setError(cause instanceof Error ? cause.message : "票据读取失败。"); } }
  }
  function handleAdvanceReceipt(event: MouseEvent<HTMLButtonElement>) {
    void viewReceipt(event.currentTarget.value);
  }
  function handleAdvanceSubmit(event: MouseEvent<HTMLButtonElement>) {
    const category = event.currentTarget.value;
    if (category === "company" || category === "trip") void submit(category);
  }
  async function submitFuel() {
    if (lock.current || fuelReadOnly) return;
    const content = { date, assignmentId: fuelAssignment, amount: Number(fuelAmount), receipts: fuelReceipts,
      expectedVersion: fuelClaim?.version || 0 };
    const key = JSON.stringify(content);
    if (pending.current?.key !== key) pending.current = { key, id: createDriverRequestId() };
    const parsed = fuelSubmissionSchema.safeParse({ ...content, requestId: pending.current.id });
    if (!parsed.success) { setError("请選択当天关联訂単，填写正整数燃油費并检查油票。"); return; }
    const current = generation.current;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/driver/fuel", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data) });
      const result = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) throw new Error(result.error || "燃油費申报未确认。");
      const saved = fuelClaimSchema.parse(result.claim);
      setData(value => value ? { ...value, fuelClaims: [...value.fuelClaims.filter(item => item.date !== saved.date), saved] } : null);
      pending.current = null; setNotice("燃油費已提交；后台确认后追加到关联訂単当天燃油費，不加入司机立替和应发金额。");
    } catch (cause) {
      if (current !== generation.current) return;
      console.error("Driver fuel submission failed.", cause);
      setError(cause instanceof Error ? cause.message : "燃油費提交失败。");
    } finally { if (current === generation.current) { lock.current = false; setBusy(false); } }
  }
  async function submit(targetCategory: FinanceCategory) {
    if (lock.current || !trip) return;
    const content = { assignmentId: trip.assignmentId, historical: trip.historical, category: targetCategory,
      expectedVersion: trip.claims.find(item => item.category === targetCategory)?.version || 0,
      expenses: targetCategory === "overtime" ? [] : expenses.filter(item => item.type === targetCategory),
      overtimeHours: targetCategory === "overtime" ? Number(hours || 0) : 0 };
    const key = JSON.stringify(content);
    if (pending.current?.key !== key) pending.current = { key, id: createDriverRequestId() };
    const parsed = financeSubmissionSchema.safeParse({ ...content, requestId: pending.current.id });
    if (!parsed.success) { setError("请填写每条費用明细及正整数金额；超时为0–999小时，最多两位小数。"); return; }
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const current = generation.current;
    try {
      const response = await fetch("/api/driver/finance", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed.data),
      });
      const result = await response.json();
      if (current !== generation.current) return;
      if (!response.ok) throw new Error(result.error || "提交未获确认，请刷新核对。");
      const claim = financeClaimSchema.parse(result.claim);
      setData(current => current ? { ...current, trips: current.trips.map(item =>
        item.assignmentId === claim.assignmentId ? { ...item, claims: [
          ...item.claims.filter(value => value.category !== claim.category), claim,
        ] } : item) } : null);
      pending.current = null; setNotice(`${financeCategoryLabels[claim.category]}已提交，待后台确认；其他分类可继续填写。`);
    } catch (cause) {
      if (current !== generation.current) return;
      console.error("Driver finance submit failed.", cause); setError(cause instanceof Error ? cause.message : "提交失败。");
    } finally { if (current === generation.current) { lock.current = false; setBusy(false); } }
  }
  const dayTrips = data?.trips.filter(item => item.date === date) || [];
  const fuelTrips = dayTrips.filter(item => !item.historical);
  const dayTotals = expenseTotals(dayTrips.flatMap(item => item.assignmentId === selected ? expenses : item.claims.flatMap(claim => claim.expenses)));
  const wages = data?.wages.reduce((total, row) => ({
    base: total.base + row.base, bonus: total.bonus + row.bonus,
    overtime: total.overtime + row.overtime, advances: total.advances + row.advances,
  }), { base: 0, bonus: 0, overtime: 0, advances: 0 });
  return <main className="driver-main driver-finance">
    <DriverNavigation active="finance" busy={busy} canLeave={canLeave} />
    <h1>财务工资</h1>
    <div className="driver-tabs" aria-label="财务界面">
      <button type="button" aria-pressed={view === "claims"} onClick={() => { setView("claims"); setReceipt(""); }}>立替申报</button>
      <button type="button" aria-pressed={view === "wages"} onClick={() => { setView("wages"); setReceipt(""); }}>月工资</button>
    </div>
    <p className="driver-muted">本人有效行程可申报社报／旅报、超时和燃油費；历史訂単可补录社报／旅报及超时。后台审核后入账。切后台会清除未提交草稿，请先提交。</p>
    <label className="driver-field">月份<input type="month" value={month} disabled={busy}
      onChange={event => { if (event.target.value && canLeave()) {
        setLoading(true); setData(null); setSelected(""); setExpenses([]); setHours(""); setError(""); setNotice(""); setReceipt("");
        setFuelAmount(""); setFuelReceipts([]); setFuelAssignment("");
        setMonth(event.target.value); setDate(`${event.target.value}-01`);
        selectedDate.current = `${event.target.value}-01`;
      } }} /></label>
    <button className="driver-link" disabled={busy || loading} onClick={() => {
      if (!canLeave()) return;
      setLoading(true); setData(null); setSelected(""); setExpenses([]); setHours(""); setError(""); setReceipt("");
      setFuelAmount(""); setFuelReceipts([]); setFuelAssignment("");
      setRevision(value => value + 1);
    }}>刷新财务</button>
    {error && <p className="driver-error" role="alert">{error}</p>}
    {notice && <p className="driver-notice" role="status">{notice}</p>}
    {loading ? <p className="driver-empty">正在读取财务…</p> : data && <>
      {view === "wages" ? <section className="driver-card"><h2>本月工资</h2>
        <p className="driver-muted">只读，应发金额包含基本、奖励、超时工资、手动加减及后台已记司机立替。待审申报不计入，不代表已支付；尚未核算的数据可能继续调整。</p>
        <div className="driver-row"><span>基本工资</span><strong>{yen(wages!.base)}</strong></div>
        <div className="driver-row"><span>奖励工资</span><strong>{yen(wages!.bonus)}</strong></div>
        <div className="driver-row"><span>超时工资</span><strong>{yen(wages!.overtime)}</strong></div>
        {data.manualItems.map((item, index) => <div className="driver-row" key={`manual-${index}`}><span>{item.name}</span><strong>{yen(item.amount)}</strong></div>)}
        <div className="driver-row"><span>后台已记司机立替</span><strong>{yen(wages!.advances)}</strong></div>
        <details><summary>按日工资及立替明细</summary>{data.wages.map((row, index) =>
          <div className="driver-row" key={`${row.date}-${index}`}><span>{row.date}</span><strong>{yen(row.base + row.bonus + row.overtime + row.advances)}</strong></div>)}</details>
        <div className="driver-row"><span>应发金额</span><strong>{yen(wages!.base + wages!.bonus + wages!.overtime + wages!.advances +
          data.manualItems.reduce((sum, item) => sum + item.amount, 0))}</strong></div>
      </section> : <>
      <div className="finance-date-row"><label className="driver-field">用車日期<input type="date" value={date} min={`${month}-01`}
        max={`${month}-${new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate()}`} disabled={busy}
        onChange={event => changeDate(event.target.value)} /></label>
        <button className="driver-link" type="button" disabled={busy} onClick={() => changeDate(japanDate())}>当日</button></div>
      <label className="driver-field">選択当天訂単<select value={selected} disabled={busy} onChange={event => choose(event.target.value)}>
        <option value="">请選択当天訂単</option>{dayTrips.map(item =>
          <option key={item.assignmentId} value={item.assignmentId}>{item.historical ? "历史訂単 · " : ""}{item.pickup} → {item.destination}</option>)}
      </select></label>
      {!dayTrips.length && <p className="driver-empty">当天暂无本人可申报的行程。</p>}
      {trip && advanceSections.map(({ category, claim, readOnly }) =>
        <section className="driver-card" key={category} aria-label={financeCategoryLabels[category]}>
        <h2>{financeCategoryLabels[category]}{trip.historical ? " · 历史訂単" : ""}</h2>
        {claim && <p className="driver-muted">{labels[claim.status]} {claim.reviewNote}</p>}
        <fieldset disabled={busy || readOnly} className="finance-fields">
          <button className="driver-link" type="button" onClick={() => setExpenses(items => [...items,
            { id: createDriverRequestId(), type: category, detail: "", amount: 0, receipts: [] }])}
            disabled={expenses.filter(item => item.type === category).length >= 50 || busy || readOnly}>＋添加{financeCategoryLabels[category]}明细</button>
          {expenses.filter(item => item.type === category).map((item, index) => <div className="finance-expense" key={item.id}>
            <h3>{index + 1}. {item.type === "company" ? "社报" : "旅报"}</h3>
            <div className="finance-expense-row">
            <label className="driver-field">明细<input maxLength={200} value={item.detail} onChange={event => edit(item.id, { detail: event.target.value })} /></label>
            <label className="driver-field">金额（JPY）<input type="number" min="1" max="99999999999999" step="1" inputMode="numeric"
              onWheel={event => event.currentTarget.blur()}
              value={item.amount || ""} onChange={event => edit(item.id, { amount: Number(event.target.value) })} /></label>
            </div>
            <label className="driver-field">上传票据（可选，最多5张）<input type="file" accept="image/jpeg,image/png,image/webp" multiple
              onClick={() => { pickingReceipt.current = true; }}
              onChange={event => { pickingReceipt.current = false; void upload(item.id, event.target.files); event.target.value = ""; }} /></label>
            <p className="driver-muted">已上传 {item.receipts.length} 张</p>
            {!readOnly && item.receipts.map((path, receiptIndex) => <button className="driver-link" type="button" key={path}
              onClick={() => { edit(item.id, { receipts: item.receipts.filter(value => value !== path) }); setReceipt(""); }}>
              移除票据 {receiptIndex + 1}　
            </button>)}
            {!readOnly && <button className="driver-link" type="button" onClick={() => setExpenses(items => items.filter(value => value.id !== item.id))}>删除此明细</button>}
          </div>)}
        </fieldset>
        {expenses.filter(item => item.type === category).flatMap(item => item.receipts).map((path, index) =>
          <button key={`${path}-${index}`} className="driver-link" value={path} onClick={handleAdvanceReceipt}>查看票据 {index + 1}　</button>)}
        {!readOnly && <button className="driver-button" disabled={busy} value={category} onClick={handleAdvanceSubmit}>{busy ? "正在处理…" : `保存${financeCategoryLabels[category]}并提交`}</button>}
      </section>)}
      {trip && <section className="driver-card">
        <h2>超时申报{trip.historical ? " · 历史訂単" : ""}</h2>
        {overtimeClaim && <p className="driver-muted">{labels[overtimeClaim.status]} {overtimeClaim.reviewNote}</p>}
          <label className="driver-field">超时小时数<input type="number" min="0" max="999" step="0.01" inputMode="decimal"
            disabled={busy || overtimeReadOnly}
            onWheel={event => event.currentTarget.blur()}
            placeholder="例：1.5" value={hours} onChange={event => setHours(event.target.value)} /></label>
        {!overtimeReadOnly && <button className="driver-button" disabled={busy} onClick={() => void submit("overtime")}>保存超时并提交</button>}
      </section>}
      <section className="driver-card"><h2>当日燃油費</h2>
        <p className="driver-muted">公司支付／油卡。每天统一申报一次，指定当天一张訂単；审核后追加到该訂単当天燃油費，不计司机立替及应发金额。请勿重复手工录入。</p>
        {fuelClaim && <p className="driver-muted">{labels[fuelClaim.status]} {fuelClaim.reviewNote}</p>}
        <fieldset className="finance-fields" disabled={busy || fuelReadOnly || !fuelTrips.length}>
          <label className="driver-field">燃油費关联訂単<select value={fuelAssignment} onChange={event => setFuelAssignment(event.target.value)}>
            <option value="">请選択当天一张訂単</option>
            {fuelClaim && !dayTrips.some(item => item.assignmentId === fuelClaim.assignmentId) &&
              <option value={fuelClaim.assignmentId}>原关联訂単（当前不可选）</option>}
            {fuelTrips.map(item => <option value={item.assignmentId} key={item.assignmentId}>{item.pickup} → {item.destination}</option>)}
          </select></label>
          <label className="driver-field">燃油費（JPY）<input type="number" min="1" max="99999999999999" step="1" inputMode="numeric"
            value={fuelAmount} onChange={event => setFuelAmount(event.target.value)} onWheel={event => event.currentTarget.blur()} /></label>
          <label className="driver-field">油票上传（可选，最多5张）<input type="file" accept="image/jpeg,image/png,image/webp" multiple
            onClick={() => { pickingReceipt.current = true; }}
            onChange={event => { pickingReceipt.current = false; void upload("fuel", event.target.files); event.target.value = ""; }} /></label>
          <p className="driver-muted">已上传 {fuelReceipts.length} 张</p>
          {fuelReceipts.map((path, index) => <button className="driver-link" type="button" key={path}
            onClick={() => { setFuelReceipts(items => items.filter(item => item !== path)); setReceipt(""); }}>移除油票 {index + 1}　</button>)}
        </fieldset>
        {fuelReceipts.map((path, index) => <button className="driver-link" type="button" key={path}
          onClick={() => void viewReceipt(path, "driver-fuel-receipts")}>查看油票 {index + 1}　</button>)}
        {!fuelReadOnly && <button className="driver-button" disabled={busy || !fuelTrips.length} onClick={() => void submitFuel()}>保存燃油費并提交</button>}
      </section>
      <section className="driver-card"><h2>司机立替汇总</h2>
        <div className="driver-row"><span>社报立替</span><strong>{yen(dayTotals.company)}</strong></div>
        <div className="driver-row"><span>旅报立替</span><strong>{yen(dayTotals.trip)}</strong></div>
        <div className="driver-row"><span>司机立替合计</span><strong>{yen(dayTotals.company + dayTotals.trip)}</strong></div>
        <p className="driver-muted">所选日期全部訂単，包含待审、已确认、退回及当前草稿，不代表已报销金额。</p>
      </section>
      </>}
    </>}
    {receipt && <section className="driver-card"><button className="driver-link" onClick={() => setReceipt("")}>关闭票据</button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={receipt} alt="司机财务票据" className="finance-receipt" /></section>}
  </main>;
}
