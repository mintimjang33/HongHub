import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'file이 필요합니다.' }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const ext = file.name.split('.').pop() || 'bin';
  const path = `${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from('honghub-files')
    .upload(path, await file.arrayBuffer(), { contentType: file.type || 'application/octet-stream' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data } = supabase.storage.from('honghub-files').getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl, name: file.name });
}
