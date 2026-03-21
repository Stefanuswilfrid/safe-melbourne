import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

export const useMap = (containerRef: React.RefObject<HTMLDivElement | null>) => {
  const map = useRef<mapboxgl.Map | null>(null);
  const mapLoadedRef = useRef<boolean>(false);
  const [mapStyle, setMapStyle] = useState<string>('dark-v11');

  // Available Mapbox styles
  const mapboxStyles = [
    { id: 'dark-v11', name: '🌕 Dark', emoji: '🌕', isCustom: false },
    { id: 'edwardtanoto12/cmf13yyv601kp01pj9fkbgd1g', name: '🌃 Night City', emoji: '🌃', isCustom: true },
  ];

  // Function to change map style
  const changeMapStyle = (styleId: string) => {
    if (map.current && styleId !== mapStyle) {
      setMapStyle(styleId);
      
      // Check if it's a custom style or standard Mapbox style
      const style = mapboxStyles.find(s => s.id === styleId);
      const styleUrl = style?.isCustom 
        ? `mapbox://styles/${styleId}` 
        : `mapbox://styles/mapbox/${styleId}`;
      
      map.current.setStyle(styleUrl);
    }
  };

  // Initialize map
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

    if (!token) {
      console.error('NEXT_PUBLIC_MAPBOX_TOKEN is not set. Please add it to your .env.local file.');
      return;
    }

    if (!containerRef.current) {
      console.error('Map container ref is not available');
      return;
    }

    mapboxgl.accessToken = token;

    // Get the initial style URL based on whether it's custom or standard
    const initialStyle = mapboxStyles.find(s => s.id === mapStyle);
    const initialStyleUrl = initialStyle?.isCustom 
      ? `mapbox://styles/${mapStyle}` 
      : `mapbox://styles/mapbox/${mapStyle}`;

    map.current = new mapboxgl.Map({
      container: containerRef.current,
      style: initialStyleUrl,
      center: [144.8, -37.8136], // Center on Melbourne (shifted slightly west)
      zoom: 8,
      attributionControl: false
    });

    map.current.on('load', () => {
      console.log('🗺️ Map loaded, waiting for events data...');
      mapLoadedRef.current = true;
    });

    return () => {
      if (map.current) {
        map.current.remove();
      }
    };
  }, []);

  return {
    map,
    mapLoadedRef,
    mapStyle,
    mapboxStyles,
    changeMapStyle
  };
};
