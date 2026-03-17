import { useEffect, useState } from "react";
import { Event } from "../types/event";

export const useRealTimeUpdates = (setEvents: React.Dispatch<React.SetStateAction<Event[]>>) => {
  const [scrapingStatus, setScrapingStatus] = useState<'idle' | 'scraping' | 'completed' | 'error'>('idle');

  // Function to check scraping status periodically
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const response = await fetch('/api/scrape/status');
        if (response.ok) {
          const data: any = await response.json();
          setScrapingStatus(data.status || 'idle');
        }
      } catch (error) {
        // API might not exist yet, keep default status
        console.log('Status API not available yet');
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, []);

  // Set up EventSource for real-time updates
  useEffect(() => {
    let eventSource: EventSource | null = null;

    const setupEventSource = () => {
      try {
        console.log('🔌 Connecting to live event stream...');
        eventSource = new EventSource('/api/events/stream');

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            switch (data.type) {
              case 'initial':
                console.log('📡 Received initial data:', data.events?.length || 0, 'events');
                // Initial data is already loaded via fetchEvents()
                break;

              case 'update':
                if (data.events?.length > 0 || data.warningMarkers?.length > 0) {
                  console.log('🔄 Live update received:', data.events?.length || 0, 'events,', data.warningMarkers?.length || 0, 'warnings');

                  // Merge new data with existing events
                  setEvents(prevEvents => {
                    const newEvents = [...prevEvents];

                    // Add new events
                    if (data.events) {
                      data.events.forEach((newEvent: Event) => {
                        const existingIndex = newEvents.findIndex(e => e.id === newEvent.id);
                        if (existingIndex >= 0) {
                          // Update existing event
                          newEvents[existingIndex] = { ...newEvent, type: newEvent.type || 'protest' };
                        } else {
                          // Add new event
                          newEvents.unshift({ ...newEvent, type: newEvent.type || 'protest' });
                        }
                      });
                    }

                    // Add new warning markers
                    if (data.warningMarkers) {
                      data.warningMarkers.forEach((newWarning: Event) => {
                        const normalizedType = newWarning.type || 'warning';
                        const existingIndex = newEvents.findIndex(
                          e => e.id === newWarning.id && e.source?.toLowerCase() === 'twitter'
                        );
                        if (existingIndex >= 0) {
                          // Update existing warning
                          newEvents[existingIndex] = { ...newWarning, type: normalizedType };
                        } else {
                          // Add new warning
                          newEvents.unshift({ ...newWarning, type: normalizedType });
                        }
                      });
                    }

                    // Keep only the most recent 200 events to prevent memory issues
                    return newEvents.slice(0, 200);
                  });

                  // Show notification for new updates
                  if (data.events?.length > 0 || data.warningMarkers?.length > 0) {
                    console.log('✅ Live update applied to map');
                  }
                }
                break;

              case 'heartbeat':
                // Heartbeat received, connection is alive
                break;

              default:
                console.log('📡 Unknown message type:', data.type);
            }
          } catch (error) {
            console.error('❌ Error parsing live update:', error);
          }
        };

        eventSource.onerror = (error) => {
          console.error('❌ EventSource error:', error);
          // Attempt to reconnect after a delay
          setTimeout(() => {
            if (eventSource) {
              eventSource.close();
              setupEventSource();
            }
          }, 5000);
        };

        eventSource.onopen = () => {
          console.log('✅ Connected to live event stream');
        };

      } catch (error) {
        console.error('❌ Failed to setup EventSource:', error);
      }
    };

    setupEventSource();

    return () => {
      if (eventSource) {
        console.log('🔌 Disconnecting from live event stream');
        eventSource.close();
      }
    };
  }, [setEvents]);

  return {
    scrapingStatus
  };
};
