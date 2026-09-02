// U-Caption 크롬 확장(로컬 워커) 없이도 서버가 직접 유튜브 자막을 긁어오는 폴백.
// 로직은 U-Caption 저장소(mintimjang33/U-Caption, extension/background.js의
// fetchViaAndroidInnertube / parseTranscriptXml)를 그대로 포팅한 것 — 새로 짠 게 아니다.
//
// WEB 클라이언트로 발급받은 자막 트랙 URL은 PoToken이 없으면 항상 빈 응답(size 0)이라
// (U-Caption 계획서 2026-08-27 기록, curl로 직접 재현 확인됨) 그 방식으로는 안 된다.
// ANDROID 클라이언트로 위장해서 InnerTube `/player`를 호출하면, 그 클라이언트가 발급하는
// 자막 URL은 PoToken 없이도 실제 내용이 내려온다 — youtube-transcript-api(Python)도 쓰는
// 잘 알려진 우회법. 단, ANDROID가 주는 자막은 옛 `<text>` 포맷이 아니라 `<p><s>...` 중첩
// srv3 포맷이라 파서가 둘 다 처리해야 한다(U-Caption이 이미 이 문제를 겪고 고쳐둔 부분).

const ANDROID_INNERTUBE_KEY = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w';
const ANDROID_CONTEXT = { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } };

type CaptionTrack = { baseUrl: string; languageCode: string };

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ANDROID 클라이언트 발급 timedtext URL은 <p> 큐 블록 안에 <s> span이 중첩된 srv3 포맷으로
// 온다 — 구식 <text> 포맷을 쓰는 트랙도 섞여 있을 수 있어 둘 다 시도한다.
function parseTranscriptXml(xml: string): string {
  const textMatches = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)];
  const source = textMatches.length > 0 ? textMatches : [...xml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
  return source
    .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export async function fetchYoutubeTranscript(
  videoId: string
): Promise<{ ok: true; transcript: string; lang: string } | { ok: false; reason: string }> {
  const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${ANDROID_INNERTUBE_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: ANDROID_CONTEXT, videoId }),
  });
  if (!res.ok) return { ok: false, reason: `player 요청 실패: HTTP ${res.status}` };
  const data = await res.json();
  const tracks: CaptionTrack[] | undefined = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks || tracks.length === 0) {
    const playability = data?.playabilityStatus?.status;
    return { ok: false, reason: `자막 트랙 없음 (playabilityStatus=${playability})` };
  }

  const track = tracks.find((t) => t.languageCode === 'ko') || tracks.find((t) => t.languageCode?.startsWith('en')) || tracks[0];

  const xmlRes = await fetch(track.baseUrl);
  if (!xmlRes.ok) return { ok: false, reason: `자막 XML 요청 실패: HTTP ${xmlRes.status}` };
  const xml = await xmlRes.text();
  if (!xml || xml.trim().length === 0) return { ok: false, reason: '자막 XML 응답이 비어있음(빈 200)' };

  const transcript = parseTranscriptXml(xml);
  if (!transcript) return { ok: false, reason: '자막 XML 파싱 결과가 비어있음' };
  return { ok: true, transcript, lang: track.languageCode };
}
