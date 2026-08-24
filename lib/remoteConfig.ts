import { getSupabaseServerClient } from './supabase';

let cache: Record<string, string> | null = null;

/**
 * app_config 테이블(key/value)을 조회해서 캐시한다.
 * 유쇼츠(U-Short)가 이미 이 테이블에 ANTHROPIC_API_KEY / GEMINI_API_KEY 등을
 * 평문으로 저장해두었고, 같은 Supabase 프로젝트를 쓰는 HongHub에서도 그대로 읽을 수 있다.
 * Vercel 환경변수를 따로 설정할 필요가 없다 — 여기 없는 키만 process.env로 폴백한다.
 */
export async function getConfigValue(key: string): Promise<string | null> {
  if (process.env[key]) return process.env[key] as string;

  if (!cache) {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.from('app_config').select('key, value');
    if (error) {
      console.error('[remoteConfig] app_config 조회 실패:', error.message);
      cache = {};
    } else {
      cache = Object.fromEntries((data || []).map((row: { key: string; value: string }) => [row.key, row.value]));
    }
  }
  return cache[key] || null;
}
