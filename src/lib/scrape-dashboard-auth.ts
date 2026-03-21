import type { NextRequest } from 'next/server';

/** Allows read access to scrape logs when SCRAPE_SECRET or ADMIN_SECRET is set; otherwise open (local dev). */
export function isScrapeDashboardAuthorized(request: NextRequest): boolean {
  const secret =
    process.env.SCRAPE_SECRET?.trim() || process.env.ADMIN_SECRET?.trim();
  if (!secret) return true;

  const auth = request.headers.get('authorization');
  const bearer =
    auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  const provided =
    request.headers.get('x-scrape-secret')?.trim() ||
    request.headers.get('x-admin-secret')?.trim() ||
    bearer;

  return provided === secret;
}
