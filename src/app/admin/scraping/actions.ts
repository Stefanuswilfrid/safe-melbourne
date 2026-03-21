'use server';

import { prisma } from '@/lib/prisma';
import { isMissingScrapeRunsTable } from '@/lib/scrape-runs-db';

const listSelect = {
  id: true,
  job: true,
  trigger: true,
  status: true,
  startedAt: true,
  completedAt: true,
  durationMs: true,
  summary: true,
  error: true,
} as const;

export type ScrapeRunListRow = {
  id: string;
  job: string;
  trigger: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  summary: unknown;
  error: string | null;
};

async function listScrapeRunsInternal(job: 'all' | 'tiktok' | 'twitter_search'): Promise<ScrapeRunListRow[]> {
  return prisma.scrapeRun.findMany({
    where: job === 'all' ? undefined : { job },
    orderBy: { startedAt: 'desc' },
    take: 50,
    select: listSelect,
  });
}

export async function listScrapeRuns(job: 'all' | 'tiktok' | 'twitter_search') {
  try {
    const runs = await listScrapeRunsInternal(job);
    return { ok: true as const, runs };
  } catch (e) {
    console.error('listScrapeRuns:', e);
    if (isMissingScrapeRunsTable(e)) {
      return {
        ok: false as const,
        schemaMissing: true as const,
        error: 'The scrape_runs table does not exist yet. Apply the migration (see dashboard banner).',
      };
    }
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : 'Failed to load runs',
    };
  }
}

export async function getScrapeRunById(id: string) {
  try {
    const run = await prisma.scrapeRun.findUnique({ where: { id } });
    if (!run) return { ok: false as const, error: 'Not found' as const };
    return { ok: true as const, run };
  } catch (e) {
    console.error('getScrapeRunById:', e);
    if (isMissingScrapeRunsTable(e)) {
      return {
        ok: false as const,
        schemaMissing: true as const,
        error: 'scrape_runs table missing',
      };
    }
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : 'Failed to load run',
    };
  }
}
