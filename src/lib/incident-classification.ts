export type IncidentType = 'protest' | 'warning' | 'road_closure';

const PROTEST_PATTERNS = [
  /\bprotest(?:s|ing)?\b/i,
  /\brally\b/i,
  /\bmarch\b/i,
  /\bdemonstration\b/i,
  /\bactivis(?:m|ts?)\b/i,
  /\bpicket\b/i,
  /\bstrike\b/i,
  /\bsit-?in\b/i,
  /\bgather(?:ing)?\b/i,
  /\bassembly\b/i,
  /\bchant(?:ing)?\b/i,
  /\bparliament steps\b/i,
  /#protest\b/i,
  /#rally\b/i,
];

const ROAD_CLOSURE_PATTERNS = [
  /\broad closed\b/i,
  /\broad closure\b/i,
  /\blane closed\b/i,
  /\blane closure\b/i,
  /\bstreet closed\b/i,
  /\btraffic diversion\b/i,
  /\bdetour\b/i,
  /\bavoid the area\b/i,
  /\bblocked off\b/i,
  /\bclosure in place\b/i,
];

export function classifyIncidentType(text: string): IncidentType {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return 'warning';
  }

  if (ROAD_CLOSURE_PATTERNS.some((pattern) => pattern.test(normalizedText))) {
    return 'road_closure';
  }

  if (PROTEST_PATTERNS.some((pattern) => pattern.test(normalizedText))) {
    return 'protest';
  }

  return 'warning';
}
