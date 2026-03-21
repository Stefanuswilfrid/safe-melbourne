import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { TwitterSearchResponse, TwitterTimeline } from '@/types/twitter';
import {
  appendOutcome,
  createScrapeRun,
  finishScrapeRun,
  markScrapeRunFailed,
  type ScrapeOutcome,
} from '@/lib/scrape-run';

// Rate limiting - simple in-memory store (consider Redis for production)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const key = `twitter_search_${ip}`;
  
  const existing = rateLimitStore.get(key);
  if (!existing || now > existing.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  existing.count++;
  return true;
}

export async function GET(request: NextRequest) {
  // Twitter scraping is disabled by default — results only created WarningMarkers,
  // never Events. Set TWITTER_SCRAPE_ENABLED=true to re-enable.
  if (process.env.TWITTER_SCRAPE_ENABLED !== 'true') {
    return NextResponse.json({
      success: false,
      disabled: true,
      error: 'Twitter scraping is disabled. Set TWITTER_SCRAPE_ENABLED=true to enable.',
    }, { status: 200 });
  }

  let scrapeRunId: string | null = null;
  let runStartedAt = Date.now();
  const outcomes: ScrapeOutcome[] = [];

  try {
    // Get client IP for rate limiting
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown';
    
    // Check rate limit
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      );
    }

    // Allow internal cron calls; block unauthenticated external requests
    const isInternalCron = request.headers.get('x-internal-cron') === 'true';
    const scrapeSecret = request.headers.get('x-scrape-secret');
    const isAuthenticated = isInternalCron && scrapeSecret === process.env.SCRAPE_SECRET;

    if (!isInternalCron && !isAuthenticated) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const trigger = isInternalCron ? 'internal_cron' : 'manual';
    runStartedAt = Date.now();
    try {
      const row = await createScrapeRun({
        job: 'twitter_search',
        trigger,
        summary: { phase: 'init' },
      });
      scrapeRunId = row.id;
    } catch (auditErr) {
      console.error('ScrapeRun create failed (Twitter, continuing):', auditErr);
    }

    // Check if RapidAPI key is configured
    if (!process.env.RAPIDAPI_KEY) {
      console.error('❌ RapidAPI key not configured');
      if (scrapeRunId) {
        await markScrapeRunFailed(scrapeRunId, runStartedAt, 'Twitter API not configured');
        scrapeRunId = null;
      }
      return NextResponse.json(
        { success: false, error: 'Twitter API not configured' },
        { status: 500 }
      );
    }

    // Configurable keyword list — override via TWITTER_SEARCH_KEYWORDS env var (pipe-separated)
    const rawKeywords = process.env.TWITTER_SEARCH_KEYWORDS;
    const searchKeywords = rawKeywords
      ? rawKeywords.split('|').map(k => k.trim()).filter(Boolean)
      : [
          'melbourne protest',
          'melbourne incident',
          'melbourne stabbing',
          'melbourne shooting',
          'melbourne crash',
          'melbourne fight',
          'melbourne attack',
          'melbourne emergency',
        ];

    console.log(`🐦 Starting Twitter search across ${searchKeywords.length} keywords:`, searchKeywords);

    const headers = {
      'x-rapidapi-key': process.env.RAPIDAPI_KEY,
      'x-rapidapi-host': 'twitter-api45.p.rapidapi.com'
    };

    // Collect all tweets across all keywords, deduplicate by tweet_id
    const seenTweetIds = new Set<string>();
    const allTweets: TwitterTimeline[] = [];

    for (const keyword of searchKeywords) {
      try {
        const encodedQuery = encodeURIComponent(keyword);
        const url = `https://twitter-api45.p.rapidapi.com/search.php?query=${encodedQuery}&search_type=Latest`;

        console.log(`🔎 Searching Twitter for: "${keyword}"`);
        const response = await fetch(url, { method: 'GET', headers });

        if (!response.ok) {
          console.warn(`⚠️ Twitter API returned ${response.status} for keyword: "${keyword}"`);
          continue;
        }

        let twitterData: TwitterSearchResponse;
        try {
          twitterData = JSON.parse(await response.text());
        } catch {
          console.warn(`⚠️ Failed to parse response for keyword: "${keyword}"`);
          continue;
        }

        if (!twitterData.timeline || !Array.isArray(twitterData.timeline)) {
          console.warn(`⚠️ No timeline in response for keyword: "${keyword}"`);
          continue;
        }

        let newForKeyword = 0;
        for (const tweet of twitterData.timeline) {
          if (!seenTweetIds.has(tweet.tweet_id)) {
            seenTweetIds.add(tweet.tweet_id);
            allTweets.push(tweet);
            newForKeyword++;
          }
        }

        console.log(`✅ "${keyword}": ${twitterData.timeline.length} tweets (${newForKeyword} new after dedup)`);
      } catch (keywordError) {
        console.error(`❌ Error searching keyword "${keyword}":`, keywordError);
      }
    }

    console.log(`📊 Total unique tweets collected: ${allTweets.length}`);

    // Process and store tweets in database
    let processedCount = 0;
    let skippedExisting = 0;
    const errors: string[] = [];

    for (const tweet of allTweets) {
      try {
        // Skip if tweet already exists
        const existing = await prisma.warningMarker.findUnique({
          where: { tweetId: tweet.tweet_id }
        });

        if (existing) {
          console.log(`⏭️ Tweet ${tweet.tweet_id} already exists, skipping...`);
          skippedExisting++;
          continue;
        }

        // Parse created_at date
        let createdAt: Date;
        try {
          // Twitter date format: "Sun Aug 31 08:28:25 +0000 2025"
          createdAt = new Date(tweet.created_at);
          if (isNaN(createdAt.getTime())) {
            throw new Error('Invalid date');
          }
        } catch (dateError) {
          console.warn(`⚠️ Failed to parse date for tweet ${tweet.tweet_id}: ${tweet.created_at}`);
          createdAt = new Date(); // Fallback to current date
        }

        // Filter user info to only include relevant fields for bot detection
        const filteredUserInfo = {
          created_at: tweet.user_info.created_at,
          followers_count: tweet.user_info.followers_count,
          friends_count: tweet.user_info.friends_count,
          favourites_count: tweet.user_info.favourites_count,
          verified: tweet.user_info.verified
        };

        // Create warning marker record
        const marker = await prisma.warningMarker.create({
          data: {
            tweetId: tweet.tweet_id,
            text: tweet.text,
            createdAt: createdAt,
            bookmarks: tweet.bookmarks || 0,
            favorites: tweet.favorites || 0,
            retweets: tweet.retweets || 0,
            views: tweet.views || '0',
            quotes: tweet.quotes || 0,
            replies: tweet.replies || 0,
            userInfo: filteredUserInfo, // Store filtered JSON
            verified: false, // Will be processed later
          }
        });

        processedCount++;
        console.log(`✅ Saved tweet ${tweet.tweet_id} to database`);
        appendOutcome(outcomes, {
          type: 'db_warning_marker_created',
          markerId: marker.id,
          tweetId: tweet.tweet_id,
          textPreview: tweet.text?.slice(0, 160) ?? '',
        });

      } catch (error) {
        const errorMsg = `Failed to process tweet ${tweet.tweet_id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error('❌', errorMsg);
        errors.push(errorMsg);
      }
    }

    console.log(`🎯 Processing complete: ${processedCount} new tweets saved`);
    
    if (errors.length > 0) {
      console.warn(`⚠️ ${errors.length} errors occurred during processing`);
    }

    appendOutcome(outcomes, {
      type: 'twitter_skipped_existing',
      count: skippedExisting,
    });

    if (scrapeRunId) {
      try {
        await finishScrapeRun(scrapeRunId, {
          status: errors.length > 0 ? 'partial' : 'success',
          startedAt: runStartedAt,
          summary: {
            totalFound: allTweets.length,
            processed: processedCount,
            skippedExisting,
            keywords: searchKeywords,
            errorsCount: errors.length,
            trigger,
          },
          outcomes,
          error: errors.length > 0 ? errors[0]! : null,
        });
      } catch (auditErr) {
        console.error('finishScrapeRun failed (Twitter):', auditErr);
      }
    }

    return NextResponse.json({
      success: true,
      scrapeRunId: scrapeRunId ?? undefined,
      totalFound: allTweets.length,
      processed: processedCount,
      keywords: searchKeywords,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    console.error('❌ Twitter search API error:', error);
    const msg = error instanceof Error ? error.message : 'Unknown error occurred';
    if (scrapeRunId) {
      try {
        await markScrapeRunFailed(scrapeRunId, runStartedAt, msg);
      } catch (auditErr) {
        console.error('markScrapeRunFailed failed (Twitter):', auditErr);
      }
    }
    return NextResponse.json(
      { 
        success: false, 
        error: msg,
        scrapeRunId: scrapeRunId ?? undefined,
      },
      { status: 500 }
    );
  }
}

// POST endpoint for manual triggers or webhook processing
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'process_pending') {
      // Process pending warning markers that haven't been geocoded yet
      const pendingMarkers = await prisma.warningMarker.findMany({
        where: {
          OR: [
            { lat: null },
            { lng: null },
            { extractedLocation: null }
          ]
        },
        orderBy: { createdAt: 'desc' },
        take: 50 // Process in batches
      });

      console.log(`🔄 Processing ${pendingMarkers.length} pending warning markers...`);

      return NextResponse.json({
        success: true,
        message: `Found ${pendingMarkers.length} markers to process`,
        markers: pendingMarkers.length
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );

  } catch (error) {
    console.error('❌ Twitter POST API error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      },
      { status: 500 }
    );
  }
}
