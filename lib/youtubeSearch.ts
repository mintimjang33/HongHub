// 유튜브 채널의 인기 영상 조회. U-Finder/U-OneShot과 같은 Supabase 프로젝트를 쓰기 때문에,
// 그 두 도구가 이미 app_config 테이블에 넣어둔 YouTube Data API 키를 그대로 읽어서 쓴다
// (새 키를 따로 발급/등록할 필요 없음).
import { getSupabaseServerClient } from './supabase';

const BASE = 'https://www.googleapis.com/youtube/v3';

export type ChannelVideo = {
  videoId: string;
  title: string;
  url: string;
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

// 채널 URL/핸들/ID 아무거나 받아서 실제 채널ID(UC...)로 바꿔준다.
export async function resolveChannelId(input: string): Promise<string> {
  const raw = input.trim();
  if (/^UC[\w-]{22}$/.test(raw)) return raw;

  let handle = raw;
  const urlMatch = raw.match(/youtube\.com\/(?:channel\/(UC[\w-]{22})|@([\w.-]+)|c\/([\w.-]+)|user\/([\w.-]+))/i);
  if (urlMatch) {
    if (urlMatch[1]) return urlMatch[1];
    handle = urlMatch[2] || urlMatch[3] || urlMatch[4];
  }
  handle = handle.replace(/^@/, '');

  const byHandle = await apiGet('channels', { part: 'id', forHandle: `@${handle}` });
  if (byHandle.items?.[0]?.id) return byHandle.items[0].id;

  const byUsername = await apiGet('channels', { part: 'id', forUsername: handle });
  if (byUsername.items?.[0]?.id) return byUsername.items[0].id;

  const bySearch = await apiGet('search', { part: 'snippet', type: 'channel', q: raw, maxResults: 1 });
  const chId = bySearch.items?.[0]?.snippet?.channelId ?? bySearch.items?.[0]?.id?.channelId;
  if (chId) return chId;

  throw new Error(`채널을 찾을 수 없습니다: ${raw}`);
}

// 채널 하나를 지정해서 그 채널의 조회수 상위 영상을 가져온다 (채널별 소재 수집용).
export async function getChannelTopVideos({
  channelId,
  maxResults = 10,
}: {
  channelId: string;
  maxResults?: number;
}): Promise<ChannelVideo[]> {
  const search = await apiGet('search', {
    part: 'snippet',
    type: 'video',
    channelId,
    order: 'viewCount',
    maxResults,
  });
  const videoIds: string[] = (search.items || []).map((it: { id: { videoId: string } }) => it.id.videoId).filter(Boolean);
  if (videoIds.length === 0) return [];

  const videosData = await apiGet('videos', { part: 'snippet,statistics', id: videoIds.join(',') });
  type YoutubeVideo = {
    id: string;
    snippet: { title: string; publishedAt: string; thumbnails?: Record<string, { url: string }> };
    statistics: { viewCount?: string };
  };
  const results: ChannelVideo[] = (videosData.items || []).map((v: YoutubeVideo) => ({
    videoId: v.id,
    title: v.snippet.title,
    url: `https://youtube.com/watch?v=${v.id}`,
    views: Number(v.statistics.viewCount ?? 0),
    publishedAt: v.snippet.publishedAt,
    thumbnail: v.snippet.thumbnails?.high?.url ?? v.snippet.thumbnails?.medium?.url ?? v.snippet.thumbnails?.default?.url ?? '',
  }));
  results.sort((a, b) => b.views - a.views);
  return results;
}

export function fmtCount(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}만`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}천`;
  return `${n}`;
}
