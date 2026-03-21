import { NextRequest, NextResponse } from 'next/server';
import { extractDetailedLocationFromTikTok } from '@/lib/openrouter';
import { classifyIncidentType } from '@/lib/incident-classification';
import { prisma } from '@/lib/prisma';

import { Video } from '@/types/tiktok';

// Import shared progress tracking and rate limiter
import { scrapingProgress, updateScrapingProgress } from '@/lib/scraping-progress';
import { scrapeRateLimiter, checkRateLimit } from '@/lib/rate-limiter';

// Import Pub/Sub for live updates
import { publishNewEvent, publishSystemMessage } from '@/lib/pubsub';

// Import RapidAPI key manager
import { rapidAPIManager, type ScrapeResult } from '@/lib/rapidapi-key-manager';
import { authenticateScrapeRequest, getCorsHeaders, handleCors } from '@/lib/auth-middleware';
import {
  getKeywordSearchAuthorAllowlist,
  getResolvedTikTokAccountHandles,
  getTikTokSearchKeywords,
} from '@/config/tiktok-scrape-accounts';
import {
  appendOutcome,
  createScrapeRun,
  finishScrapeRun,
  markScrapeRunFailed,
  type ScrapeOutcome,
} from '@/lib/scrape-run';

function resolveTikTokTrigger(isVercelCron: boolean, isInternalCron: boolean): string {
  if (isVercelCron) return 'vercel_cron';
  if (isInternalCron) return 'internal_cron';
  return 'manual';
}

/** Normalize Tiktok Scraper7 payloads (search + user feed). */
function extractVideosFromProviderPayload(resultData: unknown): Video[] {
  if (!resultData || typeof resultData !== 'object') return [];
  const root = resultData as { data?: { videos?: unknown; aweme_list?: unknown } };
  const inner = root.data;
  if (!inner || typeof inner !== 'object') return [];
  const videos = (inner as { videos?: unknown }).videos;
  if (Array.isArray(videos)) return videos as Video[];
  const awemeList = (inner as { aweme_list?: unknown }).aweme_list;
  if (Array.isArray(awemeList)) return awemeList as Video[];
  return [];
}

/** TikTok search for each keyword, then keep only videos from curated accounts (see config). */
async function scrapeTikTokVideosByKeywords(dateToday: string): Promise<Video[]> {
  try {
    console.log(`📅 Today's date: ${dateToday}`);
    const handles = getResolvedTikTokAccountHandles();
    const baseKeywords = getTikTokSearchKeywords();
    console.log(
      `🔍 TikTok: ${baseKeywords.length} keyword(s) → results limited to ${handles.length} curated account(s)`
    );
    console.log('🔎 Active search keywords:', baseKeywords);

    // Apply rate limiting before making API calls
    const rateLimitResult = await checkRateLimit(scrapeRateLimiter, 'tiktok-scrape-check');
    if (!rateLimitResult.success) {
      throw new Error('Rate limit exceeded for TikTok scraping');
    }

    // Determine if it's peak hour and choose appropriate strategy
    const isPeakHour = rapidAPIManager.isPeakHour();
    const targetPerKeyword = isPeakHour ? 30 : 20; // keep total requests reasonable

    // Combine all successful results across all keywords
    const allResults: ScrapeResult[] = [];
    const allVideos: Video[] = [];
    let totalVideosFound = 0;

    for (const baseKeyword of baseKeywords) {
      const keyword = baseKeyword.replace('{date}', dateToday);
      console.log(`🔎 Searching TikTok for: "${keyword}"`);

      let resultsForKeyword: ScrapeResult[];

      if (isPeakHour) {
        console.log(`🔥 Peak hour detected - using parallel calls (~${targetPerKeyword} videos) for "${keyword}"`);
        resultsForKeyword = await rapidAPIManager.makeParallelCalls(keyword, targetPerKeyword);
      } else {
        console.log(`💤 Conserve hour detected - using sequential calls (~${targetPerKeyword} videos) for "${keyword}"`);
        resultsForKeyword = await rapidAPIManager.makeSequentialCalls(keyword, targetPerKeyword);
      }

      allResults.push(...resultsForKeyword);

      for (const result of resultsForKeyword) {
        // Some providers use different 'code' semantics; rely on presence of videos instead.
        const videos = extractVideosFromProviderPayload(result.data);

        if (result.success && videos.length > 0) {
          allVideos.push(...videos);
          totalVideosFound += videos.length;
          console.log(`✅ ${result.keyUsed} [${keyword}]: Found ${videos.length} videos`);
        } else {
          console.log(`❌ ${result.keyUsed} [${keyword}]: ${result.error || 'No videos found or empty response'}`);
          if (result.success) {
            console.log(`   Raw provider data (truncated):`, JSON.stringify(result.data).slice(0, 500));
          }
        }
      }
    }

    console.log(`🎯 Total videos collected: ${totalVideosFound} from ${allResults.length} API calls across ${baseKeywords.length} keywords`);
    
    // Remove duplicates based on video_id
    const uniqueVideos = allVideos.filter((video, index, self) => 
      index === self.findIndex(v => v.video_id === video.video_id)
    );

    if (uniqueVideos.length !== allVideos.length) {
      console.log(`🔄 Removed ${allVideos.length - uniqueVideos.length} duplicate videos`);
    }

    const authorAllowlist = getKeywordSearchAuthorAllowlist();
    const allowed = new Set(authorAllowlist);
    const before = uniqueVideos.length;
    const filtered = uniqueVideos.filter((video) => {
      const uid = video.author?.unique_id?.trim().toLowerCase();
      return uid ? allowed.has(uid) : false;
    });
    console.log(
      `🎯 Curated accounts only: ${before} → ${filtered.length} videos (${allowed.size} allowed handle(s))`
    );
    console.log(`📊 Final unique videos (after author filter): ${filtered.length}`);
    return filtered;
  } catch (error) {
    console.error('Error in TikTok keyword scraping:', error);
    return [];
  }
}

/** Keyword search (default terms in config) → only videos from curated accounts. */
async function scrapeTikTokVideos(dateToday: string): Promise<Video[]> {
  try {
    return await scrapeTikTokVideosByKeywords(dateToday);
  } catch (error) {
    console.error('Error in TikTok scraping:', error);
    return [];
  }
}

async function processTikTokVideo(video: Video, outcomes: ScrapeOutcome[]): Promise<boolean> {
  const startTime = Date.now();

  try {
    const tiktokUrl = `https://www.tiktok.com/@${video.author.unique_id}/video/${video.video_id}`;

    // Debug: Log TikTok link for inspection
    console.log(`🔗 TikTok Link: ${tiktokUrl}`);
    console.log(`📝 Title: ${video.title}`);
    console.log(`👤 Author: ${video.author.nickname}`);

    // Check if video already exists with timeout
    const existingEvent = await Promise.race([
      prisma.event.findFirst({
        where: {
          url: tiktokUrl
        }
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Database timeout')), 5000)
      )
    ]);

    if (existingEvent) {
      console.log(`⚠️ TikTok video already exists: ${video.video_id}`);
      appendOutcome(outcomes, {
        type: 'tiktok_skip_existing_event',
        videoId: video.video_id,
        url: tiktokUrl,
      });
      return false;
    }

    // Extract detailed location using OpenRouter (enhanced AI analysis with text + image)
    console.log(`🔍 Extracting detailed location for video: ${video.video_id}`);
    console.log(`🖼️ Cover image available: ${video.cover ? 'Yes' : 'No'}`);

    let locationResult = await extractDetailedLocationFromTikTok(video);

    // Retry with exponential backoff if it fails
    if (!locationResult.success || !locationResult.exact_location) {
      console.log(`⚠️ First attempt failed, retrying detailed location extraction for video: ${video.video_id}`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
      locationResult = await extractDetailedLocationFromTikTok(video);
    }

    if (!locationResult.success || !locationResult.exact_location) {
      console.log(`❌ No detailed location found in TikTok video after retry: ${video.video_id}`);
      appendOutcome(outcomes, {
        type: 'tiktok_no_location',
        videoId: video.video_id,
        url: tiktokUrl,
      });
      return false;
    }

    console.log(`📍 Extracted exact location: "${locationResult.exact_location}"`);
    if (locationResult.all_locations && locationResult.all_locations.length > 0) {
      console.log(`📍 All locations found: ${locationResult.all_locations.join(', ')}`);
    }

    // Extract all unique locations for batch geocoding
    const locationsToGeocode : any= [];
    if (locationResult.exact_location) {
      locationsToGeocode.push(locationResult.exact_location);
    }
    if (locationResult.all_locations && locationResult.all_locations.length > 0) {
      // Add all locations and remove duplicates
      const uniqueLocations = [...new Set(locationResult.all_locations)];
      locationsToGeocode.push(...uniqueLocations);
    }

    // Remove duplicates while preserving order (exact_location first)
    const uniqueLocationsToGeocode = [...new Set(locationsToGeocode)] as string[];

    console.log(`🗺️ Locations to geocode: ${uniqueLocationsToGeocode.join(', ')}`);

    // Use batch geocoding for all locations
    const { smartGeocodeLocations } = await import('@/lib/smart-geocoding');
    const geocodeResults = await smartGeocodeLocations(uniqueLocationsToGeocode);

    // Find the best geocoding result
    let bestGeocodeResult: any = null;
    let bestLocation: any = null;

    for (const [location, result] of geocodeResults) {
      if (result.success) {
        // Prefer exact_location if it geocoded successfully
        if (location === locationResult.exact_location) {
          bestGeocodeResult = result;
          bestLocation = location;
          break;
        }
        // Otherwise use the first successful result
        if (!bestGeocodeResult) {
          bestGeocodeResult = result;
          bestLocation = location;
        }
      }
    }

    if (!bestGeocodeResult) {
      console.log(`❌ Failed to geocode any location for video: ${video.video_id}`);
      console.log(`   Tried locations: ${uniqueLocationsToGeocode.join(', ')}`);
      appendOutcome(outcomes, {
        type: 'tiktok_geocode_failed',
        videoId: video.video_id,
        url: tiktokUrl,
        tried: uniqueLocationsToGeocode,
      });
      return false;
    }

    console.log(`✅ Best geocoding result: "${bestLocation}"`);
    console.log(`📌 Coordinates: ${bestGeocodeResult.lat}, ${bestGeocodeResult.lng}`);

    // Log geocoding result details
    if (bestGeocodeResult.formattedAddress) {
      console.log(`🏷️ Formatted address: ${bestGeocodeResult.formattedAddress}`);
    }
    if (bestGeocodeResult.cached) {
      console.log(`💾 Result from cache`);
    } else {
      console.log(`🌐 Result from API (${bestGeocodeResult.source})`);
    }

    // Generate Google Maps URL for coordinates verification
    const googleMapsUrl = `https://www.google.com/maps?q=${bestGeocodeResult.lat},${bestGeocodeResult.lng}`;

    // Convert TikTok create_time (Unix timestamp) to Date
    const originalCreatedAt = new Date(video.create_time * 1000);
    
    const inferredType = classifyIncidentType(video.title);

    // Create or update event in database using upsert to prevent duplicates
    try {
      const savedEvent = await prisma.event.upsert({
        where: {
          url: tiktokUrl
        },
        update: {
          title: `Incident - ${video.author.nickname}`,
          description: video.title,
          lat: bestGeocodeResult.lat!,
          lng: bestGeocodeResult.lng!,
          verified: false,
          type: inferredType,
          extractedLocation: bestLocation,
          googleMapsUrl: googleMapsUrl,
          originalCreatedAt: originalCreatedAt,
          updatedAt: new Date()
        },
        create: {
          title: `Incident - ${video.author.nickname}`,
          description: video.title,
          lat: bestGeocodeResult.lat!,
          lng: bestGeocodeResult.lng!,
          source: 'TikTok',
          url: tiktokUrl,
          verified: false,
          type: inferredType,
          extractedLocation: bestLocation,
          googleMapsUrl: googleMapsUrl,
          originalCreatedAt: originalCreatedAt
        }
      });

      // Publish new event to Redis for live updates
      await publishNewEvent(savedEvent.id, 'created', {
        title: savedEvent.title,
        lat: bestGeocodeResult.lat,
        lng: bestGeocodeResult.lng,
        type: savedEvent.type,
        source: savedEvent.source,
        extractedLocation: bestLocation
      });

      appendOutcome(outcomes, {
        type: 'db_event_upserted',
        source: 'TikTok',
        eventId: savedEvent.id,
        videoId: video.video_id,
        url: tiktokUrl,
        extractedLocation: bestLocation,
        incidentType: inferredType,
      });

    } catch (dbError) {
      if (dbError instanceof Error && dbError.message.includes('Unique constraint')) {
        console.log(`⚠️ Event already exists for URL: ${tiktokUrl} - skipping`);
        appendOutcome(outcomes, {
          type: 'tiktok_skip_unique_race',
          videoId: video.video_id,
          url: tiktokUrl,
        });
        return false; // Don't count as processed since it already existed
      }
      throw dbError; // Re-throw other database errors
    }

    const processingTime = Date.now() - startTime;
    console.log(`✅ Successfully processed TikTok video: ${video.video_id}`);
    console.log(`📍 Location: ${bestLocation} (${bestGeocodeResult.lat}, ${bestGeocodeResult.lng})`);
    console.log(`🔗 TikTok: ${tiktokUrl}`);
    console.log(`⏱️ Processing time: ${processingTime}ms`);
    console.log(`---`);

    return true;

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error(`❌ Error processing TikTok video ${video.video_id} (${processingTime}ms):`, error);
    appendOutcome(outcomes, {
      type: 'tiktok_pipeline_error',
      videoId: video.video_id,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function GET(request: NextRequest) {
  // Handle CORS preflight
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  // Parse optional limit from query (used by cron wrapper to cap work)
  const requestUrl = new URL(request.url);
  const limitParam = requestUrl.searchParams.get('limit');
  const requestedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const safeLimit = requestedLimit && Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(50, requestedLimit))
    : undefined;

  // Check authentication: Vercel cron jobs or manual API calls
  const authHeader = request.headers.get('authorization');
  const isVercelCronJob = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isInternalCronCall = request.headers.get('x-internal-cron') === 'true';
  const scrapeSecret = request.headers.get('x-scrape-secret');

  console.log('🔍 Authentication check:');
  console.log(`  - authorization header: ${authHeader ? 'Present' : 'Missing'}`);
  console.log(`  - CRON_SECRET match: ${isVercelCronJob}`);
  console.log(`  - x-internal-cron: ${isInternalCronCall}`);
  console.log(`  - x-scrape-secret: ${scrapeSecret ? 'Present' : 'Missing'}`);
  console.log(`  - limit: ${safeLimit ?? 'none'}`);

  // Allow Vercel cron jobs with CRON_SECRET
  if (isVercelCronJob) {
    console.log(`🔐 Vercel cron job authenticated with CRON_SECRET`);
  }
  // Allow internal cron calls from /api/scrape/cron
  else if (isInternalCronCall) {
    console.log(`🔐 Internal cron call - skipping authentication`);
  }
  // Require authentication for external API calls
  else {
    console.log(`🔐 External request - checking authentication...`);
    const auth = authenticateScrapeRequest(request);
    if (!auth.isValid) {
      console.log(`❌ Authentication failed: ${auth.error}`);
      return NextResponse.json(
        {
          success: false,
          error: auth.error,
          message: 'Authentication required for scraping operations'
        },
        {
          status: 401,
          headers: getCorsHeaders()
        }
      );
    }
    console.log(`✅ External request authenticated`);
  }

  console.log('🔐 Scrape request authenticated successfully');

  const scrapingStartTime = Date.now();
  const trigger = resolveTikTokTrigger(isVercelCronJob, isInternalCronCall);
  let scrapeRunId: string | null = null;
  let runStartedAt = scrapingStartTime;
  const outcomes: ScrapeOutcome[] = [];

  try {
    // Check if scraping is already in progress
    if (scrapingProgress.isActive) {
      return NextResponse.json({
        success: false,
        error: 'Scraping is already in progress',
        progress: {
          current: scrapingProgress.processedVideos,
          total: scrapingProgress.totalVideos,
          percentage: scrapingProgress.totalVideos > 0 ?
            Math.round((scrapingProgress.processedVideos / scrapingProgress.totalVideos) * 100) : 0
        }
      }, {
        status: 409,
        headers: getCorsHeaders()
      }); // Conflict status
    }

    console.log('🚀 Starting concurrent TikTok demo scraping...');

    // Check rate limiter status
    const rateLimitCheck = await checkRateLimit(scrapeRateLimiter, 'tiktok-scrape-check');

    if (!rateLimitCheck.success) {
      return NextResponse.json({
        success: false,
        error: `Rate limit exceeded. Try again in ${Math.ceil((rateLimitCheck.reset || 0) / 1000)} seconds.`,
        rateLimit: {
          remainingCalls: rateLimitCheck.remaining || 0,
          resetInSeconds: Math.ceil((rateLimitCheck.reset || 0) / 1000)
        }
      }, {
        status: 429,
        headers: getCorsHeaders()
      }); // Too Many Requests
    }

    console.log(`📊 Rate limiter: ${rateLimitCheck.remaining} calls remaining, resets in ${Math.ceil((rateLimitCheck.reset || 0) / 1000)}s`);

    runStartedAt = Date.now();
    try {
      const row = await createScrapeRun({
        job: 'tiktok',
        trigger,
        summary: { limit: safeLimit ?? null },
      });
      scrapeRunId = row.id;
    } catch (auditErr) {
      console.error('ScrapeRun create failed (continuing without audit log):', auditErr);
    }

    // Initialize progress tracking
    updateScrapingProgress({
      isActive: true,
      totalVideos: 0,
      processedVideos: 0,
      currentBatch: 0,
      totalBatches: 0,
      startTime: scrapingStartTime,
      lastUpdate: new Date().toISOString(),
      currentRunId: scrapeRunId,
    });

    // Get today's date for reference
    const today = new Date();
    const day = today.getDate().toString().padStart(2, '0');
    const month = (today.getMonth() + 1).toString().padStart(2, '0');
    const year = today.getFullYear();
    const dateToday = `${day}/${month}/${year}`;

    // Scrape TikTok videos with our Melbourne keywords
    let videos = await scrapeTikTokVideos(dateToday);
    console.log(`📹 Found ${videos.length} TikTok videos for incident search`);

    // Hard cap the number of videos we pass through the heavy LLM/location pipeline
    // to avoid blowing OpenAI token limits in a single run.
    const MAX_LLM_VIDEOS = 3;
    const originalCount = videos.length;
    videos = videos.slice(0, Math.min(MAX_LLM_VIDEOS, safeLimit || MAX_LLM_VIDEOS));
    console.log(`✂️  Limiting processing to first ${videos.length} of ${originalCount} videos to control LLM token usage`);

    // Choose a smaller batch size for cron-triggered runs
    const dynamicBatchSize = isInternalCronCall ? 2 : 3;
    console.log(`⚡ Processing with concurrent batches (${dynamicBatchSize} videos per batch)`);

    // Update progress with total count
    scrapingProgress.totalVideos = videos.length;
    scrapingProgress.totalBatches = Math.max(1, Math.ceil(videos.length / dynamicBatchSize));
    scrapingProgress.lastUpdate = new Date().toISOString();

    let processedCount = 0;

    // Process videos in concurrent batches to avoid overwhelming APIs
    const BATCH_SIZE = dynamicBatchSize; // Process N videos concurrently
    const DELAY_BETWEEN_BATCHES = 2000; // 2 second delay between batches

    for (let i = 0; i < videos.length; i += BATCH_SIZE) {
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const batch = videos.slice(i, i + BATCH_SIZE);

      // Update progress for current batch
      scrapingProgress.currentBatch = batchNumber;
      scrapingProgress.lastUpdate = new Date().toISOString();

      console.log(`🔄 Processing batch ${batchNumber}/${scrapingProgress.totalBatches} (${batch.length} videos)`);

      // Process batch concurrently
      const batchPromises = batch.map(async (video) => {
        try {
          const success = await processTikTokVideo(video, outcomes);
          // Update processed count in progress tracking
          if (success) {
            scrapingProgress.processedVideos++;
            scrapingProgress.lastUpdate = new Date().toISOString();
          }
          return success ? 1 : 0;
        } catch (error) {
          console.error(`Failed to process video ${video.video_id}:`, error);
          return 0;
        }
      });

      // Wait for all videos in batch to complete
      const batchResults = await Promise.all(batchPromises);
      processedCount += batchResults.reduce((sum: number, result: number) => sum + result, 0);

      console.log(`✅ Batch ${batchNumber} completed: ${batchResults.reduce((sum: number, result: number) => sum + result, 0)}/${batch.length} videos processed`);
      console.log(`📊 Progress: ${scrapingProgress.processedVideos}/${scrapingProgress.totalVideos} videos processed`);

      // Delay between batches (except for the last batch)
      if (i + BATCH_SIZE < videos.length) {
        console.log(`⏳ Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }

    const totalTime = Date.now() - scrapingStartTime;
    const avgTimePerVideo = processedCount > 0 ? Math.round(totalTime / processedCount) : 0;

    // Mark scraping as completed
    updateScrapingProgress({
      ...scrapingProgress,
      isActive: false,
      lastUpdate: new Date().toISOString(),
      currentRunId: null,
    });

    console.log(`🎉 Scraping completed in ${totalTime}ms`);
    console.log(`📊 Average processing time per video: ${avgTimePerVideo}ms`);
    console.log(`🚀 Concurrent processing speedup: ~${Math.round((videos.length * 1000) / totalTime)}x faster than sequential`);

    // Publish scraping completion message
    await publishSystemMessage('scrape_completed', `Processed ${processedCount} demo locations from ${videos.length} TikTok videos`);

    // Get final rate limiter status
    const finalRateLimitCheck = await checkRateLimit(scrapeRateLimiter, 'tiktok-scrape-final');
    const finalRemainingCalls = finalRateLimitCheck.remaining || 0;
    const finalTimeUntilReset = finalRateLimitCheck.reset || 0;

    // Get key usage statistics
    const keyStats = rapidAPIManager.getKeyUsageStats();

    const scrapeSource = {
      mode: 'keywords_on_curated_accounts' as const,
      keywords: getTikTokSearchKeywords(),
      keywordsSource: process.env.SCRAPE_KEYWORDS?.trim() ? ('SCRAPE_KEYWORDS' as const) : ('default_config' as const),
      authorAllowlist: getKeywordSearchAuthorAllowlist(),
      accountsListSource: process.env.SCRAPE_TIKTOK_ACCOUNTS?.trim()
        ? ('SCRAPE_TIKTOK_ACCOUNTS' as const)
        : ('default_config' as const),
    };

    if (scrapeRunId) {
      try {
        await finishScrapeRun(scrapeRunId, {
          status: 'success',
          startedAt: runStartedAt,
          summary: {
            videos: videos.length,
            videosDiscovered: originalCount,
            processed: processedCount,
            date: dateToday,
            scrapeSource,
            totalTime,
            avgTimePerVideo,
            isPeakHour: rapidAPIManager.isPeakHour(),
            keyUsage: keyStats,
            rateLimit: {
              remainingCalls: finalRemainingCalls,
              resetInSeconds: Math.ceil(finalTimeUntilReset / 1000),
            },
            trigger,
          },
          outcomes,
          error: null,
        });
      } catch (auditErr) {
        console.error('finishScrapeRun failed:', auditErr);
      }
    }

    return NextResponse.json({
      success: true,
      scrapeRunId: scrapeRunId ?? undefined,
      videos: videos.length,
      processed: processedCount,
      date: dateToday,
      scrapeSource,
      totalTime: totalTime,
      avgTimePerVideo: avgTimePerVideo,
      isPeakHour: rapidAPIManager.isPeakHour(),
      keyUsage: keyStats,
      rateLimit: {
        remainingCalls: finalRemainingCalls,
        resetInSeconds: Math.ceil(finalTimeUntilReset / 1000)
      },
      message: `Processed ${processedCount} incident locations from ${videos.length} TikTok videos in ${totalTime}ms`
    }, { headers: getCorsHeaders() });

  } catch (error) {
    const totalTime = Date.now() - scrapingStartTime;

    // Mark scraping as failed
    updateScrapingProgress({
      ...scrapingProgress,
      isActive: false,
      lastUpdate: new Date().toISOString(),
      currentRunId: null,
    });

    const errMsg = error instanceof Error ? error.message : 'Failed to scrape TikTok videos';
    if (scrapeRunId) {
      try {
        await markScrapeRunFailed(scrapeRunId, runStartedAt, errMsg);
      } catch (auditErr) {
        console.error('markScrapeRunFailed failed:', auditErr);
      }
    }

    console.error(`❌ Error in TikTok scraping API (${totalTime}ms):`, error);
    return NextResponse.json(
      { success: false, error: 'Failed to scrape TikTok videos', scrapeRunId: scrapeRunId ?? undefined },
      {
        status: 500,
        headers: getCorsHeaders()
      }
    );
  }
}