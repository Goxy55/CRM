"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Vodoravni stubičasti prikaz: jedna serija, vrednosti po kategorijama. */
export function ReportChart({ data, label }: { data: { label: string; value: number }[]; label: string }) {
  const height = Math.max(160, data.length * 34 + 40);
  return (
    <div role="img" aria-label={`Grafikon: ${label}`} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 8 }}>
          <CartesianGrid horizontal={false} stroke="#e2e8f0" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 12, fill: "#334155" }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "#f1f5f9" }} formatter={(value) => [String(value), label]} />
          <Bar dataKey="value" fill="#1f5fae" radius={[0, 3, 3, 0]} maxBarSize={22} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
