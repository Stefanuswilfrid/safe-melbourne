import { getCorsHeaders, handleCors } from '@/lib/admin-middleware';
import { hoaxProcessor } from '@/lib/hoax-data-processor';
import { prisma } from '@/lib/prisma';
import { formatTimeAgo } from '@/utils/date';
import OpenAI from 'openai';

import { NextRequest, NextResponse } from 'next/server';
import { ChatContext } from '@/types/event';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});
export interface ChatRequest {
  message: string;
  context?: {
    currentView?: string;
    timeRange?: string;
    includeHoaxes?: boolean;
  };
}

export interface HoaxResult {
  id: string;
  title: string;
  originalClaim?: string | null;
  hoaxCategory: string;
  verificationMethod?: string | null;
  investigationResult?: string | null;
  authorName?: string | null;
  sourceUrl: string;
  publicationDate: Date;
  similarity?: number;
}

export interface EventData {
  id: number;
  title: string;
  description: string | null;
  lat: number;
  lng: number;
  type: string;
  extractedLocation: string | null;
  createdAt: Date;
  verified: boolean;
  source: string;
  url?: string | null;
  confidenceScore?: number | null;
  views?: string | number | null;
  retweets?: number | null;
}

const HOAX_KEYWORDS = [
  'hoax', 'bohong', 'palsu', 'penipuan', 'scam', 'tipu', 'manipulasi',
  'turnbackhoax', 'cek fakta', 'verifikasi', 'bantah', 'klarifikasi',
  'disinformasi', 'misinformasi', 'propaganda', 'fitnah', 'hasut'
];

// Simple hash-based embedding function (matches generate-embeddings.js)
function generateSimpleEmbedding(text: string): number[] {
  const hash = text.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);

  const vector: number[] = [];
  for (let i = 0; i < 1536; i++) {
    vector.push((Math.sin(hash + i) + 1) / 2);
  }
  return vector;
}

export async function GET(request: NextRequest) {
  // Handle CORS preflight
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;
  
  return NextResponse.json({
    success: true,
    message: "Safe Melbourne Chat API - POST your questions here!",
    example: {
      message: "ada demo dimana?",
      context: {
        currentView: "jakarta",
        timeRange: "last_24h"
      }
    }
  }, { headers: getCorsHeaders() });
}

export async function POST(request: NextRequest) {
  // Handle CORS preflight
  const corsResponse = handleCors(request);
  if (corsResponse) return corsResponse;

  try {
    const body: ChatRequest = await request.json();
    const { message, context = {} } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Message is required' },
        { status: 400, headers: getCorsHeaders() }
      );
    }

    // Generate embedding for user query
    const queryEmbedding = generateSimpleEmbedding(message);

    // Fetch relevant events using vector search (RAG)
    const events = await getSimilarEvents(queryEmbedding);

    // Check if this is a hoax-related query
    const isHoaxQuery = detectHoaxQuery(message);
    let hoaxResults: HoaxResult[] | null = null;

    if (isHoaxQuery || context?.includeHoaxes) {
      hoaxResults = await searchRelevantHoaxes(message);
    }

    // Generate LLM response with retrieved context
    const response = await generateChatResponse(message, events, hoaxResults, context);

    return NextResponse.json({
      success: true,
      response
    }, { headers: getCorsHeaders() });

  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process chat request' },
      { status: 500, headers: getCorsHeaders() }
    );
  }
}

async function getSimilarEvents(queryEmbedding: number[]): Promise<EventData[]> {
  try {
    // For now, skip vector similarity search and use basic filtering
    // TODO: Re-enable when embedding column is added to events table
    const similarEvents: EventData[] = [];

    // Also get some recent events as fallback
    const recentEvents = await prisma.event.findMany({
      where: {
        type: {
          in: ['protest', 'demonstration']
        },
        createdAt: {
          gte: new Date(Date.now() - 6 * 60 * 60 * 1000) // 6 hours ago
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5,
      select: {
        id: true,
        title: true,
        description: true,
        lat: true,
        lng: true,
        type: true,
        extractedLocation: true,
        createdAt: true,
        verified: true,
        source: true,
        url: true
      }
    });

    // Get warning markers (demonstration alerts from Twitter)
    const warningMarkers = await prisma.warningMarker.findMany({
      where: {
        AND: [
          { extractedLocation: { not: null } },
          { lat: { not: null } },
          { lng: { not: null } },
          { confidenceScore: { gte: 0.3 } },
          { createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) } } // 6 hours ago
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        text: true,
        extractedLocation: true,
        lat: true,
        lng: true,
        confidenceScore: true,
        verified: true,
        createdAt: true,
        tweetId: true,
        userInfo: true,
        views: true,
        retweets: true
      }
    });

    // Transform warning markers to match EventData format
    const transformedWarnings = warningMarkers.map((marker) => ({
      id: marker.id,
      title: `⚠️ Demo Alert: ${marker.extractedLocation}`,
      description: marker.text.length > 200 ? marker.text.substring(0, 200) + '...' : marker.text,
      lat: marker.lat!,
      lng: marker.lng!,
      type: 'warning',
      extractedLocation: marker.extractedLocation,
      createdAt: marker.createdAt,
      verified: marker.verified,
      source: 'twitter',
      url: `https://twitter.com/i/status/${marker.tweetId}`,
      confidenceScore: marker.confidenceScore,
      views: marker.views,
      retweets: marker.retweets
    }));

    // Combine all results
    const allEvents = [...similarEvents, ...recentEvents, ...transformedWarnings];
    const seenIds = new Set();
    const uniqueEvents = allEvents.filter(event => {
      const uniqueKey = `${event.type}-${event.id}`;
      if (seenIds.has(uniqueKey)) return false;
      seenIds.add(uniqueKey);
      return true;
    });

    return uniqueEvents.slice(0, 25);
  } catch (error) {
    console.error('Error fetching similar events:', error);
    // Fallback to recent events if vector search fails
    return await getRecentEventsFallback();
  }
}


async function getRecentEventsFallback(): Promise<EventData[]> {
  try {
    // Get events from last 6 hours as fallback
    const events = await prisma.event.findMany({
      where: {
        type: {
          in: ['protest', 'demonstration']
        },
        createdAt: {
          gte: new Date(Date.now() - 6 * 60 * 60 * 1000) // 6 hours ago
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 15,
      select: {
        id: true,
        title: true,
        description: true,
        lat: true,
        lng: true,
        type: true,
        extractedLocation: true,
        createdAt: true,
        verified: true,
        source: true,
        url: true
      }
    });

    // Also get warning markers as fallback
    const warningMarkers = await prisma.warningMarker.findMany({
      where: {
        AND: [
          { extractedLocation: { not: null } },
          { lat: { not: null } },
          { lng: { not: null } },
          { confidenceScore: { gte: 0.3 } },
          { createdAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) } } // 6 hours ago
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        text: true,
        extractedLocation: true,
        lat: true,
        lng: true,
        confidenceScore: true,
        verified: true,
        createdAt: true,
        tweetId: true,
        userInfo: true,
        views: true,
        retweets: true
      }
    });

    // Transform warning markers to match EventData format
    const transformedWarnings = warningMarkers.map((marker) => ({
      id: marker.id,
      title: `⚠️ Demo Alert: ${marker.extractedLocation}`,
      description: marker.text.length > 200 ? marker.text.substring(0, 200) + '...' : marker.text,
      lat: marker.lat!,
      lng: marker.lng!,
      type: 'warning',
      extractedLocation: marker.extractedLocation,
      createdAt: marker.createdAt,
      verified: marker.verified,
      source: 'twitter',
      url: `https://twitter.com/i/status/${marker.tweetId}`,
      confidenceScore: marker.confidenceScore,
      views: marker.views,
      retweets: marker.retweets
    }));

    // Fix type compatibility
    const compatibleEvents = events.map(event => ({
      ...event,
      url: event.url || undefined
    }));
    return [...compatibleEvents, ...transformedWarnings];
  } catch (error) {
    console.error('Error fetching recent events fallback:', error);
    return [];
  }
}

async function generateChatResponse(message: string, events: EventData[], hoaxResults: HoaxResult[] | null, context: ChatContext) {
  try {
    // Format events data for LLM context
    const eventsContext = events.map(event => {
      const baseInfo = {
        location: event.extractedLocation || `${event.lat.toFixed(4)}, ${event.lng.toFixed(4)}`,
        type: event.type,
        title: event.title,
        description: event.description,
        time: formatTimeAgo(event.createdAt),
        verified: event.verified,
        source: event.source,
        url: event.url || 'Tidak tersedia'
      };

      // Add specific information for warning markers
      if (event.type === 'warning') {
        return {
          ...baseInfo,
          confidenceScore: `${Math.round((event.confidenceScore || 0) * 100)}%`,
          views: event.views || 0,
          retweets: event.retweets || 0,
          markdownLink: event.url ? `[Twitter](${event.url})` : 'Tidak ada link tersedia',
          alertType: 'Peringatan Demonstrasi'
        };
      } else {
        return {
          ...baseInfo,
          markdownLink: event.url ? `[TikTok](${event.url})` : 'Tidak ada link tersedia'
        };
      }
    });

    // Format hoax data for LLM context
    const hoaxContext = hoaxResults && hoaxResults.length > 0 ? hoaxResults.map((hoax, index) => ({
      id: hoax.id,
      title: hoax.title,
      originalClaim: hoax.originalClaim || 'N/A',
      category: hoax.hoaxCategory,
      verificationMethod: hoax.verificationMethod || 'N/A',
      investigationResult: hoax.investigationResult || 'N/A',
      author: hoax.authorName || 'TurnBackHoax',
      sourceUrl: hoax.sourceUrl,
      publicationDate: formatTimeAgo(hoax.publicationDate),
      similarity: hoax.similarity || 0.5
    })) : [];

    const systemPrompt = `You are a safety information assistant for Safe Melbourne.
Help users with questions about protests, unrest/incidents, and current safety situations.

LATEST INFORMATION FROM THE DATABASE (${events.length} items from the last 6 hours):
${JSON.stringify(eventsContext, null, 2)}

${hoaxResults && hoaxResults.length > 0 ? `
HOAX / FACT-CHECK INFORMATION FROM TURNBACKHOAX.ID (${hoaxResults.length} search results):
${JSON.stringify(hoaxContext, null, 2)}

HOAX CATEGORIES:
- SALAH: false/fabricated/misleading content
- PENIPUAN: scam/impostor content
` : ''}

AVAILABLE DATA TYPES:
1. WARNING MARKERS (type: "warning"): protest warnings from Twitter with a confidence score
2. EVENTS (type: "protest", "demonstration"): events from TikTok and other sources
${hoaxResults && hoaxResults.length > 0 ? '3. HOAX FACT-CHECKS: verifications from TurnBackHoax.ID' : ''}

PROTEST-QUESTION GUIDANCE:
- When asked “where are protests planned?” or similar, prioritize WARNING MARKERS
- Warning markers are usually the most accurate signal for planned demonstrations
- Include the confidence score for warning markers
- Mention views and retweets to show public attention/engagement
- Provide specific location information

HOAX-QUESTION GUIDANCE:
- When asked about hoaxes/misinformation or verification, use TurnBackHoax.ID data
- Include the hoax category (SALAH / PENIPUAN) and the verification method
- Explain investigation results clearly and simply
- ALWAYS include the link to the original TurnBackHoax.ID source
- If you don’t find a relevant hoax, say so honestly
- Emphasize the information comes from a trusted source (TurnBackHoax.ID)
- For hoaxes, include when it was published

GENERAL GUIDANCE:
- Respond in natural, easy-to-understand English
- Focus on location, time, and incident/event type
- Include verification status when relevant
- Provide a safety-useful summary
- If there’s no recent data, say so honestly
- Do not provide inaccurate or speculative information
- If the question is not related to safety, steer back to the main topic
- ALWAYS include links (Twitter/TikTok/TurnBackHoax) when available for each item

RESPONSE FORMAT:
- Use relevant emoji (📍 location, ⏰ time, ✅ verified, ⚠️ warning, 🔗 link)
- Group information by location when possible
- Provide clear time context (“2 hours ago”, “yesterday”, etc.)
- For warning markers: include confidence score and engagement metrics
- LINK FORMAT: use the existing markdownLink field provided in the data
- Example: 🔗 [Twitter](https://twitter.com/i/status/123) or [TikTok](https://tiktok.com/@user/video/123) or [TurnBackHoax.ID](https://turnbackhoax.id/...)
- The markdownLink field is already properly formatted for hyperlinks
- If no link exists, it will show "Tidak ada link tersedia"`;

    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "system",
          content: systemPrompt
        },
        {
          role: "user",
          content: message
        }
      ],
      max_completion_tokens: 1000,
    });
    console.log('LLM response:', response.choices[0]?.message);

    const llmResponse = response.choices[0]?.message?.content || "Maaf, saya tidak dapat memproses pertanyaan Anda saat ini.";

    return {
      text: llmResponse,
      eventsCount: events.length,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('LLM generation error:', error);
    return {
      text: "Maaf, terjadi kesalahan dalam memproses pertanyaan Anda. Silakan coba lagi.",
      eventsCount: events.length,
      timestamp: new Date().toISOString(),
      error: true
    };
  }
}

// Hoax detection functions
function detectHoaxQuery(message: string): boolean {
  const lowerMessage = message.toLowerCase();

  // Check for explicit hoax keywords
  const hasHoaxKeyword = HOAX_KEYWORDS.some(keyword =>
    lowerMessage.includes(keyword)
  );

  if (hasHoaxKeyword) {
    return true;
  }

  // Check for question patterns that might be about hoaxes
  const hoaxQuestionPatterns = [
    /apakah.*hoax/i,
    /benarkah/i,
    /klarifikasi/i,
    /bantah/i,
    /cek.*fakta/i,
    /verifikasi/i,
    /benar.*tidak/i,
    /palsu.*tidak/i
  ];

  return hoaxQuestionPatterns.some(pattern => pattern.test(lowerMessage));
}

async function searchRelevantHoaxes(message: string): Promise<HoaxResult[]> {
  try {
    // Generate embedding for the message
    const queryEmbedding = generateSimpleEmbedding(message);

    // Search for relevant hoaxes
    const hoaxResults = await hoaxProcessor.findSimilarHoaxes(queryEmbedding, 3);

    if (hoaxResults.length === 0) {
      // Fallback to keyword search
      const keywords = extractHoaxKeywords(message);
      if (keywords.length > 0) {
        return await hoaxProcessor.searchByKeywords(keywords, undefined, 3);
      }
    }

    return hoaxResults;

  } catch (error) {
    console.error('Error searching hoaxes:', error);
    return [];
  }
}

function extractHoaxKeywords(message: string): string[] {
  const lowerMessage = message.toLowerCase();

  // Extract potential keywords for hoax search
  const words = lowerMessage.split(/\s+/).filter(word =>
    word.length > 2 &&
    !['yang', 'dan', 'atau', 'dengan', 'di', 'ke', 'dari', 'pada', 'untuk', 'adalah'].includes(word)
  );

  // Prioritize hoax-related words and return top 5
  const prioritizedWords = words.filter(word =>
    HOAX_KEYWORDS.some(keyword => word.includes(keyword)) ||
    word.length > 4 // Longer words are more specific
  );

  return [...prioritizedWords, ...words.filter(word => !prioritizedWords.includes(word))].slice(0, 5);
}