import { NextResponse } from 'next/server';
import { extractVideoId } from '../../../lib/youtube';
import { fetchYoutubeTranscript } from '../../../lib/youtube-transcript';

// U-Caption 크롬 확장(로컬 워커) 없이도 동작하는 자막 수집 폴백.
// 워크플로우 3번 패널이 U-Caption 큐(transcript-jobs)를 먼저 시도해보고 응답이 없거나
// 실패하면 이 엔드포인트로 자동 전환한다 — 크롬 확장 설치 여부와 무관하게 항상 시도된다.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const url = body?.url?.trim();
  if (!url) return NextResponse.json({ error: 'url이 필요합니다.' }, { status: 400 });

  const videoId = extractVideoId(url);
  if (!videoId) return NextResponse.json({ error: '유효한 유튜브 링크가 아닙니다.' }, { status: 400 });

  const result = await fetchYoutubeTranscript(videoId).catch(() => null);
  if (!result) {
    return NextResponse.json({ error: '이 영상은 자동 자막 수집이 안 돼요 — 직접 붙여넣어주세요.' }, { status: 404 });
  }
  return NextResponse.json({ transcript: result.transcript, lang: result.lang });
}
