"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { isCompanySealDataUrl } from "@/lib/company-seal";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onBusyChange: (busy: boolean) => void;
  standalone?: boolean;
};

export function CompanySealUpload({ value, onChange, onBusyChange, standalone = false }: Props) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; onBusyChange(false); }, [onBusyChange]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    const request = ++sequence.current;
    setBusy(true);
    onBusyChange(true);
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        throw new Error("請選択 PNG、JPG 或 WebP 图片，不支持 SVG 等格式。");
      }
      if (file.size > 2 * 1024 * 1024) throw new Error("印章原图不能超过2MB。");
      const bitmap = await createImageBitmap(file);
      let data: string;
      try {
        if (bitmap.width > 10000 || bitmap.height > 10000 || bitmap.width * bitmap.height > 20_000_000) {
          throw new Error("印章图片尺寸过大，請缩小后重试。");
        }
        const scale = Math.min(1, 512 / bitmap.width, 512 / bitmap.height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法处理印章图片，請更换浏览器后重试。");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        data = canvas.toDataURL("image/png");
      } finally {
        bitmap.close();
      }
      if (!isCompanySealDataUrl(data)) throw new Error("处理后的印章图片过大或无效，請使用更簡洁的印章图片。");
      if (request === sequence.current) onChange(data);
    } catch (error) {
      if (request === sequence.current) {
        setError(error instanceof Error ? error.message : "印章图片读取失败，請重新選択。");
      }
    } finally {
      if (request === sequence.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }

  return (
    <div className="rounded border p-3">
      <label className="block text-sm font-medium">
        会社印章（用于請求書）
        <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={upload}
          className="mt-2 block w-full text-sm" />
      </label>
      <p className="mt-2 text-xs text-gray-500">建议使用透明背景 PNG；原图最大2MB，保存時缩小至512像素以内。{standalone ? "点击保存印章后用于請求書" : "保存会社后用于請求書"}，未上传時不显示印章。</p>
      {busy && <p role="status" className="mt-2 text-sm text-blue-700">正在处理印章…</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {value && (
        <div className="mt-3 flex items-center gap-4">
          <Image src={value} alt="会社印章预览" width={96} height={96} unoptimized
            className="h-24 w-24 border bg-white object-contain" />
          <button type="button" disabled={busy} onClick={() => { setError(""); onChange(""); }}
            className="rounded border px-3 py-2 text-sm text-red-700 disabled:opacity-40">移除印章</button>
        </div>
      )}
    </div>
  );
}
