import { NextRequest } from 'next/server';
import { classifyIncidentType } from '@/lib/incident-classification';
import { prisma } from '../../../../lib/prisma';
import '../../../../lib/pubsub';

// Use Node.js runtime since Prisma doesn't work in Edge runtime
export const runtime = 'nodejs';

function transformWarningMarker(marker: {
  id: number;
  tweetId: string;
  text: string;
  createdAt: Date;
  userInfo: unknown;
  extractedLocation: string | null;
  lat: number | null;
  lng: number | null;
  confidenceScore: number | null;
  verified: boolean;
  bookmarks?: number;
  favorites?: number;
  retweets?: number;
  views?: string;
  quotes?: number;
  replies?: number;
}) {
  const type = classifyIncidentType(marker.text);
  const label = type === 'sex_offender' ? 'Sex Offender' : 'Crime';

  return {
    id: marker.id,
    title: `${label}: ${marker.extractedLocation ?? 'Unknown location'}`,
    description: marker.text.length > 200 ? `${marker.text.substring(0, 200)}...` : marker.text,
    lat: marker.lat,
    lng: marker.lng,
    source: 'twitter',
    url: `https://twitter.com/${(marker.userInfo as Record<string, unknown>)?.screen_name}/status/${marker.tweetId}`,
    verified: marker.verified,
    type,
    createdAt: marker.createdAt.toISOString(),
    tweetId: marker.tweetId,
    extractedLocation: marker.extractedLocation,
    confidenceScore: marker.confidenceScore,
    socialMetrics: JSON.stringify({
      bookmarks: marker.bookmarks ?? 0,
      favorites: marker.favorites ?? 0,
      retweets: marker.retweets ?? 0,
      views: marker.views ?? '0',
      quotes: marker.quotes ?? 0,
      replies: marker.replies ?? 0,
    }),
    userInfo: JSON.stringify(marker.userInfo),
  };
}

export async function GET(request: NextRequest) {
  // Set up SSE headers
  const responseStream = new ReadableStream({
    start(controller) {
      let isConnected = true;

      // Send initial data
      const sendInitialData = async () => {
        try {
          const [events, warningMarkers] = await Promise.all([
            prisma.event.findMany({
              orderBy: { createdAt: 'desc' },
              take: 100
            }),
            prisma.warningMarker.findMany({
              where: { confidenceScore: { gte: 0.4 } },
              orderBy: { createdAt: 'desc' },
              take: 50
            })
          ]);

          const transformedWarnings = warningMarkers
            .filter((marker) => marker.lat !== null && marker.lng !== null)
            .map(transformWarningMarker);

          const data = `data: ${JSON.stringify({
            type: 'initial',
            events,
            warningMarkers: transformedWarnings,
            timestamp: Date.now()
          })}\n\n`;

          controller.enqueue(new TextEncoder().encode(data));
        } catch (error) {
          console.error('Error fetching initial data:', error);
        }
      };

      // Send heartbeat every 30 seconds
      const heartbeatInterval = setInterval(() => {
        if (!isConnected) return;

        try {
          const heartbeat = `data: ${JSON.stringify({
            type: 'heartbeat',
            timestamp: Date.now()
          })}\n\n`;
          controller.enqueue(new TextEncoder().encode(heartbeat));
        } catch (error) {
          console.error('Error sending heartbeat:', error);
        }
      }, 30000);

      // Subscribe to Redis Pub/Sub channels
      const subscribeToUpdates = async () => {
        try {
          // Use polling approach with Upstash Redis REST API
          const pollInterval = setInterval(async () => {
            if (!isConnected) {
              clearInterval(pollInterval);
              return;
            }

            try {
              // Poll for recent updates from database (fallback mechanism)
              const recentEvents = await prisma.event.findMany({
                where: {
                  createdAt: {
                    gte: new Date(Date.now() - 30000) // Events from last 30 seconds
                  }
                },
                orderBy: { createdAt: 'desc' }
              });

              const recentWarnings = await prisma.warningMarker.findMany({
                where: {
                  createdAt: {
                    gte: new Date(Date.now() - 30000)
                  },
                  confidenceScore: { gte: 0.4 }
                },
                orderBy: { createdAt: 'desc' }
              });

              const transformedWarnings = recentWarnings
                .filter((marker) => marker.lat !== null && marker.lng !== null)
                .map(transformWarningMarker);

              if (recentEvents.length > 0 || transformedWarnings.length > 0) {
                const data = `data: ${JSON.stringify({
                  type: 'update',
                  events: recentEvents,
                  warningMarkers: transformedWarnings,
                  timestamp: Date.now()
                })}\n\n`;

                controller.enqueue(new TextEncoder().encode(data));
              }
            } catch (error) {
              console.error('Error polling for updates:', error);
            }
          }, 5000); // Poll every 5 seconds

          // Clean up polling when connection closes
          request.signal.addEventListener('abort', () => {
            clearInterval(pollInterval);
          });

        } catch (error) {
          console.error('Error setting up Redis subscription:', error);
        }
      };

      // Initialize the stream
      const initializeStream = async () => {
        await sendInitialData();
        await subscribeToUpdates();
      };

      initializeStream();

      // Clean up when connection closes
      request.signal.addEventListener('abort', () => {
        isConnected = false;
        clearInterval(heartbeatInterval);
        controller.close();
      });
    }
  });

  return new Response(responseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'Access-Control-Allow-Methods': 'GET',
    },
  });
}
