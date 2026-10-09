import { paymentNotice } from "../../shared/payments";
import { usePaymentMode } from "../paymentMode";
// Open Books: every PayPal movement the platform has made, as a live ledger (AG Grid)
// with charts (AG Charts) that follow whatever the ledger is filtered to.
// Loaded lazily so the grid and chart libraries never weigh down the rest of the app.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { AgGridReact, type CustomCellRendererProps } from "ag-grid-react";
import {
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  CsvExportModule,
  DateFilterModule,
  HighlightChangesModule,
  LocaleModule,
  ModuleRegistry as GridModules,
  NumberFilterModule,
  PaginationModule,
  QuickFilterModule,
  TextFilterModule,
  TooltipModule,
  ValidationModule,
  themeQuartz,
  type ColDef,
  type GridApi,
} from "ag-grid-community";
import { AgCharts } from "ag-charts-react";
import {
  BarSeriesModule,
  CartesianChartModule,
  CategoryAxisModule,
  DonutSeriesModule,
  LegendModule,
  ModuleRegistry as ChartModules,
  NumberAxisModule,
  PolarChartModule,
  type AgCartesianChartOptions,
  type AgChartTheme,
  type AgPolarChartOptions,
} from "ag-charts-community";
import type { BooksRow, OpenBooks } from "../../shared/types";
import { api } from "../api";
import { nf } from "../lib";


GridModules.registerModules([
  ClientSideRowModelModule, ClientSideRowModelApiModule, LocaleModule, PaginationModule, QuickFilterModule, TextFilterModule, NumberFilterModule, DateFilterModule,
  CsvExportModule, CellStyleModule, TooltipModule, HighlightChangesModule,
  ...(import.meta.env.DEV ? [ValidationModule] : []),
]);
ChartModules.registerModules([CartesianChartModule, PolarChartModule, BarSeriesModule, DonutSeriesModule, CategoryAxisModule, NumberAxisModule, LegendModule]);

// Brand inks, nudged into the validated band (dataviz validate_palette: all checks pass on #fbf8f0).
const GREEN = "#2f7d52", GOLD = "#b8861f", BLUE = "#2a5db0", RED = "#b3261e", PURPLE = "#7a4fb0", STONE = "#8a8f86";

const chartTheme: AgChartTheme = {
  baseTheme: "ag-default",
  palette: { fills: [GREEN, GOLD, BLUE, RED, PURPLE], strokes: [GREEN, GOLD, BLUE, RED, PURPLE] },
  params: {
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    fontSize: 12,
    foregroundColor: "#17402f",
    textColor: "#17402f",
    subtleTextColor: "#5d6f63",
    backgroundColor: "#fbf8f0",
    gridLineColor: "#e8e1cd",
    axisLineColor: "#cfc6ad",
    tooltipBackgroundColor: "#17402f",
    tooltipTextColor: "#f6f1e3",
    tooltipSubtleTextColor: "#cfd8cf",
  },
};

const gridTheme = themeQuartz.withParams({
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  fontSize: 14,
  backgroundColor: "#fbf8f0",
  foregroundColor: "#17402f",
  accentColor: "#17402f",
  borderColor: "#cfc6ad",
  headerBackgroundColor: "#ebe4d1",
  headerTextColor: "#17402f",
  headerFontWeight: 600,
  oddRowBackgroundColor: "#f7f2e5",
  rowHoverColor: "#efe8d6",
  wrapperBorderRadius: 18,
  browserColorScheme: "light",
});

// ---------------------------------------------------------------- formatting

const KIND_LABEL: Record<BooksRow["kind"], string> = {
  release: "Release a buck",
  fork: "Fork a story",
  first_holder: "To the first holder",
  claim: "Claim from the wild",
  pass: "Pass the buck",
};

const signed = (r: BooksRow) => (r.direction === "in" ? r.amount : -r.amount);
const money = (n: number) => `${n < 0 ? "−" : "+"}$${Math.abs(n).toFixed(2)}`;
const dollars = (n: number) => `$${nf(n)}`;
const when = (t: number) => new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function duration(s: number | null): string {
  if (s == null) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const STATUS_TONE: Record<string, string> = {
  COMPLETED: "bg-emerald-50 text-emerald-900 border-emerald-300",
  SUCCESS: "bg-emerald-50 text-emerald-900 border-emerald-300",
  UNCLAIMED: "bg-sky-50 text-sky-900 border-sky-300",
  PENDING: "bg-amber-50 text-amber-900 border-amber-300",
  ONHOLD: "bg-amber-50 text-amber-900 border-amber-300",
};
const statusTone = (s: string) => STATUS_TONE[s] ?? "bg-red-50 text-red-900 border-red-300";

const STATUS_HELP: Record<string, string> = {
  COMPLETED: "PayPal captured the $2 checkout.",
  SUCCESS: "Delivered to a PayPal account.",
  UNCLAIMED: "PayPal accepted the dollar for someone without a PayPal account yet. It counts as delivered.",
  PENDING: "PayPal is still processing this payout.",
};

// Color follows the status, never its rank, so filtering never repaints a slice.
const STATUS_COLOR = (s: string) => (s === "SUCCESS" ? GREEN : s === "UNCLAIMED" ? BLUE : s === "PENDING" || s === "ONHOLD" ? GOLD : s === "RETURNED" ? STONE : RED);

function StatusCell({ value, data }: CustomCellRendererProps<BooksRow, string>) {
  if (!value || !data) return null;
  return (
    <span className={`chip !leading-4 align-middle ${statusTone(value)}`} title={STATUS_HELP[value] ?? "The payout didn't go through, so the money never left."}>
      {data.outcome === "in_flight" && <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-amber-600" />}
      {value}
    </span>
  );
}

function SerialCell({ value }: CustomCellRendererProps<BooksRow, string>) {
  return value ? <Link href={`/b/${value}`} className="serial text-[0.8rem] underline-offset-4 hover:underline">{value}</Link> : null;
}

const MODEL_LABEL = (m: string) =>
  m.includes("gpt-oss") ? "gpt-oss-120b" :
  m.includes("llama-3.3") ? "Llama 3.3 70B" :
  m.includes("flux") ? "FLUX.1 [schnell] stamps" :
  m.startsWith("claude") ? "Claude" :
  m === "fallback" ? "Hand-written fallback" : m;

// ---------------------------------------------------------------- page

export function Books() {
  const mode = usePaymentMode();
  const [books, setBooks] = useState<OpenBooks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<BooksRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [billFilter, setBillFilter] = useState<string | null>(() => new URLSearchParams(location.search).get("bill")?.toUpperCase() ?? null);
  const gridApi = useRef<GridApi<BooksRow> | null>(null);

  const load = useCallback(() => api.books().then((b) => { setBooks(b); setError(null); }, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), 15_000);
    return () => clearInterval(id);
  }, [load]);

  // The bill filter lives in the grid's own filter model, so the column menu and the chip agree.
  const applyBillFilter = useCallback((api: GridApi<BooksRow>, serial: string | null) => {
    api.setColumnFilterModel("serial", serial ? { filterType: "text", type: "equals", filter: serial } : null).then(() => api.onFilterChanged());
  }, []);
  // The grid owns the filter; the URL follows it so a filtered view can be shared.
  useEffect(() => {
    const url = new URL(location.href);
    if (billFilter) url.searchParams.set("bill", billFilter);
    else url.searchParams.delete("bill");
    history.replaceState(history.state, "", url.pathname + url.search);
  }, [billFilter]);

  const syncVisible = useCallback(() => {
    const api = gridApi.current;
    if (!api) return;
    const out: BooksRow[] = [];
    api.forEachNodeAfterFilter((n) => n.data && out.push(n.data));
    setVisible(out);
  }, []);

  const rows = visible ?? books?.rows ?? [];
  const filtered = !!books && rows.length !== books.rows.length;

  const columns = useMemo<ColDef<BooksRow>[]>(() => [
    { field: "at", headerName: "When", sort: "desc", minWidth: 150, flex: 1.1, valueFormatter: (p) => when(p.value), filter: "agDateColumnFilter",
      filterParams: { comparator: (day: Date, t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() - day.getTime(); } } },
    { field: "serial", headerName: "Bill", minWidth: 120, flex: 0.9, cellRenderer: SerialCell, filter: "agTextColumnFilter" },
    { field: "kind", headerName: "What", minWidth: 170, flex: 1.2, valueFormatter: (p) => KIND_LABEL[p.value as BooksRow["kind"]] ?? p.value, filter: "agTextColumnFilter",
      filterValueGetter: (p) => (p.data ? KIND_LABEL[p.data.kind] : "") },
    { colId: "amount", headerName: "Amount", minWidth: 110, flex: 0.8, type: "rightAligned", valueGetter: (p) => (p.data ? signed(p.data) : 0), valueFormatter: (p) => money(p.value),
      cellClass: (p) => (p.value > 0 ? "books-in" : "books-out"), filter: "agNumberColumnFilter" },
    { field: "paypalStatus", headerName: "PayPal says", minWidth: 140, flex: 1, cellRenderer: StatusCell, enableCellChangeFlash: true, filter: "agTextColumnFilter",
      headerTooltip: "The status PayPal reported for this payment." },
    { field: "ref", headerName: "PayPal ref", minWidth: 120, flex: 0.9, cellClass: "font-mono text-[0.8rem]", headerTooltip: "PayPal's id for the payout item or order, masked to its last four characters." },
    { field: "hop", headerName: "Hop", minWidth: 80, flex: 0.5, type: "rightAligned", valueFormatter: (p) => (p.value ? `#${p.value}` : "—"),
      headerTooltip: "The hop whose four words joined the story when this payout landed.", filter: "agNumberColumnFilter" },
    { field: "secondsToLand", headerName: "Landed in", minWidth: 125, flex: 0.8, type: "rightAligned", valueFormatter: (p) => duration(p.value), filter: "agNumberColumnFilter",
      headerTooltip: "From our payout request to PayPal's answer." },
    { field: "settledBy", headerName: "Confirmed by", minWidth: 140, flex: 1, enableCellChangeFlash: true,
      valueFormatter: (p) => (p.value === "webhook" ? "Webhook" : p.value === "polling" ? "Polling" : "—"),
      tooltip: (p) => (p.value === "webhook" ? "PayPal told us first, in a signed webhook we verified." : p.value === "polling" ? "We asked PayPal before its webhook arrived." : null) },
    { field: "webhook", headerName: "Signed webhook", minWidth: 140, flex: 0.9, valueFormatter: (p) => (p.data?.direction === "in" ? "—" : p.value ? "✓ Verified" : "Not yet"),
      headerTooltip: "Whether PayPal's webhook for this payout arrived and passed signature verification." },
    { field: "mode", headerName: "Mode", minWidth: 100, flex: 0.6, hide: !books?.rows.some((r) => r.mode === "mock") },
  ], [books?.rows]);

  const kpis = useMemo(() => {
    const ins = rows.filter((r) => r.direction === "in");
    const landed = rows.filter((r) => r.direction === "out" && r.outcome === "landed");
    const outs = rows.filter((r) => r.direction === "out");
    return {
      paidIn: ins.reduce((a, r) => a + r.amount, 0),
      checkouts: ins.length,
      paidOut: landed.reduce((a, r) => a + r.amount, 0),
      landed: landed.length,
      inFlight: outs.filter((r) => r.outcome === "in_flight").length,
      failed: outs.filter((r) => r.outcome === "failed").length,
      median: median(landed.map((r) => r.secondsToLand).filter((s): s is number => s != null)),
      webhooks: outs.filter((r) => r.webhook).length,
      outs: outs.length,
    };
  }, [rows]);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:pt-12">
      <div className="eyebrow">Open books</div>
      <h1 className="mt-2 font-display text-4xl font-semibold sm:text-5xl">Every dollar, in and out.</h1>
      <p className="mt-3 max-w-3xl text-lg leading-relaxed text-ink-2">
        Four Word Pass takes every checkout and sends every payout itself, so it can show you all of them. Statuses come straight from PayPal and update live.
        Emails stay private, and PayPal references are masked.
      </p>
      <p className="mt-2 max-w-3xl text-sm text-muted">{paymentNotice(mode)} Demo histories aren't here: their payments were simulated.</p>

      {error && !books && <p className="card mt-8 p-6">{error}</p>}

      {/* ---------------------------------------------------------------- stat tiles */}
      <section aria-label="Totals" className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          [books ? dollars(kpis.paidIn) : "—", "paid in", `${nf(kpis.checkouts)} ${kpis.checkouts === 1 ? "checkout" : "checkouts"}`],
          [books ? dollars(kpis.paidOut) : "—", "paid out", `${nf(kpis.landed)} ${kpis.landed === 1 ? "payout" : "payouts"} landed`],
          [books ? nf(kpis.inFlight) : "—", "in flight", kpis.failed ? `${nf(kpis.failed)} failed, money never left` : "none failed"],
          [kpis.median == null ? "—" : duration(kpis.median), "median landing", "request to PayPal's answer"],
          [books ? `${nf(kpis.webhooks)}/${nf(kpis.outs)}` : "—", "webhooks verified", "signed by PayPal, checked by us"],
        ].map(([n, label, sub]) => (
          <div key={label} className="card px-4 py-4">
            <div className="font-display text-3xl font-semibold leading-none">{n}</div>
            <div className="mt-2 font-mono text-[0.66rem] uppercase tracking-widest text-muted">{label}</div>
            <div className="mt-1 text-xs text-muted">{sub}</div>
          </div>
        ))}
      </section>
      {books && !filtered && books.totals.heldForWild > 0 && (
        <p className="mt-3 text-sm text-muted">Holding {dollars(books.totals.heldForWild)} for {books.totals.heldForWild === 1 ? "a bill" : "bills"} in the wild, paid out to whoever claims {books.totals.heldForWild === 1 ? "it" : "them"}.</p>
      )}

      {/* ---------------------------------------------------------------- charts */}
      <section aria-label="Charts" className="mt-8 grid gap-4 lg:grid-cols-3">
        <ChartCard title="Money in, money out" note="By day, in your time zone." className="lg:col-span-3">
          <MoneyChart rows={rows} />
        </ChartCard>
        <ChartCard title="What PayPal said" note="Every payout, by the status PayPal reported.">
          <StatusChart rows={rows} />
        </ChartCard>
        <ChartCard title="How fast it lands" note="Payouts that landed, by time to confirm.">
          <LandingChart rows={rows} />
        </ChartCard>
        <ChartCard title="Who wrote the words" note="Story words on real bills: holders, creators' finales, and lost bills' labeled AI closings.">
          <WordsChart books={books} />
        </ChartCard>
      </section>

      {/* ---------------------------------------------------------------- ledger */}
      <section className="mt-12" aria-labelledby="ledger-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="ledger-title" className="font-display text-3xl font-semibold">The ledger</h2>
            <p className="text-sm text-muted">Sort, filter and search it. The charts above follow along.</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {billFilter && (
              <button type="button" className="chip !py-1.5 hover:!border-ink" onClick={() => gridApi.current && applyBillFilter(gridApi.current, null)} aria-label={`Stop filtering to ${billFilter}`}>
                <span className="serial">{billFilter}</span> only <span aria-hidden>×</span>
              </button>
            )}
            <input
              type="search"
              className="field !w-full !py-2 sm:!w-60"
              placeholder="Search the ledger"
              aria-label="Search the ledger"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="button" className="btn btn-ghost !py-2 text-sm" disabled={!books?.rows.length}
              onClick={() => gridApi.current?.exportDataAsCsv({ fileName: "four-word-pass-open-books.csv" })}>
              Download CSV
            </button>
          </div>
        </div>
        <div className="mt-4">
          <AgGridReact<BooksRow>
            theme={gridTheme}
            rowData={books?.rows}
            columnDefs={columns}
            defaultColDef={{ sortable: true, resizable: true, filter: false, suppressHeaderMenuButton: false }}
            getRowId={(p) => p.data.id}
            quickFilterText={search}
            domLayout="autoHeight"
            pagination
            paginationPageSize={15}
            paginationPageSizeSelector={[15, 50, 100]}
            tooltipShowDelay={300}
            localeText={{ noRowsToShow: books ? "No PayPal movements match. Clear the search or filters." : "Opening the books…" }}
            onGridReady={(e) => { gridApi.current = e.api; applyBillFilter(e.api, billFilter); }}
            onFilterChanged={(e) => {
              const m = e.api.getColumnFilterModel("serial") as { type?: string; filter?: string } | null;
              setBillFilter(m?.type === "equals" && m.filter ? m.filter.toUpperCase() : null);
            }}
            onModelUpdated={syncVisible}
          />
        </div>
      </section>

      {/* ---------------------------------------------------------------- the bill's voice */}
      <section className="mt-12 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <h2 className="font-display text-3xl font-semibold">The bill's voice</h2>
          <p className="mt-2 leading-relaxed text-ink-2">
            People write every story. AI plays the bill: its diary, its nags, its eulogy and its passport art. Every one of those records the model that made it. Here's the count on real bills.
          </p>
          <p className="mt-3 text-sm text-muted">The only AI words in any story are a bill's own closing when it's lost, always labeled and capped at about 5% of the story.</p>
        </div>
        <ChartCard title="AI writing and art, by model" note="Diary entries, nags and eulogies, plus stamp illustrations.">
          <VoiceChart books={books} />
        </ChartCard>
      </section>

      {/* ---------------------------------------------------------------- how to read */}
      <section className="mt-12 grid gap-4 md:grid-cols-3">
        {[
          ["UNCLAIMED means delivered", "PayPal holds the dollar for someone who doesn't have a PayPal account yet. In the sandbox that's almost everyone, so it counts as landed."],
          ["Webhook or polling", "We ask PayPal right after every payout, then keep checking with increasing delays. Unclaimed payouts are checked periodically until their final outcome. PayPal also sends a signed webhook, which we verify before trusting. Whichever answers first settles the hop."],
          ["Who pays for hops", `${mode === "mock" ? "Demo checkouts and payouts are simulated." : "Each sandbox release brings in $2 in test money; the platform funds later test payouts."} Live payments are paused while a model with internal handoffs and a single final payout is being defined.`],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl border border-dashed border-line p-5">
            <div className="font-display text-lg font-semibold">{t}</div>
            <p className="mt-1 text-sm leading-relaxed text-muted">{d}</p>
          </div>
        ))}
      </section>
      <p className="mt-8 text-sm text-muted">
        Want the story behind a payment? Every serial links to its bill. <Link href="/wild" className="font-semibold underline-offset-4 hover:underline">Claim a buck from the wild</Link> and your payout lands here in seconds.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- charts

function ChartCard({ title, note, className = "", children }: { title: string; note: string; className?: string; children: React.ReactNode }) {
  return (
    <figure className={`card p-4 sm:p-5 ${className}`}>
      <figcaption>
        <div className="font-display text-xl font-semibold">{title}</div>
        <div className="text-xs text-muted">{note}</div>
      </figcaption>
      <div className="mt-3">{children}</div>
    </figure>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-56 items-center justify-center rounded-xl border border-dashed border-line px-6 text-center text-sm text-muted">{children}</div>;
}

const dayKey = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

function MoneyChart({ rows }: { rows: BooksRow[] }) {
  const data = useMemo(() => {
    const money = rows.filter((r) => r.direction === "in" || r.outcome === "landed");
    if (!money.length) return [];
    const byDay = new Map<number, { in: number; out: number }>();
    for (const r of money) {
      const k = dayKey(r.at);
      const v = byDay.get(k) ?? { in: 0, out: 0 };
      v[r.direction] += r.amount;
      byDay.set(k, v);
    }
    // Every day from the first movement (at least a week back) to today, so quiet days read as quiet.
    const today = dayKey(Date.now());
    const first = Math.min(...byDay.keys(), dayKey(today - 6 * 86_400_000));
    const out = [];
    for (let d = first; d <= today; d = dayKey(d + 36 * 3_600_000)) {
      const v = byDay.get(d) ?? { in: 0, out: 0 };
      out.push({ day: new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }), in: v.in, out: v.out });
    }
    return out.slice(-60);
  }, [rows]);
  const options = useMemo<AgCartesianChartOptions>(() => ({
    theme: chartTheme,
    data,
    series: [
      { type: "bar", xKey: "day", yKey: "in", yName: "Paid in (checkouts)", fill: GREEN, cornerRadius: 4 },
      { type: "bar", xKey: "day", yKey: "out", yName: "Paid out (payouts landed)", fill: GOLD, cornerRadius: 4 },
    ],
    axes: {
      x: { type: "category", position: "bottom", paddingInner: 0.35, groupPaddingInner: 0.12, label: { avoidCollisions: true } },
      y: { type: "number", position: "left", label: { formatter: ({ value }) => `$${value}` }, interval: { minSpacing: 40 } },
    },
    legend: { position: "bottom" },
  }), [data]);
  if (!data.length) return <Empty>No money has moved{rows.length ? " in this view" : " yet"}. The first checkout or payout shows up here.</Empty>;
  return <AgCharts options={options} style={{ height: 280 }} />;
}

function StatusChart({ rows }: { rows: BooksRow[] }) {
  const data = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.direction === "out") counts.set(r.paypalStatus, (counts.get(r.paypalStatus) ?? 0) + 1);
    return [...counts].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
  }, [rows]);
  const total = data.reduce((a, d) => a + d.count, 0);
  const options = useMemo<AgPolarChartOptions>(() => ({
    theme: chartTheme,
    data,
    series: [{
      type: "donut", angleKey: "count", legendItemKey: "status", calloutLabelKey: "status",
      fills: data.map((d) => STATUS_COLOR(d.status)), strokes: ["#fbf8f0"], strokeWidth: 2,
      innerRadiusRatio: 0.62,
      calloutLabel: { enabled: data.length > 1 },
      innerLabels: [
        { text: nf(total), fontSize: 26, fontWeight: 600, color: "#17402f" },
        { text: total === 1 ? "payout" : "payouts", fontSize: 12, color: "#5d6f63" },
      ],
    }],
    legend: { position: "bottom" },
  }), [data, total]);
  if (!total) return <Empty>No payouts{rows.length ? " in this view" : " yet"}.</Empty>;
  return <AgCharts options={options} style={{ height: 260 }} />;
}

const BINS: [string, number][] = [["<10s", 10], ["10–30s", 30], ["30–60s", 60], ["1–5m", 300], ["5m+", Infinity]];

function LandingChart({ rows }: { rows: BooksRow[] }) {
  const data = useMemo(() => {
    const secs = rows.filter((r) => r.outcome === "landed" && r.direction === "out" && r.secondsToLand != null).map((r) => r.secondsToLand!);
    if (!secs.length) return [];
    return BINS.map(([bin, max], i) => ({ bin, count: secs.filter((s) => s < max && s >= (i ? BINS[i - 1][1] : 0)).length }));
  }, [rows]);
  const options = useMemo<AgCartesianChartOptions>(() => ({
    theme: chartTheme,
    data,
    series: [{ type: "bar", xKey: "bin", yKey: "count", yName: "Payouts", fill: GREEN, cornerRadius: 4,
      label: { enabled: true, placement: "outside-end", formatter: ({ value }) => (value ? String(value) : "") } }],
    axes: {
      x: { type: "category", position: "bottom", paddingInner: 0.3 },
      y: { type: "number", position: "left", interval: { minSpacing: 36 }, label: { formatter: ({ value }) => (Number.isInteger(value) ? String(value) : "") } },
    },
    legend: { enabled: false },
  }), [data]);
  if (!data.length) return <Empty>Nothing has landed{rows.length ? " in this view" : " yet"}.</Empty>;
  return <AgCharts options={options} style={{ height: 260 }} />;
}

function WordsChart({ books }: { books: OpenBooks | null }) {
  const data = useMemo(() => {
    if (!books) return [];
    return [
      { who: "Holders", words: books.words.holders, fill: GREEN },
      { who: "Finales", words: books.words.creatorFinales, fill: BLUE },
      { who: "AI closings", words: books.words.billClosings, fill: PURPLE },
    ].filter((d) => d.words > 0);
  }, [books]);
  const total = data.reduce((a, d) => a + d.words, 0);
  const human = books ? books.words.holders + books.words.creatorFinales : 0;
  const options = useMemo<AgPolarChartOptions>(() => ({
    theme: chartTheme,
    data,
    series: [{
      type: "donut", angleKey: "words", legendItemKey: "who",
      fills: data.map((d) => d.fill), strokes: ["#fbf8f0"], strokeWidth: 2, innerRadiusRatio: 0.62,
      calloutLabel: { enabled: false },
      innerLabels: [
        { text: total ? `${Math.floor((human / total) * 1000) / 10}%` : "—", fontSize: 26, fontWeight: 600, color: "#17402f" },
        { text: "by people", fontSize: 12, color: "#5d6f63" },
      ],
    }],
    legend: { position: "bottom" },
  }), [data, total, human]);
  if (!books) return <Empty>Counting words…</Empty>;
  if (!total) return <Empty>No real stories yet. Release a buck and the first four words count here.</Empty>;
  return <AgCharts options={options} style={{ height: 260 }} />;
}

function VoiceChart({ books }: { books: OpenBooks | null }) {
  const data = useMemo(() => (books?.voice ?? []).map((v) => ({ model: MODEL_LABEL(v.model), pieces: v.pieces })), [books]);
  const options = useMemo<AgCartesianChartOptions>(() => ({
    theme: chartTheme,
    data,
    series: [{ type: "bar", direction: "horizontal", xKey: "model", yKey: "pieces", yName: "Pieces", fill: PURPLE, cornerRadius: 4,
      label: { enabled: true, placement: "outside-end" } }],
    axes: {
      x: { type: "category", position: "left", paddingInner: 0.35 },
      y: { type: "number", position: "bottom", interval: { minSpacing: 50 } },
    },
    legend: { enabled: false },
  }), [data]);
  if (!books) return <Empty>Counting…</Empty>;
  if (!data.length) return <Empty>No AI writing on real bills yet. The first release writes a birth entry.</Empty>;
  return <AgCharts options={options} style={{ height: Math.max(180, 56 * data.length + 70) }} />;
}
