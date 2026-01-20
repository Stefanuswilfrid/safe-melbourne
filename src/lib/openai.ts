/* eslint-disable @typescript-eslint/no-explicit-any */
import { LocationResult } from "@/types/location";
import OpenAI from "openai";

export async function extractLocationFromTweet(
  tweetText: string,
  userInfo?: any
): Promise<LocationResult> {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return {
        success: false,
        error: "OpenAI API key not configured",
      };
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const prompt = `Extract the specific location mentioned in this Twitter text about planned protests/demonstrations in Melbourne/Victoria, Australia. Focus on the exact place where the planned protest will happen.

Tweet Text: ${tweetText}
${userInfo?.location ? `User Location: ${userInfo.location}` : ""}

CRITICAL RULES - READ CAREFULLY:
1. NEVER assume Melbourne unless EXPLICITLY mentioned in the text
2. Look for specific Australian/Victorian government buildings, landmarks, or addresses
3. Common protest locations: Parliament House Victoria, State Library Victoria, Federation Square, Flinders Street Station, CBD, Town Hall
4. Include suburb/city/state information when available (e.g., "Carlton, VIC", "Melbourne CBD", "Spring St, Melbourne")
5. If multiple locations are mentioned, choose the most specific one

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
- "Demo in Carlton near UniMelb" -> "University of Melbourne, Carlton VIC"`;

    // Choose a model you have access to:
    // - "gpt-5" if enabled on your account
    // - otherwise "gpt-4o-mini" is a good, cheap extractor
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_LOCATION_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100,
      temperature: 0.1,
    });

    const extractedLocation = completion.choices[0]?.message?.content?.trim();

    if (!extractedLocation || extractedLocation.toLowerCase() === "unknown") {
      return {
        success: false,
        error: "No location found in tweet text",
      };
    }

    // Remove leading/trailing quotes if present
    const cleanLocation = extractedLocation.replace(/^["']|["']$/g, "").trim();

    if (cleanLocation.length < 3) {
      return {
        success: false,
        error: "Extracted location too short",
      };
    }

    // Confidence heuristic
    let confidence = 0.5; // base
    const lower = cleanLocation.toLowerCase();

    // Higher confidence for specific government buildings
    if (
      lower.includes("dprd") ||
      lower.includes(" dpr") || // includes 'DPR RI'
      lower.includes("polda") ||
      lower.includes("istana")
    ) {
      confidence += 0.3;
    }

    // Higher confidence if province/city present (comma or known cities)
    if (
      cleanLocation.includes(",") ||
      lower.includes("jakarta") ||
      lower.includes("bandung") ||
      lower.includes("surabaya") ||
      lower.includes("yogyakarta") ||
      lower.includes("denpasar") ||
      lower.includes("medan") ||
      lower.includes("makassar") ||
      lower.includes("semarang")
    ) {
      confidence += 0.2;
    }

    confidence = Math.min(confidence, 1.0);

    return {
      success: true,
      location: cleanLocation,
      confidence,
    };
  } catch (error) {
    console.error("Twitter location extraction error:", error);
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Unknown extraction error",
    };
  }
}
