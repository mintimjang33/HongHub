import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';

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

// mlt 타임코드("HH:MM:SS.mmm" 또는 "HH:MM:SS")를 밀리초로 변환.
function timecodeToMs(tc: string): number {
  const m = tc.trim().match(/^(\d+):(\d+):(\d+)(?:[.,](\d+))?$/);
  if (!m) return 0;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  const ms = m[4] ? parseInt(m[4].padEnd(3, '0').slice(0, 3), 10) : 0;
  return ((h * 60 + min) * 60 + s) * 1000 + ms;
}

// 밀리초 → mlt 타임코드("HH:MM:SS.mmm"). Shotcut이 실제 저장하는 자릿수(밀리초 3자리)를 그대로
// 맞춰야 Shotcut에서 다시 열었을 때 이질감 없이 표시된다.
function msToTimecode(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000);
  const min = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(min)}:${pad(s)}.${String(millis).padStart(3, '0')}`;
}

// resource 경로("C:/Users/.../S02.mp4")에서 실제 파일명만 소문자로 뽑아낸다 — 경로 구분자(\ 또는 /)
// 차이를 흡수하기 위함.
function baseName(resource: string): string {
  return (resource.split(/[\\/]/).pop() || '').toLowerCase();
}

// chain/producer id → 그 producer가 참조하는 실제 파일명(resource) 맵.
function buildResourceMap(xml: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /<(?:chain|producer) id="([^"]+)"[^>]*>([\s\S]*?)<\/(?:chain|producer)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const resMatch = m[2].match(/<property name="resource">([^<]*)<\/property>/);
    if (resMatch) map.set(m[1], baseName(resMatch[1]));
  }
  return map;
}

// tractor의 <track producer="playlistX" .../> 나열 순서 그대로 playlist id 배열을 뽑는다 —
// Shotcut의 실제 트랙 번호(V1, V2...)와 같은 순서다.
function getTrackOrder(xml: string): string[] {
  const tractorMatch = xml.match(/<tractor[^>]*>([\s\S]*?)<\/tractor>/);
  if (!tractorMatch) return [];
  return [...tractorMatch[1].matchAll(/<track producer="([^"]+)"[^/]*\/>/g)].map((m) => m[1]);
}

// 2026-09-16(21차) 추가 — 사용자 요청: "영상의 몇초부토 몇초까지만 사용하고 싶은지 정할수
// 있어?". entry의 in/out은 "타임라인에 걸린 구간"일 뿐이고, 실제로 그 파일에서 쓸 수 있는
// 최대 길이는 <chain>/<producer> 태그 자체의 out 속성(원본 파일 전체 길이)이다 — 구간을
// 늘리려면(예: out을 뒤로 미루기) 이 최대치를 넘을 수 없다.
function getSourceMaxMs(xml: string, producerId: string): number {
  const re = new RegExp(`<(?:chain|producer) id="${producerId}"[^>]*\\bout="([^"]+)"`);
  const m = xml.match(re);
  return m ? timecodeToMs(m[1]) : Infinity;
}

type PlaylistInfo = { id: string; body: string; start: number; end: number; producerId: string | null; fileName: string | null };

// 모든 playlist를 훑어서, "영상 클립 트랙"(entry가 정확히 1개이고 그 producer가 영상 파일인
// playlist)만 골라 위치 정보와 함께 tractor 트랙 순서 기준 번호를 매긴다. 이미지 슬라이드쇼
// 트랙(entry 수십~수백 개)이나 나레이션 트랙(오디오라 영상 확장자 필터에 안 걸림)은 자동 제외.
function findVideoClipPlaylists(xml: string): PlaylistInfo[] {
  const resourceMap = buildResourceMap(xml);
  const all: PlaylistInfo[] = [];
  const playlistRe = /<playlist id="([^"]*)">([\s\S]*?)<\/playlist>/g;
  let pm: RegExpExecArray | null;
  while ((pm = playlistRe.exec(xml))) {
    const body = pm[2];
    const entries = [...body.matchAll(/<entry producer="([^"]+)" in="([^"]+)" out="([^"]+)"\s*\/>/g)];
    if (entries.length !== 1) continue;
    const producerId = entries[0][1];
    const fileName = resourceMap.get(producerId) || null;
    if (!fileName || !/\.(mp4|mov|m4v)$/i.test(fileName)) continue;
    all.push({ id: pm[1], body, start: pm.index!, end: pm.index! + pm[0].length, producerId, fileName });
  }
  const order = getTrackOrder(xml);
  all.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return all;
}

// 2026-09-16(20차) 추가 — 사용자 요청: "앞쪽 1초를 자르고 싶은데 영상 편집기능은 없으니까".
// (21차) 확장 — 사용자 요청: "영상의 몇초부토 몇초까지만 사용하고 싶은지 정할수 있어?" — 앞만
// 자르는 게 아니라 시작/끝 구간 전체를 지정하도록 넓혔다. 위치(blank)는 "이 클립이 타임라인
// 어디서 시작하는지"고, inMs/outMs는 "그 클립이 소스 영상의 몇 초~몇 초 구간을 재생하는지"다.
// sourceMaxMs는 그 소스 파일이 실제로 가진 최대 길이(<chain>의 out 속성) — outMs는 이걸 넘을
// 수 없다(원본에 없는 구간을 만들어낼 수는 없으므로).
export type ClipPosition = {
  file: string;
  positionMs: number;
  durationMs: number;
  trackNumber: number;
  inMs: number;
  outMs: number;
  sourceMaxMs: number;
};

function clipsFromPlaylists(xml: string, playlists: PlaylistInfo[]): ClipPosition[] {
  return playlists.map((p, i) => {
    const entryMatch = p.body.match(/<entry producer="[^"]+" in="([^"]+)" out="([^"]+)"\s*\/>/)!;
    const blankMatch = p.body.match(/<blank length="([^"]+)"\s*\/>/);
    const inMs = timecodeToMs(entryMatch[1]);
    const outMs = timecodeToMs(entryMatch[2]);
    return {
      file: p.fileName!,
      positionMs: blankMatch ? timecodeToMs(blankMatch[1]) : 0,
      durationMs: outMs - inMs,
      trackNumber: i + 1,
      inMs,
      outMs,
      sourceMaxMs: getSourceMaxMs(xml, p.producerId!),
    };
  });
}

function parseClipPositions(xml: string): { clips: ClipPosition[]; totalTracks: number } {
  const playlists = findVideoClipPlaylists(xml);
  return { clips: clipsFromPlaylists(xml, playlists), totalTracks: playlists.length };
}

// 특정 클립(파일명 기준)이 속한 트랙의 blank 길이를 바꿔서 타임라인 위치만 옮긴다. entry의
// in/out(실제 영상 내용 구간)은 절대 건드리지 않는다.
function setClipPosition(xml: string, targetFile: string, newPositionMs: number): string | null {
  const playlists = findVideoClipPlaylists(xml);
  const target = playlists.find((p) => p.fileName === targetFile.toLowerCase());
  if (!target) return null;

  const newTc = msToTimecode(newPositionMs);
  const blankRe = /<blank length="[^"]+"\s*\/>/;
  const entryRe = new RegExp(`<entry producer="${target.producerId}"[^/]*/>`);
  let newBlock: string;
  if (blankRe.test(target.body)) {
    newBlock = target.body.replace(blankRe, `<blank length="${newTc}"/>`);
  } else if (newPositionMs > 0) {
    newBlock = target.body.replace(entryRe, (m) => `<blank length="${newTc}"/>\n    ${m}`);
  } else {
    return xml; // 이미 0초 위치인데 0으로 설정 요청 — 변경 없음
  }
  return xml.slice(0, target.start) + `<playlist id="${target.id}">${newBlock}</playlist>` + xml.slice(target.end);
}

// "다른 트랙 번호로 옮긴다" = 그 트랙에 원래 있던 내용(blank+entry 전체)과 이 클립의 내용을
// 통째로 맞바꾼다. 트랙 개수·순서·id 자체는 안 건드리고 내용물만 교환하므로 파일 구조가 깨질
// 위험이 없다 — 위치(블랭크 길이)는 각 트랙에 원래 있던 값을 그대로 따라간다(트랙을 옮기면 그
// 트랙의 기존 타이밍 자리를 물려받는 것).
function setClipTrack(xml: string, targetFile: string, newTrackNumber: number): string | null {
  const playlists = findVideoClipPlaylists(xml);
  const fromIdx = playlists.findIndex((p) => p.fileName === targetFile.toLowerCase());
  const toIdx = newTrackNumber - 1;
  if (fromIdx === -1 || toIdx < 0 || toIdx >= playlists.length) return null;
  if (fromIdx === toIdx) return xml; // 이미 그 트랙 — 변경 없음

  const from = playlists[fromIdx];
  const to = playlists[toIdx];
  // 뒤쪽(파일 안에서 더 나중에 나오는) 것부터 잘라내야 앞쪽 교체 시 인덱스가 안 밀린다.
  const [first, second] = from.start < to.start ? [from, to] : [to, from];
  const firstNewInner = first === from ? to.body : from.body;
  const secondNewInner = second === from ? to.body : from.body;
  return (
    xml.slice(0, first.start) +
    `<playlist id="${first.id}">${firstNewInner}</playlist>` +
    xml.slice(first.end, second.start) +
    `<playlist id="${second.id}">${secondNewInner}</playlist>` +
    xml.slice(second.end)
  );
}

// 클립이 소스 영상에서 사용하는 구간(in~out)을 통째로 바꾼다 — 위치(blank)는 절대 안
// 건드린다. newOutMs가 소스 파일의 실제 최대 길이(sourceMaxMs)를 넘거나, newInMs가 newOutMs
// 이상이면 거부한다(원본에 없는 구간을 만들 수는 없고, 구간이 뒤집힐 수도 없으므로).
function setClipRange(xml: string, targetFile: string, newInMs: number, newOutMs: number): string | null {
  const playlists = findVideoClipPlaylists(xml);
  const target = playlists.find((p) => p.fileName === targetFile.toLowerCase());
  if (!target) return null;

  const entryMatch = target.body.match(/<entry producer="[^"]+" in="([^"]+)" out="([^"]+)"\s*\/>/);
  if (!entryMatch || !target.producerId) return null;
  const sourceMaxMs = getSourceMaxMs(xml, target.producerId);
  if (newInMs < 0 || newOutMs <= newInMs || newOutMs > sourceMaxMs) return null;

  const newInTc = msToTimecode(newInMs);
  const newOutTc = msToTimecode(newOutMs);
  const oldEntryTag = entryMatch[0];
  const newEntryTag = oldEntryTag.replace(/ in="[^"]+"/, ` in="${newInTc}"`).replace(/ out="[^"]+"/, ` out="${newOutTc}"`);
  const newBlock = target.body.replace(oldEntryTag, newEntryTag);
  return xml.slice(0, target.start) + `<playlist id="${target.id}">${newBlock}</playlist>` + xml.slice(target.end);
}

async function fetchAndUpload(mltUrl: string, transform: (xml: string) => string | null) {
  const fileRes = await fetch(mltUrl);
  if (!fileRes.ok) return { error: `mlt 파일을 불러오지 못했습니다 (HTTP ${fileRes.status})`, status: 502 } as const;
  const xml = await fileRes.text();
  const updated = transform(xml);
  if (updated === null) return { error: '이 .mlt 파일 안에서 대상을 찾지 못했습니다.', status: 404 } as const;

  const marker = '/object/public/honghub-files/';
  const idx = mltUrl.indexOf(marker);
  if (idx === -1) return { error: '이 URL은 honghub-files Storage 경로가 아니라 덮어쓸 수 없습니다.', status: 400 } as const;
  const storagePath = mltUrl.slice(idx + marker.length).split('?')[0];

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.storage
    .from('honghub-files')
    .upload(storagePath, new TextEncoder().encode(updated), { contentType: 'application/xml', upsert: true });
  if (error) return { error: error.message, status: 500 } as const;
  return { xml: updated } as const;
}

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
