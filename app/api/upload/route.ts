import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'file이 필요합니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;

  // 브라우저가 .md/.txt 등에 file.type을 빈 문자열로 주는 경우가 많고, 그럴 때
  // application/octet-stream으로 저장되면 charset 정보가 없어 브라우저가 다른 인코딩으로
  // 잘못 추측해 한글이 깨진다(실측 확인). 텍스트 확장자는 항상 utf-8을 명시한다.
  // 2026-09-16(23차) 수정 — 사용자 지적: "mlt파일 클릭하니까 이렇게 깨져서 나와". .mlt(Shotcut
  // 프로젝트)와 자막류(.srt/.vtt/.ass/.ssa)도 전부 UTF-8 평문 XML/텍스트인데 이 목록에 없어서
  // application/xml 또는 file.type(브라우저가 .srt에 붙이는 'text/plain'처럼 charset 없는 값)
  // 그대로 저장됐다 — 직접 열어보니 Supabase의 서빙 CDN이 'application/xml'은 charset 없이
  // 'text/plain'으로 내려버려 브라우저가 인코딩을 잘못 추측했다(실측 확인, app/api/render-position
  // 참고). 반대로 'text/plain; charset=utf-8'로 저장한 .md/.txt는 항상 정상 표시됐으므로, 텍스트성
  // 파일은 전부 이 값으로 통일한다.
  const TEXT_EXTENSIONS = new Set(['md', 'txt', 'csv', 'json', 'log', 'mlt', 'srt', 'vtt', 'ass', 'ssa']);
  const contentType = TEXT_EXTENSIONS.has(ext) ? 'text/plain; charset=utf-8' : file.type || 'application/octet-stream';

  const { error } = await supabase.storage
    .from('honghub-files')
    .upload(path, await file.arrayBuffer(), { contentType });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data } = supabase.storage.from('honghub-files').getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl, name: file.name });
}
