import OpenAI from 'openai';
import type { TwitterTimeline } from '@/types/twitter';

export interface LocationResult {
  success: boolean;
  location?: string;
  confidence?: number;
  error?: string;
}

export interface DetailedLocationResult {
  success: boolean;
  exact_location?: string;
  all_locations?: string[];
  confidence?: number;
  error?: string;
}

export async function extractLocationFromArticle(title: string, content: string): Promise<LocationResult> {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return {
        success: false,
        error: 'OpenAI API key not configured'
      };
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const prompt = `Extract the specific location mentioned in this Melbourne/Victoria (Australia) protest news/video. Focus on finding the exact place where the protest is happening.

Title: ${title}
Content: ${content}

Return ONLY the location name (in English), without any additional text. If no specific location is mentioned, return "unknown".

Examples:
- "Protest outside Parliament House in Melbourne" -> "Parliament House Victoria, Melbourne"
- "Demonstration at Federation Square this afternoon" -> "Federation Square, Melbourne"
- "March near Flinders Street Station" -> "Flinders Street Station, Melbourne"
- "Rally in Melbourne CBD on Swanston Street" -> "Swanston St, Melbourne CBD"`;

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_LOCATION_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 100,
      temperature: 0.1
    });

    const extractedLocation = completion.choices[0]?.message?.content?.trim();

    if (!extractedLocation || extractedLocation === 'unknown') {
      return {
        success: false,
        error: 'No location found in text'
      };
    }

    // Remove quotes if present
    const cleanLocation = extractedLocation.replace(/^["']|["']$/g, '');

    return {
      success: true,
      location: cleanLocation,
      confidence: 0.8 // Default confidence for extraction
    };

  } catch (error) {
    console.error('Location extraction error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown extraction error'
    };
  }
}

// Location validation function to prevent obviously wrong mappings
function validateIndonesianLocation(extractedLocation: string): {isValid: boolean, correctedLocation?: string, reason?: string} {
  const location = extractedLocation.toLowerCase();

  // Jakarta bias detection - if location mentions Jakarta but extracted location is wrong
  if (location.includes('ntb') || location.includes('nusa tenggara barat') ||
      location.includes('mataram') || location.includes('lombok') || location.includes('sumbawa')) {
    // If the extracted location contains Jakarta-related terms but should be NTB
    if (location.includes('kebayoran') || location.includes('jakarta') ||
        location.includes('monas') || location.includes('bundaran hi')) {
      return {
        isValid: false,
        correctedLocation: 'DPRD NTB, Mataram, Nusa Tenggara Barat',
        reason: 'NTB location incorrectly mapped to Jakarta - correcting to Mataram, NTB'
      };
    }
  }

  // Bali validation
  if (location.includes('bali') || location.includes('denpasar')) {
    if (location.includes('jakarta') && !location.includes('denpasar')) {
      return {
        isValid: false,
        correctedLocation: 'DPRD Bali, Denpasar, Bali',
        reason: 'Bali location incorrectly mapped to Jakarta - correcting to Denpasar, Bali'
      };
    }
  }

  // Jawa Barat validation
  if (location.includes('jabar') || location.includes('jawa barat') ||
      location.includes('bandung') || location.includes('bogor')) {
    if (location.includes('jakarta') && !location.includes('bandung')) {
      return {
        isValid: false,
        correctedLocation: 'DPRD Jawa Barat, Bandung, Jawa Barat',
        reason: 'West Java location incorrectly mapped to Jakarta - correcting to Bandung, Jawa Barat'
      };
    }
  }

  // Geographic validation - prevent cross-island errors
  const jakartaTerms = ['jakarta', 'kebayoran', 'monas', 'bundaran hi', 'sudirman', 'thamrin'];
  const ntbTerms = ['ntb', 'nusa tenggara barat', 'mataram', 'lombok', 'sumbawa'];
  const baliTerms = ['bali', 'denpasar', 'buleleng', 'tabanan'];
  const sumateraTerms = ['sumatera', 'medan', 'padang', 'pekanbaru', 'palembang', 'batam', 'tanjung pinang'];
  const kalimantanTerms = ['kalimantan', 'pontianak', 'palangka raya', 'banjarmasin', 'samarinda', 'tanjung selor'];
  const sulawesiTerms = ['sulawesi', 'manado', 'palu', 'makassar', 'kendari', 'gorontalo', 'mamuju'];
  const malukuTerms = ['maluku', 'ambon', 'sofifi'];
  const papuaTerms = ['papua', 'jayapura', 'manokwari', 'nabire', 'jayawijaya', 'merauke', 'sorong'];

  const hasJakartaTerms = jakartaTerms.some(term => location.includes(term));
  const hasNtbTerms = ntbTerms.some(term => location.includes(term));
  const hasBaliTerms = baliTerms.some(term => location.includes(term));
  const hasSumateraTerms = sumateraTerms.some(term => location.includes(term));
  const hasKalimantanTerms = kalimantanTerms.some(term => location.includes(term));
  const hasSulawesiTerms = sulawesiTerms.some(term => location.includes(term));
  const hasMalukuTerms = malukuTerms.some(term => location.includes(term));
  const hasPapuaTerms = papuaTerms.some(term => location.includes(term));

  // If location has both Jakarta and other province terms, it's likely confused
  if (hasJakartaTerms && (hasNtbTerms || hasBaliTerms || hasSumateraTerms || hasKalimantanTerms ||
      hasSulawesiTerms || hasMalukuTerms || hasPapuaTerms)) {
    if (hasNtbTerms) {
      return {
        isValid: false,
        correctedLocation: 'DPRD NTB, Mataram, Nusa Tenggara Barat',
        reason: 'Conflicting Jakarta and NTB terms - prioritizing NTB location'
      };
    }
    if (hasBaliTerms) {
      return {
        isValid: false,
        correctedLocation: 'DPRD Bali, Denpasar, Bali',
        reason: 'Conflicting Jakarta and Bali terms - prioritizing Bali location'
      };
    }
    if (hasSumateraTerms) {
      // Determine specific Sumatera province based on city mentioned
      if (location.includes('medan')) {
        return {
          isValid: false,
          correctedLocation: 'DPRD Sumatera Utara, Medan',
          reason: 'Conflicting Jakarta and Sumatera Utara terms - prioritizing Sumatera Utara location'
        };
      } else if (location.includes('padang')) {
        return {
          isValid: false,
          correctedLocation: 'DPRD Sumatera Barat, Padang',
          reason: 'Conflicting Jakarta and Sumatera Barat terms - prioritizing Sumatera Barat location'
        };
      } else if (location.includes('palembang')) {
        return {
          isValid: false,
          correctedLocation: 'DPRD Sumatera Selatan, Palembang',
          reason: 'Conflicting Jakarta and Sumatera Selatan terms - prioritizing Sumatera Selatan location'
        };
      }
    }
    if (hasKalimantanTerms) {
      if (location.includes('samarinda')) {
        return {
          isValid: false,
          correctedLocation: 'DPRD Kalimantan Timur, Samarinda',
          reason: 'Conflicting Jakarta and Kalimantan Timur terms - prioritizing Kalimantan Timur location'
        };
      } else if (location.includes('banjarmasin')) {
        return {
          isValid: false,
          correctedLocation: 'DPRD Kalimantan Selatan, Banjarmasin',
          reason: 'Conflicting Jakarta and Kalimantan Selatan terms - prioritizing Kalimantan Selatan location'
        };
      }
    }
    if (hasSulawesiTerms) {
      if (location.includes('makassar')) {
        return {
          isValid: false,
          correctedLocation: 'DPRD Sulawesi Selatan, Makassar',
          reason: 'Conflicting Jakarta and Sulawesi Selatan terms - prioritizing Sulawesi Selatan location'
        };
      } else if (location.includes('manado')) {
        return {
          isValid: false,
          correctedLocation: 'DPRD Sulawesi Utara, Manado',
          reason: 'Conflicting Jakarta and Sulawesi Utara terms - prioritizing Sulawesi Utara location'
        };
      }
    }
    if (hasPapuaTerms) {
      if (location.includes('jayapura')) {
        return {
          isValid: false,
          correctedLocation: 'DPRD Papua, Jayapura',
          reason: 'Conflicting Jakarta and Papua terms - prioritizing Papua location'
        };
      }
    }
  }

  return { isValid: true };
}

// Apply location validation to results
function applyLocationValidation(result: DetailedLocationResult): DetailedLocationResult {
  if (!result.success || !result.exact_location) {
    return result;
  }

  const validation = validateIndonesianLocation(result.exact_location);

  if (!validation.isValid && validation.correctedLocation) {
    console.log(`⚠️ Location validation failed: ${validation.reason}`);
    console.log(`🔄 Correcting "${result.exact_location}" → "${validation.correctedLocation}"`);

    return {
      ...result,
      exact_location: validation.correctedLocation,
      all_locations: [validation.correctedLocation],
      confidence: Math.min(result.confidence || 0.5, 0.7) // Reduce confidence for corrected locations
    };
  }

  return result;
}

async function extractDetailedLocationFromTikTokInternal(videoData: any): Promise<DetailedLocationResult> {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ OpenRouter API key not configured');
      return {
        success: false,
        error: 'OpenAI API key not configured'
      };
    }
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const { title, author, music_info, region, cover } = videoData;

    // First, try to extract location from text content
    console.log(`📝 Extracting location from text: "${title}"`);

    const textPrompt = `You are a location extraction expert for Melbourne/Victoria, Australia. Extract any location mentioned in this TikTok video caption about a crime, incident, or safety event.

VIDEO DATA:
Title: "${title}"
Author: "${author?.nickname || 'Unknown'}"
Region: "${region || 'Unknown'}"

YOUR TASK: Find ANY location or place name mentioned in the title. Be aggressive — extract even vague area references.

EXTRACTION RULES:
1. Extract ANY suburb, street, station, landmark, or area reference
2. Directional areas count: "Melbourne's south-west" → "South-West Melbourne, VIC"
3. Relative areas count: "Melbourne's outer north" → "Outer North Melbourne, VIC"
4. Suburb names are locations: "Noble Park", "Kew", "Mernda", "Werribee" → extract them
5. Train stations count: "Mernda train station" → "Mernda Station, VIC"
6. "the city" or "the CBD" or "Melbourne's CBD" → "Melbourne CBD, VIC"
7. "western suburbs" → "Western Suburbs, Melbourne VIC"
8. If the text mentions Melbourne or Victoria context, append ", VIC" to the location
9. Return null ONLY if there is absolutely zero geographic information in the text

LOCATION PRIORITY (most specific first):
1. Named place: "Mernda train station", "Noble Park", "Bourke St Mall"
2. Suburb: "Kew", "Carlton", "Footscray", "Dandenong"
3. Area/direction: "Melbourne's south-west", "outer north"
4. City: "Melbourne CBD"

RESPONSE FORMAT (JSON only, no markdown):
{
  "exact_location": "Noble Park, VIC" | null,
  "all_locations": ["Noble Park", "Melbourne"],
  "confidence": 0.8
}

EXAMPLES:
✅ "stabbed to death in Melbourne's south-west" → {"exact_location": "South-West Melbourne, VIC", "all_locations": ["South-West Melbourne", "Melbourne"], "confidence": 0.7}
✅ "assaulted by a group of men in Noble Park" → {"exact_location": "Noble Park, VIC", "all_locations": ["Noble Park"], "confidence": 0.9}
✅ "stabbing of a teenage girl in Kew" → {"exact_location": "Kew, VIC", "all_locations": ["Kew", "Melbourne"], "confidence": 0.9}
✅ "found fatally stabbed in Melbourne's CBD" → {"exact_location": "Melbourne CBD, VIC", "all_locations": ["Melbourne CBD", "Melbourne"], "confidence": 0.9}
✅ "Mernda train station in Melbourne's outer north" → {"exact_location": "Mernda Station, VIC", "all_locations": ["Mernda Station", "Mernda", "Melbourne"], "confidence": 0.95}
✅ "bus stop stabbing in the western suburbs" → {"exact_location": "Western Suburbs, Melbourne VIC", "all_locations": ["Western Suburbs", "Melbourne"], "confidence": 0.6}
✅ "attacked at a Melbourne primary school" → {"exact_location": "Melbourne, VIC", "all_locations": ["Melbourne"], "confidence": 0.5}
❌ "Breaking news tonight" → {"exact_location": null, "all_locations": [], "confidence": 0.0}

Return ONLY valid JSON:`;

    const textCompletion = await client.chat.completions.create({
      model: process.env.OPENAI_LOCATION_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: textPrompt
        }
      ],
      max_tokens: 300,
      temperature: 0.1
    });

    let textResult: any = null;
    const textContent = textCompletion.choices[0]?.message?.content?.trim();

    if (textContent) {
      try {
        textResult = JSON.parse(textContent);
        console.log(`📝 Text analysis result:`, textResult);
      } catch (e) {
        console.log(`⚠️ Failed to parse text analysis result:`, textContent);
      }
    }

    // Now try to extract location from the cover image using vision model
    let imageResult: any = null;

    if (cover) {
      console.log(`🖼️ Analyzing cover image: ${cover}`);

      const imagePrompt = `You are a location identification expert for Melbourne/Victoria, Australia. This is a TikTok news video cover image about a crime or safety incident. Identify the location shown.

Look for ANY of these in the image:
- Text overlays showing suburb/location names (e.g., "South Melbourne", "Noble Park", "Dandenong")
- Street signs, station names, building names
- News ticker/banner text mentioning a location
- Recognizable Melbourne landmarks or buildings
- Victoria Police markings, court buildings
- Any text or signage that indicates a place

RULES:
1. Text overlays in news videos are the most reliable — prioritize them
2. If you see a suburb name in text overlay, that IS the location
3. Include ", VIC" for Victorian locations
4. If you cannot identify ANY location, return exact_location as null
5. Do NOT say "I'm unable to identify" — just return null in the JSON

RESPONSE FORMAT (JSON only, no markdown):
{
  "exact_location": "South Melbourne, VIC" | null,
  "confidence": 0.9 | 0.0
}

Return ONLY valid JSON, nothing else.`;

      try {
        const imageCompletion = await client.chat.completions.create({
          model: process.env.OPENAI_LOCATION_MODEL || "gpt-4o-mini",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: imagePrompt
                },
                {
                  type: "image_url",
                  image_url: {
                    url: cover
                  }
                }
              ]
            }
          ],
          max_tokens: 200,
          temperature: 0.1
        });

        const imageContent = imageCompletion.choices[0]?.message?.content?.trim();

        if (imageContent) {
          console.log(`🖼️ Image analysis result: "${imageContent}"`);

          // The prompt asks for JSON directly — try to parse it
          let cleanJson = imageContent
            .replace(/```json\s*/g, '')
            .replace(/```\s*/g, '')
            .trim();

          const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            cleanJson = jsonMatch[0];
          }

          try {
            imageResult = JSON.parse(cleanJson);
            console.log(`📋 Image result:`, imageResult);
          } catch {
            console.log(`⚠️ Failed to parse image result as JSON, skipping`);
          }
        } else {
          console.log(`🖼️ No identifiable location in cover image`);
        }
      } catch (error) {
        console.log(`⚠️ Image analysis failed:`, error);
      }
    }

    // Combine results from text and image analysis with improved logic
    console.log(`🔄 Combining text and image analysis results...`);

    // Priority 1: High-confidence image results
    if (imageResult && imageResult.exact_location && imageResult.confidence > 0.8) {
      console.log(`🎯 Using high-confidence image-based location: "${imageResult.exact_location}"`);
      return {
        success: true,
        exact_location: imageResult.exact_location,
        all_locations: [imageResult.exact_location],
        confidence: imageResult.confidence
      };
    }

    // Priority 2: High-confidence text results
    if (textResult && textResult.exact_location && textResult.confidence > 0.8) {
      console.log(`📝 Using high-confidence text-based location: "${textResult.exact_location}"`);
      return {
        success: true,
        exact_location: textResult.exact_location,
        all_locations: textResult.all_locations || [],
        confidence: textResult.confidence
      };
    }

    // Priority 3: Medium-confidence results (either image or text)
    if (imageResult && imageResult.exact_location && imageResult.confidence > 0.5) {
      console.log(`🖼️ Using medium-confidence image-based location: "${imageResult.exact_location}"`);
      return {
        success: true,
        exact_location: imageResult.exact_location,
        all_locations: [imageResult.exact_location],
        confidence: imageResult.confidence
      };
    }

    if (textResult && textResult.exact_location && textResult.confidence > 0.5) {
      console.log(`📝 Using medium-confidence text-based location: "${textResult.exact_location}"`);
      return {
        success: true,
        exact_location: textResult.exact_location,
        all_locations: textResult.all_locations || [],
        confidence: textResult.confidence
      };
    }

    // Priority 4: Low-confidence results as fallback
    if (imageResult && imageResult.exact_location) {
      console.log(`🖼️ Using low-confidence image-based location as fallback: "${imageResult.exact_location}"`);
      return {
        success: true,
        exact_location: imageResult.exact_location,
        all_locations: [imageResult.exact_location],
        confidence: Math.max(imageResult.confidence || 0.3, 0.3) // Minimum 0.3 confidence
      };
    }

    if (textResult && textResult.exact_location) {
      console.log(`📝 Using low-confidence text-based location as fallback: "${textResult.exact_location}"`);
      return {
        success: true,
        exact_location: textResult.exact_location,
        all_locations: textResult.all_locations || [],
        confidence: Math.max(textResult.confidence || 0.3, 0.3) // Minimum 0.3 confidence
      };
    }

    // Priority 5: Attempt to extract location from title using regex patterns
    console.log(`🔍 Attempting regex-based location extraction as final fallback`);
    const titleText = title.toLowerCase();

    // Common Indonesian location patterns
    const locationPatterns = [
      /(?:di|depan|dekat)\s+([^,.\n]+(?:dpr|mp|istana|polda|kodam|monas|bundaran)[^,.\n]*)/i,
      /(?:jalan|jl\.?)\s+([^,.\n]+(?:sudirman|thamrin|gatot|mh\.)[^,.\n]*)/i,
      /(?:kawasan|daerah)\s+([^,.\n]+)/i,
      /(?:jakarta|pala|bandung|surabaya|yogyakarta|semarang)\s+(?:pusat|utara|selatan|timur|barat)/i,
      /(?:gedung|kantor)\s+([^,.\n]+)/i
    ];

    for (const pattern of locationPatterns) {
      const match = titleText.match(pattern);
      if (match && match[1]) {
        const extractedLocation = match[1].trim();
        if (extractedLocation.length > 3) { // Avoid very short matches
          console.log(`🎯 Regex fallback found location: "${extractedLocation}"`);
          return {
            success: true,
            exact_location: extractedLocation,
            all_locations: [extractedLocation],
            confidence: 0.4 // Low confidence for regex fallback
          };
        }
      }
    }

    // Final fallback: try to find any Indonesian city/province names
    const indonesianLocations = [
      // Major cities
      'jakarta', 'bandung', 'surabaya', 'medan', 'semarang', 'yogyakarta', 'palembang',
      'makassar', 'pekanbaru', 'padang', 'batam', 'malang', 'samarinda', 'denpasar',
      'manado', 'palu', 'kendari', 'gorontalo', 'ambon', 'sofifi', 'jayapura', 'manokwari',
      'pontianak', 'palangka raya', 'banjarmasin', 'tanjung selor', 'mamuju', 'nabire',
      'jayawijaya', 'merauke', 'sorong', 'tanjung pinang', 'jambi', 'bengkulu',
      'bandar lampung', 'pangkal pinang', 'serang', 'kupang', 'mataram', 'banda aceh',

      // Provinces
      'bali', 'jawa barat', 'jawa tengah', 'jawa timur', 'banten', 'nusa tenggara barat',
      'nusa tenggara timur', 'sumatera utara', 'sumatera barat', 'riau', 'kepulauan riau',
      'jambi', 'sumatera selatan', 'bengkulu', 'lampung', 'bangka belitung',
      'kalimantan barat', 'kalimantan tengah', 'kalimantan selatan', 'kalimantan timur',
      'kalimantan utara', 'sulawesi utara', 'sulawesi tengah', 'sulawesi selatan',
      'sulawesi tenggara', 'gorontalo', 'sulawesi barat', 'maluku', 'maluku utara',
      'papua barat', 'papua', 'papua tengah', 'papua pegunungan', 'papua selatan',
      'papua barat daya', 'aceh', 'dki jakarta'
    ];

    for (const location of indonesianLocations) {
      if (titleText.includes(location)) {
        console.log(`🏙️ Found Indonesian location in title: "${location}"`);
        return {
          success: true,
          exact_location: location,
          all_locations: [location],
          confidence: 0.2 // Very low confidence
        };
      }
    }

    console.log(`❌ No location found after all extraction attempts`);
    return {
      success: false,
      error: 'No location found in text, image, or fallback analysis'
    };

  } catch (error) {
    console.error('Detailed location extraction error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown extraction error'
    };
  }
}

// Wrapper function for TikTok detailed location extraction.
// scraper can be repurposed for other regions (e.g. Melbourne incidents).
export async function extractDetailedLocationFromTikTok(videoData: any): Promise<DetailedLocationResult> {
  const result = await extractDetailedLocationFromTikTokInternal(videoData);
  return result;
}

// Debug function to test OpenRouter connection
export async function testOpenRouterConnection(): Promise<{success: boolean, error?: string}> {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return { success: false, error: 'API key not configured' };
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_LOCATION_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: 'Hello' }],
      max_tokens: 5,
      temperature: 0.1
    });

    const message = completion.choices[0]?.message;
    const content = message?.content?.trim();
    const refusal = message?.refusal;
    
    console.log('completion', message);
    console.log('content', content);
    console.log('refusal', refusal);

    // Check if the model refused to respond
    if (refusal) {
      return { 
        success: false, 
        error: `Model refused to respond: ${refusal}` 
      };
    }

    // Check if we got a valid response
    if (!content || content.length === 0) {
      return { 
        success: false, 
        error: 'Empty response from model' 
      };
    }

    return { success: true };

  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Extract location from Twitter text about planned demonstrations
export async function extractLocationFromTweet(tweetText: string, userInfo?: any): Promise<LocationResult> {
  try {
    if (!process.env.OPENROUTER_API_KEY) {
      return {
        success: false,
        error: 'OpenRouter API key not configured'
      };
    }

    const client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "https://safe-melbourne.vercel.app",
        "X-Title": process.env.NEXT_PUBLIC_APP_TITLE || "Safe Melbourne",
      },
    });

    const prompt = `Extract the specific location mentioned in this Twitter text about planned protests/demonstrations in Melbourne/Victoria, Australia. Focus on finding the exact place where the planned protest will happen.

Tweet Text: ${tweetText}
${userInfo?.location ? `User Location: ${userInfo.location}` : ''}

CRITICAL RULES - READ CAREFULLY:
1. NEVER assume Melbourne unless EXPLICITLY mentioned in the text
2. Look for specific Australian/Victorian government buildings, landmarks, or addresses
3. Common protest locations: Parliament House Victoria, State Library Victoria, Federation Square, Flinders Street Station, CBD, Town Hall
4. Include suburb/city/state information when available (e.g., "Carlton, VIC", "Melbourne CBD", "Spring St, Melbourne")
5. If multiple locations mentioned, choose the most specific one

MELBOURNE / VICTORIA LOCATION PATTERNS:
- Government buildings: "Parliament House", "Supreme Court of Victoria", "Victoria Police HQ"
- Landmarks: "Federation Square", "Flinders Street Station", "State Library Victoria", "Arts Centre Melbourne"
- Universities: "University of Melbourne", "RMIT", "Monash (Caulfield)"
- Streets/areas: "Swanston St", "Bourke St Mall", "Collins St", "Spring St", "CBD"

AUSTRALIAN LOCATION HINTS:
- VIC = Victoria (state); CBD = Central Business District
- Common suburbs: Carlton, Fitzroy, Richmond, Southbank, Docklands, St Kilda
- Nearby cities: Geelong, Ballarat, Bendigo

Return ONLY the location name (in English), without any additional text. If no specific location is mentioned, return "unknown".

Examples:
- "Protest at Parliament House this Friday" → "Parliament House Victoria, Melbourne"
- "Rally at Fed Square today" → "Federation Square, Melbourne"
- "March along Swanston Street in the CBD" → "Swanston St, Melbourne CBD"
- "Gathering outside Flinders Street Station" → "Flinders Street Station, Melbourne"
- "Demo in Carlton near UniMelb" → "University of Melbourne, Carlton VIC"`;

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_LOCATION_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 100,
      temperature: 0.1
    });

    const extractedLocation = completion.choices[0]?.message?.content?.trim();

    if (!extractedLocation || extractedLocation === 'unknown') {
      return {
        success: false,
        error: 'No location found in tweet text'
      };
    }

    // Remove quotes if present
    const cleanLocation = extractedLocation.replace(/^["']|["']$/g, '');

    // Validate that we have a reasonable location
    if (cleanLocation.length < 3) {
      return {
        success: false,
        error: 'Extracted location too short'
      };
    }

    // Calculate confidence based on location specificity
    let confidence = 0.5; // Base confidence
    
    // Higher confidence for specific government buildings
    if (cleanLocation.toLowerCase().includes('dprd') || 
        cleanLocation.toLowerCase().includes('dpr') ||
        cleanLocation.toLowerCase().includes('polda') ||
        cleanLocation.toLowerCase().includes('istana')) {
      confidence += 0.3;
    }
    
    // Higher confidence if province is mentioned
    if (cleanLocation.includes(',') || 
        cleanLocation.toLowerCase().includes('jakarta') ||
        cleanLocation.toLowerCase().includes('bandung') ||
        cleanLocation.toLowerCase().includes('surabaya')) {
      confidence += 0.2;
    }

    confidence = Math.min(confidence, 1.0); // Cap at 1.0

    return {
      success: true,
      location: cleanLocation,
      confidence: confidence
    };

  } catch (error) {
    console.error('Twitter location extraction error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown extraction error'
    };
  }
}

