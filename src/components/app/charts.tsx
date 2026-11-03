"use client";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, Pie, PieChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export const CHART_COLORS = ["#2449b8", "#17804a", "#c2771b", "#7c3aed", "#0e7490", "#be185d", "#64748b"];

const compact = new Intl.NumberFormat("en-LK", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Row = Record<string, string | number>;
type Series = { key: string; label: string; color?: string };

function TooltipBox({ active, payload, label, money }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; money: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-3 font-medium tabular-nums">{money ? `LKR ${full.format(p.value)}` : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function BarChartCard({ data, x, series, money = true, stacked, height = 260 }: {
  data: Row[]; x: string; series: Series[]; money?: boolean; stacked?: boolean; height?: number;
}) {
  if (!data.length) return <EmptyChart height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#e8ebf0" />
        <XAxis dataKey={x} tickLine={false} axisLine={false} fontSize={11} tick={{ fill: "#5b6474" }} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={52} tick={{ fill: "#5b6474" }} tickFormatter={(v) => (money ? compact.format(v) : String(v))} />
        <Tooltip cursor={{ fill: "#f1f3f6" }} content={<TooltipBox money={money} />} />
        {series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]} radius={stacked ? 0 : [3, 3, 0, 0]} stackId={stacked ? "s" : undefined} maxBarSize={36} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LineChartCard({ data, x, series, money = true, height = 260 }: { data: Row[]; x: string; series: Series[]; money?: boolean; height?: number }) {
  if (!data.length) return <EmptyChart height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#e8ebf0" />
        <XAxis dataKey={x} tickLine={false} axisLine={false} fontSize={11} tick={{ fill: "#5b6474" }} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={52} tick={{ fill: "#5b6474" }} tickFormatter={(v) => (money ? compact.format(v) : String(v))} />
        <Tooltip content={<TooltipBox money={money} />} />
        {series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 2.5 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DonutChartCard({ data, height = 260 }: { data: { name: string; value: number }[]; height?: number }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <EmptyChart height={height} />;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="h-[200px] w-[200px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} stroke="none">
              {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip content={<TooltipBox money />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-2 text-sm">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            <span className="text-muted-foreground">{d.name}</span>
            <span className="ml-auto font-medium tabular-nums">{full.format(d.value)}</span>
            <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyChart({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground" style={{ height }}>
      No data for this period yet
    </div>
  );
}
