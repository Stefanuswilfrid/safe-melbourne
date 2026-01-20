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

    const textPrompt = `You are a location extraction expert specializing in Melbourne/Victoria (Australia) protest locations. Analyze this TikTok video about protests/demonstrations.

VIDEO DATA:
Title: "${title}"
Author: "${author?.nickname || 'Unknown'}"
Music: "${music_info?.title || 'Unknown'}"
Region: "${region || 'Unknown'}"

CRITICAL RULES - READ CAREFULLY:
1. NEVER assume Melbourne unless EXPLICITLY mentioned in the text
2. Be extremely specific about Australian geography (city/suburb/state)
3. VIC = Victoria (state); CBD = Central Business District
4. Prefer the most specific identifiable place (building/landmark > street > suburb > city > state)
5. If multiple locations are mentioned, choose the one that is most likely the protest gathering point

LOCATION PRIORITY (most specific first):
1. Specific venue/building: "Parliament House Victoria", "Melbourne Town Hall", "State Library Victoria"
2. Landmark: "Federation Square", "Flinders Street Station", "Shrine of Remembrance", "NGV"
3. Street + area: "Swanston St, Melbourne CBD", "Bourke St Mall, Melbourne"
4. Suburb + state: "Carlton VIC", "Fitzroy VIC", "Richmond VIC"
5. City/state only: "Melbourne", "Victoria"

MELBOURNE / VICTORIA LOCATION HINTS:
- Parliament House Victoria is on Spring St, East Melbourne
- Common protest areas: Melbourne CBD, Parliament precinct, Fed Square, State Library
- Key stations: Flinders Street Station, Southern Cross Station
- Nearby cities sometimes mentioned: Geelong, Ballarat, Bendigo
- Common suburbs: Carlton, Fitzroy, Richmond, Southbank, Docklands, St Kilda

VALIDATION CHECKS:
-- If you see "VIC" or "Victoria" → prefer the Victorian location context
-- If you see "CBD" → interpret as Melbourne CBD unless another city is clearly specified
-- If a landmark/station is mentioned, prefer that over a generic city label

RESPONSE FORMAT (JSON only):
{
  "exact_location": "Parliament House Victoria, Melbourne VIC" | null,
  "all_locations": ["Parliament House Victoria", "Spring St", "Melbourne", "VIC"],
  "confidence": 0.95
}

EXAMPLES:
✅ "Protest at Parliament House" → {"exact_location": "Parliament House Victoria, Melbourne VIC", "all_locations": ["Parliament House Victoria", "Spring St", "Melbourne", "VIC"], "confidence": 0.95}
✅ "Rally at Fed Square" → {"exact_location": "Federation Square, Melbourne VIC", "all_locations": ["Federation Square", "Melbourne", "VIC"], "confidence": 0.95}
✅ "March along Swanston St in the CBD" → {"exact_location": "Swanston St, Melbourne CBD", "all_locations": ["Swanston St", "Melbourne CBD", "Melbourne", "VIC"], "confidence": 0.9}
✅ "Gathering outside Flinders Street Station" → {"exact_location": "Flinders Street Station, Melbourne VIC", "all_locations": ["Flinders Street Station", "Melbourne", "VIC"], "confidence": 0.95}
❌ "Protest happening today" → {"exact_location": null, "all_locations": [], "confidence": 0.0}

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

      const imagePrompt = `You are a location identification expert specializing in Melbourne/Victoria (Australia) protest locations. Analyze this TikTok video cover image and identify the exact location shown.

This is a TikTok video about protests/demonstrations in Melbourne/Victoria, Australia. Look for:

LOCATION IDENTIFIERS:
- Government buildings: Parliament House Victoria, Melbourne Town Hall, Supreme Court of Victoria
- Police: Victoria Police (stations/HQ), "POLICE" signage, "Victoria Police" markings
- Famous landmarks: Federation Square, Flinders Street Station, Southern Cross Station, Shrine of Remembrance, NGV, Arts Centre Melbourne, MCG, Rod Laver Arena
- Street signs: Swanston St, Collins St, Bourke St, Elizabeth St, Flinders St, Spring St, St Kilda Rd, etc.
- Area/suburb names: Melbourne CBD, Carlton, Fitzroy, Richmond, Southbank, Docklands, St Kilda, etc.
- Universities: University of Melbourne, RMIT University, Monash University (Caulfield), etc.
- Text overlays or signs visible in the image

AUSTRALIAN GEOGRAPHY - CRITICAL RULES:
1. VIC = Victoria (state); NSW = New South Wales (state)
2. CBD = Central Business District (usually Melbourne CBD here)
3. NEVER assume Melbourne unless you see "Melbourne" / "VIC" explicitly, or the landmark is uniquely Melbourne
4. If a suburb is mentioned, include it with "VIC" when possible

MELBOURNE / VICTORIA REFERENCE:
- Common CBD landmarks: Federation Square, Flinders Street Station, State Library Victoria
- Major roads/areas: Swanston St, Collins St, Bourke St Mall, St Kilda Rd, Spring St

AUSTRALIA-SPECIFIC HINTS:
- Look for "Victoria Police", "VIC", "Melbourne", "City of Melbourne"
- Numbers after street names can indicate building/street numbers
- "St" can mean "Street" or "Saint" depending on context (e.g., St Kilda)

VALIDATION CHECKLIST:
- If you see "VIC" → include Victoria context
- If you see "CBD" → interpret as Melbourne CBD unless another city is explicit
- If you see a landmark/station name, prefer that over generic "Melbourne"

IMPORTANT:
- Be VERY specific about the location (landmark/building/street/suburb)
- Include suburb + state when available (e.g., "Carlton VIC")
- If you see street names, include them with any numbers
- Focus ONLY on Australian locations
- If multiple possible locations, choose the most prominent one
- NEVER default to Melbourne unless clearly supported by the image/text

What exact location is shown in this image? Include the suburb/city and state (VIC) if identifiable.`;

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

        if (imageContent && !imageContent.includes("Unable to identify")) {
          console.log(`🖼️ Image analysis result: "${imageContent}"`);

          // Try to extract structured location from image analysis
          const structuredPrompt = `Convert this location description into structured JSON format:

Location description: "${imageContent}"

Return ONLY valid JSON format like this:
{"exact_location": "the most specific location mentioned", "confidence": 0.9}

If no clear location, return: {"exact_location": null, "confidence": 0.0}

IMPORTANT: Return ONLY the JSON object, no markdown, no explanation, no backticks.`;

          const structuredCompletion = await client.chat.completions.create({
            model: process.env.OPENAI_LOCATION_MODEL || "gpt-4o-mini",
            messages: [
              {
                role: "user",
                content: structuredPrompt
              }
            ],
            max_tokens: 150,
            temperature: 0.1
          });

          const structuredContent = structuredCompletion.choices[0]?.message?.content?.trim();

          if (structuredContent) {
            let cleanJson = '';
            try {
              // Clean the response by removing markdown formatting and extra text
              cleanJson = structuredContent
                .replace(/```json\s*/g, '') // Remove ```json
                .replace(/```\s*/g, '') // Remove ```
                .replace(/^\s*[\w\s]*:\s*/g, '') // Remove any prefix text
                .trim();

              // Extract JSON if it's embedded in text
              const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                cleanJson = jsonMatch[0];
              }

              imageResult = JSON.parse(cleanJson);
              console.log(`📋 Structured image result:`, imageResult);
            } catch (e) {
              console.log(`⚠️ Failed to parse structured image result:`, structuredContent);
              console.log(`🧹 Cleaned content was:`, cleanJson);

              // Fallback: try to extract location manually from the original content
              if (imageContent && imageContent.length > 10) {
                console.log(`🔄 Attempting fallback extraction from original image content`);
                imageResult = {
                  exact_location: imageContent.split('.')[0].trim(), // Take first sentence
                  confidence: 0.6 // Lower confidence for fallback
                };
                console.log(`📍 Fallback image result:`, imageResult);
              }
            }
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
        "HTTP-Referer": "https://safe-indo.vercel.app",
        "X-Title": "Safe Indo",
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

