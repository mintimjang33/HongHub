// 유튜브 URL(watch/youtu.be/shorts)에서 영상 ID만 뽑아낸다.
// transcript-jobs(U-Caption 큐 등록)와 transcript-fallback(서버 직접 수집) 양쪽에서 같이 쓴다.
export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (u.hostname.endsWith('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const shortsMatch = u.pathname.match(/^\/shorts\/([^/?]+)/);
      if (shortsMatch) return shortsMatch[1];
    }
  } catch {
    // not a valid URL
  }
  return null;
}
