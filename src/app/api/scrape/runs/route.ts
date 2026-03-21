import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isScrapeDashboardAuthorized } from '@/lib/scrape-dashboard-auth';

export async function GET(request: NextRequest) {
  if (!isScrapeDashboardAuthorized(request)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Unauthorized',
        message: 'Send x-scrape-secret, x-admin-secret, or Authorization: Bearer matching SCRAPE_SECRET / ADMIN_SECRET',
      },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const job = searchParams.get('job')?.trim() || undefined;
  const rawLimit = Number.parseInt(searchParams.get('limit') || '40', 10);
  const take = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 40;

  try {
    const runs = await prisma.scrapeRun.findMany({
      where: job ? { job } : undefined,
      orderBy: { startedAt: 'desc' },
      take,
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

    return NextResponse.json({ success: true, runs });
  } catch (e) {
    console.error('scrape/runs list error:', e);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to list scrape runs',
        hint: 'Apply the scrape_runs migration if the table is missing (see README).',
      },
      { status: 500 }
    );
  }
}
