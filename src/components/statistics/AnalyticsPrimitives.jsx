import { Link, useLocation } from "react-router";
import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { money } from "@/lib/quote-template";
import { comparison } from "@/lib/analytics";

const colors = ["var(--data-view-accent)", "var(--status-success)", "var(--status-warning)"];
export function AnalyticsMetric({ label, value, previous, compare, detail, onClick }) {
  return <div className="analytics-metric" data-metric={label}><dt>{label}</dt><dd>{onClick ? <button onClick={onClick}>{value}</button> : value}</dd>
    {compare && previous !== undefined ? <span className="analytics-comparison">{comparison(compare.current, previous)}</span> : <span>{detail || "\u00a0"}</span>}</div>;
}
export function AnalyticsSection({ title, detail, action, children, className = "" }) {
  return <section className={`analytics-section ${className}`} aria-label={title}><header><div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</header>{children}</section>;
}
function ChartTooltip({ active, payload, label, currency }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return <div className="analytics-tooltip" role="status"><strong>{row.name || label}</strong>{payload.map(item => <div key={item.dataKey}><i style={{ background: item.color }} />{item.name}<b>{currency ? money(item.value) : item.value}</b></div>)}
    {row.invoiceCount !== undefined && <small>{row.invoiceCount} invoices</small>}{row.count !== undefined && <small>{row.count} invoices / plans</small>}</div>;
}
export function AnalyticsChart({ data, series, currency = false, bars = false, horizontal = false, onPoint, label }) {
  const format = value => currency ? `${value < 0 ? "−" : ""}$${Math.abs(value) >= 1000 ? `${(Math.abs(value) / 1000).toFixed(Math.abs(value) >= 10000 ? 0 : 1)}k` : Math.abs(value)}` : value;
  return <div className="analytics-chart" aria-label={label}>
    <div className="analytics-legend">{series.map(([key, name], i) => <span key={key}><i style={{ background: colors[i % colors.length] }} />{name}</span>)}</div>
    <ResponsiveContainer width="100%" height={horizontal ? Math.max(180, Math.min(data.length, 8) * 29) : 230} minWidth={0}>
      <ComposedChart data={horizontal ? data.slice(0, 8) : data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 10, right: 20, bottom: 5, left: 0 }} accessibilityLayer onClick={event => { const index = Number(event?.activeTooltipIndex ?? event?.activeIndex); const row = Number.isInteger(index) ? data[index] : data.find(d => (horizontal ? d.name : d.label) === event?.activeLabel); if (row && onPoint) onPoint(row); }}>
        <CartesianGrid stroke="var(--data-view-grid-line)" vertical={horizontal} horizontal={!horizontal} />
        <XAxis type={horizontal ? "number" : "category"} dataKey={horizontal ? undefined : "label"} tickFormatter={horizontal ? format : undefined} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={25} allowDecimals={currency} />
        <YAxis type={horizontal ? "category" : "number"} dataKey={horizontal ? "name" : undefined} width={horizontal ? 128 : 60} interval={horizontal ? 0 : undefined} tickFormatter={horizontal ? value => String(value).length > 20 ? `${String(value).slice(0, 18)}…` : value : format} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={currency} />
        <Tooltip content={<ChartTooltip currency={currency} />} wrapperStyle={{ zIndex: 100 }} allowEscapeViewBox={{ x: false, y: true }} />
        {series.map(([key, name], i) => bars || horizontal ? <Bar key={key} dataKey={key} name={name} fill={colors[i % colors.length]} maxBarSize={22} isAnimationActive={false} onClick={row => onPoint?.(row.payload || row)} cursor={onPoint ? "pointer" : undefined} />
          : <Line key={key} type="linear" dataKey={key} name={name} stroke={colors[i % colors.length]} strokeWidth={2} dot={data.length < 3} activeDot={{ r: 4 }} isAnimationActive={false} />)}
      </ComposedChart>
    </ResponsiveContainer>
    {!data.length && <p className="analytics-empty">No matching records.</p>}
  </div>;
}
export function AnalyticsTable({ columns, rows, label, limit, compact = false }) {
  const location = useLocation();
  const state = { sourceSection: "statistics", returnTo: { path: location.pathname + location.search, label: "Reports & Analytics" } };
  const shown = limit ? rows.slice(0, limit) : rows;
  const format = (value, type) => value === null || value === undefined || value === "" ? "—" : type === "money" ? money(value / 100) : type === "percent" ? `${Number(value).toFixed(1)}%` : value;
  return <div className={`analytics-table-scroll ${compact ? "analytics-table-compact" : ""}`} tabIndex={0} role="region" aria-label={`${label} table`}>
    <table><caption className="sr-only">{label}</caption><thead><tr>{columns.map(c => <th key={c.key} className={["money", "number", "percent"].includes(c.type) ? "numeric" : ""} scope="col">{c.label}</th>)}</tr></thead><tbody>
      {shown.map((row, index) => <tr key={row.id || index}>{columns.map(c => <td key={c.key} className={["money", "number", "percent"].includes(c.type) ? "numeric" : ""}>{c.link && row[c.key] ? <Link to={c.link(row)} state={state}>{format(row[c.key], c.type)}</Link> : format(row[c.key], c.type)}</td>)}</tr>)}
      {!shown.length && <tr><td colSpan={columns.length} className="analytics-empty">No records match these filters.</td></tr>}
    </tbody></table>
  </div>;
}
