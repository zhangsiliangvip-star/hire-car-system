"use client";

import Link from "next/link";
import DriverNavigation from "@/app/driver/navigation";
import DriverTripNotes from "@/components/driver-trip-notes";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { assignmentIdSchema, createDriverRequestId, japanDate, tripActions, tripNavigationUrl, tripPreviousStates, tripStatusLabels, type DriverTrip, type DriverTripItem, type TripState } from "@/lib/driver/orders";

type Identity = { name: string; globalSlogan?: string; personalSlogan?: string };
type FlightTrackingInfo = {
  flightNumber: string;
  status: "tracking_pending" | "scheduled" | "delayed" | "en_route" | "landed" | "cancelled" | "diverted" | "unknown" | "not_found";
  terminal: string | null;
  arrivalTime: string | null;
  updatedAt: string;
};
type FlightTrackingState = FlightTrackingInfo | { error: string };
const flightStatusLabels: Record<FlightTrackingInfo["status"], string> = {
  tracking_pending: "免费套餐不支持提前查询航班，请在航班当天查看",
  scheduled: "计划中",
  delayed: "延误",
  en_route: "飞行中",
  landed: "已落地",
  cancelled: "已取消",
  diverted: "已备降",
  unknown: "状态未知",
  not_found: "暂未找到航班记录",
};

function FlightInfo({ flightNumber, state, inDailyOverview = false }: {
  flightNumber: string;
  state?: FlightTrackingState;
  inDailyOverview?: boolean;
}) {
  return <section className={inDailyOverview
    ? "driver-daily-flight"
    : "rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm"}>
    <div className="driver-row"><span>航班信息</span><strong>{flightNumber}</strong></div>
    {!state ? <p className="driver-muted">正在查询航班状态…</p> :
      "error" in state ? <p className="driver-error" role="status">{state.error}</p> :
        <>
          <div className="driver-row"><span>飞行状态</span><strong>{flightStatusLabels[state.status]}</strong></div>
          <div className="driver-row"><span>到达航站楼</span><strong>{state.terminal || "航班数据暂未提供"}</strong></div>
          {state.arrivalTime && <div className="driver-row"><span>预计／实际到达</span>
            <strong>{new Intl.DateTimeFormat("zh-CN", {
              timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit",
            }).format(new Date(state.arrivalTime))}</strong></div>}
        </>}
  </section>;
}

function TripLocation({ label, address }: { label: string; address: string }) {
  const href = tripNavigationUrl(address);
  return <div className="min-w-0 break-words"><span className="driver-muted">{label}</span>
    <p>{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="driver-link whitespace-pre-wrap underline"
      aria-label={`${label}：${address}，打开Google Maps导航`}>{address} ↗</a> : "待确认"}</p>
  </div>;
}
export default function DriverTrips({ assignmentId, orderId }: { assignmentId?: string; orderId?: string }) {
  const [date, setDate] = useState(() => japanDate());
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [trips, setTrips] = useState<DriverTripItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [flightTracking, setFlightTracking] = useState<Record<string, FlightTrackingState>>({});
  const pendingRequest = useRef<{ assignmentId: string; version: number; requestId: string; state: TripState } | null>(null);
  const savingRef = useRef(false);
  const detail = orderId !== undefined;
  const flightTrackingKey = JSON.stringify(trips.flatMap((trip) =>
    !("historical" in trip) && trip.details?.flightNumber.trim()
      ? [{ assignmentId: trip.assignmentId, flightNumber: trip.details.flightNumber, serviceDate: trip.date }]
      : [],
  ));

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let loading = false;
    async function load() {
      if (loading || savingRef.current) return;
      loading = true;
      try {
        if (detail && !assignmentIdSchema.safeParse(assignmentId).success) throw new Error("行程链接无效，請返回列表重新選択。");
        const query = detail ? `assignmentId=${encodeURIComponent(assignmentId!)}` : `date=${date}`;
        const [me, response] = await Promise.all([
          fetch("/api/driver/me", { cache: "no-store", signal: controller.signal }),
          fetch(`/api/driver/orders?${query}`, { cache: "no-store", signal: controller.signal }),
        ]);
        if (me.status === 401 || response.status === 401) { location.replace("/driver/login"); return; }
        if (!me.ok) throw new Error("運転士身份不可用，請联系管理员或重新登录。");
        const profile: Identity = await me.json();
        if (!response.ok) throw new Error(response.status === 404 ? "行程已撤派或不存在。" : "无法读取行程，請重试。");
        const data: { trips: DriverTrip[] } = await response.json();
        if (detail && (data.trips.length !== 1 || data.trips[0].orderId !== orderId)) throw new Error("行程不存在或无权查看。");
        if (active && !savingRef.current && document.visibilityState === "visible") {
          setIdentity(profile); setTrips(data.trips); setError("");
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        console.error("Driver trip load failed.", cause);
        if (active) { setTrips([]); setIdentity(null); setError(cause instanceof Error ? cause.message : "无法读取行程。"); }
      } finally {
        loading = false;
        if (active && document.visibilityState === "visible") { setBusy(false); setRefreshing(false); }
      }
    }
    function revalidate() {
      setIdentity(null); setTrips([]); setBusy(true); setError(""); setRevision((value) => value + 1);
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") { setTrips([]); setIdentity(null); setBusy(true); }
      else revalidate();
    }
    function onPageShow(event: PageTransitionEvent) { if (event.persisted) revalidate(); }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    const { data: subscription } = createClient("driver").auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") { setTrips([]); setIdentity(null); location.replace("/driver/login"); }
    });
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10_000);
    return () => {
      active = false; controller.abort(); clearInterval(timer); subscription.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [date, assignmentId, orderId, detail, revision]);

  useEffect(() => {
    const assignments = JSON.parse(flightTrackingKey) as {
      assignmentId: string;
      flightNumber: string;
      serviceDate: string;
    }[];
    let active = true;
    const controller = new AbortController();
    async function refreshFlights() {
      await Promise.all(assignments.map(async ({ assignmentId }) => {
        try {
          const response = await fetch(
            `/api/driver/flights?assignmentId=${encodeURIComponent(assignmentId)}`,
            { cache: "no-store", signal: controller.signal },
          );
          const result = await response.json() as { flight?: FlightTrackingInfo; error?: string };
          if (!response.ok || !result.flight) {
            throw new Error(typeof result.error === "string" ? result.error : "航班状态暂时不可用。");
          }
          if (active) setFlightTracking((current) => ({ ...current, [assignmentId]: result.flight! }));
        } catch (cause) {
          if (controller.signal.aborted) return;
          console.error("Driver flight status load failed.", cause);
          if (active) setFlightTracking((current) => ({
            ...current,
            [assignmentId]: { error: cause instanceof Error ? cause.message : "航班状态暂时不可用。" },
          }));
        }
      }));
    }
    if (assignments.length) {
      setFlightTracking((current) => Object.fromEntries(
        Object.entries(current).filter(([assignmentId]) =>
          assignments.some((assignment) => assignment.assignmentId === assignmentId),
        ),
      ));
      void refreshFlights();
    } else {
      setFlightTracking({});
    }
    const timer = assignments.length ? setInterval(() => {
      if (document.visibilityState === "visible") void refreshFlights();
    }, 5 * 60_000) : null;
    return () => {
      active = false;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [flightTrackingKey]);

  // Keeps current cards visible while reloading; actions stay locked until fresh versions arrive.
  function refresh() { setRefreshing(true); setError(""); setRevision((value) => value + 1); }
  async function advance(trip: DriverTripItem, backwards = false) {
    if ("historical" in trip) return;
    if (savingRef.current || refreshing) return;
    const state = backwards ? tripPreviousStates[trip.status] : tripActions[trip.status]?.state;
    if (!state) return;
    if (backwards && !window.confirm(`将行程状態从“${tripStatusLabels[trip.status]}”退回“${tripStatusLabels[state]}”？已有記録会保留。`)) return;
    savingRef.current = true; setSaving(true); setError(""); setNotice("");
    try {
      if (pendingRequest.current?.assignmentId !== trip.assignmentId || pendingRequest.current.version !== trip.version || pendingRequest.current.state !== state) {
        pendingRequest.current = { assignmentId: trip.assignmentId, version: trip.version, requestId: createDriverRequestId(), state };
      }
      const acknowledging = !backwards && state === "acknowledged";
      const response = await fetch(`/api/driver/assignments/${trip.assignmentId}/${acknowledging ? "acknowledge" : "events"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: trip.version, requestId: pendingRequest.current.requestId,
          ...(acknowledging ? {} : { state }) }),
      });
      if (!response.ok) {
        const failure: { error?: unknown } = await response.json();
        if ([401,403,404,409].includes(response.status)) { pendingRequest.current = null; refresh(); }
        throw new Error(typeof failure.error === "string" ? failure.error :
          response.status === 409 ? "派单状態已变化，正在刷新，請核对后重试。" : `行程更新未获确认（${response.status}），請重试或联系调度。`);
      }
      pendingRequest.current = null; setNotice("操作已記録，正在刷新最新行程状態。"); refresh();
    } catch (cause) {
      console.error("Driver trip action failed.", cause);
      setError(cause instanceof Error ? cause.message : "无法更新行程。");
    } finally { savingRef.current = false; setSaving(false); }
  }
  function changeDate(next: string) {
    if (!next || next === date) return;
    setTrips([]); setBusy(true); setError(""); setNotice(""); setDate(next);
  }
  return <main className="driver-main">
    <DriverNavigation active="trips" busy={saving} />
    <div className="driver-page-header">
      {detail ? <Link className="driver-link" href="/driver">‹ 返回我的行程</Link> :
        <p className="driver-global-slogan">{identity?.globalSlogan ?? "平安出行，美好的一天"}</p>}
    </div>
    <h1>{detail ? "行程详情" : identity ?
      (identity.personalSlogan || `${identity.name}，你好`) : "我的行程"}</h1>
    {!detail && <div className="driver-tabs driver-trip-dates">
      {[0,1].map((offset) => <button key={offset} aria-pressed={date === japanDate(offset)}
        onClick={() => changeDate(japanDate(offset))}>
        {offset ? "明天" : "今天"} · {japanDate(offset).slice(5)}
      </button>)}
      <input type="date" aria-label="選択行程日期" value={date}
        onChange={event => changeDate(event.target.value)} />
      <Link className="driver-calendar-link" href="/driver/calendar">日历</Link>
    </div>}
    {error && <p className="driver-error" role="alert">{error}</p>}
    {notice && <p className="driver-notice" role="status">{notice}</p>}
    {busy ? <p className="driver-empty" role="status">正在核验并读取行程…</p> : <>
      {!detail && trips.length > 0 && <section className="driver-card driver-hero driver-daily-overview">
        <span className="driver-muted">{date === japanDate() ? "当日全部訂単行程" : `${date} 全部訂単行程`}</span>
        <div className="driver-daily-orders">{trips.map((trip, index) => <div className="driver-daily-order" key={`${trip.orderId}-${trip.date}`}>
          <span className="driver-muted driver-daily-number">訂単 {index + 1}</span>
          <div className="driver-daily-content">
            <h2>{trip.details?.orderName || "訂単内容未填写"}</h2>
            <p className="driver-daily-summary">{trip.details?.tripSummary || "行程簡概未填写"}</p>
          </div>
          <p className="driver-muted driver-daily-plate">車両番号：{trip.vehicleNumber || "未填写"}</p>
          {!("historical" in trip) && trip.details?.flightNumber && <FlightInfo
            flightNumber={trip.details.flightNumber}
            state={flightTracking[trip.assignmentId]}
            inDailyOverview
          />}
        </div>)}</div>
      </section>}
      {!trips.length && !error && <div className="driver-card driver-empty">暂无获派行程，請等待调度安排。</div>}
      {trips.map((trip) => <article className="driver-card" key={trip.assignmentId ?? `${trip.orderId}-${trip.date}`}>
        <div className="driver-toolbar"><div><span className="driver-muted">配車時間</span>
          <time className="driver-time block">{trip.time || "待定"}</time></div>
          <span className={`driver-status ${trip.status === "assigned" ? "pending" : ""}`}>
            {"historical" in trip ? "历史訂単（只读）" : tripStatusLabels[trip.status]}</span></div>
        <div className="my-3 space-y-3">
          <TripLocation label="上車地点" address={trip.pickup} />
          <TripLocation label="下車地点" address={trip.destination} />
          {"historical" in trip ? <div className="break-words"><p className="driver-muted">備考</p>
            <p className="whitespace-pre-wrap">{trip.details?.notes || "未填写"}</p></div> :
            <DriverTripNotes assignmentId={trip.assignmentId} notes={trip.details?.notes ?? ""} disabled={saving || refreshing}
              onSavingChange={value => { savingRef.current = value; setSaving(value); }}
              onConflict={() => setRevision(value => value + 1)}
              onSaved={notes => {
                setTrips(current => current.map(item => item.orderId === trip.orderId && item.details
                  ? { ...item, details: { ...item.details, notes } } : item));
                setRevision(value => value + 1);
              }} />}
        </div>
        <div className="driver-row"><span>服务日期</span><strong>{trip.date}</strong></div>
        <div className="driver-row"><span>車両</span><strong>{trip.vehicle || "請联系调度确认"}</strong></div>
        <div className="driver-row"><span>車両番号</span><strong className="break-words">{trip.vehicleNumber || "未填写"}</strong></div>
        {detail && trip.details && <div className="space-y-3 break-words">
          <div className="driver-row"><span>訂単名称</span><strong>{trip.details.orderName || "未填写"}</strong></div>
          <div><p className="driver-muted">行程簡概</p><p className="whitespace-pre-wrap">{trip.details.tripSummary || "未填写"}</p></div>
        </div>}
        {detail && !("historical" in trip) && trip.details?.flightNumber && <FlightInfo
          flightNumber={trip.details.flightNumber}
          state={flightTracking[trip.assignmentId]}
        />}
        {detail ? <>
          {!("historical" in trip) && tripActions[trip.status] && <button className="driver-button" disabled={saving || refreshing} onClick={() => advance(trip)}>{saving ? "正在記録…" : refreshing ? "正在更新…" : tripActions[trip.status]?.label}</button>}
          {!("historical" in trip) && tripPreviousStates[trip.status] && <button className="driver-button driver-secondary" disabled={saving || refreshing}
            onClick={() => advance(trip, true)}>退回上一步</button>}
        </> : "historical" in trip ? null :
          <Link className="driver-button driver-secondary" href={`/driver/orders/${trip.orderId}?assignmentId=${trip.assignmentId}`}>查看行程 ›</Link>}
      </article>)}
    </>}
  </main>;
}
