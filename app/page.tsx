"use client";

import { useState } from "react";

type OrderStatus = "仮予約" | "予約確定" | "運行中" | "完了" | "キャンセル";

type Order = {
  id: number;
  vehicle: string;
  date: string;
  customer: string;
  phone: string;
  pickup: string;
  destination: string;
  time: string;
  status: OrderStatus;
  notes: string;
};

type OrderDraft = Omit<Order, "id">;

const vehicles = [
  "Alphard 01",
  "Alphard 02",
  "Alphard 03",
  "Hiace 01",
  "Crown 01",
];

const dates = [
  { date: "9/29", day: "火" },
  { date: "9/30", day: "水" },
  { date: "10/1", day: "木" },
  { date: "10/2", day: "金" },
  { date: "10/3", day: "土" },
  { date: "10/4", day: "日" },
  { date: "10/5", day: "月" },
];

const statusStyles: Record<OrderStatus, string> = {
  仮予約: "border-amber-200 bg-amber-50 text-amber-800",
  予約確定: "border-blue-200 bg-blue-50 text-blue-800",
  運行中: "border-violet-200 bg-violet-50 text-violet-800",
  完了: "border-emerald-200 bg-emerald-50 text-emerald-800",
  キャンセル: "border-rose-200 bg-rose-50 text-rose-800",
};

function createEmptyDraft(
  vehicle: string = vehicles[0],
  date: string = dates[0].date,
): OrderDraft {
  return {
    vehicle,
    date,
    time: "",
    customer: "",
    phone: "",
    pickup: "",
    destination: "",
    status: "仮予約",
    notes: "",
  };
}

export default function Home() {
  const [orders, setOrders] = useState<Order[]>([
    {
      id: 1,
      vehicle: "Alphard 01",
      date: "9/30",
      customer: "王先生",
      phone: "",
      pickup: "东京",
      destination: "成田机场",
      time: "08:30",
      status: "予約確定",
      notes: "",
    },
    {
      id: 2,
      vehicle: "Alphard 02",
      date: "10/2",
      customer: "田中様",
      phone: "",
      pickup: "羽田机场",
      destination: "银座",
      time: "14:00",
      status: "予約確定",
      notes: "",
    },
  ]);

  const [showForm, setShowForm] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [form, setForm] = useState<OrderDraft>(() => createEmptyDraft());

  function openNewOrder(vehicle: string, date: string) {
    setEditingOrderId(null);
    setForm(createEmptyDraft(vehicle, date));
    setShowForm(true);
  }

  function openEditOrder(order: Order) {
    setEditingOrderId(order.id);
    setForm({
      vehicle: order.vehicle,
      date: order.date,
      time: order.time,
      customer: order.customer,
      phone: order.phone,
      pickup: order.pickup,
      destination: order.destination,
      status: order.status,
      notes: order.notes,
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingOrderId(null);
  }

  function addOrder() {
    if (
      !form.customer.trim() ||
      !form.pickup.trim() ||
      !form.destination.trim() ||
      !form.time
    ) {
      alert("お客様名、開始時間、お迎え場所、目的地を入力してください。");
      return;
    }

    if (editingOrderId === null) {
      setOrders((currentOrders) => [
        ...currentOrders,
        { id: Date.now(), ...form },
      ]);
    } else {
      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.id === editingOrderId ? { id: order.id, ...form } : order,
        ),
      );
    }

    closeForm();
  }

  function deleteOrder() {
    if (editingOrderId === null) return;
    if (!window.confirm("确定要删除这个订单吗？")) return;

    setOrders((currentOrders) =>
      currentOrders.filter((order) => order.id !== editingOrderId),
    );
    closeForm();
  }

  return (
    <main className="min-h-screen bg-gray-100 text-gray-900">
      {/* 顶部 */}
      <header className="flex items-center justify-between bg-slate-900 px-6 py-4 text-white">
        <div>
          <h1 className="text-xl font-bold">ハイヤー配車管理</h1>
          <p className="text-sm text-gray-300">车辆・订单・排班管理</p >
        </div>

        <button
          onClick={() => openNewOrder(vehicles[0], dates[0].date)}
          className="rounded-lg bg-blue-600 px-5 py-2 font-bold hover:bg-blue-700"
        >
          ＋ 新建订单
        </button>
      </header>

      {/* 日期控制 */}
      <div className="flex items-center gap-3 border-b bg-white px-6 py-3">
        <button className="rounded border px-3 py-1">←</button>

        <button className="rounded border px-4 py-1">
          今天
        </button>

        <button className="rounded border px-3 py-1">→</button>

        <span className="ml-3 font-bold">
          2026年9月29日 ～ 10月5日
        </span>
      </div>

      {/* 排班表 */}
      <div className="overflow-x-auto p-4">
        <div className="min-w-[1200px] overflow-hidden rounded-xl border bg-white shadow-sm">

          {/* 日期标题 */}
          <div
            className="grid"
            style={{
              gridTemplateColumns: `180px repeat(${dates.length}, minmax(145px, 1fr))`,
            }}
          >
            <div className="border-b border-r bg-gray-100 p-4 font-bold">
              车辆
            </div>

            {dates.map((d) => (
              <div
                key={d.date}
                className="border-b border-r bg-gray-100 p-3 text-center"
              >
                <div className="font-bold">{d.date}</div>
                <div className="text-sm text-gray-500">
                  {d.day}
                </div>
              </div>
            ))}
          </div>

          {/* 车辆 */}
          {vehicles.map((vehicle) => (
            <div
              key={vehicle}
              className="grid min-h-[105px]"
              style={{
                gridTemplateColumns: `180px repeat(${dates.length}, minmax(145px, 1fr))`,
              }}
            >
              <div className="flex items-center border-b border-r bg-slate-50 p-4">
                <div>
                  <div className="font-bold">🚘 {vehicle}</div>
                  <div className="mt-1 text-xs text-gray-500">
                    运营中
                  </div>
                </div>
              </div>

              {dates.map((d) => {
                const dayOrders = orders.filter(
                  (order) =>
                    order.vehicle === vehicle &&
                    order.date === d.date
                );

                return (
                  <div
                    key={d.date}
                    onClick={() => openNewOrder(vehicle, d.date)}
                    className="min-h-[105px] cursor-pointer border-b border-r p-2"
                  >
                    {dayOrders.map((order) => (
                      <div
                        key={order.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditOrder(order);
                        }}
                        className={`mb-2 cursor-pointer rounded-lg border p-2 text-sm shadow-sm ${statusStyles[order.status]}`}
                      >
                        <div className="font-bold">
                          {order.time} {order.customer}
                        </div>

                        <div className="mt-1 text-xs">
                          {order.pickup} → {order.destination}
                        </div>

                        <div className="mt-1 text-xs font-medium">
                          {order.status}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* 新建订单窗口 */}
      {showForm && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-6 shadow-xl">

            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-bold">
                {editingOrderId === null ? "新建订单" : "编辑订单"}
              </h2>

              <button
                type="button"
                onClick={closeForm}
                className="text-2xl text-gray-500"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">

              <label className="block text-sm font-medium">
                客户姓名
                <input
                  type="text"
                  required
                  className="w-full rounded border p-2"
                  value={form.customer}
                  onChange={(e) => setForm({ ...form, customer: e.target.value })}
                  placeholder="例如：王先生"
                />
              </label>

              <label className="block text-sm font-medium">
                车辆
                <select
                  className="w-full rounded border p-2"
                  value={form.vehicle}
                  onChange={(e) => setForm({ ...form, vehicle: e.target.value })}
                >
                  {vehicles.map((vehicle) => (
                    <option key={vehicle} value={vehicle}>
                      {vehicle}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium">
                用车日期
                <select
                  className="w-full rounded border p-2"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                >
                  {dates.map((d) => (
                    <option key={d.date} value={d.date}>
                      {d.date}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium">
                开始時間
                <input
                  type="time"
                  required
                  className="w-full rounded border p-2"
                  value={form.time}
                  onChange={(e) => setForm({ ...form, time: e.target.value })}
                />
              </label>

              <label className="block text-sm font-medium">
                电话
                <input
                  type="tel"
                  className="w-full rounded border p-2"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="電話番号"
                />
              </label>

              <label className="block text-sm font-medium">
                上车地点
                <input
                  type="text"
                  required
                  className="w-full rounded border p-2"
                  value={form.pickup}
                  onChange={(e) => setForm({ ...form, pickup: e.target.value })}
                  placeholder="例如：羽田机场"
                />
              </label>

              <label className="block text-sm font-medium">
                目的地
                <input
                  type="text"
                  required
                  className="w-full rounded border p-2"
                  value={form.destination}
                  onChange={(e) =>
                    setForm({ ...form, destination: e.target.value })
                  }
                  placeholder="例如：东京站"
                />
              </label>

              <label className="block text-sm font-medium">
                订单状态
                <select
                  className="w-full rounded border p-2"
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as OrderStatus })
                  }
                >
                  <option value="仮予約">仮予約</option>
                  <option value="予約確定">予約確定</option>
                  <option value="運行中">運行中</option>
                  <option value="完了">完了</option>
                  <option value="キャンセル">キャンセル</option>
                </select>
              </label>

              <label className="block text-sm font-medium">
                备注
                <textarea
                  rows={3}
                  className="w-full resize-y rounded border p-2"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="引き継ぎ事項など"
                />
              </label>

            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              {editingOrderId !== null && (
                <button
                  type="button"
                  onClick={deleteOrder}
                  className="rounded bg-red-600 px-4 py-2 font-bold text-white hover:bg-red-700"
                >
                  删除订单
                </button>
              )}

              <div className="ml-auto flex gap-3">
              <button
                type="button"
                onClick={closeForm}
                className="rounded border px-5 py-2"
              >
                取消
              </button>

              <button
                type="button"
                onClick={addOrder}
                className="rounded bg-blue-600 px-5 py-2 font-bold text-white"
              >
                {editingOrderId === null ? "保存订单" : "保存修改"}
              </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </main>
  );
}