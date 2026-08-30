export function detectChannelPlatform(hostname: string): string {
  if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
  if (hostname.includes('tiktok.com')) return 'tiktok';
  if (hostname.includes('instagram.com')) return 'instagram';
  if (hostname.includes('threads.net') || hostname.includes('threads.com')) return 'threads';
  return 'community';
}

export function extractMeta(html: string, property: string): string | null {
  // property="og:title" content="..." 또는 content="..." property="og:title" 순서 둘 다 대응
  const re1 = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, 'i');
  return html.match(re1)?.[1] || html.match(re2)?.[1] || null;
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// 유튜브 watch/shorts 페이지는 봇 UA로 fetch하면 og태그가 없는 동의화면/빈 셸만 내려와서
// 제목이 " - YouTube"로만 잡히는 문제가 있었다(2026-08-30 실사용 중 발견) — 대신 공식 oEmbed
// API(인증 불필요, 공식 지원)로 title/author_name(채널명)/thumbnail_url을 확실하게 받는다.
async function fetchYoutubeOembed(url: string): Promise<{ title: string; siteName: string; image: string | null } | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      title: decodeHtmlEntities(data.title || '제목 없음'),
      siteName: decodeHtmlEntities(data.author_name || 'YouTube'),
      image: data.thumbnail_url || null,
    };
  } catch {
    return null;
  }
}

export async function fetchOgMeta(
  url: string
): Promise<{ title: string; description: string; siteName: string; hostname: string; image: string | null }> {
  const hostname = new URL(url).hostname;

  if (detectChannelPlatform(hostname) === 'youtube') {
    const oembed = await fetchYoutubeOembed(url);
    if (oembed) return { ...oembed, description: '', hostname };
  }

  const pageRes = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HongHubBot/1.0; +https://honghub.vercel.app)' },
    redirect: 'follow',
  });
  const html = await pageRes.text();
  const title = decodeHtmlEntities(extractMeta(html, 'og:title') || html.match(/<title>([^<]*)<\/title>/i)?.[1] || '제목 없음');
  const description = decodeHtmlEntities(extractMeta(html, 'og:description') || '');
  const siteName = decodeHtmlEntities(extractMeta(html, 'og:site_name') || hostname);
  const image = decodeHtmlEntities(extractMeta(html, 'og:image') || '') || null;
  return { title, description, siteName, hostname, image };
}
