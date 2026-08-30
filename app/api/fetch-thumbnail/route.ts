import { NextResponse } from 'next/server';
import { fetchOgMeta } from '../../../lib/ogMeta';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url')?.trim();
  if (!url) return NextResponse.json({ error: 'url이 필요합니다.' }, { status: 400 });

  try {
    const meta = await fetchOgMeta(url);
    return NextResponse.json({ image: meta.image });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
