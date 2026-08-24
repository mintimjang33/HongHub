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

export async function fetchOgMeta(url: string): Promise<{ title: string; description: string; siteName: string; hostname: string }> {
  const hostname = new URL(url).hostname;
  const pageRes = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; HongHubBot/1.0; +https://honghub.vercel.app)' },
    redirect: 'follow',
  });
  const html = await pageRes.text();
  const title = decodeHtmlEntities(extractMeta(html, 'og:title') || html.match(/<title>([^<]*)<\/title>/i)?.[1] || '제목 없음');
  const description = decodeHtmlEntities(extractMeta(html, 'og:description') || '');
  const siteName = decodeHtmlEntities(extractMeta(html, 'og:site_name') || hostname);
  return { title, description, siteName, hostname };
}
