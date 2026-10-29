"use client";

import { useState } from "react";

export const DEFAULT_VEHICLE_NAME_OPTIONS = [
  "Alphard",
  "Hiace",
  "Tesla",
  "外注 Alphard",
  "外注 Hiace",
  "外注其他",
];
export const MANUAL_VEHICLE_NAME = "__manual_vehicle_name__";
const STORAGE_KEY = "hire-car-system:vehicle-name-options";

function readOptions() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === null) return { options: DEFAULT_VEHICLE_NAME_OPTIONS, error: "" };
    const options: unknown = JSON.parse(saved);
    if (
      !Array.isArray(options) ||
      !options.every((name): name is string =>
        typeof name === "string" && DEFAULT_VEHICLE_NAME_OPTIONS.includes(name),
      ) ||
      new Set(options).size !== options.length
    ) {
      throw new Error("Invalid vehicle name options.");
    }
    return { options, error: "" };
  } catch (error) {
    console.error("Failed to read local vehicle name options.", error);
    return {
      options: DEFAULT_VEHICLE_NAME_OPTIONS,
      error: "无法读取本浏览器的车名设置，请点击“恢复默认”重试。",
    };
  }
}

export function VehicleNameSelect({
  value,
  manualName,
  onChange,
  onManualNameChange,
  onDeleteSelected,
}: {
  value: string;
  manualName: string;
  onChange: (value: string) => void;
  onManualNameChange: (value: string) => void;
  onDeleteSelected: () => void;
}) {
  // This selector is mounted only when the client opens the vehicle editor.
  const [settings, setSettings] = useState(readOptions);
  const [isManaging, setIsManaging] = useState(false);

  function saveOptions(options: string[]) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
    } catch (error) {
      console.error("Failed to save local vehicle name options.", error);
      setSettings((current) => ({
        ...current,
        error: "车名设置保存失败，请检查浏览器是否允许本地存储。此次更改未生效。",
      }));
      return false;
    }
    setSettings({ options, error: "" });
    return true;
  }

  function deleteOption(name: string) {
    if (!window.confirm(`从本浏览器的车名列表删除「${name}」？已有車両和訂単不会改变。`)) return;
    if (saveOptions(settings.options.filter((option) => option !== name)) && value === name) {
      onDeleteSelected();
    }
  }

  const selectedValue = DEFAULT_VEHICLE_NAME_OPTIONS.includes(value) &&
    !settings.options.includes(value)
    ? MANUAL_VEHICLE_NAME
    : value;

  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor="vehicle-name-select" className="text-sm font-medium">車名</label>
        <button
          type="button"
          aria-expanded={isManaging}
          aria-controls="vehicle-name-options-manager"
          onClick={() => setIsManaging((current) => !current)}
          className="text-sm text-blue-700 hover:underline"
        >
          {isManaging ? "收起管理" : "管理车名"}
        </button>
      </div>
      <select
        id="vehicle-name-select"
        className="mt-1 w-full rounded border p-2"
        value={selectedValue}
        onChange={(event) => onChange(event.target.value)}
      >
        {!DEFAULT_VEHICLE_NAME_OPTIONS.includes(value) &&
          value !== MANUAL_VEHICLE_NAME && (
            <option value={value}>{value}</option>
          )}
        {settings.options.map((name) => <option key={name} value={name}>{name}</option>)}
        <option value={MANUAL_VEHICLE_NAME}>手动输入車名</option>
      </select>
      {selectedValue === MANUAL_VEHICLE_NAME && (
        <input
          type="text"
          required
          aria-label="車名（手动输入）"
          className="mt-1 w-full rounded border p-2"
          value={manualName}
          onChange={(event) => onManualNameChange(event.target.value)}
        />
      )}
      {settings.error && <p role="alert" className="mt-2 text-sm text-rose-700">{settings.error}</p>}
      {isManaging && (
        <div id="vehicle-name-options-manager" className="mt-2 rounded border bg-gray-50 p-3">
          <p className="mb-2 text-xs text-gray-600">仅影响本浏览器的下拉选项，不删除車両或訂単。</p>
          {settings.options.length === 0 && <p className="text-sm text-gray-600">已无预设车名，仍可手动输入。</p>}
          <ul className="space-y-2">
            {settings.options.map((name) => (
              <li key={name} className="flex items-center justify-between gap-2 text-sm">
                <span>{name}</span>
                <button type="button" aria-label={`删除车名 ${name}`}
                  onClick={() => deleteOption(name)} className="text-rose-700 hover:underline">
                  删除
                </button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => saveOptions(DEFAULT_VEHICLE_NAME_OPTIONS)}
            className="mt-3 text-sm text-blue-700 hover:underline">
            恢复默认
          </button>
        </div>
      )}
    </div>
  );
}
