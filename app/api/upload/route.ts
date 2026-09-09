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
  const TEXT_EXTENSIONS = new Set(['md', 'txt', 'csv', 'json', 'log']);
  const contentType = TEXT_EXTENSIONS.has(ext) ? 'text/plain; charset=utf-8' : file.type || 'application/octet-stream';

  const { error } = await supabase.storage
    .from('honghub-files')
    .upload(path, await file.arrayBuffer(), { contentType });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data } = supabase.storage.from('honghub-files').getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl, name: file.name });
}
