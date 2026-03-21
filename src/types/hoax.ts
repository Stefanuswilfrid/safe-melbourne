
export interface HoaxFactCheck {
  guid: string;
  title: string;
  originalClaim: string;
  category: 'SALAH' | 'PENIPUAN';
  verificationMethod: string;
  investigationResult: string;
  author: string;
  sourceUrl: string;
  publicationDate: Date;
  content: string;
  contentHash: string;
}

export interface RSSItem {
  guid?: string | { '#text': string };
  title?: string | { '#text': string };
  description?: string | { '#text': string };
  link?: string | { '#text': string };
  pubDate?: string;
  'dc:creator'?: string;
}
export interface ProcessingResult {
  success: boolean;
  hoaxId?: string | number;
  error?: string;
  embeddingGenerated: boolean;
}