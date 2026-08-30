import { NextResponse } from 'next/server';
import { resolveChannelId, getChannelTopVideos, fmtCount } from '../../../lib/youtubeSearch';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const channelUrl = searchParams.get('channelUrl')?.trim();
  if (!channelUrl) return NextResponse.json({ error: 'channelUrl이 필요합니다.' }, { status: 400 });

  try {
    const channelId = await resolveChannelId(channelUrl);
    const results = await getChannelTopVideos({ channelId, maxResults: 10 });
    return NextResponse.json({ results: results.map((r) => ({ ...r, viewsLabel: fmtCount(r.views) })) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
