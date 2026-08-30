import { NextResponse } from 'next/server';
import { searchShorts, fmtCount } from '../../../lib/youtubeSearch';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query')?.trim();
  if (!query) return NextResponse.json({ error: 'query가 필요합니다.' }, { status: 400 });

  const uploadWithinDays = Number(searchParams.get('uploadWithinDays') || 14);
  const maxSubscribers = searchParams.get('maxSubscribers') ? Number(searchParams.get('maxSubscribers')) : undefined;
  const minViews = Number(searchParams.get('minViews') || 10000);

  try {
    const results = await searchShorts({ query, uploadWithinDays, maxSubscribers, minViews });
    return NextResponse.json({
      results: results.map((r) => ({ ...r, subscriberLabel: fmtCount(r.subscriberCount), viewsLabel: fmtCount(r.views) })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
