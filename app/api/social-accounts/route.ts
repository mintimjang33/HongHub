import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase';

// 2026-09-17 신설 — 사용자 요청: "홍허브 메인화면 플랫폼 버튼들이 그냥 외부 링크만 있는데,
// 계정 채널 셋팅(API/설정 문구 등)을 하게 해두자". 기존 6개 플랫폼 버튼(유튜브/인스타/쓰레드/
// 페이스북/틱톡/네이버블로그)은 외부 사이트 링크로 그대로 두고, 그 아래에 플랫폼별 계정
// 목록을 등록/관리하는 섹션을 새로 추가하기 위한 API — _migration_16_social_accounts.sql
// 참고.
export async function GET() {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.from('hub_social_accounts').select('*').order('platform').order('sort_order').order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || !body.platform || !body.account_name) {
    return NextResponse.json({ error: 'platform, account_name이 필요합니다.' }, { status: 400 });
  }
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from('hub_social_accounts')
    .insert({
      platform: body.platform,
      account_name: body.account_name,
      setting_note: body.setting_note || null,
      admin_email: body.admin_email || null,
      site_id: body.site_id || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ account: data });
}
