import { Event } from "../types/event";

// Function to create GeoJSON from events
export const createEventGeoJSON = (events: Event[]) => {
  return {
    type: 'FeatureCollection' as const,
    features: events.map(event => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [event.lng, event.lat] // [lng, lat]
      },
      properties: {
        id: event.id,
        title: event.title,
        description: event.description,
        source: event.source,
        url: event.url,
        verified: event.verified,
        type: event.type,
        originalCreatedAt: event.originalCreatedAt,
        createdAt: event.createdAt,
        severity: event.severity,
        closureType: event.closureType,
        reason: event.reason,
        affectedRoutes: event.affectedRoutes,
        alternativeRoutes: event.alternativeRoutes,
        emoji: event.type === 'sex_offender' ? '🔞' : event.type === 'crime' ? '⚠️' : '📍',
        // Warning-specific properties
        tweetId: event.tweetId,
        extractedLocation: event.extractedLocation,
        confidenceScore: event.confidenceScore,
        socialMetrics: event.socialMetrics,
        userInfo: event.userInfo
      }
    }))
  };
};

// Function to get status color
export const getStatusColor = (status: 'idle' | 'scraping' | 'completed' | 'error') => {
  switch (status) {
    case 'scraping': return '#3b82f6'; // Blue
    case 'completed': return '#10b981'; // Green
    case 'error': return '#ef4444'; // Red
    default: return '#6b7280'; // Gray
  }
};

// Function to get status text
export const getStatusText = (status: 'idle' | 'scraping' | 'completed' | 'error') => {
  switch (status) {
    case 'scraping': return 'Scraping...';
    case 'completed': return 'Updated';
    case 'error': return 'Error';
    default: return 'Idle';
  }
};

// Function to calculate next update time
export const calculateNextUpdateTime = () => {
  const now = new Date();
  const currentHour = now.getHours();

  // Peak hours: 12-23, 0-1 (13 hours total)
  // Conserve hours: 2-11 (10 hours total)
  let nextUpdate: Date;

  if ((currentHour >= 12 && currentHour <= 23) || currentHour <= 1) {
    // Peak hours - next update in 1 hour
    nextUpdate = new Date(now.getTime() + 60 * 60 * 1000);
  } else {
    // Conserve hours - next update in 2 hours
    nextUpdate = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  }

  // Round to next hour mark
  nextUpdate.setMinutes(0, 0, 0);

  return nextUpdate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};
