/**
 * RapidAPI Key Manager
 * Handles intelligent rotation and parallel usage of multiple API keys
 */

export interface APIKeyConfig {
    key: string;
    name: string;
    isActive: boolean;
    lastUsed?: Date;
    callsThisMonth?: number;
    monthlyLimit: number;
  }
  
  export interface ScrapeRequest {
    keyword: string;
    cursor?: number;
    count?: number;
  }

  /** User feed (per-account) — cursor is provider-specific (number or string). */
  export interface UserPostsRequest {
    uniqueId: string;
    cursor?: string | number;
    count?: number;
  }
  
  export interface ScrapeResult {
    success: boolean;
    data?: any;
    error?: string;
    keyUsed: string;
    cursor?: number;
  }
  
  class RapidAPIKeyManager {
    private keys: APIKeyConfig[] = [];
    private keyRotationIndex = 0;
  
    constructor() {
      this.initializeKeys();
    }
  
    private initializeKeys() {
      const keyNames = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'];
      
      this.keys = keyNames
        .map(name => {
          const envKey = `RAPIDAPI_KEY_${name}`;
          const apiKey = process.env[envKey];
          
          if (!apiKey) {
            console.warn(`⚠️ ${envKey} not found in environment variables`);
            return null;
          }
  
          return {
            key: apiKey,
            name: `KEY_${name}`,
            isActive: true,
            monthlyLimit: 300,
            callsThisMonth: 0
          };
        })
        .filter(Boolean) as APIKeyConfig[];

      // Fallback: if no numbered keys are configured but RAPIDAPI_KEY exists,
      // use it as a single generic key so scraping still works.
      if (this.keys.length === 0 && process.env.RAPIDAPI_KEY) {
        console.warn('⚠️ No RAPIDAPI_KEY_ONE..FIVE found; using RAPIDAPI_KEY as a single key');
        this.keys.push({
          key: process.env.RAPIDAPI_KEY,
          name: 'KEY_DEFAULT',
          isActive: true,
          monthlyLimit: 300,
          callsThisMonth: 0
        });
      }
  
      console.log(`🔑 Initialized ${this.keys.length} RapidAPI keys:`, 
        this.keys.map(k => k.name).join(', '));
    }
  
    /**
     * Get keys for peak hours (3 parallel calls)
     */
    getKeysForPeakHour(): APIKeyConfig[] {
      const availableKeys = this.keys.filter(k => k.isActive);
      
      if (availableKeys.length < 3) {
        console.warn(`⚠️ Only ${availableKeys.length} keys available for peak hour`);
        return availableKeys;
      }
  
      // Rotate through keys to distribute load evenly
      const selectedKeys: APIKeyConfig[] = [];
      for (let i = 0; i < 3; i++) {
        const keyIndex = (this.keyRotationIndex + i) % availableKeys.length;
        selectedKeys.push(availableKeys[keyIndex]);
      }
  
      // Update rotation index for next time
      this.keyRotationIndex = (this.keyRotationIndex + 3) % availableKeys.length;
  
      console.log(`🔥 Peak hour keys: ${selectedKeys.map(k => k.name).join(', ')}`);
      return selectedKeys;
    }
  
    /**
     * Get keys for conserve hours (2 sequential calls)
     */
    getKeysForConserveHour(): APIKeyConfig[] {
      const availableKeys = this.keys.filter(k => k.isActive);
      
      if (availableKeys.length < 2) {
        console.warn(`⚠️ Only ${availableKeys.length} keys available for conserve hour`);
        return availableKeys;
      }
  
      // Use different keys than peak to distribute load
      const selectedKeys: APIKeyConfig[] = [];
      for (let i = 0; i < 2; i++) {
        const keyIndex = (this.keyRotationIndex + i) % availableKeys.length;
        selectedKeys.push(availableKeys[keyIndex]);
      }
  
      // Update rotation index for next time
      this.keyRotationIndex = (this.keyRotationIndex + 2) % availableKeys.length;
  
      console.log(`💤 Conserve hour keys: ${selectedKeys.map(k => k.name).join(', ')}`);
      return selectedKeys;
    }
  
    /**
     * Make a single API call with specified key and cursor
     */
    /**
     * Fetch a page of videos for one TikTok account (username / unique_id, no @).
     * Endpoint defaults to `user/posts` on tiktok-scraper7; override with SCRAPE_TIKTOK_USER_POSTS_PATH if your RapidAPI tab shows a different path.
     */
    async makeUserPostsAPICall(
      keyConfig: APIKeyConfig,
      request: UserPostsRequest
    ): Promise<ScrapeResult> {
      try {
        const { uniqueId, cursor = 0, count = 30 } = request;
        const path =
          (process.env.SCRAPE_TIKTOK_USER_POSTS_PATH || 'user/posts').replace(/^\/+/, '');

        const url = `https://tiktok-scraper7.p.rapidapi.com/${path}?unique_id=${encodeURIComponent(uniqueId)}&count=${count}&cursor=${encodeURIComponent(String(cursor))}`;

        const options = {
          method: 'GET',
          headers: {
            'x-rapidapi-key': keyConfig.key,
            'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com',
          },
        };

        console.log(
          `🌐 User posts API (${path}) with ${keyConfig.name}, @${uniqueId}, cursor: ${cursor}, count: ${count}`
        );

        const response = await fetch(url, options);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        keyConfig.lastUsed = new Date();
        keyConfig.callsThisMonth = (keyConfig.callsThisMonth || 0) + 1;

        return {
          success: true,
          data,
          keyUsed: keyConfig.name,
        };
      } catch (error) {
        console.error(`❌ User posts API failed with ${keyConfig.name}:`, error);

        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          keyUsed: keyConfig.name,
        };
      }
    }

    async makeAPICall(keyConfig: APIKeyConfig, request: ScrapeRequest): Promise<ScrapeResult> {
      try {
        const { keyword, cursor = 0, count = 30 } = request;

        // Target Australia explicitly and remove the 24h limit:
        // - region=au → focus on Australian content (Melbourne, etc.)
        // - publish_time=0 → no time restriction (API returns recent/top results, not just today)
        const url = `https://tiktok-scraper7.p.rapidapi.com/feed/search?keywords=${encodeURIComponent(keyword)}&region=au&count=${count}&cursor=${cursor}&publish_time=0&sort_type=0`;
  
        const options = {
          method: 'GET',
          headers: {
            'x-rapidapi-key': keyConfig.key,
            'x-rapidapi-host': 'tiktok-scraper7.p.rapidapi.com'
          }
        };
  
        console.log(`🌐 API Call with ${keyConfig.name}, cursor: ${cursor}, count: ${count}`);
        
        const response = await fetch(url, options);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
  
        const data = await response.json();
        
        // Update key usage tracking
        keyConfig.lastUsed = new Date();
        keyConfig.callsThisMonth = (keyConfig.callsThisMonth || 0) + 1;
  
        return {
          success: true,
          data,
          keyUsed: keyConfig.name,
          cursor: cursor + count
        };
  
      } catch (error) {
        console.error(`❌ API call failed with ${keyConfig.name}:`, error);
        
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          keyUsed: keyConfig.name
        };
      }
    }
  
    /**
     * Make parallel API calls for peak hours
     */
    async makeParallelCalls(keyword: string, videoCount: number = 90): Promise<ScrapeResult[]> {
      const keys = this.getKeysForPeakHour();
      const callsNeeded = Math.ceil(videoCount / 30);
      const actualKeys = keys.slice(0, callsNeeded);
      
      console.log(`🔥 Making ${callsNeeded} parallel calls for ${videoCount} videos`);
  
      const promises = actualKeys.map((keyConfig, index) => {
        const cursor = index * 30;
        return this.makeAPICall(keyConfig, { keyword, cursor, count: 30 });
      });
  
      const results = await Promise.all(promises);
      
      const successCount = results.filter(r => r.success).length;
      console.log(`✅ Parallel calls completed: ${successCount}/${results.length} successful`);
      
      return results;
    }
  
    /**
     * Make sequential API calls for conserve hours
     */
    async makeSequentialCalls(keyword: string, videoCount: number = 60): Promise<ScrapeResult[]> {
      const keys = this.getKeysForConserveHour();
      const callsNeeded = Math.ceil(videoCount / 30);
      const results: ScrapeResult[] = [];
      
      console.log(`💤 Making ${callsNeeded} sequential calls for ${videoCount} videos`);
  
      for (let i = 0; i < callsNeeded && i < keys.length; i++) {
        const cursor = i * 30;
        const result = await this.makeAPICall(keys[i], { keyword, cursor, count: 30 });
        results.push(result);
        
        // Small delay between sequential calls to be respectful
        if (i < callsNeeded - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
  
      const successCount = results.filter(r => r.success).length;
      console.log(`✅ Sequential calls completed: ${successCount}/${results.length} successful`);
      
      return results;
    }

    /**
     * Active RapidAPI keys (for account-mode pagination in the route).
     */
    getActiveKeys(): APIKeyConfig[] {
      return this.keys.filter((k) => k.isActive);
    }
  
    /**
     * Check if current time is peak hours (12pm-2am)
     */
    isPeakHour(): boolean {
      const now = new Date();
      const hour = now.getHours();
      
      // Peak: 12pm-2am (12-23, 0-1)
      return (hour >= 12 && hour <= 23) || (hour >= 0 && hour <= 1);
    }
  
    /**
     * Get key usage statistics
     */
    getKeyUsageStats(): { [keyName: string]: any } {
      const stats: { [keyName: string]: any } = {};
      
      this.keys.forEach(key => {
        stats[key.name] = {
          isActive: key.isActive,
          callsThisMonth: key.callsThisMonth || 0,
          monthlyLimit: key.monthlyLimit,
          remainingCalls: key.monthlyLimit - (key.callsThisMonth || 0),
          lastUsed: key.lastUsed?.toISOString() || 'Never',
          usagePercentage: Math.round(((key.callsThisMonth || 0) / key.monthlyLimit) * 100)
        };
      });
  
      return stats;
    }
  
    /**
     * Reset monthly usage counters (call this on the 1st of each month)
     */
    resetMonthlyUsage(): void {
      this.keys.forEach(key => {
        key.callsThisMonth = 0;
      });
      console.log(`🔄 Monthly usage counters reset for all keys`);
    }
  }
  
  // Export singleton instance
  export const rapidAPIManager = new RapidAPIKeyManager();
  