import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export const SCRAPE_OUTCOME_MAX = 120;

export type ScrapeOutcome = Record<string, unknown>;

export async function createScrapeRun(input: {
  job: string;
  trigger: string;
  summary?: Prisma.InputJsonValue;
}): Promise<{ id: string }> {
  const run = await prisma.scrapeRun.create({
    data: {
      job: input.job,
      trigger: input.trigger,
      status: 'running',
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      outcomes: [] as Prisma.InputJsonValue,
    },
  });
  return { id: run.id };
}

export function appendOutcome(outcomes: ScrapeOutcome[], item: ScrapeOutcome): void {
  if (outcomes.length >= SCRAPE_OUTCOME_MAX) return;
  outcomes.push(item);
}

export async function finishScrapeRun(
  id: string,
  input: {
    status: 'success' | 'failed' | 'partial';
    summary?: Prisma.InputJsonValue;
    outcomes?: ScrapeOutcome[];
    error?: string | null;
    startedAt: number;
  }
): Promise<void> {
  const completedAt = new Date();
  const durationMs = Math.max(0, completedAt.getTime() - input.startedAt);
  const outcomes = input.outcomes ?? [];
  const omitted = outcomes.length >= SCRAPE_OUTCOME_MAX;

  await prisma.scrapeRun.update({
    where: { id },
    data: {
      status: input.status,
      completedAt,
      durationMs,
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      outcomes: omitted
        ? ([...outcomes, { type: 'outcomes_capped', max: SCRAPE_OUTCOME_MAX }] as Prisma.InputJsonValue)
        : (outcomes as Prisma.InputJsonValue),
      error: input.error ?? null,
    },
  });
}

export async function markScrapeRunFailed(id: string, startedAt: number, error: string): Promise<void> {
  await finishScrapeRun(id, {
    status: 'failed',
    error,
    startedAt,
    outcomes: [{ type: 'run_failed', message: error }],
  });
}
