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
      message: "What incidents are happening in Melbourne?",
      context: {
        currentView: "melbourne",
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
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // last 7 days
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
          { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } // last 7 days
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
      title: `⚠️ Alert: ${marker.extractedLocation}`,
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
    // Get recent events as fallback
    const events = await prisma.event.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // last 7 days
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
          { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } // last 7 days
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
      title: `⚠️ Alert: ${marker.extractedLocation}`,
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
        url: event.url || 'Not available'
      };

      // Add specific information for warning markers
      if (event.type === 'warning') {
        return {
          ...baseInfo,
          confidenceScore: `${Math.round((event.confidenceScore || 0) * 100)}%`,
          views: event.views || 0,
          retweets: event.retweets || 0,
          markdownLink: event.url ? `[Twitter](${event.url})` : null,
          alertType: 'Safety Alert'
        };
      } else {
        return {
          ...baseInfo,
          markdownLink: event.url ? `[TikTok](${event.url})` : null
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
Help users with questions about protests, incidents, road closures, and current safety situations in Melbourne, Australia.

LATEST INFORMATION FROM THE DATABASE (${events.length} recent items):
${JSON.stringify(eventsContext, null, 2)}

AVAILABLE DATA TYPES:
1. WARNING (type: "warning"): safety incidents sourced from Twitter/X or TikTok (stabbings, crashes, fights, protests, etc.)
2. ROAD CLOSURE (type: "road_closure"): road or traffic incidents

INCIDENT GUIDANCE:
- When asked about incidents or what is happening, summarise all recent events by location
- For Twitter warning markers, include confidence score and engagement (views/retweets)
- Always mention the source (TikTok, Twitter, Discord) and how long ago it was reported
- Provide specific Melbourne suburb or street names when available

GENERAL GUIDANCE:
- Always respond in clear, natural English
- Focus on location, time, and incident type
- Include verification status when relevant
- If there is no recent data, say so honestly
- Do not speculate or fabricate information
- If the question is unrelated to Melbourne safety, politely redirect

RESPONSE FORMAT:
- Use relevant emoji for location, time, verified, warning, and links
- Group by location when listing multiple incidents
- Use clear time context such as "2 hours ago" or "yesterday"
- Include links using the markdownLink field already provided in the data
- If no link is available, omit the link line entirely`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
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
      max_tokens: 1000,
    });
    console.log('LLM response:', response.choices[0]?.message);

    const llmResponse = response.choices[0]?.message?.content || "Sorry, I was unable to process your question.";

    return {
      text: llmResponse,
      eventsCount: events.length,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('LLM generation error:', error);
    return {
      text: "Sorry, an error occurred. Please try again.",
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