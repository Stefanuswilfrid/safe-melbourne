'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getScrapeRunById, listScrapeRuns, type ScrapeRunListRow } from './actions';

interface ScrapeStatus {
  success: boolean;
  status: string;
  scrapeRunId: string | null;
  progress: {
    current: number;
    total: number;
    percentage: number;
    currentBatch: number;
    totalBatches: number;
    elapsedTime: number;
    estimatedTimeRemaining: number;
  };
  stats: { totalEvents: number; lastUpdate: string };
}

function formatWhen(iso: string | Date) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso);
  }
}

function statusPill(status: string) {
  const base = 'rounded-full px-2.5 py-0.5 text-xs font-medium';
  if (status === 'running') return `${base} bg-amber-500/20 text-amber-200`;
  if (status === 'success') return `${base} bg-emerald-500/20 text-emerald-200`;
  if (status === 'partial') return `${base} bg-sky-500/20 text-sky-200`;
  if (status === 'failed') return `${base} bg-rose-500/20 text-rose-200`;
  return `${base} bg-slate-600 text-slate-200`;
}

type RunRow = ScrapeRunListRow;

export function ScrapingDashboardClient({
  initialRuns,
  schemaMissing: schemaMissingProp = false,
}: {
  initialRuns: RunRow[];
  schemaMissing?: boolean;
}) {
  const [status, setStatus] = useState<ScrapeStatus | null>(null);
  const [runs, setRuns] = useState<RunRow[]>(initialRuns);
  const [tableMissing, setTableMissing] = useState(schemaMissingProp);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [jobFilter, setJobFilter] = useState<'all' | 'tiktok' | 'twitter_search'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailJson, setDetailJson] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchRuns = useCallback(async () => {
    setLoadingRuns(true);
    setRunsError(null);
    const data = await listScrapeRuns(jobFilter);
    if (!data.ok) {
      if ('schemaMissing' in data && data.schemaMissing) {
        setTableMissing(true);
        setRunsError(null);
      } else {
        setRunsError(data.error);
      }
      setRuns([]);
    } else {
      setTableMissing(false);
      setRuns(data.runs);
    }
    setLoadingRuns(false);
  }, [jobFilter]);

  const skipNextFilterFetch = useRef(true);
  useEffect(() => {
    if (skipNextFilterFetch.current && jobFilter === 'all') {
      skipNextFilterFetch.current = false;
      return;
    }
    skipNextFilterFetch.current = false;
    void fetchRuns();
  }, [jobFilter, fetchRuns]);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch('/api/scrape/status');
        const data = await res.json();
        if (!cancelled && data.success) setStatus(data);
      } catch {
        /* ignore */
      }
    }
    void poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    setTableMissing(schemaMissingProp);
  }, [schemaMissingProp]);

  const toggleDetail = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setDetailJson(null);
      return;
    }
    setExpandedId(id);
    setDetailLoading(true);
    setDetailJson(null);
    const data = await getScrapeRunById(id);
    if (!data.ok) {
      setDetailJson(JSON.stringify({ error: data.error }, null, 2));
    } else {
      setDetailJson(JSON.stringify(data.run, null, 2));
    }
    setDetailLoading(false);
  };

  const scraping = status?.status === 'scraping';
  const p = status?.progress;

  return (
    <div className="min-h-screen bg-slate-950 px-5 py-6 font-sans text-slate-100">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold text-white">Scraping observability</h1>
          <p className="max-w-2xl text-sm text-slate-400">
            Live TikTok scrape progress (in-memory on the current server instance) and persisted run history
            loaded from the database on the server—no API key in the browser. Programmatic access still uses{' '}
            <code className="text-slate-300">SCRAPE_SECRET</code> on{' '}
            <code className="text-slate-300">GET /api/scrape/runs</code>.
          </p>
        </div>

        {tableMissing && (
          <div className="mb-8 rounded-xl border border-amber-800 bg-amber-950/40 px-4 py-4 text-sm text-amber-100">
            <p className="mb-2 font-medium text-amber-50">
              The <code className="text-amber-200">scrape_runs</code> table is not in this database yet (Prisma
              P2021).
            </p>
            <p className="mb-3 text-amber-100/90">
              Create it once from the project root, then reload this page:
            </p>
            <pre className="overflow-x-auto rounded-lg border border-amber-900/60 bg-slate-950 p-3 font-mono text-xs text-slate-200">
              {`npx prisma db execute --schema prisma/schema.prisma --file prisma/migrations/20250321120000_add_scrape_runs/migration.sql`}
            </pre>
            <p className="mt-3 text-xs text-amber-200/80">
              Or run the same SQL in the Neon (or Postgres) console. After that, scrapes will persist rows here.
            </p>
          </div>
        )}

        <div className="mb-8 flex justify-end">
          <button
            type="button"
            onClick={() => fetchRuns()}
            disabled={loadingRuns}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {loadingRuns ? 'Refreshing…' : 'Refresh history'}
          </button>
        </div>

        <section className="mb-10 rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">Live status</h2>
          {!status ? (
            <p className="text-slate-400">Loading status…</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div
                className={`rounded-lg border p-4 ${
                  scraping ? 'border-amber-700 bg-amber-950/30' : 'border-slate-700 bg-slate-950/50'
                }`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${scraping ? 'animate-pulse bg-amber-400' : 'bg-slate-500'}`}
                  />
                  <span className="font-medium text-white">
                    {scraping ? 'TikTok scraper active' : 'Idle'}
                  </span>
                  <span className={statusPill(scraping ? 'running' : 'success')}>{status.status}</span>
                </div>
                {status.scrapeRunId && (
                  <p className="mb-2 font-mono text-xs text-slate-400">Run id: {status.scrapeRunId}</p>
                )}
                {p && (
                  <div className="space-y-1 text-sm text-slate-300">
                    <p>
                      Batch {p.currentBatch}/{p.totalBatches} · Videos {p.current}/{p.total} ({p.percentage}%)
                    </p>
                    <p>
                      Elapsed {(p.elapsedTime / 1000).toFixed(1)}s
                      {scraping && p.estimatedTimeRemaining > 0
                        ? ` · ~${(p.estimatedTimeRemaining / 1000).toFixed(0)}s remaining`
                        : ''}
                    </p>
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-950/50 p-4 text-sm text-slate-300">
                <p>
                  <strong className="text-white">Events in DB:</strong>{' '}
                  {status.stats.totalEvents.toLocaleString()}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  Progress reflects the TikTok route only and may not match cron if another instance handled
                  the job (e.g. serverless).
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-white">Run history</h2>
            <div className="flex flex-wrap gap-2">
              {(['all', 'tiktok', 'twitter_search'] as const).map((j) => (
                <button
                  key={j}
                  type="button"
                  onClick={() => setJobFilter(j)}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium capitalize ${
                    jobFilter === j
                      ? 'border-blue-500 bg-blue-600 text-white'
                      : 'border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {j.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {runsError && (
            <div className="mb-4 rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-100">
              {runsError}
            </div>
          )}

          {loadingRuns && runs.length === 0 && !tableMissing ? (
            <p className="text-slate-400">Loading runs…</p>
          ) : runs.length === 0 ? (
            <p className="text-slate-400">
              {tableMissing
                ? 'Run history will appear here after the migration creates scrape_runs.'
                : 'No runs yet. Trigger a TikTok or Twitter scrape to record a run.'}
            </p>
          ) : (
            <ul className="space-y-3">
              {runs.map((run) => (
                <li
                  key={run.id}
                  className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/60"
                >
                  <button
                    type="button"
                    onClick={() => toggleDetail(run.id)}
                    className="flex w-full flex-col gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-900/80 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-slate-500">{run.id.slice(0, 8)}…</span>
                        <span className={statusPill(run.status)}>{run.status}</span>
                        <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">
                          {run.job}
                        </span>
                        <span className="text-xs text-slate-500">{run.trigger}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-300">
                        {formatWhen(run.startedAt)}
                        {run.durationMs != null ? ` · ${(run.durationMs / 1000).toFixed(1)}s` : ''}
                      </p>
                      {run.error && (
                        <p className="mt-1 line-clamp-2 text-xs text-rose-300">{run.error}</p>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">{expandedId === run.id ? 'Hide' : 'Details'}</span>
                  </button>
                  {expandedId === run.id && (
                    <div className="border-t border-slate-800 bg-slate-950 px-4 py-3">
                      {detailLoading ? (
                        <p className="text-sm text-slate-400">Loading full run…</p>
                      ) : (
                        <pre className="max-h-[min(70vh,520px)] overflow-auto rounded-md border border-slate-800 bg-slate-900 p-3 text-xs text-slate-200">
                          {detailJson}
                        </pre>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-8 text-center text-xs text-slate-600">
          <a href="/admin/twitter-data" className="text-slate-500 underline hover:text-slate-400">
            Twitter data
          </a>
          {' · '}
          <a href="/debug" className="text-slate-500 underline hover:text-slate-400">
            Debug
          </a>
        </p>
      </div>
    </div>
  );
}
