"use client";

import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { buildApiErrorMessage, readJsonSafely } from "@/lib/api-client";
import type { CollectionName } from "@/lib/domain";
import { toLastOperation, type AuditedRecord } from "@/lib/audit";

type Identified = AuditedRecord & { id: string; regionId?: string };

function withoutOperation<T extends Identified>(item: T) {
  const { lastOperation, ...data } = item;
  void lastOperation;
  return data;
}

export function usePersistedCollection<T extends Identified>(
  collection: CollectionName,
  reportError: (message: string) => void,
  reportPending: (change: number) => void,
  getDeletePassword: () => string,
  getRegionId: () => string | null,
) {
  const [items, setItems] = useState<T[]>([]);
  const itemsRef = useRef(items);
  const saveQueue = useRef(Promise.resolve());
  const pendingSaves = useRef(0);
  const changeVersion = useRef(0);
  const persistenceFailed = useRef(false);

  const replaceItems = useCallback((nextItems: T[]) => {
    persistenceFailed.current = false;
    itemsRef.current = nextItems;
    setItems(nextItems);
  }, []);

  /** Version of local edits; any edit after a sync fetch started invalidates that fetch. */
  const getChangeVersion = useCallback(() => changeVersion.current, []);

  /** Apply server data from a background sync unless local edits happened or are still saving. */
  const syncItems = useCallback((serverItems: T[], startedAtVersion: number) => {
    if (pendingSaves.current > 0 || changeVersion.current !== startedAtVersion) return false;
    if (JSON.stringify(serverItems) === JSON.stringify(itemsRef.current)) return false;
    itemsRef.current = serverItems;
    setItems(serverItems);
    return true;
  }, []);

  const updateItems = useCallback<Dispatch<SetStateAction<T[]>>>((action) => {
    const previous = itemsRef.current;
    const requested = typeof action === "function" ? action(previous) : action;
    if (requested === previous) return;

    const previousById = new Map(previous.map((item) => [item.id, item]));
    const defaultRegionId = getRegionId();
    const next = requested.map((item) => ({
      ...item,
      regionId: item.regionId || previousById.get(item.id)?.regionId || defaultRegionId || "",
    }));
    if (next.some((item) => !item.regionId)) {
      persistenceFailed.current = true;
      reportError("新增業務数据前，請先選択一个具体地域。");
      return;
    }

    itemsRef.current = next;
    setItems(next);
    changeVersion.current += 1;

    const nextById = new Map(next.map((item) => [item.id, item]));
    const upsert = next.filter(
      (item) => {
        const previousItem = previousById.get(item.id);
        return !previousItem ||
          JSON.stringify(withoutOperation(previousItem)) !== JSON.stringify(withoutOperation(item));
      },
    );
    const deleteIds = previous
      .filter((item) => !nextById.has(item.id))
      .map((item) => item.id);
    const deletePassword = deleteIds.length > 0 ? getDeletePassword() : "";

    if (upsert.length === 0 && deleteIds.length === 0) return;
    reportPending(1);
    pendingSaves.current += 1;

    saveQueue.current = saveQueue.current
      .then(async () => {
        const response = await fetch("/api/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collection, upsert: upsert.map(withoutOperation), deleteIds, deletePassword }),
        });
        const result = await readJsonSafely(response);
        if (!response.ok) {
          throw new Error(buildApiErrorMessage(response, result, `保存${collection}失败。`));
        }
        if (typeof result !== "object" || result === null || !("saved" in result) ||
          !Array.isArray(result.saved)) {
          throw new Error("保存后未收到操作信息，請重新载入核对。");
        }
        const operations = new Map(result.saved.map((record: unknown) => {
          if (typeof record !== "object" || record === null ||
            !("id" in record) || typeof record.id !== "string" || !("lastOperation" in record)) {
            throw new Error("服务器返回的操作信息格式不正确。");
          }
          return [record.id, toLastOperation(record.lastOperation)] as const;
        }));
        const current = itemsRef.current.map((item) =>
          operations.has(item.id) ? { ...item, lastOperation: operations.get(item.id) } : item,
        );
        itemsRef.current = current;
        setItems(current);
        changeVersion.current += 1;
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : `保存${collection}時発生未知错误。`;
        console.error(`Failed to persist ${collection}.`, error);
        persistenceFailed.current = true;
        reportError(message);
      })
      .finally(() => {
        pendingSaves.current -= 1;
        reportPending(-1);
      });
  }, [collection, getDeletePassword, getRegionId, reportError, reportPending]);

  const waitForSave = useCallback(async () => {
    await saveQueue.current;
    return !persistenceFailed.current;
  }, []);

  return { items, updateItems, replaceItems, syncItems, getChangeVersion, waitForSave };
}
