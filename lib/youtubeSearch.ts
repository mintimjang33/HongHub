// 유튜브 채널의 인기 영상 조회. U-Finder/U-OneShot과 같은 Supabase 프로젝트를 쓰기 때문에,
// 그 두 도구가 이미 app_config 테이블에 넣어둔 YouTube Data API 키를 그대로 읽어서 쓴다
// (새 키를 따로 발급/등록할 필요 없음).
import { getConfigValue } from './remoteConfig';

const BASE = 'https://www.googleapis.com/youtube/v3';

export type ChannelVideo = {
  videoId: string;
  title: string;
  url: string;
  views: number;
  publishedAt: string;
  thumbnail: string;
  durationSeconds: number;
};

// ISO 8601 재생시간(PT1M5S 등)을 초 단위로 바꾼다.
export function parseDurationSeconds(iso: string | undefined): number {
  const m = (iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || '0') * 3600) + (parseInt(m[2] || '0') * 60) + parseInt(m[3] || '0');
}

export function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

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

async function apiKey(): Promise<string> {
  const key = await getConfigValue('YOUTUBE_DATA_API_KEY');
  if (!key) throw new Error('app_config에 YOUTUBE_DATA_API_KEY가 등록되어 있지 않습니다.');
  return key;
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
  // 핸들 부분은 \w로 제한하면 한글 핸들(예: @전세계건축물)을 못 잡으므로 경로 구분자 전까지 통째로 잡는다.
  const urlMatch = raw.match(/youtube\.com\/(?:channel\/(UC[\w-]{22})|@([^/?#]+)|c\/([^/?#]+)|user\/([^/?#]+))/i);
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

  const videosData = await apiGet('videos', { part: 'snippet,statistics,contentDetails', id: videoIds.join(',') });
  type YoutubeVideo = {
    id: string;
    snippet: { title: string; publishedAt: string; thumbnails?: Record<string, { url: string }> };
    statistics: { viewCount?: string };
    contentDetails?: { duration?: string };
  };
  const results: ChannelVideo[] = (videosData.items || []).map((v: YoutubeVideo) => ({
    videoId: v.id,
    title: v.snippet.title,
    url: `https://youtube.com/watch?v=${v.id}`,
    views: Number(v.statistics.viewCount ?? 0),
    publishedAt: v.snippet.publishedAt,
    thumbnail: v.snippet.thumbnails?.high?.url ?? v.snippet.thumbnails?.medium?.url ?? v.snippet.thumbnails?.default?.url ?? '',
    durationSeconds: parseDurationSeconds(v.contentDetails?.duration),
  }));
  results.sort((a, b) => b.views - a.views);
  return results;
}

// 이미 등록된 소재의 영상 길이만 나중에 채워 넣을 때 쓴다 (3번 패널의 "⏱ 길이 가져오기").
export async function getVideoDuration(videoId: string): Promise<number> {
  const data = await apiGet('videos', { part: 'contentDetails', id: videoId });
  return parseDurationSeconds(data.items?.[0]?.contentDetails?.duration);
}

// 키워드로 최근 업로드된 쇼츠를 검색해서 채널당 1개씩만 추린다 (1번 채널 발굴용).
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
