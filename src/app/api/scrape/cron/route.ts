import { NextRequest, NextResponse } from 'next/server';

/**
 * Cron Job Endpoint — TikTok + Twitter Scraping
 *
 * Called by Vercel cron (vercel.json) once daily at 09:00 UTC.
 * Runs TikTok and Twitter scraping in parallel.
 */

async function parseJsonResponse(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type');
  try {
    if (contentType && contentType.includes('application/json')) {
      return await response.json();
    }
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { success: false, error: `Non-JSON response (${response.status}): ${text.substring(0, 100)}` };
    }
  } catch {
    return { success: false, error: 'Failed to parse response', status: response.status };
  }
}

export async function GET(request: NextRequest) {
  console.log('⏰ Cron job triggered - Starting TikTok + Twitter scraping...');

  const scrapeSecret = process.env.SCRAPE_SECRET;

  if (!scrapeSecret) {
    console.error('❌ SCRAPE_SECRET not configured in environment');
    return NextResponse.json(
      { success: false, error: 'SCRAPE_SECRET not configured', timestamp: new Date().toISOString() },
      { status: 500 }
    );
  }

  const baseUrl = process.env.NODE_ENV === 'production'
    ? process.env.NEXT_PUBLIC_APP_URL || 'https://safe-melbourne.vercel.app'
    : 'http://localhost:3000';

  const limit = process.env.SCRAPE_CRON_LIMIT || '10';
  const internalHeaders = {
    'x-internal-cron': 'true',
    'x-scrape-secret': scrapeSecret,
    'user-agent': 'vercel-cron/1.0',
  };

  console.log(`📍 Base URL: ${baseUrl}`);

  // Run TikTok and Twitter scraping in parallel
  const [tiktokResult, twitterResult] = await Promise.allSettled([
    // --- TikTok ---
    fetch(`${baseUrl}/api/scrape/tiktok?limit=${encodeURIComponent(limit)}`, {
      method: 'GET',
      headers: internalHeaders,
      cache: 'no-store',
      signal: AbortSignal.timeout(25 * 60 * 1000),
    }).then(r => parseJsonResponse(r).then(data => ({ response: r, data }))),

    // --- Twitter ---
    fetch(`${baseUrl}/api/twitter/search`, {
      method: 'GET',
      headers: internalHeaders,
      cache: 'no-store',
      signal: AbortSignal.timeout(5 * 60 * 1000),
    }).then(r => parseJsonResponse(r).then(data => ({ response: r, data }))),
  ]);

  const tiktok = tiktokResult.status === 'fulfilled'
    ? tiktokResult.value
    : { response: null, data: { success: false, error: (tiktokResult.reason as Error)?.message } };

  const twitter = twitterResult.status === 'fulfilled'
    ? twitterResult.value
    : { response: null, data: { success: false, error: (twitterResult.reason as Error)?.message } };

  console.log(`🎬 TikTok: ${tiktok.data.success ? '✅' : '❌'} ${tiktok.data.message || tiktok.data.error || ''}`);
  console.log(`🐦 Twitter: ${twitter.data.success ? '✅' : '❌'} processed=${twitter.data.processed ?? 'N/A'}`);

  return NextResponse.json({
    success: tiktok.data.success || twitter.data.success,
    timestamp: new Date().toISOString(),
    tiktok: tiktok.data,
    twitter: twitter.data,
  });
}

// Handle other HTTP methods
export async function POST() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed. Use GET for cron jobs.' },
    { status: 405 }
  );
}

export async function PUT() {
  return POST();
}

export async function DELETE() {
  return POST();
}
