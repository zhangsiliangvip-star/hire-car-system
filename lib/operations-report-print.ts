import { durationLabel, dutyDuration, isBlankReportStop, reportTotals } from "@/lib/driver/reports";
import { operationDateLabel, operationTimeLabel, type OperationRow } from "@/lib/operations-reports";

function escape(value: string) {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function inspectionForm(operationsManager: string | null) {
  const cab = [
    ["ブレーキペダル", "踏みしろ、きき具合"],
    ["駐車ブレーキ・レバー", "引きしろ"],
    ["エンジン", "かかり具合<br>低速・加速状態"],
    ["ウインド・ウォッシャー", "噴射状態"],
    ["ワイパー", "払拭状態"],
    ["室内", "清掃状態"],
    ["ドアロック・座席ベルト", "損傷有無"],
  ];
  const engine = [
    ["ウインド・ウォッシャー", "液量"], ["ブレーキリザーブ・タンク", "液量"],
    ["バッテリー", "液量"], ["ラジエーター", "水量"], ["エンジンオイル", "油量"],
    ["ファンベルト", "張り具合、損傷"],
  ];
  const checkRows = (items: string[][], group: string) => items.map(([place, item], index) =>
    `<tr>${index === 0 ? `<th class="vertical" rowspan="${items.length}">${group}</th>` : ""}
    <td>${place}</td><td>${item}</td><td class="circle">○</td></tr>`).join("");
  return `<div class="paper-lower">
    <table class="alcohol"><colgroup><col style="width:33%"><col style="width:8%"><col style="width:41%"><col style="width:8%"><col style="width:10%"></colgroup><tbody>
      <tr><th>始業時アルコールチェック（宿泊の場合）</th><th>施設名</th><td></td><th>確認者</th><td></td></tr>
      <tr><th>終業時アルコールチェック（宿泊の場合）</th><th>施設名</th><td></td><th>確認者</th><td></td></tr>
      <tr><th>運行管理者＆補助者</th><td colspan="3" rowspan="2" class="remarks">報告及び特記事項
        <span>車体損傷　　あり　　　なし</span></td><th>給油量</th></tr>
      <tr><td class="manager-sign">${escape(operationsManager ?? "")}</td><td class="fuel-blank">L</td></tr>
    </tbody></table>
    <table class="inspection-heading"><tbody><tr><th>日　常　点　検</th><th>整備管理者＆運行管理者＆補助者</th></tr></tbody></table>
    <div class="inspection-columns">
      <table class="inspection left-inspection"><colgroup><col style="width:7%"><col style="width:43%"><col style="width:43%"><col style="width:7%"></colgroup>
        <thead><tr><th>順番</th><th>点検箇所</th><th>点検項目</th><th>良</th></tr></thead><tbody>
          ${checkRows(cab, "運転席点検")}${checkRows(engine, "エンジンルーム点検")}
          <tr><td colspan="3" class="alcohol-device">携帯式アルコールチェッカー番号、　返却</td><td class="circle">○</td></tr>
        </tbody></table>
      <table class="inspection right-inspection"><colgroup><col style="width:7%"><col style="width:43%"><col style="width:43%"><col style="width:7%"></colgroup>
        <thead><tr><th colspan="2">点検箇所</th><th>点検項目</th><th>良</th></tr></thead><tbody>
          <tr><th class="vertical" rowspan="8">車の周りの点検</th><td rowspan="4">タイヤ</td><td>空気圧</td><td class="circle">○</td></tr>
          <tr><td>亀裂、損傷</td><td class="circle">○</td></tr>
          <tr><td>異常な摩耗</td><td class="circle">○</td></tr>
          <tr><td>溝の深さ</td><td class="circle">○</td></tr>
          <tr><td rowspan="3">灯火装置及び方向<br>指示器<br>（前照灯・尾灯・番号灯<br>後退灯・方向指示器）</td><td>点灯具合</td><td class="circle">○</td></tr>
          <tr><td>点滅具合</td><td class="circle">○</td></tr>
          <tr><td>汚れ・損傷</td><td class="circle">○</td></tr>
          <tr><td>ディスクホイールの取付</td><td>取り付け状況</td><td class="circle">○</td></tr>
          <tr><th class="vertical" rowspan="2">その他</th><td>非常信号計・工具</td><td>備え付け</td><td class="circle">○</td></tr>
          <tr><td>車検証・保険証</td><td>備え付け</td><td class="circle">○</td></tr>
          <tr><th class="vertical" rowspan="4">備考</th><td>配車時間</td><td colspan="2">時　分</td></tr>
          <tr><td>終了時間</td><td colspan="2">時　分</td></tr>
          <tr><td>車両掃除</td><td colspan="2">あり　　なし</td></tr>
          <tr><td>ＥＴＣ使用</td><td colspan="2">あり　　なし</td></tr>
        </tbody></table>
    </div></div>`;
}
export function buildOperationsPrintHtml(rows: OperationRow[], title: string) {
  if (!rows.length) throw new Error("没有可打印的日报。");
  const time = (value: string | null) => escape(operationTimeLabel(value));
  const km = (value: number | null | undefined) => value === null || value === undefined ? "—" : value.toFixed(1);
  const pages = [...rows].sort((a, b) => a.report.serviceDate.localeCompare(b.report.serviceDate) ||
    a.report.departedAt.localeCompare(b.report.departedAt) || a.report.id.localeCompare(b.report.id)).map(row => {
    const r = row.report; const h = r.header;
    const hours = dutyDuration(r); const totals = reportTotals(r);
    const duty = (clock: string | null | undefined) => clock ? escape(clock) : "未填写";
    const stops = r.stops.filter(s => !isBlankReportStop(s));
    const stopRows = stops.map((s, i) => `<tbody class="stop-entry" data-stop-id="${escape(s.id)}">
      <tr><th rowspan="2">${i + 1}</th><td rowspan="2" class="place">${escape(s.address || "（地点未填写）")}</td>
        <td>${time(s.arrivedAt)}</td><td>着</td><td class="odometer">${km(s.arrivedKm)} km</td>
        <td rowspan="2" class="planned">${s.plannedKm !== null && s.plannedKm !== undefined ? `${km(s.plannedKm)} km` : ""}</td></tr>
      <tr><td>${time(s.departedAt)}</td><td>発</td><td class="odometer">${km(s.departedKm)} km</td></tr></tbody>`).join("");
    return `<section class="sheet"><article class="content">
      <table class="report-header"><colgroup>${Array(8).fill('<col style="width:12.5%">').join("")}</colgroup><tbody>
      <tr><th colspan="8" class="report-title">乗　務　日　報</th></tr>
      <tr><td colspan="2">${escape(operationDateLabel(r.serviceDate))} · 日本时间</td><th>運転士</th><td colspan="3">${escape(h?.driverName || row.driverName)}</td>
        <td colspan="2">${r.returnedAt ? "已归库" : "出库中（未完成）"}</td></tr>
      <tr><th>所属</th><td colspan="3">${escape(row.company || "未匹配")}</td><th>車両番号</th><td colspan="3">${escape(h?.vehicleNumber || "未填写")}</td></tr>
      <tr><th>乗車人数</th><td>${h?.passengerCount ?? "未填写"}</td><th colspan="2">出勤時間（始業点呼）</th><td colspan="4">${duty(h?.dutyStartTime)}</td></tr>
      <tr><th colspan="2">工作总时长</th><td colspan="2">${hours === null ? "点呼日期／时间未完整，无法计算" : durationLabel(hours)}</td>
        <th colspan="2">退勤時間（終業点呼）</th><td colspan="2">${duty(h?.dutyEndTime)}</td></tr>
      </tbody></table>
      <table class="journey"><colgroup><col style="width:6%"><col style="width:34%"><col style="width:24%"><col style="width:5%"><col style="width:17%"><col style="width:14%"></colgroup>
      <thead><tr><th>No</th><th>出発地・到着地<br>主な経由地</th><th colspan="2">日付・時間</th><th>メーター距離数<br>（表示距離）</th><th>予定距離<br>（表示距離）</th></tr></thead>
      <tbody><tr><th>出库</th><td class="place">${escape(r.departureAddress)}</td><td>${time(r.departedAt)}</td><td>発</td><td class="odometer">${km(r.departureKm)} km</td><td></td></tr></tbody>
      ${stopRows}
      <tbody><tr><th>归库</th><td class="place">${escape(r.returnAddress ?? "未归库")}</td><td>${time(r.returnedAt)}</td><td>着</td><td class="odometer">${km(r.returnKm)} km</td><td></td></tr></tbody>
      </table>
      <table class="totals"><tbody><tr><th>メーター数<br>運行開始前</th><td>${km(r.departureKm)} km</td>
        <th>メーター数<br>運行終了後</th><td>${km(r.returnKm)} km</td><th>差引全走行距離</th><td>${km(totals.distance)} km</td></tr>
        <tr><th>累计休息</th><td colspan="5">${durationLabel(totals.restMs)}（经由地到着至出发）</td></tr></tbody></table>
      ${r.rests.length ? `<table class="rest-records"><thead><tr><th colspan="2">休息记录（另存的休息打卡）</th></tr><tr><th>开始</th><th>结束</th></tr></thead><tbody>${r.rests.map(rest =>
        `<tr><td>${time(rest.startedAt)}</td><td>${time(rest.endedAt)}</td></tr>`).join("")}</tbody></table>` : ""}
      ${inspectionForm(row.operationsManager)}
      <footer>工时＝退勤点呼－出勤点呼；不扣除休息。公里表为累计读数。運行管理者取车辆所属会社资料；其他点检、确认及给油栏未采集，留空手填。○为原表印刷符号，不代表已通过。日报版本 ${r.version}。</footer>
      </article></section>`;
  }).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(title)}</title>
    <style>@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#000}
    body{font:11px "Yu Mincho","MS Mincho","Noto Serif CJK JP","SimSun",serif}.sheet{width:190mm;height:276mm;overflow:hidden;break-after:page;page-break-after:always}
    .sheet:last-child{break-after:auto;page-break-after:auto}.content{width:190mm;transform-origin:top left}
    table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{border:1px solid #222;padding:3px 4px;overflow-wrap:anywhere;text-align:center;vertical-align:middle;font-weight:normal}
    .report-title{font-size:23px;font-weight:bold;height:10mm;letter-spacing:3px}
    .report-header td,.report-header th:not(.report-title){height:6.5mm}
    .journey th,.journey td{padding:2px 4px;line-height:1.35;min-height:4.5mm}
    .journey .place{text-align:left;white-space:pre-wrap}.odometer,.planned{font-variant-numeric:tabular-nums}
    .stop-entry{break-inside:avoid}.totals td,.totals th{height:7mm}.rest-records th,.rest-records td{padding:2px}
    .paper-lower{margin-top:2mm}.alcohol{font-size:10px}.alcohol tr{height:6mm}
    .remarks{text-align:left}.remarks span{display:inline-block;margin-left:12px}.manager-sign{height:8mm}.fuel-blank{text-align:right;vertical-align:bottom}
    .inspection-heading th{height:6mm;letter-spacing:1px}.inspection-columns{display:grid;grid-template-columns:1fr 1fr}
    .inspection{font-size:10.5px}.inspection tr{height:5.6mm}.inspection th,.inspection td{padding:1px 3px;line-height:1.15}
    .right-inspection{margin-left:-1px;width:calc(100% + 1px)}.vertical{writing-mode:vertical-rl;letter-spacing:2px}
    .circle{font-size:15px;line-height:1}.alcohol-device{text-align:left}.inspection-heading,.alcohol,.report-header,.journey,.totals,.rest-records{margin-bottom:-1px}
    footer{margin-top:2mm;font:9px Arial,sans-serif;line-height:1.3}</style></head><body>${pages}</body></html>`;
}

export async function printOperationsReports(rows: OperationRow[], title: string, signal: AbortSignal) {
  const html = buildOperationsPrintHtml(rows, title);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const frame = document.createElement("iframe");
  frame.title = title;
  frame.style.cssText = "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0";
  const cleanup = () => { frame.remove(); signal.removeEventListener("abort", cleanup); };
  signal.addEventListener("abort", cleanup, { once: true });
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument; const view = frame.contentWindow;
    if (!doc || !view) throw new Error("无法创建打印页面。");
    doc.open(); doc.write(html); doc.close();
    await doc.fonts.ready;
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const pages = doc.querySelectorAll<HTMLElement>(".sheet");
    if (pages.length !== rows.length) throw new Error("打印日报数量不一致。");
    for (const sheet of pages) {
      const content = sheet.querySelector<HTMLElement>(".content");
      if (!content) throw new Error("打印版式加载失败。");
      const scale = Math.min(1, sheet.clientHeight / content.scrollHeight, sheet.clientWidth / content.scrollWidth);
      if (!Number.isFinite(scale) || scale <= 0) throw new Error("打印尺寸无效。");
      content.style.transform = `scale(${scale})`;
    }
    view.addEventListener("afterprint", cleanup, { once: true });
    view.focus(); view.print();
  } catch (error) {
    cleanup(); throw error;
  }
}
