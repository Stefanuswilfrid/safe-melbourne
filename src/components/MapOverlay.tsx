import React from 'react';
import { Event } from '../types/event';
import { getStatusColor, getStatusText } from '../utils/mapUtils';

interface MapOverlayProps {
  isMobile: boolean;
  loading: boolean;
  error: string | null;
  events: Event[];
  eventFilter: 'all' | 'crime' | 'sex_offenders';
  scrapingStatus: 'idle' | 'scraping' | 'completed' | 'error';
  renderingMarkers: boolean;
  nextUpdateTime: string;
  timeFilter: number;
  handleTimeFilterChange: (hours: number) => void;
}

export const MapOverlay: React.FC<MapOverlayProps> = ({
  isMobile,
  loading,
  error,
  events,
  eventFilter,
  scrapingStatus,
  renderingMarkers,
  nextUpdateTime,
  timeFilter,
  handleTimeFilterChange
}) => {
  return (
    <div style={{
      position: 'absolute',
      top: '20px',
      left: '20px',
      zIndex: 1000,
      fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      pointerEvents: 'none'
    }}>
      {/* Unified Box */}
      <div style={{
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(10px)',
        padding: isMobile ? '12px' : '20px',
        textAlign: 'left',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        minWidth: isMobile ? '160px' : '200px'
      }}>
        {!isMobile && (
          <>
            {/* Main Title - Desktop Only */}
            <h1 style={{
              margin: '0 0 16px 0',
              fontSize: '24px',
              fontWeight: '600',
              color: '#ffffff',
              textShadow: '0 2px 4px rgba(0, 0, 0, 0.5)',
              textAlign: 'left'
            }}>
              Safe Melbourne
              <span style={{
                  fontSize: '11px',
                  color: '#9ca3af'
                }}>
                </span>
            </h1>
          </>
        )}
        
        {/* Events Count */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: isMobile ? '0' : '8px',
          borderTop: isMobile ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
          marginBottom: isMobile ? '10px' : '8px'
        }}>
          <div style={{ textAlign: 'left' }}>
            <div style={{
              fontSize: isMobile ? '12px' : '13px',
              fontWeight: '500',
              color: '#ffffff',
              marginBottom: '2px'
            }}>
              📍 Events: {loading ? '...' : (() => {
              let count = 0;
              let label = '';
              switch (eventFilter) {
                case 'crime':
                  count = events.filter(e => e.type === 'crime').length;
                  label = 'crimes';
                  break;
                case 'sex_offenders':
                  count = events.filter(e => e.type === 'sex_offender').length;
                  label = 'sex offenders';
                  break;
                case 'all':
                default:
                  count = events.length;
                  label = 'total events';
                  break;
              }
              return `${count} ${label}`;
            })()}
            </div>
             {/* Status Information */}
             <div style={{
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '6px'
                }}>
                  <div style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    backgroundColor: getStatusColor(scrapingStatus),
                    boxShadow: `0 0 10px ${getStatusColor(scrapingStatus)}`,
                    animation: scrapingStatus === 'scraping' ? 'pulse 2s infinite' : 'none'
                  }} />
                  <span style={{
                    fontSize: '12px',
                    fontWeight: '500',
                    color: '#ffffff'
                  }}>
                    {getStatusText(scrapingStatus)} - Updates every 24 hour
                  </span>
                </div>
                <div style={{
                  fontSize: '10px',
                  color: '#9ca3af',
                  lineHeight: '1.3'
                }}>
                </div>
              </div>
            {!isMobile && (
              <div style={{
                fontSize: '11px',
                color: '#9ca3af'
              }}>
                {loading ? 'Loading events...' : error ? '❌ Error loading events' : renderingMarkers && isMobile ? '📱 Rendering markers...' : <div>Next update: {nextUpdateTime}</div>}
              </div>
            )}
          </div>
        </div>

        {/* Time Filter */}
        <div style={{
          paddingTop: isMobile ? '0' : '8px',
          borderTop: isMobile ? 'none' : '1px solid rgba(255, 255, 255, 0.1)',
          marginBottom: isMobile ? '0' : '8px',
          pointerEvents: 'auto'
        }}>
          <div style={{
            fontSize: isMobile ? '11px' : '12px',
            fontWeight: '500',
            color: '#ffffff',
            marginBottom: isMobile ? '4px' : '6px'
          }}>
            Time Filter
          </div>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: isMobile ? '3px' : '4px',
            fontSize: '11px'
          }}>
            {[3, 6, 12, 24, 0].map((hours) => (
              <button
                key={hours}
                onClick={() => handleTimeFilterChange(hours)}
                style={{
                  padding: isMobile ? '3px 6px' : '4px 8px',
                  borderRadius: '4px',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  backgroundColor: timeFilter === hours ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                  color: '#ffffff',
                  cursor: 'pointer',
                  fontSize: isMobile ? '9px' : '10px',
                  fontWeight: '500',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = timeFilter === hours ? 'rgba(255, 255, 255, 0.1)' : 'transparent';
                }}
              >
                {hours === 0 ? 'All' : `${hours}h`}
              </button>
            ))}
          </div>
          <div style={{
            fontSize: isMobile ? '9px' : '10px',
            color: '#9ca3af',
            marginTop: isMobile ? '3px' : '4px'
          }}>
            Showing events from last {timeFilter === 0 ? 'all time' : `${timeFilter} hours`}
          </div>
        </div>

        {!isMobile && (
          <>
            {/* Legend - Desktop Only */}
            <div style={{
              paddingTop: '8px',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              marginBottom: '8px'
            }}>
              <div style={{
                fontSize: '12px',
                fontWeight: '500',
                color: '#ffffff',
                marginBottom: '6px'
              }}>
                Legend
              </div>
              {/* Desktop legend (horizontal row) */}
              <div style={{
                display: 'flex',
                flexDirection: 'row',
                gap: '16px',
                fontSize: '12px',
                color: '#6b7280',
                padding: '8px 0'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ 
                    width: '14px', 
                    height: '14px', 
                    borderRadius: '50%', 
                    backgroundColor: '#FFD700',
                    border: '2px solid #FF4500',
                    boxShadow: '0 1px 3px rgba(255, 215, 0, 0.4)'
                  }}></div>
                  <span style={{ fontWeight: '500' }}>Crime / Incident</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ 
                    width: '14px', 
                    height: '14px', 
                    borderRadius: '50%', 
                    backgroundColor: '#9333ea',
                    border: '2px solid #6b21a8',
                    boxShadow: '0 1px 3px rgba(147, 51, 234, 0.4)'
                  }}></div>
                  <span style={{ fontWeight: '500' }}>Sex Offender</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
