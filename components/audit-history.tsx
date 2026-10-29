"use client";

import { useEffect, useState } from "react";
import { z } from "zod";
import { auditChanges, auditTableNames, auditTables, formatAuditTime, type AuditLog, type AuditValue } from "@/lib/audit";
import { buildApiErrorMessage, readJsonSafely } from "@/lib/api-client";
import type { Region } from "@/lib/domain";

const pageSchema = z.object({
  logs: z.array(z.object({
    id: z.string().uuid(), occurred_at: z.string(), actor_id: z.string().uuid().nullable(),
    actor_name: z.string(), region_id: z.string().uuid().nullable(),
    table_name: z.enum(auditTableNames), record_id: z.string().uuid(), record_label: z.string(),
    action: z.enum(["INSERT", "UPDATE", "DELETE"]),
    before_data: z.record(z.string(), z.json()).nullable(),
    after_data: z.record(z.string(), z.json()).nullable(),
  })),
  hasNext: z.boolean(), page: z.number().int(),
});

const actionLabels = { INSERT: "新增", UPDATE: "修改", DELETE: "删除" } as const;

function displayValue(value: AuditValue | undefined) {
  if (value === undefined) return "（不存在）";
  if (value === null) return "（空值）";
  if (value === "") return "（空白）";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function AuditHistory({ regions, regionId }: { regions: Region[]; regionId: string }) {
  const [filters, setFilters] = useState({
    table: "", action: "", actor: "", region: regionId, start: "", end: "", record: "", page: 1,
  });
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ logs: AuditLog[]; hasNext: boolean } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError("");
      setResult(null);
      try {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(filters)) {
          if (value !== "") params.set(key, String(value));
        }
        const response = await fetch(`/api/admin/audit?${params}`, { signal: controller.signal });
        const payload = await readJsonSafely(response);
        if (!response.ok) throw new Error(buildApiErrorMessage(response, payload, "读取操作记录失败。"));
        const parsed = pageSchema.safeParse(payload);
        if (!parsed.success) throw new Error("服务器返回的操作记录格式不正确。");
        if (!controller.signal.aborted) setResult(parsed.data);
      } catch (caught) {
        if (controller.signal.aborted) return;
        console.error("Failed to load audit history.", caught);
        setError(caught instanceof Error ? caught.message : "读取操作记录失败。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [filters, refresh]);

  function changeFilter(key: Exclude<keyof typeof filters, "page">, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value, page: 1 }));
  }
  const controlClass = "mt-1 block w-full rounded border bg-white px-3 py-2 text-sm";

  return (
    <div className="p-4 md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">操作记录</h2>
        <button type="button" onClick={() => setRefresh((value) => value + 1)}
          disabled={loading} className="rounded border bg-white px-3 py-2 text-sm disabled:opacity-50">
          重新读取
        </button>
      </div>
      <p className="mb-4 text-sm text-gray-600">
        仅管理员可查看。记录启用后的业务新增、修改、删除及請求書编号分配；相同内容重复保存不产生记录。
        時間均为日本時間。历史操作无法补查；印章只记录图片指纹，不保留图片副本。
      </p>
      <div className="mb-4 grid gap-3 rounded border bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
        <label className="text-sm">业务类型
          <select value={filters.table} onChange={(event) => changeFilter("table", event.target.value)} className={controlClass}>
            <option value="">全部业务</option>
            {Object.entries(auditTables).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="text-sm">操作
          <select value={filters.action} onChange={(event) => changeFilter("action", event.target.value)} className={controlClass}>
            <option value="">全部操作</option>
            {Object.entries(actionLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="text-sm">操作人
          <input value={filters.actor} maxLength={200} placeholder="用户姓名"
            onChange={(event) => changeFilter("actor", event.target.value)} className={controlClass} />
        </label>
        <label className="text-sm">地域
          <select value={filters.region} onChange={(event) => changeFilter("region", event.target.value)} className={controlClass}>
            <option value="">全部地域</option>
            {regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
        </label>
        <label className="text-sm">开始日期
          <input type="date" value={filters.start} onChange={(event) => changeFilter("start", event.target.value)} className={controlClass} />
        </label>
        <label className="text-sm">结束日期
          <input type="date" value={filters.end} onChange={(event) => changeFilter("end", event.target.value)} className={controlClass} />
        </label>
        <label className="text-sm sm:col-span-2">记录编号（精确查询，可从下方记录复制）
          <input value={filters.record} placeholder="UUID" onChange={(event) => changeFilter("record", event.target.value)} className={controlClass} />
        </label>
      </div>
      {error && <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {loading && <p role="status" className="mb-4 text-sm text-gray-600">正在读取操作记录…</p>}
      {result && (
        <>
          {result.logs.length === 0 && <p className="rounded border bg-white p-4 text-sm text-gray-500">没有符合条件的操作记录。</p>}
          <div className="space-y-3">
            {result.logs.map((log) => (
              <details key={log.id} className="rounded border bg-white p-4">
                <summary className="cursor-pointer text-sm">
                  <span className="font-semibold">{log.actor_name}</span>
                  {" · "}{actionLabels[log.action]}{" · "}{auditTables[log.table_name]}{" · "}{log.record_label}
                  <span className="ml-3 text-gray-500">
                    {formatAuditTime(log.occurred_at)}{" · "}{regions.find((region) => region.id === log.region_id)?.name ?? "历史／未知地域"}
                  </span>
                </summary>
                <p className="my-3 break-all text-xs text-gray-500">
                  记录编号：{log.record_id}　操作账号编号：{log.actor_id ?? "系统操作"}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full table-fixed text-left text-sm">
                    <thead className="bg-gray-50"><tr><th className="w-1/4 p-2">字段</th><th className="p-2">操作前</th><th className="p-2">操作后</th></tr></thead>
                    <tbody>{auditChanges(log.before_data, log.after_data).map((change) => (
                      <tr key={change.field} className="border-t align-top">
                        <td className="break-words p-2">{change.field}</td>
                        <td className="whitespace-pre-wrap break-words p-2 [overflow-wrap:anywhere]">{displayValue(change.before)}</td>
                        <td className="whitespace-pre-wrap break-words p-2 [overflow-wrap:anywhere]">{displayValue(change.after)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-end gap-3 text-sm">
            <button type="button" disabled={filters.page === 1}
              onClick={() => setFilters((previous) => ({ ...previous, page: previous.page - 1 }))}
              className="rounded border bg-white px-3 py-2 disabled:opacity-40">上一页</button>
            <span>第 {filters.page} 页 · 每页最多50条</span>
            <button type="button" disabled={!result.hasNext}
              onClick={() => setFilters((previous) => ({ ...previous, page: previous.page + 1 }))}
              className="rounded border bg-white px-3 py-2 disabled:opacity-40">下一页</button>
          </div>
        </>
      )}
    </div>
  );
}
