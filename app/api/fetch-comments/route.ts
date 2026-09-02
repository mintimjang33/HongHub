import { NextResponse } from 'next/server';
import { getVideoComments } from '../../../lib/youtubeSearch';
import { extractVideoId } from '../../../lib/youtube';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url')?.trim();
  if (!url) return NextResponse.json({ error: 'url이 필요합니다.' }, { status: 400 });

  const videoId = extractVideoId(url);
  if (!videoId) return NextResponse.json({ error: '유효한 유튜브 링크가 아닙니다.' }, { status: 400 });

  try {
    const result = await getVideoComments(videoId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
