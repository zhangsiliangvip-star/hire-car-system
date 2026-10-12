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

type Identified = { id: string };

export function usePersistedCollection<T extends Identified>(
  collection: CollectionName,
  reportError: (message: string) => void,
  reportPending: (change: number) => void,
  getDeletePassword: () => string,
) {
  const [items, setItems] = useState<T[]>([]);
  const itemsRef = useRef(items);
  const saveQueue = useRef(Promise.resolve());

  const replaceItems = useCallback((nextItems: T[]) => {
    itemsRef.current = nextItems;
    setItems(nextItems);
  }, []);

  const updateItems = useCallback<Dispatch<SetStateAction<T[]>>>((action) => {
    const previous = itemsRef.current;
    const next = typeof action === "function" ? action(previous) : action;
    if (next === previous) return;

    itemsRef.current = next;
    setItems(next);

    const previousById = new Map(previous.map((item) => [item.id, item]));
    const nextById = new Map(next.map((item) => [item.id, item]));
    const upsert = next.filter(
      (item) => JSON.stringify(previousById.get(item.id)) !== JSON.stringify(item),
    );
    const deleteIds = previous
      .filter((item) => !nextById.has(item.id))
      .map((item) => item.id);
    const deletePassword = deleteIds.length > 0 ? getDeletePassword() : "";

    if (upsert.length === 0 && deleteIds.length === 0) return;
    reportPending(1);

    saveQueue.current = saveQueue.current
      .then(async () => {
        const response = await fetch("/api/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collection, upsert, deleteIds, deletePassword }),
        });
        const result = await readJsonSafely(response);
        if (!response.ok) {
          throw new Error(buildApiErrorMessage(response, result, `保存${collection}失败。`));
        }
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : `保存${collection}时发生未知错误。`;
        console.error(`Failed to persist ${collection}.`, error);
        reportError(message);
      })
      .finally(() => reportPending(-1));
  }, [collection, getDeletePassword, reportError, reportPending]);

  return { items, updateItems, replaceItems };
}
