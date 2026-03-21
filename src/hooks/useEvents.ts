import { useState, useRef } from "react";
import { Event } from "../types/event";

export const useEvents = () => {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeFilter, setTimeFilter] = useState<number>(0); // Default to All time
  const [eventFilter, setEventFilter] = useState<'all' | 'crime' | 'sex_offenders'>('all');
  const eventsLoadedRef = useRef<boolean>(false);

  // Function to fetch events from database
  const fetchEvents = async (customTimeFilter?: number) => {
    try {
      setLoading(true);
      setError(null);

      // Use the passed timeFilter or fall back to state
      const activeTimeFilter = customTimeFilter !== undefined ? customTimeFilter : timeFilter;
      
      // Fetch regular events (all types), road closures, and warning markers with time filter
      const timeParam = activeTimeFilter > 0 ? `&hours=${activeTimeFilter}` : '';
      const [eventsResponse, roadClosuresResponse, warningMarkersResponse] = await Promise.all([
        fetch(`/api/events?${timeParam.startsWith('&') ? timeParam.slice(1) : timeParam}`),
        // For road closures: if activeTimeFilter is 0 (All), don't send hours param, otherwise send the activeTimeFilter value
        fetch(`/api/road-closures${activeTimeFilter > 0 ? `?hours=${activeTimeFilter}` : ''}`),
        // Fetch warning markers with minimum confidence threshold
        fetch(`/api/warning-markers?${activeTimeFilter > 0 ? `hours=${activeTimeFilter}&` : ''}minConfidence=0.4&limit=50`)
      ]);

      if (!eventsResponse.ok) {
        throw new Error('Failed to fetch events');
      }

      const eventsData = await eventsResponse.json() as { success: boolean; events: Event[]; error?: string };
      const roadClosuresData = await roadClosuresResponse.json() as { success: boolean; roadClosures: Event[]; error?: string };
      
      // Handle warning markers with fallback
      let warningMarkersData: { success: boolean; warnings: Event[]; error?: string } = { success: true, warnings: [] };
      try {
        if (warningMarkersResponse.ok) {
          warningMarkersData = await warningMarkersResponse.json() as { success: boolean; warnings: Event[]; error?: string };
        } else {
          console.warn('⚠️ Warning markers API failed, continuing without warning markers');
        }
      } catch (error) {
        console.warn('⚠️ Failed to parse warning markers response, continuing without warning markers:', error);
      }

      if (eventsData.success && roadClosuresData.success) {
        // Combine events, road closures, and warning markers (if available)
        const allEvents = [
          ...eventsData.events,
          ...roadClosuresData.roadClosures.map(rc => ({ ...rc, type: 'road_closure' as const })),
          ...(warningMarkersData.success ? warningMarkersData.warnings : [])
        ];

        setEvents(allEvents);
        eventsLoadedRef.current = true; // Mark events as loaded
        const warningCount = warningMarkersData.success ? warningMarkersData.warnings.length : 0;
        console.log(`📍 Loaded ${eventsData.events.length} events, ${roadClosuresData.roadClosures.length} road closures, and ${warningCount} warning markers from database`);
      } else {
        throw new Error(eventsData.error || roadClosuresData.error || 'Failed to fetch data');
      }
    } catch (error) {
      console.error('❌ Error fetching events:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // Function to handle time filter changes
  const handleTimeFilterChange = (hours: number) => {
    setTimeFilter(hours);
    // Immediately fetch events with new time filter, passing the new value directly
    fetchEvents(hours);
  };

  return {
    events,
    setEvents,
    loading,
    error,
    timeFilter,
    eventFilter,
    setEventFilter,
    eventsLoadedRef,
    fetchEvents,
    handleTimeFilterChange
  };
};
