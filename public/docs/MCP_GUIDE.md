# 새 프로젝트에 MCP 서버 붙이는 방법 (표준)

> 클론 프로젝트의 마지막 단계(§8, `CLONE_PROCESS.md` 참고)에서 진행. 기능 클론과 실사용 검증이 다 끝난 뒤에 붙인다.

## 🔒 원칙: 새 기능은 웹페이지/API만으로 끝내지 않는다

**어떤 프로젝트든, 새로운 기능(테이블/API 엔드포인트)을 추가하면 그 즉시 대응하는 MCP 도구도 함께 만든다.** 웹 UI로만 끝내고 MCP 도구를 빼먹으면, 다음 대화에서 Claude가 그 기능을 조작하려 할 때 `run_sql`(SELECT 전용, 조회만 가능)로 우회하거나 아예 손을 못 대는 상황이 생긴다.

체크리스트 (기능 하나 추가할 때마다):
- [ ] 새 테이블/API에 대응하는 **조회(list_*)** 도구가 있는가
- [ ] **생성(add_*)** 도구가 있는가
- [ ] **수정(update_*)** 도구가 있는가 (필요한 경우)
- [ ] **삭제(delete_*)** 도구가 있는가 (필요한 경우)
- [ ] 그 기능이 외부 API 호출(AI 생성, 스크래핑 등)을 포함한다면, **그 전체 파이프라인을 한 번에 실행하는 도구**도 하나 있는가 (예: `import_source_url`이 og태그 추출+AI분류+DB저장을 한 번에 처리하는 것처럼)

이 원칙을 어기면 "웹사이트에는 있는데 Claude는 못 쓰는 기능"이 계속 쌓이게 된다.

## 왜 이 구조인가

Claude가 그 프로젝트의 DB/GitHub 코드/도메인 기능을 직접 조작할 수 있게 하려는 목적. 매 프로젝트마다 아래 4가지 조합이 표준 패턴:

1. **Supabase 범용 CRUD 툴**: `list_tables` / `get_rows` / `upsert_row` / `delete_row` / `run_sql`(SELECT 전용)
2. **도메인 특화 툴**: 그 프로젝트만의 핵심 동작(예: `publish_thread_post`, `search_coupang_products`, `import_source_url`)
3. **GitHub 읽기 툴**: `list_github_files` / `get_github_file` — 저장소 코드를 Claude가 언제든 직접 읽게
4. **공유 비밀키 인증**: `?key=` 쿼리파라미터를 `MCP_SHARED_SECRET` 환경변수와 대조하는 얇은 래퍼

## 설치

```bash
npm install mcp-handler zod
```

## 서버 코드 (`app/api/mcp/route.ts`)

**중요 — 버전에 따라 API가 다르다.** `mcp-handler` v2.1.1 기준(2026-08 현재) 실제로 동작 확인된 형태:

```ts
import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';

const baseHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      'tool_name',
      { description: '설명', inputSchema: z.object({ field: z.string() }) },
      async ({ field }) => {
        // ... 실제 로직 (Supabase 호출 등)
        return { content: [{ type: 'text', text: '결과' }] };
      }
    );
  },
  { verboseLogs: true } // ← options는 두 번째 인자 하나에 다 합칠 것 (3번째 인자 아님, v1 스타일과 다름)
);

async function authedHandler(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!process.env.MCP_SHARED_SECRET || key !== process.env.MCP_SHARED_SECRET) {
    return new Response(JSON.stringify({ error: '인증 필요 (key 파라미터 확인)' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return baseHandler(request);
}

export { authedHandler as GET, authedHandler as POST };
```

**흔한 실수**:
- ❌ `server.tool(name, description, shape, handler)` — 구버전(v1) API, 지금 버전엔 `.tool()` 메서드 자체가 없음(`Property 'tool' does not exist on type 'McpServer'`)
- ❌ `createMcpHandler(setupFn, metadataObj, optionsObj)` 3인자 — `Expected 1-2 arguments`로 빌드 실패. 옵션은 2번째 인자 하나로 합칠 것
- ✅ `server.registerTool(name, { description, inputSchema: z.object({...}) }, handler)` — inputSchema는 반드시 `z.object({...})`로 감쌀 것(raw shape도 동작은 하지만 deprecated)

## 환경변수

```
MCP_SHARED_SECRET=아무-랜덤-문자열
```
Vercel Production/Preview 둘 다에 등록.

## Claude 쪽 커넥터 등록

배포 후 MCP URL은 `https://{배포도메인}/api/mcp?key={MCP_SHARED_SECRET}` 형태. 이 URL을 Claude의 커넥터(MCP 서버) 등록 화면에 추가하면 새 딥레퍼드 툴(`mcp__{connectorId}__{toolName}`)로 나타난다.

## 확인 체크리스트

- [ ] `npx tsc --noEmit`으로 타입 에러 없음
- [ ] 로컬에서 `list_tables`류 조회 툴 실제 호출해서 실데이터 확인
- [ ] 잘못된 `key`로 호출 시 401 확인
- [ ] 쓰기 툴(`add_*`/`upsert_*`)은 실제로 행이 생기는지, 삭제 툴은 실제로 지워지는지 확인 — 스펙만 보고 됐다고 말하지 말 것
- [ ] **(신규 기능 추가 시) 위 "원칙" 섹션 체크리스트를 통과했는지 확인**
