'use client';

import { useEffect, useState } from 'react';

interface TwitterData {
  id: number;
  tweetId: string;
  text: string;
  createdAt: string;
  socialMetrics: {
    bookmarks: number;
    favorites: number;
    retweets: number;
    views: string;
    quotes: number;
    replies: number;
  };
  userInfo: {
    created_at: string;
    followers_count: number;
    friends_count: number;
    favourites_count: number;
    verified: boolean;
  };
  location: {
    extractedLocation: string | null;
    lat: number | null;
    lng: number | null;
    confidenceScore: number | null;
  };
  status: {
    verified: boolean;
    processedAt: string;
    updatedAt: string;
  };
}

export default function TwitterDataPage() {
  const [data, setData] = useState<TwitterData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'processed' | 'unprocessed'>('all');

  const fetchData = async (filterType: string) => {
    try {
      setLoading(true);
      const processedParam = filterType === 'processed' ? 'true' : filterType === 'unprocessed' ? 'false' : '';
      const response = await fetch(`/api/twitter/data?limit=50${processedParam ? `&processed=${processedParam}` : ''}`);
      const result = await response.json();
      
      if (result.success) {
        setData(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch Twitter data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(filter);
  }, [filter]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const calculateAccountAge = (createdAt: string) => {
    const created = new Date(createdAt);
    const now = new Date();
    const diffInDays = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    return diffInDays;
  };

  return (
    <div className="min-h-screen bg-slate-950 px-5 py-6 font-sans text-slate-100">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <h1 className="mb-2 text-3xl font-bold text-white">
            Twitter Data Dashboard
          </h1>
          <p className="mb-5 text-sm text-slate-400">
            View and analyze Twitter data from &quot;Melbourne protest&quot; searches
          </p>

          <div className="flex flex-wrap gap-3">
            {(['all', 'processed', 'unprocessed'] as const).map((filterType) => {
              const isActive = filter === filterType;

              return (
                <button
                  key={filterType}
                  onClick={() => setFilter(filterType)}
                  className={`rounded-md border px-4 py-2 text-sm capitalize transition-colors ${
                    isActive
                      ? 'border-blue-500 bg-blue-600 text-white'
                      : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  {filterType} ({filterType === 'all' ? data.length :
                    filterType === 'processed' ? data.filter(d => d.location.extractedLocation).length :
                    data.filter(d => !d.location.extractedLocation).length})
                </button>
              );
            })}
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-6 py-16 text-center text-slate-300">
            <div className="text-lg">Loading Twitter data...</div>
          </div>
        ) : (
          <div className="grid gap-4">
            {data.map((tweet) => {
              const accountAge = calculateAccountAge(tweet.userInfo.created_at);
              const followerRatio = tweet.userInfo.friends_count > 0 ?
                (tweet.userInfo.followers_count / tweet.userInfo.friends_count) : 0;
              const isLikelyBot = accountAge < 30 || followerRatio < 0.1 ||
                tweet.userInfo.friends_count > tweet.userInfo.followers_count * 5;

              return (
                <div
                  key={tweet.id}
                  className={`rounded-xl border p-4 shadow-sm ${
                    tweet.location.extractedLocation
                      ? 'border-emerald-900 bg-slate-900'
                      : 'border-rose-900 bg-slate-900'
                  }`}
                >
                  <div className="mb-3 flex flex-col gap-2 text-sm md:flex-row md:items-start md:justify-between">
                    <div className="text-slate-200">
                      <strong className="text-white">Tweet #{tweet.id}</strong>
                      <span className="ml-2 text-slate-400">
                        ID: {tweet.tweetId}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400">
                      {formatDate(tweet.createdAt)}
                    </div>
                  </div>

                  <div className="mb-3 rounded-lg border border-slate-800 bg-slate-800/70 p-3 italic text-slate-100">
                    &quot;{tweet.text}&quot;
                  </div>

                  <div
                    className="mb-3 grid gap-2 text-xs text-slate-300"
                    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))' }}
                  >
                    <div>👀 {tweet.socialMetrics.views} views</div>
                    <div>🔄 {tweet.socialMetrics.retweets} retweets</div>
                    <div>❤️ {tweet.socialMetrics.favorites} likes</div>
                    <div>💬 {tweet.socialMetrics.replies} replies</div>
                    <div>📝 {tweet.socialMetrics.quotes} quotes</div>
                    <div>🔖 {tweet.socialMetrics.bookmarks} bookmarks</div>
                  </div>

                  <div
                    className={`mb-3 flex flex-col gap-2 rounded-md p-3 text-xs md:flex-row md:items-center md:justify-between ${
                      isLikelyBot
                        ? 'border border-rose-900/60 bg-rose-950/40 text-rose-100'
                        : 'border border-sky-900/60 bg-sky-950/40 text-sky-100'
                    }`}
                  >
                    <div>
                      <strong>{isLikelyBot ? 'Potential Bot' : 'User Account'}</strong>
                      <div className="mt-1">
                        Age: {accountAge} days | Followers: {tweet.userInfo.followers_count?.toLocaleString()} | Following: {tweet.userInfo.friends_count?.toLocaleString()}
                      </div>
                    </div>
                    {tweet.userInfo.verified && (
                      <div className="font-medium text-blue-300">Verified</div>
                    )}
                  </div>

                  {tweet.location.extractedLocation ? (
                    <div className="rounded-md border border-emerald-900/60 bg-emerald-950/40 p-3 text-sm text-emerald-100">
                      <strong>Location:</strong> {tweet.location.extractedLocation}
                      <br />
                      <strong>Confidence:</strong> {Math.round((tweet.location.confidenceScore || 0) * 100)}%
                      <br />
                      <strong>Coordinates:</strong> {tweet.location.lat?.toFixed(4)}, {tweet.location.lng?.toFixed(4)}
                    </div>
                  ) : (
                    <div className="rounded-md border border-rose-900/60 bg-rose-950/40 p-3 text-sm text-rose-200">
                      No location extracted
                    </div>
                  )}

                  <div className="mt-3 text-right text-xs text-slate-500">
                    {tweet.status.verified ? 'Verified' : 'Unverified'} | Updated: {formatDate(tweet.status.updatedAt)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
