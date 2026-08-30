// 유튜브 채널/영상 검색. U-Finder/U-OneShot과 같은 Supabase 프로젝트를 쓰기 때문에,
// 그 두 도구가 이미 app_config 테이블에 넣어둔 YouTube Data API 키를 그대로 읽어서 쓴다
// (새 키를 따로 발급/등록할 필요 없음).
// U-Finder MCP의 search_shorts 도구와 같은 로직(검색 → 영상 상세 → 채널 상세 → 필터/정렬)을
// 웹 UI에서 바로 쓸 수 있도록 이식한 버전.
import { getSupabaseServerClient } from './supabase';

const BASE = 'https://www.googleapis.com/youtube/v3';

export type ShortsResult = {
  videoId: string;
  title: string;
  url: string;
  channelId: string;
  channelTitle: string;
  channelUrl: string;
  subscriberCount: number;
  views: number;
  publishedAt: string;
  thumbnail: string;
};

let cachedKey: string | null = null;

async function apiKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('app_config').select('value').eq('key', 'YOUTUBE_DATA_API_KEY').maybeSingle();
  if (error || !data?.value) throw new Error('app_config에 YOUTUBE_DATA_API_KEY가 등록되어 있지 않습니다.');
  cachedKey = data.value as string;
  return cachedKey;
}

async function apiGet(path: string, params: Record<string, string | number | undefined>) {
  const url = new URL(`${BASE}/${path}`);
  url.searchParams.set('key', await apiKey());
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`YouTube API 오류 (${res.status}): ${body?.error?.message ?? res.statusText}`);
  }
  return res.json();
}

export async function searchShorts({
  query,
  uploadWithinDays = 14,
  maxSubscribers,
  minViews = 10000,
}: {
  query: string;
  uploadWithinDays?: number;
  maxSubscribers?: number;
  minViews?: number;
}): Promise<ShortsResult[]> {
  const publishedAfter = new Date(Date.now() - uploadWithinDays * 86400000).toISOString();
  const search = await apiGet('search', {
    part: 'snippet',
    type: 'video',
    q: query,
    order: 'viewCount',
    publishedAfter,
    videoDuration: 'short',
    maxResults: 50,
    regionCode: 'KR',
    relevanceLanguage: 'ko',
  });
  const videoIds: string[] = (search.items || []).map((it: { id: { videoId: string } }) => it.id.videoId).filter(Boolean);
  if (videoIds.length === 0) return [];

  const videosData = await apiGet('videos', { part: 'snippet,statistics,contentDetails', id: videoIds.join(',') });
  const videos = (videosData.items || []).filter((v: { contentDetails?: { duration?: string } }) => {
    const m = (v.contentDetails?.duration || '').match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
    const seconds = m ? (parseInt(m[1] || '0') * 60 + parseInt(m[2] || '0')) : 999;
    return seconds > 0 && seconds <= 60;
  });

  const channelIds = [...new Set(videos.map((v: { snippet: { channelId: string } }) => v.snippet.channelId))];
  const channelsData = channelIds.length ? await apiGet('channels', { part: 'snippet,statistics', id: channelIds.join(',') }) : { items: [] };
  const chMap = new Map((channelsData.items || []).map((c: { id: string }) => [c.id, c]));

  type YoutubeVideo = {
    id: string;
    snippet: { title: string; channelId: string; channelTitle: string; publishedAt: string; thumbnails?: Record<string, { url: string }> };
    statistics: { viewCount?: string };
  };
  type YoutubeChannel = { statistics: { subscriberCount?: string } };

  let results: ShortsResult[] = videos.map((v: YoutubeVideo) => {
    const ch = chMap.get(v.snippet.channelId) as YoutubeChannel | undefined;
    return {
      videoId: v.id,
      title: v.snippet.title,
      url: `https://youtube.com/watch?v=${v.id}`,
      channelId: v.snippet.channelId,
      channelTitle: v.snippet.channelTitle,
      channelUrl: `https://youtube.com/channel/${v.snippet.channelId}`,
      subscriberCount: Number(ch?.statistics.subscriberCount ?? 0),
      views: Number(v.statistics.viewCount ?? 0),
      publishedAt: v.snippet.publishedAt,
      thumbnail: v.snippet.thumbnails?.high?.url ?? v.snippet.thumbnails?.medium?.url ?? v.snippet.thumbnails?.default?.url ?? '',
    };
  });

  results = results.filter((r) => r.views >= minViews && (maxSubscribers ? r.subscriberCount <= maxSubscribers : true));
  results.sort((a, b) => b.views - a.views);

  // 채널당 조회수 1위 영상만 남긴다 (채널 발굴이 목적이라 같은 채널 중복은 불필요).
  const seenChannels = new Set<string>();
  const deduped: ShortsResult[] = [];
  for (const r of results) {
    if (seenChannels.has(r.channelId)) continue;
    seenChannels.add(r.channelId);
    deduped.push(r);
  }
  return deduped.slice(0, 20);
}

export function fmtCount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}천`;
  return `${n}`;
}
