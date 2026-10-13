"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type Day = { day: string; captures: number };

/** One series (total captures per day), so no legend: the heading names it. */
export function DailyChart({ data }: { data: Day[] }) {
  return (
    <div className="h-64 w-full" role="img" aria-label="Captures per day over the last 30 days">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid vertical={false} stroke="#d5dad4" />
          <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(8) + "/" + d.slice(5, 7)} tick={{ fill: "#5d6b63", fontSize: 13 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
          <YAxis allowDecimals={false} tick={{ fill: "#5d6b63", fontSize: 13 }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "rgba(0,121,58,0.08)" }} formatter={(v) => [String(v), "Captures"]} labelFormatter={(l) => String(l)} contentStyle={{ borderRadius: 10, border: "1px solid #d5dad4" }} />
          <Bar dataKey="captures" fill="#00793a" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
