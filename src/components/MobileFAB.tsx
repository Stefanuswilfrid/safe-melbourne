import React from 'react';

interface MobileFABProps {
  fabMenuOpen: boolean;
  setFabMenuOpen: (open: boolean) => void;
  loading: boolean;
  fetchEvents: () => void;
  initialMarkersRenderedRef: React.MutableRefObject<boolean>;
  mapStyle: string;
  mapboxStyles: Array<{ id: string; name: string; emoji: string; isCustom: boolean }>;
  changeMapStyle: (styleId: string) => void;
  eventFilter: 'all' | 'crime' | 'sex_offenders';
  setEventFilter: (filter: 'all' | 'crime' | 'sex_offenders') => void;
}

export const MobileFAB: React.FC<MobileFABProps> = ({
  fabMenuOpen,
  setFabMenuOpen,
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
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: 1000,
      fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: '12px'
    }}>
      {/* FAB Menu Items (show when expanded) */}
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '12px',
        overflow: 'hidden'
      }}>
        {/* Refresh FAB */}
        <button
          onClick={() => {
            fetchEvents();
            // Reset mobile render flag to force re-render
            initialMarkersRenderedRef.current = false;
            setFabMenuOpen(false);
          }}
          disabled={loading}
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '24px',
            backgroundColor: loading ? 'rgba(107, 114, 128, 0.9)' : 'rgba(0, 0, 0, 0.9)',
            border: 'none',
            color: '#ffffff',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: fabMenuOpen ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 0 0 rgba(0, 0, 0, 0)',
            transition: 'all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
            transitionDelay: fabMenuOpen ? '0.2s' : '0s',
            transform: fabMenuOpen ? 'translateX(0) scale(1)' : 'translateX(20px) scale(0.8)',
            opacity: fabMenuOpen ? 1 : 0,
            visibility: fabMenuOpen ? 'visible' : 'hidden'
          }}
          onMouseEnter={(e) => {
            if (!loading && fabMenuOpen) {
              e.currentTarget.style.transform = fabMenuOpen ? 'translateX(0) scale(1.1)' : 'translateX(20px) scale(0.8)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = fabMenuOpen ? 'translateX(0) scale(1)' : 'translateX(20px) scale(0.8)';
          }}
        >
          {loading ? '⏳' : '🔄'}
        </button>

        {/* Map Style FAB */}
        <button
          onClick={() => {
            // Cycle through map styles
            const currentIndex = mapboxStyles.findIndex(style => style.id === mapStyle);
            const nextIndex = (currentIndex + 1) % mapboxStyles.length;
            changeMapStyle(mapboxStyles[nextIndex].id);
            // Keep FAB menu open when style is changed
          }}
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '24px',
            backgroundColor: 'rgba(34, 197, 94, 0.9)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: fabMenuOpen ? '0 4px 12px rgba(34, 197, 94, 0.4)' : '0 0 0 rgba(34, 197, 94, 0)',
            transition: 'all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
            transitionDelay: fabMenuOpen ? '0.1s' : '0s',
            transform: fabMenuOpen ? 'translateX(0) scale(1)' : 'translateX(20px) scale(0.8)',
            opacity: fabMenuOpen ? 1 : 0,
            visibility: fabMenuOpen ? 'visible' : 'hidden'
          }}
          onMouseEnter={(e) => {
            if (fabMenuOpen) {
              e.currentTarget.style.transform = 'translateX(0) scale(1.1)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = fabMenuOpen ? 'translateX(0) scale(1)' : 'translateX(20px) scale(0.8)';
          }}
        >
          {(() => {
            const currentStyle = mapboxStyles.find(style => style.id === mapStyle);
            return currentStyle ? currentStyle.emoji : '🌙';
          })()}
        </button>

        {/* Filter Menu FAB */}
        <button
          onClick={() => {
            // Cycle through filters on mobile: protest -> road closure -> warning -> all -> protest...
            const filters = ['all', 'crime', 'sex_offenders'] as const;
            const currentIndex = filters.indexOf(eventFilter);
            const nextIndex = (currentIndex + 1) % filters.length;
            setEventFilter(filters[nextIndex]);
            // Keep FAB menu open when filter is clicked
          }}
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '24px',
            backgroundColor: 'rgba(59, 130, 246, 0.9)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: '18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: fabMenuOpen ? '0 4px 12px rgba(59, 130, 246, 0.4)' : '0 0 0 rgba(59, 130, 246, 0)',
            transition: 'all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
            transitionDelay: fabMenuOpen ? '0.15s' : '0s',
            transform: fabMenuOpen ? 'translateX(0) scale(1)' : 'translateX(20px) scale(0.8)',
            opacity: fabMenuOpen ? 1 : 0,
            visibility: fabMenuOpen ? 'visible' : 'hidden'
          }}
          onMouseEnter={(e) => {
            if (fabMenuOpen) {
              e.currentTarget.style.transform = fabMenuOpen ? 'translateX(0) scale(1.1)' : 'translateX(20px) scale(0.8)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = fabMenuOpen ? 'translateX(0) scale(1)' : 'translateX(20px) scale(0.8)';
          }}
        >
          {(() => {
            switch (eventFilter) {
              case 'crime': return '⚠️';
              case 'sex_offenders': return '🔞';
              default: return '📍';
            }
          })()}
        </button>
      </div>

      {/* Main FAB Button */}
      <button
        onClick={() => setFabMenuOpen(!fabMenuOpen)}
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '28px',
          backgroundColor: fabMenuOpen ? 'rgba(239, 68, 68, 0.95)' : 'rgba(59, 130, 246, 0.95)',
          border: 'none',
          color: '#ffffff',
          cursor: 'pointer',
          fontSize: '24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: fabMenuOpen ? 
            '0 8px 25px rgba(239, 68, 68, 0.4)' : 
            '0 6px 20px rgba(59, 130, 246, 0.4)',
          transition: 'all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          transform: fabMenuOpen ? 'rotate(135deg) scale(1.1)' : 'rotate(0deg) scale(1)'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = fabMenuOpen ? 
            'rotate(135deg) scale(1.2)' : 
            'rotate(0deg) scale(1.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = fabMenuOpen ? 
            'rotate(135deg) scale(1.1)' : 
            'rotate(0deg) scale(1)';
        }}
      >
        {fabMenuOpen ? '✕' : '+'}
      </button>
    </div>
  );
};
