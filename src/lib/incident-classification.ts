export type IncidentType = 'crime' | 'sex_offender';

const SEX_OFFENDER_PATTERNS = [
  /\bsex(?:ual)?\s+(?:assault|offend(?:er|ing)|abuse|harassment|predator|grooming)\b/i,
  /\bsexually\s+(?:assault|abuse|harass)/i,
  /\brape(?:d|s|r)?\b/i,
  /\bpaedophile\b/i,
  /\bpedophile\b/i,
  /\bindecent\s+(?:exposure|act|assault)\b/i,
  /\bsex\s+pest\b/i,
  /\bchild\s+(?:abuse|exploitation|sex)\b/i,
  /\bgrooming\b/i,
  /#sexoffend/i,
  /#rape\b/i,
  /\bpervert\b/i,
  /\bupskirt\b/i,
  /\bvoyeur/i,
];

export function classifyIncidentType(text: string): IncidentType {
  const normalizedText = text.trim();

  if (normalizedText && SEX_OFFENDER_PATTERNS.some((pattern) => pattern.test(normalizedText))) {
    return 'sex_offender';
  }

  return 'crime';
}
