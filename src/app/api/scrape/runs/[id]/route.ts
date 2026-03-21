import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isScrapeDashboardAuthorized } from '@/lib/scrape-dashboard-auth';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
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

  const { id } = await context.params;

  try {
    const run = await prisma.scrapeRun.findUnique({
      where: { id },
    });

    if (!run) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, run });
  } catch (e) {
    console.error('scrape/runs/[id] error:', e);
    return NextResponse.json(
      { success: false, error: 'Failed to load scrape run' },
      { status: 500 }
    );
  }
}
