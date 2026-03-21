import { prisma } from '@/lib/prisma';
import { isMissingScrapeRunsTable } from '@/lib/scrape-runs-db';
import type { ScrapeRunListRow } from './actions';
import { ScrapingDashboardClient } from './ScrapingDashboardClient';

export default async function ScrapingDashboardPage() {
  let initialRuns: ScrapeRunListRow[] = [];
  let schemaMissing = false;

  try {
    initialRuns = await prisma.scrapeRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        job: true,
        trigger: true,
        status: true,
        startedAt: true,
        completedAt: true,
        durationMs: true,
        summary: true,
        error: true,
      },
    });
  } catch (e) {
    if (isMissingScrapeRunsTable(e)) {
      schemaMissing = true;
    } else {
      throw e;
    }
  }

  return (
    <ScrapingDashboardClient initialRuns={initialRuns} schemaMissing={schemaMissing} />
  );
}
