import { NextResponse } from 'next/server';
import { parseClipPositions, setClipPosition, setClipTrack, setClipRange, fetchAndUpload } from '../../../lib/mltClipPosition';

// 2026-09-16(16차) 신설 — 사용자 요청: "14번에서 영상 앞의 1초를 잘르는 편집을 해달라는게
// 아니라, 위치만 정확하게 셋팅하고 싶은거야 — 숏컷 셋팅파일에다가". 실제 업로드된 .mlt 파일을
// 뜯어보면, 영상 클립마다 자기 트랙(playlist)이 있고 클립 앞에 <blank length="..."/>(빈 구간)
// 하나만 있다 — 그 blank 길이가 곧 "이 클립이 타임라인에서 시작하는 위치"다(예: blank 11초 =
// 11초 지점에서 시작). "클립을 1초 앞으로"는 영상 내용(in/out)은 그대로 두고 이 blank 길이만
// 줄이면 된다 — 트리밍이 아니라 순수한 위치 이동.
//
// (17차) 추가 — 사용자 후속 요청: "모달에서 트랙번호 설정, 시간설정, 위치설정을 할 수 있게".
// 확인 결과 "시간"은 클립 재생 구간(트리밍)이 아니라 현재 길이를 참고로 보여주는 용도이고
// (트리밍은 명시적으로 원치 않음), "트랙번호"는 실제로 다른 트랙으로 옮기고 싶다는 뜻이었다.
// 지금 구조상 영상 클립마다 자기만의 전용 트랙(playlist)이 있어서, "다른 트랙으로 옮긴다"는
// 건 그 트랙에 원래 있던 클립과 자리를 통째로(blank+entry) 맞바꾸는 것으로 구현한다 — 트랙
// 개수·id 자체는 그대로 두고 내용물만 서로 바뀌므로 파일 구조가 깨질 위험이 없다.
//
// 2026-09-17 리팩터 — 사용자 지적: "기능 추가하면 mcp를 같이 추가하게끔 하라고 했는데" — 이
// 기능이 웹 API로만 있어서 로그인 세션 쿠키(middleware.ts) 없이는 MCP에서 손댈 방법이
// 없었다. 실제 클립 파싱/수정 로직을 lib/mltClipPosition.ts로 뽑아서 이 라우트와 MCP 도구
// (get_mlt_clip_positions/set_mlt_clip_position, app/api/mcp/route.ts)가 같은 코드를
// 공유하도록 바꿨다 — 이 파일은 이제 그 lib을 부르는 얇은 HTTP 래퍼일 뿐이다.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mltUrl = searchParams.get('mltUrl');
  if (!mltUrl) return NextResponse.json({ error: 'mltUrl이 필요합니다.' }, { status: 400 });

  const fileRes = await fetch(mltUrl);
  if (!fileRes.ok) return NextResponse.json({ error: `mlt 파일을 불러오지 못했습니다 (HTTP ${fileRes.status})` }, { status: 502 });
  const xml = await fileRes.text();
  return NextResponse.json(parseClipPositions(xml));
}

export async function POST(request: Request) {
  const body = await request.json();
  const { mltUrl, file, action } = body as { mltUrl?: string; file?: string; action?: 'position' | 'track' | 'range' };
  if (!mltUrl || !file) return NextResponse.json({ error: 'mltUrl, file이 필요합니다.' }, { status: 400 });

  let result;
  if (action === 'track') {
    const trackNumber = Number((body as { trackNumber?: number }).trackNumber);
    if (!Number.isFinite(trackNumber) || trackNumber < 1) {
      return NextResponse.json({ error: 'trackNumber(1 이상)가 필요합니다.' }, { status: 400 });
    }
    result = await fetchAndUpload(mltUrl, (xml) => setClipTrack(xml, file, trackNumber));
  } else if (action === 'range') {
    const inMs = Number((body as { inMs?: number }).inMs);
    const outMs = Number((body as { outMs?: number }).outMs);
    if (!Number.isFinite(inMs) || inMs < 0 || !Number.isFinite(outMs) || outMs <= inMs) {
      return NextResponse.json({ error: 'inMs(0 이상), outMs(inMs보다 커야 함)가 필요합니다.' }, { status: 400 });
    }
    result = await fetchAndUpload(mltUrl, (xml) => setClipRange(xml, file, inMs, outMs));
  } else {
    const positionMs = Number((body as { positionMs?: number }).positionMs);
    if (!Number.isFinite(positionMs) || positionMs < 0) {
      return NextResponse.json({ error: 'positionMs(0 이상)가 필요합니다.' }, { status: 400 });
    }
    result = await fetchAndUpload(mltUrl, (xml) => setClipPosition(xml, file, positionMs));
  }

  if ('error' in result) {
    const message =
      action === 'range' && result.status === 404
        ? '이 구간은 설정할 수 없습니다(끝이 원본 영상 길이를 넘거나 시작보다 앞섭니다) — 또는 클립을 찾지 못했습니다.'
        : result.error;
    return NextResponse.json({ error: message }, { status: result.status });
  }
  return NextResponse.json({ ok: true, ...parseClipPositions(result.xml) });
}
