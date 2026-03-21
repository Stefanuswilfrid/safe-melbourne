/**
 * Default TikTok allowlist (news / curated). Handles are TikTok unique_id (no @).
 * Verify on tiktok.com/@… if an account rebrands.
 */
export const DEFAULT_TIKTOK_NEWS_ACCOUNTS = [
  '7newsmelbourne', // 7NEWS Melbourne
  'heraldsun_', // Herald Sun
  '9newsmelbourne', // 9News Melbourne
  '9newsaustralia', // 9News Australia
  'aussietopics',
  '9news',
  '7newsaustralia',
  '10newsau'
] as const;

/** Default search terms (TikTok search API). Edit here — no env required. */
export const DEFAULT_TIKTOK_SEARCH_KEYWORDS = [
  'melbourne crime',
  'crime melbourne',
  'victoria crime',
  'melbourne incident',
  'melbourne stabbing',
  'stabbing melbourne',
  'melbourne assault',
  'assault melbourne',
  'melbourne robbery',
  'robbery melbourne',
  'melbourne burglary',
  'melbourne violence',
  'melbourne attack',
  'victoria police incident',
  'melbourne sex offender',
  'melbourne sexual assault',
  'melbourne rape',
  'sex pest',
  'victoria sex offender',
  'melbourne pervert',
  'melbourne indecent',
  'sex offender victoria',
  'sexual assault melbourne',
  'pervert melbourne',
  'predator melbourne',
  'indecent assault victoria',
  'groping melbourne',
] as const;

function normalizeTikTokHandle(s: string): string {
  return s.trim().replace(/^@/u, '').toLowerCase();
}

/**
 * Which accounts may appear in results: default list or `SCRAPE_TIKTOK_ACCOUNTS` (pipe-separated).
 */
export function getResolvedTikTokAccountHandles(): string[] {
  const raw = process.env.SCRAPE_TIKTOK_ACCOUNTS;
  if (raw?.trim()) {
    return raw
      .split('|')
      .map((s) => s.trim().replace(/^@/u, ''))
      .filter(Boolean);
  }
  return [...DEFAULT_TIKTOK_NEWS_ACCOUNTS];
}

/**
 * Search keywords: `SCRAPE_KEYWORDS` (pipe-separated) if set, else {@link DEFAULT_TIKTOK_SEARCH_KEYWORDS}.
 * Optional `{date}` in a term → replaced by caller with DD/MM/YYYY.
 */
export function getTikTokSearchKeywords(): string[] {
  const raw = process.env.SCRAPE_KEYWORDS?.trim();
  if (raw) {
    return raw.split('|').map((k) => k.trim()).filter(Boolean);
  }
  return [...DEFAULT_TIKTOK_SEARCH_KEYWORDS];
}

/**
 * After keyword search, only videos whose `author.unique_id` is in this list (always the curated accounts).
 */
export function getKeywordSearchAuthorAllowlist(): string[] {
  return getResolvedTikTokAccountHandles().map(normalizeTikTokHandle).filter(Boolean);
}
