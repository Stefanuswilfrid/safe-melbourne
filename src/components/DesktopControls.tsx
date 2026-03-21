import React from 'react';

interface DesktopControlsProps {
  loading: boolean;
  fetchEvents: () => void;
  initialMarkersRenderedRef: React.MutableRefObject<boolean>;
  mapStyle: string;
  mapboxStyles: Array<{ id: string; name: string; emoji: string; isCustom: boolean }>;
  changeMapStyle: (styleId: string) => void;
  eventFilter: 'all' | 'crime' | 'sex_offenders';
  setEventFilter: (filter: 'all' | 'crime' | 'sex_offenders') => void;
}

export const DesktopControls: React.FC<DesktopControlsProps> = ({
  loading,
  fetchEvents,
  initialMarkersRenderedRef,
  mapStyle,
  mapboxStyles,
  changeMapStyle,
  eventFilter,
  setEventFilter
}) => {
  return (
    <div style={{
      position: 'absolute',
      bottom: '30px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 1000,
      fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex',
      gap: '12px',
      alignItems: 'center'
    }}>
      {/* Refresh Button */}
      <button
        onClick={() => {
          fetchEvents();
          // Reset mobile render flag to force re-render
          initialMarkersRenderedRef.current = false;
        }}
        disabled={loading}
        style={{
          backgroundColor: loading ? 'rgba(107, 114, 128, 0.8)' : 'rgba(0, 0, 0, 0.85)',
          backdropFilter: 'blur(10px)',
          color: '#ffffff',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: '16px',
          padding: '12px 20px',
          fontSize: '14px',
          fontWeight: '500',
          cursor: loading ? 'not-allowed' : 'pointer',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          transition: 'all 0.3s ease',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          minWidth: '120px',
          justifyContent: 'center'
        }}
        onMouseEnter={(e) => {
          if (!loading) {
            e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.95)';
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 6px 25px rgba(0, 0, 0, 0.4)';
          }
        }}
        onMouseLeave={(e) => {
          if (!loading) {
            e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)';
          }
        }}
      >
        {loading ? (
          <>
            <div style={{
              width: '14px',
              height: '14px',
              border: '2px solid #ffffff',
              borderTop: '2px solid transparent',
              borderRadius: '14px',
              animation: 'spin 1s linear infinite'
            }} />
            Loading...
          </>
        ) : (
          <>
            <span style={{ fontSize: '14px' }}>🔄</span>
            Refresh
          </>
        )}
      </button>

      {/* Map Style Selector Button */}
      <button
        onClick={() => {
          // Cycle through map styles
          const currentIndex = mapboxStyles.findIndex(style => style.id === mapStyle);
          const nextIndex = (currentIndex + 1) % mapboxStyles.length;
          changeMapStyle(mapboxStyles[nextIndex].id);
        }}
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          backdropFilter: 'blur(10px)',
          color: '#ffffff',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: '16px',
          padding: '12px 16px',
          fontSize: '14px',
          fontWeight: '500',
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          transition: 'all 0.3s ease',
          minWidth: '140px',
          outline: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.95)';
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 6px 25px rgba(0, 0, 0, 0.4)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)';
        }}
      >
        {(() => {
          const currentStyle = mapboxStyles.find(style => style.id === mapStyle);
          return currentStyle ? `${currentStyle.emoji} ${currentStyle.name.split(' ').slice(1).join(' ')}` : '🌙 Dark';
        })()}
      </button>

      {/* Event Filter Toggle Button */}
      <button
        onClick={() => {
          const filters = ['all', 'crime', 'sex_offenders'] as const;
          const currentIndex = filters.indexOf(eventFilter);
          const nextIndex = (currentIndex + 1) % filters.length;
          setEventFilter(filters[nextIndex]);
        }}
        style={{
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          backdropFilter: 'blur(10px)',
          color: '#ffffff',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: '16px',
          padding: '12px 16px',
          fontSize: '14px',
          fontWeight: '500',
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          transition: 'all 0.3s ease',
          minWidth: '160px',
          outline: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '6px'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.95)';
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 6px 25px rgba(0, 0, 0, 0.4)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0, 0, 0, 0.85)';
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)';
        }}
      >
        {(() => {
          switch (eventFilter) {
            case 'crime': return <>⚠️ Crime</>;
            case 'sex_offenders': return <>🔞 Sex Offenders</>;
            case 'all':
            default: return <>📍 All Events</>;
          }
        })()}
      </button>
    </div>
  );
};
