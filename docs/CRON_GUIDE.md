# 예약/반복 작업(크론) 붙이는 방법 (표준)

> "예약발행", "매일 자동 실행" 같은 기능이 필요할 때 참고하는 표준 절차.

## 왜 이 방식인가 (트리거 선택 기준)

Vercel 자체 Cron Jobs는 **Hobby(무료) 플랜에서 하루 1회 실행 제한**이 있어서, 분 단위/시간 단위로 자주 도는 작업엔 못 쓴다. GitHub Actions의 `schedule:` 트리거는 무료지만 공식 문서에 **"best-effort"라 지연될 수 있고, 저장소가 60일간 비활성이면 자동으로 꺼진다**는 단점이 있다.

**표준 선택: 외부 무료 크론 서비스(cron-job.org)** — 분 단위 정확도, 헤더 커스터마이징 가능, 완전 무료.

## 구현 순서

### 1. DB에 예약 상태 컬럼 추가
작업 대상 테이블에 최소한 아래가 필요:
- `status` (예: `draft` / `scheduled` / `publishing` / `posted` / `failed`)
- `scheduled_at` (timestamptz)
- `publish_error` (text, 실패 사유 기록용)

### 2. 실행 로직을 공용 함수로 뽑기
수동 실행 버튼과 크론 잡이 **같은 함수**를 호출하게 만든다(로직이 두 곳에서 갈라지면 나중에 반드시 어긋난다). 예: `lib/publishXxxNow.ts`에 실제 로직, `publishScheduledXxx()`가 그걸 감싸서 상태 갱신까지 처리.

### 3. 크론이 때릴 API 라우트 작성
```ts
// app/api/cron/{작업이름}/route.ts
export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  // status='scheduled' AND scheduled_at <= now() 인 행을 조회해서 처리
  // ...
  return Response.json({ processed: N, results: [...] });
}
```

### 4. `CRON_SECRET` 환경변수 발급 + Vercel에 등록
랜덤 문자열 생성해서 Vercel Production/Preview에 등록. **절대 채팅에 평문으로 적지 말고 파일로 전달할 것.**

### 5. 로컬 커밋을 실제로 푸시했는지 확인
**실제로 겪은 실수**: 크론 라우트를 로컬에서 만들어놓고 커밋만 하고 푸시를 깜빡해서, 배포된 사이트엔 그 API 자체가 없어 404가 났던 적이 있다. 크론 설정 전에 `git status -b --short`로 `ahead`가 없는지, 배포에 실제로 반영됐는지 확인할 것.

### 6. cron-job.org에 잡 등록
1. cron-job.org 가입/로그인 (계정 생성은 사용자가 직접 — Claude 대행 불가)
2. Create cronjob → URL에 `https://{배포도메인}/api/cron/{작업이름}` 입력
3. 실행 주기 설정(예: 5~10분마다)
4. **Advanced 탭에서 Custom Header 추가 필수**: `Authorization: Bearer {CRON_SECRET}` — 이거 빠뜨리면 인증 실패. **실제로 겪은 실수**: 헤더 설정을 빼먹은 채로 저장해서 첫 실행이 계속 401 났던 적이 있다.
5. 저장 후 **Test Run**으로 즉시 1회 실행해서 응답 확인(curl로도 직접 호출해서 재확인하면 더 확실함)

### 7. 검증 체크리스트
- [ ] `curl -H "Authorization: Bearer {CRON_SECRET}" https://.../api/cron/{작업이름}` 가 200과 정상 JSON을 반환하는가
- [ ] 잘못된/누락된 헤더로 호출하면 401이 나는가
- [ ] 실제로 `scheduled_at`이 과거인 테스트 행을 하나 만들어서, 크론이 돌고 난 뒤 상태가 `posted`(또는 해당 성공 상태)로 바뀌는가
- [ ] 실패 케이스(예: 잘못된 데이터)를 하나 넣어서 `status='failed'` + `publish_error`에 사유가 기록되는가

**절대 "설정만 해놓고 됐다고 말하지 말 것"** — 위 체크리스트를 실제로 통과시켜야 완료.
