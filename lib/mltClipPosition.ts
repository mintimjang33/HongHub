import { getSupabaseServerClient } from './supabase';

// 2026-09-17 추출 — 사용자 지적: "기능 추가하면 mcp를 같이 추가하게끔 하라고 했는데" — 이 파일의
// 로직은 원래 app/api/render-position/route.ts 안에만 있어서, MCP(app/api/mcp/route.ts)에서는
// 로그인 세션 쿠키 없이 이 기능을 쓸 방법이 없었다. 두 곳(웹 API, MCP 도구)이 같은 로직을 쓰도록
// 여기로 뽑아서 공유 lib으로 만든다 — 로직을 복제하면 나중에 한쪽만 고치고 다른 쪽을 깜빡해서
// 어긋나는 사고가 나기 쉽다.

// mlt 타임코드("HH:MM:SS.mmm" 또는 "HH:MM:SS")를 밀리초로 변환.
export function timecodeToMs(tc: string): number {
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
export function msToTimecode(ms: number): string {
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

// entry의 in/out은 "타임라인에 걸린 구간"일 뿐이고, 실제로 그 파일에서 쓸 수 있는 최대 길이는
// <chain>/<producer> 태그 자체의 out 속성(원본 파일 전체 길이)이다 — 구간을 늘리려면(예: out을
// 뒤로 미루기) 이 최대치를 넘을 수 없다.
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

export function parseClipPositions(xml: string): { clips: ClipPosition[]; totalTracks: number } {
  const playlists = findVideoClipPlaylists(xml);
  return { clips: clipsFromPlaylists(xml, playlists), totalTracks: playlists.length };
}

// 특정 클립(파일명 기준)이 속한 트랙의 blank 길이를 바꿔서 타임라인 위치만 옮긴다. entry의
// in/out(실제 영상 내용 구간)은 절대 건드리지 않는다.
export function setClipPosition(xml: string, targetFile: string, newPositionMs: number): string | null {
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
export function setClipTrack(xml: string, targetFile: string, newTrackNumber: number): string | null {
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
export function setClipRange(xml: string, targetFile: string, newInMs: number, newOutMs: number): string | null {
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

export async function fetchAndUpload(mltUrl: string, transform: (xml: string) => string | null) {
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
  // 2026-09-16(23차) 수정 — 사용자 지적: "mlt파일 클릭하니까 이렇게 깨져서 나와". Storage
  // 객체 메타데이터에는 'application/xml'로 정확히 저장되는 게 실측 확인됐지만(Storage API로
  // 직접 조회: mimetype "application/xml"), Supabase가 공개 URL로 서빙할 때는 charset 없는
  // 'text/plain'으로 내려버려 브라우저가 인코딩을 잘못 추측해 한글이 깨졌다. .md/.txt처럼
  // 'text/plain; charset=utf-8'로 저장한 파일은 항상 정상 표시됐으므로(app/api/upload 참고)
  // 같은 값으로 통일한다.
  const { error } = await supabase.storage
    .from('honghub-files')
    .upload(storagePath, new TextEncoder().encode(updated), { contentType: 'text/plain; charset=utf-8', upsert: true });
  if (error) return { error: error.message, status: 500 } as const;
  return { xml: updated } as const;
}
