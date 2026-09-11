"""flow_econ_driver.py용 실시간 컨트롤 대시보드.
2026-09-10 — 워크플로우(hub_sites) 드롭다운 → 콘텐츠(script_draft.units) 드롭다운 →
씬 스크롤 리스트(각 씬 상태: 대기/진행/완료/실패) → 시작/멈춤 버튼까지 전부 여기서 조작한다.
Flow 옆 사이드패널(scripts/status_extension)이 이 서버(127.0.0.1:8799)를 iframe으로 띄운다.

사용법:
    python scripts/status_dashboard.py [port]
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

HERE = Path(__file__).resolve().parent
RUN_DIR = HERE.parent / "examples-economics-newstyle" / "dashboard_runs"
RUN_DIR.mkdir(parents=True, exist_ok=True)

# ── Supabase (읽기 전용: 워크플로우/콘텐츠 목록, scenePrompts 읽기만) ──────────
# 2026-09-10 — 다른 PC에서도 쓸 수 있도록, 이 팩 자체의 `.env.local`을 먼저 찾고
# (SETUP_OTHER_PC.md 참고), 없으면 이 PC에만 있던 예전 경로(U-Short 프로젝트)로 대체한다.
_env_candidates = [
    Path(__file__).resolve().parent.parent / ".env.local",
    Path(r"C:\Users\user\Downloads\U-Short\.env.local"),
]
_env_path = next((p for p in _env_candidates if p.exists()), None)
if _env_path is None:
    raise FileNotFoundError(
        "Supabase .env.local을 찾을 수 없습니다 — flow-media-pack/.env.local을 만드세요"
        "(SETUP_OTHER_PC.md, .env.local.example 참고)."
    )
_env = {}
for _line in _env_path.read_text(encoding="utf-8").splitlines():
    if "=" in _line and not _line.strip().startswith("#"):
        k, _, v = _line.partition("=")
        _env[k.strip()] = v.strip()
SUPA_URL = _env["NEXT_PUBLIC_SUPABASE_URL"]
SUPA_KEY = _env["SUPABASE_SERVICE_ROLE_KEY"]


def supa_headers():
    return {"apikey": SUPA_KEY, "Authorization": f"Bearer {SUPA_KEY}"}


def parse_scene_prompts(text: str):
    """SceneBlock 직렬화 포맷("### S01 제목\\n- 시간:...\\n- 이미지프롬프트:...")을 파싱.
    2026-09-10 — 원문 문서 순서가 뒤섞여 있어도(수동 편집 등) 항상 S01→S91 번호 순으로
    나오도록 씬 번호 기준으로 다시 정렬한다(사용자 지적: "프롬프트가 순서대로 나와야지")."""
    # 2026-09-10 수정 — \d\d(정확히 2자리)로 고정돼 있어서 100번대 이상 씬(예: S100)이
    # 앞 두 자리만 잘려 "S10"으로 잘못 파싱되고 겹치는 사고가 있었다(실제 108씬 코카콜라
    # 유닛에서 S100~S108이 전부 S10 하나로 뭉개짐). \d{2,4}로 자릿수 제한을 풀었다.
    blocks = re.split(r"\n(?=### S\d{2,4}\b)", text.strip())
    scenes = []
    for b in blocks:
        m_id = re.search(r"### (S(\d{2,4}))\s*(.*)", b)
        m_prompt = re.search(r"- 이미지프롬프트:\s*(.+)", b)
        # 2026-09-10 추가 — 서버를 재시작하면 메모리 속 실행 상태(_current)가 날아가서
        # 방금 완료된 씬도 화면엔 "pending"으로 보이는 문제가 있었다(사용자가 스샷으로 지적:
        # 실제론 완료·홍허브 등록까지 됐는데 목록만 pending). 어느 세션에서 확인하든 항상
        # 맞게 나오도록, DB에 이미 박힌 "- 장면이미지:" 줄 자체를 완료 여부의 근거로 삼는다.
        m_image = re.search(r"- 장면이미지:\s*(\S+)", b)
        if m_id and m_prompt:
            scenes.append({"id": m_id.group(1), "num": int(m_id.group(2)),
                           "title": m_id.group(3).strip(), "prompt": m_prompt.group(1).strip(),
                           "image_url": m_image.group(1).strip() if m_image else None})
    scenes.sort(key=lambda s: s["num"])
    return scenes


# ── 2026-09-11 추가 — 파일 업로드로 씬 등록 ──────────────────────────────────
# 사용자 요청: "여기에 파일업로드를 하나 추가하자~ 니가 만들어준 텍스트로 하는 방법" — 지금까지는
# Claude가 만든 JSON 씬 파일을 HongHub 앱(13번 패널)에 따로 가서 붙여넣어야 여기(이미지 생성
# 대시보드)에서 씬 목록이 보였다. 그 왕복을 없애고, 이 대시보드에서 바로 파일을 올리면 곧장
# scenePrompts에 등록되게 한다 — HongHub 앱의 registerParsed()/findSceneIssues()와 정확히
# 같은 포맷·같은 검증 규칙을 파이썬으로 그대로 옮겨서, 어느 경로로 등록하든 결과가 동일하다.
MAX_SCENE_SEC = 15
GAP_TOLERANCE_SEC = 1


def format_sec(sec: float) -> str:
    total = max(0, round(sec or 0))
    m, s = divmod(int(total), 60)
    return f"{m}:{s:02d}"


def find_scene_issues(scenes: list[dict]) -> list[str]:
    """HongHub 앱 step16-17-ImageVideoPanel.tsx의 findSceneIssues()와 동일한 규칙 —
    15초 초과 장면, 장면 간 시간 공백/겹침을 계산해서 문제 목록을 돌려준다."""
    issues = []
    prev_end = None
    for i, s in enumerate(scenes):
        start = s.get("startSec") or 0
        end = s.get("endSec") or 0
        dur = end - start
        label = s.get("id") or f"#{i + 1}"
        if dur > MAX_SCENE_SEC:
            issues.append(f"{label} ({format_sec(start)}~{format_sec(end)}): {dur:.1f}초 — 최대 {MAX_SCENE_SEC}초 초과")
        if prev_end is not None:
            gap = start - prev_end
            if abs(gap) > GAP_TOLERANCE_SEC:
                kind = "공백" if gap > 0 else "겹침"
                issues.append(f"{label} 앞 구간: {format_sec(prev_end)} → {format_sec(start)} 사이에 {kind} {abs(gap):.1f}초")
        prev_end = end
    return issues


def serialize_scenes(scenes: list[dict]) -> str:
    """HongHub 앱 utils.ts의 serializeSceneBlocks()와 동일한 SceneBlock 텍스트 포맷으로
    직렬화한다("### S01 제목\\n- 시간:...\\n- 이미지프롬프트:...\\n- 영상:...") — 이 포맷이어야
    parse_scene_prompts()와 HongHub 앱 양쪽에서 똑같이 읽힌다."""
    blocks = []
    for s in scenes:
        sid = s.get("id", "")
        title = s.get("screenDescription", "")
        lines = [f"### {sid}{' ' + title if title else ''}"]
        time_str = f"{format_sec(s.get('startSec') or 0)}-{format_sec(s.get('endSec') or 0)}"
        lines.append(f"- 시간: {time_str}")
        if s.get("sceneImage"):
            lines.append(f"- 장면이미지: {s['sceneImage']}")
        image_prompt = s.get("imagePrompt", "")
        if image_prompt:
            lines.append(f"- 이미지프롬프트: {image_prompt}")
        video_bits = []
        if s.get("needsVideoClip"):
            video_bits.append("[영상클립 필요]")
        if s.get("transitionPrompt"):
            video_bits.append(s["transitionPrompt"])
        if video_bits:
            lines.append(f"- 영상: {' '.join(video_bits)}")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def register_scenes(site_id: str, unit_id: str, scenes: list[dict]):
    if not scenes:
        return {"error": "등록할 씬이 없습니다(파일에서 JSON 배열을 못 찾음)."}
    issues = find_scene_issues(scenes)
    if issues:
        return {"error": "등록 중단 — 문제 발견:\n" + "\n".join(issues)}
    r = httpx.get(f"{SUPA_URL}/rest/v1/hub_sites", params={"id": f"eq.{site_id}", "select": "script_draft"},
                  headers=supa_headers(), timeout=30)
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return {"error": "사이트를 찾을 수 없습니다."}
    script_draft = rows[0].get("script_draft") or {}
    units = script_draft.get("units") or []
    unit = next((u for u in units if u.get("id") == unit_id), None)
    if not unit:
        return {"error": "콘텐츠(유닛)를 찾을 수 없습니다."}
    # 2026-09-11 실사고 방지 — 업로드한 JSON에는 애초에 "이미 생성된 이미지 URL" 필드가 없다
    # (Claude가 만드는 씬 파일은 시간·프롬프트만 담고, 이미지는 이 대시보드가 나중에 채운다).
    # 그래서 그냥 덮어쓰면 이미 생성·등록된 이미지가 전부 사라져서 "지우고 다시 만드는" 낭비가
    # 생긴다(사용자 지적: "이미지를 싹 지우고 올리고 하는게 문제아닐까?"). 기존 scenePrompts에서
    # 씬 id별 이미지 URL을 먼저 뽑아서, 업로드된 씬 중 같은 id가 있으면 그 URL을 그대로 이어붙인다.
    existing = {s["id"]: s["image_url"] for s in parse_scene_prompts(unit.get("scenePrompts") or "") if s["image_url"]}
    carried_over = 0
    for s in scenes:
        url = existing.get(s.get("id"))
        if url:
            s["sceneImage"] = url
            carried_over += 1
    unit["scenePrompts"] = serialize_scenes(scenes)
    patch = httpx.patch(f"{SUPA_URL}/rest/v1/hub_sites", params={"id": f"eq.{site_id}"},
                        headers={**supa_headers(), "Content-Type": "application/json"},
                        content=json.dumps({"script_draft": script_draft}).encode("utf-8"), timeout=30)
    patch.raise_for_status()
    return {"ok": True, "scene_count": len(scenes), "images_carried_over": carried_over}


# ── 2026-09-11 추가 — 이미지 링크 수동 등록 ──────────────────────────────────
# 사용자 지적: "1번이 아까 생성이 되었는데 기록이 안 되었나봐 → 이럴 때 수동으로 링크를
# 입력할 수 있었으면 하는데". flow_econ_driver.py가 완료 감지에 실패(최종 타임아웃 등)하면
# Flow 프로젝트 안엔 이미지가 실제로 만들어져 있어도 로컬 저장·Storage 업로드·scenePrompts
# 등록이 전부 스킵된다. 그 경우 사람이 Flow 화면에서 직접 이미지 URL을 복사해와 붙여넣으면
# 곧바로 그 씬의 "- 장면이미지:" 줄에 등록되게 한다(flow_econ_driver.py의
# register_scene_image()와 동일한 블록 편집 규칙 — 기존 파일 업로드는 안 하고 URL만 그대로 씀).
def set_scene_image_url(site_id: str, unit_id: str, scene_id: str, image_url: str):
    image_url = (image_url or "").strip()
    if not image_url:
        return {"error": "이미지 URL을 입력하세요."}
    r = httpx.get(f"{SUPA_URL}/rest/v1/hub_sites", params={"id": f"eq.{site_id}", "select": "script_draft"},
                  headers=supa_headers(), timeout=30)
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return {"error": "사이트를 찾을 수 없습니다."}
    script_draft = rows[0].get("script_draft") or {}
    units = script_draft.get("units") or []
    unit = next((u for u in units if u.get("id") == unit_id), None)
    if not unit:
        return {"error": "콘텐츠(유닛)를 찾을 수 없습니다."}
    text = unit.get("scenePrompts") or ""
    blocks = re.split(r"\n(?=### \S+)", text.strip()) if text.strip() else []
    changed = False
    new_blocks = []
    for b in blocks:
        if re.match(rf"### {re.escape(scene_id)}(\s|$)", b):
            lines = b.split("\n")
            lines = [ln for ln in lines if not ln.startswith("- 장면이미지:")]
            insert_at = 1
            for i, ln in enumerate(lines[1:], start=1):
                if ln.startswith("- 시간:"):
                    insert_at = i + 1
            lines.insert(insert_at, f"- 장면이미지: {image_url}")
            new_blocks.append("\n".join(lines))
            changed = True
        else:
            new_blocks.append(b)
    if not changed:
        return {"error": f"{scene_id} 씬을 찾을 수 없습니다."}
    unit["scenePrompts"] = "\n\n".join(new_blocks)
    patch = httpx.patch(f"{SUPA_URL}/rest/v1/hub_sites", params={"id": f"eq.{site_id}"},
                        headers={**supa_headers(), "Content-Type": "application/json"},
                        content=json.dumps({"script_draft": script_draft}).encode("utf-8"), timeout=30)
    patch.raise_for_status()
    return {"ok": True, "scene_id": scene_id, "image_url": image_url}


# ── 실행 중인 러너 상태 — 2026-09-10 수정: 계정(포트)별로 여러 개 동시 실행 지원 ─────
# 예전엔 프로세스 하나만 허용하는 단일 슬롯(_current)이었는데, 계정 3개(9223/9224/9225)로
# 병렬 처리하려면 포트별로 각자 추적해야 한다. 포트를 키로 하는 dict로 바꿨다.
_lock = threading.Lock()
_runs: dict[int, dict] = {}  # port -> {"proc":..., "run_dir":...}


def start_run(site_id: str, unit_id: str, scene_ids: list[str] | None = None,
              ratio: str = "16:9", new_project: bool = False, port: int = 9223,
              character_name: str = "", image_count: int = 1):
    with _lock:
        existing = _runs.get(port)
        if existing and existing["proc"] and existing["proc"].poll() is None:
            return {"error": f"포트 {port}에 이미 실행 중인 작업이 있습니다 — 먼저 멈춰주세요."}

        r = httpx.get(
            f"{SUPA_URL}/rest/v1/hub_sites",
            params={"id": f"eq.{site_id}", "select": "script_draft"},
            headers=supa_headers(), timeout=30,
        )
        r.raise_for_status()
        rows = r.json()
        if not rows:
            return {"error": "사이트를 찾을 수 없습니다."}
        units = (rows[0].get("script_draft") or {}).get("units") or []
        unit = next((u for u in units if u.get("id") == unit_id), None)
        if not unit:
            return {"error": "콘텐츠(유닛)를 찾을 수 없습니다."}
        scene_text = unit.get("scenePrompts") or ""
        scenes = parse_scene_prompts(scene_text)
        if not scenes:
            return {"error": "이 콘텐츠엔 등록된 씬 프롬프트가 없습니다(14번 단계 먼저 필요)."}
        # 2026-09-10 수정 — "이 씬만 생성"을 눌렀을 때 job["images"]를 그 씬 하나로 줄여버려서
        # 화면 목록(전체 108개)까지 그거 하나로 보이는 사고가 있었다("다른 건 다 사라졌다"는
        # 지적). images는 항상 전체 씬을 담고, 실제로 이번에 처리할 대상만 active_ids로 따로
        # 표시한다 — 목록 표시는 항상 전체 유지, 생성만 선택된 것으로 한정.
        active_ids = set(scene_ids) if scene_ids else {s["id"] for s in scenes}
        if not active_ids:
            return {"error": "선택된 씬이 없습니다."}

        # 2026-09-10 추가 — 포트별로 로컬 상태 파일(_flow_state.json/status.json/job.json)을
        # 따로 둔다 — 같은 파일을 여러 프로세스가 동시에 쓰면 로컬에서도 경쟁이 생긴다.
        run_dir = RUN_DIR / f"{unit_id}__{port}"
        run_dir.mkdir(parents=True, exist_ok=True)
        job = {
            "style": "",
            "ratio": ratio,
            "images": [{"id": s["id"], "prompt": s["prompt"]} for s in scenes],
            "active_ids": sorted(active_ids),
            "workflow": site_name_cache.get(site_id, ""),
            "content_no": None,
            "content_title": unit.get("title", ""),
            "step_no": 14,
            "step_name": "씬(스토리보드) 분할 · 이미지 프롬프트 작성 · 생성",
            # 2026-09-10 추가 — 생성 완료 시 flow_econ_driver.py가 Storage 업로드 +
            # scenePrompts의 sceneImage 자동 등록까지 하려면 이 두 id가 필요하다.
            "site_id": site_id,
            "unit_id": unit_id,
            # 2026-09-10 추가 — "일관성" 대응: 프로젝트 안에 미리 만들어둔 Flow 캐릭터 이름을
            # 넣으면 드라이버가 매 씬마다 자동으로 첨부한다(계정마다 캐릭터를 따로 만들어야
            # 하므로, 그 계정 프로젝트에 실제로 만들어둔 이름과 정확히 일치해야 함).
            "character_name": character_name.strip(),
            # 2026-09-11 추가 — 사용자 지시: 패널에서 켜고 끌 수 있는 설정으로 노출("1장으로
            # 지정할 수 있게 설정을 부분을 만들어줘"). True면 드라이버가 제출 프롬프트 맨 앞에
            # "이미지 1장만 만들어라" 지시를 붙인다(기본 켜짐 — Flow 에이전트가 스스로 여러 장을
            # 만드는 창작적 이탈을 줄이기 위함).
            "image_count": int(image_count),
        }
        job_path = run_dir / "job.json"
        job_path.write_text(json.dumps(job, ensure_ascii=False, indent=1), encoding="utf-8")
        (run_dir / "stop.flag").unlink(missing_ok=True)
        state_path = run_dir / "_flow_state.json"
        if new_project:
            # "새 프로젝트로 시작" 체크됨 — 기존 done/titles 기록(이미 생성된 씬)은 그대로 두고
            # project_url만 비워서 open_project(None)이 새 Flow 프로젝트를 만들게 한다.
            prev = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
            prev["project_url"] = None
            prev.setdefault("titles", {})
            prev.setdefault("done", {})
            prev["settings_done"] = False  # 새 프로젝트는 비율 설정도 새로 해야 한다
            state_path.write_text(json.dumps(prev, ensure_ascii=False, indent=1), encoding="utf-8")
        elif not state_path.exists():
            # 2026-09-10 실사고 수정 — 여기가 항상 빈 문자열("")이었는데 open_project("")는
            # falsy라 새 프로젝트를 만들어버린다(오늘 두 번째로 이 버그가 재발함, 엉뚱한
            # 프로젝트 779605ab...가 또 생김). 실제 진짜 프로젝트 URL을 직접 넣는다 — 단,
            # 이건 mintimjang33(9223) 계정 전용 프로젝트라 다른 포트(계정)엔 안 맞는다.
            # 다른 포트는 project_url을 비워서 그 계정에서 처음 한 번 새 프로젝트가 만들어지고,
            # 이후 이 상태 파일에 저장돼 같은 포트에서는 계속 재사용된다.
            default_project = (
                "https://flow.google.com/project/6f8960c1-1b98-4e73-b5c0-0e63010bf835"
                if port == 9223 else None
            )
            state_path.write_text(json.dumps({
                "project_url": os.environ.get("FLOW_PROJECT_URL", default_project),
                "titles": {}, "done": {},
            }, ensure_ascii=False, indent=1), encoding="utf-8")
        status_path = run_dir / "status.json"
        status_path.write_text(json.dumps({
            "phase": "idle", "total": len(scenes), "done_count": 0,
            "workflow": job["workflow"], "content_title": job["content_title"],
            "step_no": job["step_no"], "step_name": job["step_name"],
        }, ensure_ascii=False, indent=1), encoding="utf-8")

        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        env["BU_CDP_URL"] = f"http://127.0.0.1:{port}"
        env["FLOW_JOB"] = str(job_path)
        env["FLOW_STAGE"] = "images"
        log_path = run_dir / "run.log"
        proc = subprocess.Popen(
            [sys.executable, str(HERE / "flow_econ_driver.py")],
            cwd=str(HERE.parent), env=env,
            stdout=open(log_path, "w", encoding="utf-8"), stderr=subprocess.STDOUT,
        )
        _runs[port] = {"proc": proc, "run_dir": run_dir}
        # 2026-09-10 추가 — 드라이버가 시작하자마자 죽으면(예: Flow 크롬에 탭이 없어서 CDP
        # 연결 실패) 사용자 화면엔 "생성 눌러도 아무 반응 없음"으로만 보였다. 잠깐 기다렸다가
        # 바로 죽었으면 run.log 마지막 줄을 에러로 돌려줘서 최소한 원인은 바로 보이게 한다.
        time.sleep(1.5)
        if proc.poll() is not None:
            tail = log_path.read_text(encoding="utf-8", errors="replace").strip().splitlines()
            return {"error": f"포트 {port}: 생성이 시작되자마자 멈췄습니다: " + (tail[-1] if tail else "(로그 없음)")}
        return {"ok": True, "run_dir": str(run_dir), "scene_count": len(scenes), "port": port}


def stop_run(port: int):
    with _lock:
        run = _runs.get(port)
        if run and run.get("run_dir"):
            (run["run_dir"] / "stop.flag").write_text("stop", encoding="utf-8")
            return {"ok": True}
        return {"error": f"포트 {port}엔 실행 중인 작업이 없습니다."}


def worker_status():
    """2026-09-10 재설계 — 계정(포트) 여러 개를 동시에 돌리게 되면서, 씬 목록(done/pending)은
    더 이상 어느 한 프로세스의 로컬 상태만 보고 판단할 수 없다(다른 포트가 다른 씬을 끝낼
    수도 있으므로). 씬 목록은 /api/scenes(DB 직접 조회)가 계속 맡고, 여기서는 포트별
    "지금 뭘 하고 있는지"만 돌려준다 — 프론트가 이 둘을 합쳐서 보여준다."""
    with _lock:
        ports = list(_runs.keys())
    workers = []
    for port in ports:
        run_dir = _runs[port]["run_dir"]
        status = json.loads((run_dir / "status.json").read_text(encoding="utf-8")) if (run_dir / "status.json").exists() else {}
        status["port"] = port
        workers.append(status)
    return {"workers": workers}


site_name_cache: dict[str, str] = {}

HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>씬 이미지 생성 진행상황</title>
<style>
  body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:14px;font-size:13px}
  h1{font-size:15px;color:#9ad;margin:0 0 10px}
  select,button{background:#222;color:#eee;border:1px solid #444;border-radius:6px;padding:6px 8px;font-size:12px}
  select{width:100%;margin-bottom:8px}
  .row{display:flex;gap:8px;align-items:center;margin:6px 0}
  label{color:#999;min-width:70px}
  .badge{padding:2px 7px;border-radius:6px;font-size:11px;font-weight:700}
  .waiting,.submitting,.running{background:#553}
  .done{background:#265}
  .failed{background:#622}
  .idle,.pending{background:#333}
  .bar{background:#222;border-radius:6px;overflow:hidden;height:16px;flex:1}
  .fill{background:#4a8;height:100%;transition:width .3s}
  img{max-width:100%;border-radius:8px;border:1px solid #333;display:block;margin-top:6px}
  #startBtn{background:#275;font-weight:700}
  #stopBtn{background:#a33;font-weight:700}
  #scenes{max-height:340px;overflow-y:auto;border:1px solid #2a2a2a;border-radius:6px;margin-top:8px}
  .scene-row{display:flex;justify-content:space-between;gap:6px;padding:5px 8px;border-bottom:1px solid #222;font-size:11px}
  .scene-row:last-child{border-bottom:none}
  .scene-detail{background:#1a1a1a;padding:6px 10px;border-bottom:1px solid #222}
  .scene-id{color:#9ad;font-weight:700;min-width:32px}
  .scene-title{flex:1;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
</style></head>
<body>
  <h1>🎬 씬 이미지 생성 — 실시간 진행</h1>
  <div class="row"><label>워크플로우</label>
    <select id="siteSel" onchange="onSiteChange()"><option value="">불러오는 중...</option></select></div>
  <div class="row"><label>콘텐츠</label>
    <select id="unitSel" onchange="onUnitChange()"><option value="">워크플로우를 먼저 선택하세요</option></select></div>
  <div class="row"><label>씬 파일</label>
    <input type="file" id="sceneFileInput" accept=".txt,.json" style="flex:1;background:#222;color:#eee;border:1px solid #444;border-radius:6px;padding:4px;font-size:11px">
    <button onclick="uploadSceneFile()" style="background:#275;font-weight:700">📤 파일로 씬 등록</button></div>
  <div id="sceneFileResult" style="font-size:11px;color:#c66;white-space:pre-line;margin:-4px 0 6px"></div>
  <div class="row"><label>화면비율</label>
    <select id="ratioSel" onchange="saveUiState()">
      <option value="16:9">16:9 (가로)</option>
      <option value="9:16">9:16 (세로)</option>
      <option value="1:1">1:1 (정사각)</option>
    </select></div>
  <div class="row"><label><input type="checkbox" id="newProjectChk" onchange="saveUiState()"> 새 프로젝트로 시작</label></div>
  <div class="row"><label>생성 장수</label>
    <select id="imageCountSel" onchange="saveUiState()">
      <option value="1" selected>1장</option>
      <option value="2">2장</option>
      <option value="3">3장</option>
      <option value="4">4장</option>
    </select></div>
  <div class="row" style="margin-top:-4px"><span style="color:#777;font-size:10px">기본 1장 — 이 숫자를 프롬프트에 명시해서 Flow 에이전트가 제멋대로 몇 장씩 만드는 걸 막는다. 저장·홍허브 등록은 항상 가장 최근 1장만 됨(2장 이상 선택해도 나머지는 로컬에만 남고 등록 안 됨).</span></div>
  <div class="row"><label>캐릭터(선택)</label>
    <input type="text" id="characterNameInput" placeholder="예: Gentleman Rouge (일관성용, 계정 프로젝트에 미리 만들어둔 이름과 정확히 일치해야 함)" onchange="saveUiState()" style="width:100%;background:#222;color:#eee;border:1px solid #444;border-radius:6px;padding:6px 8px;font-size:12px"></div>
  <div class="row"><label>계정(포트)</label>
    <select id="portSel" onchange="saveUiState()">
      <option value="9223">mintimjang33 (9223)</option>
      <option value="9224">minsiljang0 (9224)</option>
      <option value="9225">minssajang (9225)</option>
      <option value="9226">minsiljjang (9226)</option>
    </select></div>
  <div class="row"><label>번호 범위</label>
    <input type="text" id="rangeInput" placeholder="예: 5~10 (비우면 체크된 씬 전부)" oninput="updateSelectedCount()" onchange="saveUiState()" style="width:100%;background:#222;color:#eee;border:1px solid #444;border-radius:6px;padding:6px 8px;font-size:12px"></div>
  <div class="row">
    <button id="startBtn" onclick="startRun()">▶ 이 콘텐츠로 시작</button>
    <button id="stopBtn" onclick="stopRun()">⏹ 지금 멈추기</button>
  </div>
  <div class="row">
    <button onclick="selectAll(true)">☑ 전체 선택</button>
    <button onclick="selectAll(false)">☐ 전체 해제</button>
    <button id="refreshBtn" onclick="refreshNow()">🔄 새로고침</button>
  </div>
  <hr style="border-color:#333">
  <div class="row"><b>⚡ 여러 계정 동시 시작</b></div>
  <div class="row"><label style="min-width:110px">9223 범위</label>
    <input type="text" id="range9223" placeholder="예: 5~9" onchange="saveUiState()" style="flex:1;background:#222;color:#eee;border:1px solid #444;border-radius:6px;padding:6px 8px;font-size:12px"></div>
  <div class="row"><label style="min-width:110px">9224 범위</label>
    <input type="text" id="range9224" placeholder="예: 10~14" onchange="saveUiState()" style="flex:1;background:#222;color:#eee;border:1px solid #444;border-radius:6px;padding:6px 8px;font-size:12px"></div>
  <div class="row"><label style="min-width:110px">9225 범위</label>
    <input type="text" id="range9225" placeholder="예: 15~19" onchange="saveUiState()" style="flex:1;background:#222;color:#eee;border:1px solid #444;border-radius:6px;padding:6px 8px;font-size:12px"></div>
  <div class="row"><label style="min-width:110px">9226 범위</label>
    <input type="text" id="range9226" placeholder="예: 20~24" onchange="saveUiState()" style="flex:1;background:#222;color:#eee;border:1px solid #444;border-radius:6px;padding:6px 8px;font-size:12px"></div>
  <div class="row"><button id="startAllBtn" onclick="startAllAccounts()" style="background:#275;font-weight:700;width:100%">▶▶▶ 여러 계정 동시 시작</button></div>
  <div id="startAllResult" style="font-size:11px;color:#c66"></div>
  <div class="row"><button id="autoDispatchBtn" onclick="autoDispatch()" style="background:#25a;font-weight:700;width:100%">🔀 대기 씬 자동 분배 시작 (9223~9226 균등 배분)</button></div>
  <div id="autoDispatchResult" style="font-size:11px;color:#c66"></div>
  <hr style="border-color:#333">
  <div class="row"><span>선택됨:</span><b id="selectedCount">0개</b> <span id="lastSync" style="color:#666;font-size:10px;margin-left:auto"></span></div>
  <div id="workers" style="width:100%"></div>
  <div id="failBanner" style="display:none;background:#3a1414;border:1px solid #a33;border-radius:6px;padding:8px;margin:6px 0;font-size:11px"></div>
  <div id="scenes"></div>
<script>
async function loadSites(){
  const r = await fetch('/api/sites');
  const sites = await r.json();
  const sel = document.getElementById('siteSel');
  sel.innerHTML = '<option value="">-- 선택 --</option>' + sites.map(s=>`<option value="${s.id}">${s.name} (${s.unit_count}개 콘텐츠)</option>`).join('');
}
let previewScenes = [];
// 2026-09-10 추가 — "선택한 상태를 기억하고 있을수 있어?"라는 요청으로, 워크플로우/콘텐츠/
// 비율/새프로젝트여부/진행개수를 localStorage에 저장해뒀다가 패널을 새로고침해도 복원한다.
function saveUiState(){
  localStorage.setItem('flowDashUi', JSON.stringify({
    siteId: document.getElementById('siteSel').value,
    unitId: document.getElementById('unitSel').value,
    ratio: document.getElementById('ratioSel').value,
    newProject: document.getElementById('newProjectChk').checked,
    range: document.getElementById('rangeInput').value,
    port: document.getElementById('portSel').value,
    range9223: document.getElementById('range9223').value,
    range9224: document.getElementById('range9224').value,
    range9225: document.getElementById('range9225').value,
    range9226: document.getElementById('range9226').value,
    characterName: document.getElementById('characterNameInput').value,
    imageCount: parseInt(document.getElementById('imageCountSel').value, 10),
  }));
}
// "9223에서 5개, 9224에서 5개, 9225에서 5개 각각 뽑아서 여기서 한번에 명령" 요청 —
// 계정별 범위 3칸을 한 번에 읽어서 /api/start를 포트마다 따로(순차) 호출한다.
function parseRangeStr(raw, scenes){
  raw = (raw||'').trim();
  if(!raw) return null;
  const m = raw.match(/^(\d+)\s*[~\-]\s*(\d+)$/);
  if(!m) return null;
  const lo = parseInt(m[1], 10), hi = parseInt(m[2], 10);
  return (scenes||[]).filter(s => s.num >= lo && s.num <= hi).map(s => s.id);
}
async function startAllAccounts(){
  const resultDiv = document.getElementById('startAllResult');
  resultDiv.textContent = '';
  const siteId = document.getElementById('siteSel').value;
  const unitId = document.getElementById('unitSel').value;
  if(!siteId || !unitId){ alert('워크플로우와 콘텐츠를 먼저 선택하세요.'); return; }
  const ratio = document.getElementById('ratioSel').value;
  const newProject = document.getElementById('newProjectChk').checked;
  const characterName = document.getElementById('characterNameInput').value;
  const imageCount = parseInt(document.getElementById('imageCountSel').value, 10);
  const ranges = {
    9223: document.getElementById('range9223').value,
    9224: document.getElementById('range9224').value,
    9225: document.getElementById('range9225').value,
    9226: document.getElementById('range9226').value,
  };
  const btn = document.getElementById('startAllBtn');
  btn.disabled = true; btn.textContent = '전송 중...';
  const lines = [];
  for(const portStr of Object.keys(ranges)){
    const port = parseInt(portStr, 10);
    const ids = parseRangeStr(ranges[portStr], previewScenes);
    if(ids === null) continue;
    if(!ids.length){ lines.push(`포트 ${port}: 해당 범위 씬 없음`); continue; }
    try{
      const r = await fetch('/api/start', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({site_id: siteId, unit_id: unitId, scene_ids: ids, ratio, new_project: newProject, port, character_name: characterName, image_count: imageCount})});
      const d = await r.json();
      lines.push(d.error ? `포트 ${port}: 실패 — ${d.error}` : `포트 ${port}: ${d.scene_count !== undefined ? ids.length : ''}개 시작됨`);
    }catch(e){ lines.push(`포트 ${port}: 요청 실패 — ${e}`); }
  }
  btn.disabled = false; btn.textContent = '▶▶▶ 여러 계정 동시 시작';
  resultDiv.style.color = lines.some(l=>l.includes('실패')) ? '#c66' : '#6a6';
  resultDiv.textContent = lines.join(' / ') || '범위를 하나 이상 입력하세요.';
}
// 2026-09-10 추가 — "창이 4개 떠 있으면 순서대로 돌아가면서 작업이 되어야 하는거 아니야?"
// 지적 — 위 startAllAccounts()는 사람이 계정별 범위를 직접 나눠 적어야 하는 1회성 기능이라,
// 대기(pending) 씬을 자동으로 계정 수만큼 균등하게 돌아가며(round-robin) 나눠서 한 번에
// 다 시작시키는 버튼을 별도로 추가한다. 각 계정은 배정받은 목록을 이후 순서대로 처리한다
// (계정 내부 순서는 driver가 이미 처리 — 여기선 "누구에게 어떤 씬을 줄지"만 나눈다).
async function autoDispatch(){
  const resultDiv = document.getElementById('autoDispatchResult');
  resultDiv.textContent = '';
  const siteId = document.getElementById('siteSel').value;
  const unitId = document.getElementById('unitSel').value;
  if(!siteId || !unitId){ alert('워크플로우와 콘텐츠를 먼저 선택하세요.'); return; }
  const pending = (previewScenes||[]).filter(s => s.status !== 'done').slice().sort((a,b)=>a.num-b.num);
  if(!pending.length){ resultDiv.style.color = '#6a6'; resultDiv.textContent = '대기 중인 씬이 없습니다 — 전부 완료 상태.'; return; }
  const ratio = document.getElementById('ratioSel').value;
  const newProject = document.getElementById('newProjectChk').checked;
  const characterName = document.getElementById('characterNameInput').value;
  const imageCount = parseInt(document.getElementById('imageCountSel').value, 10);
  const ports = [9223, 9224, 9225, 9226];
  const groups = {}; ports.forEach(p => groups[p] = []);
  pending.forEach((s, i) => groups[ports[i % ports.length]].push(s.id));
  const btn = document.getElementById('autoDispatchBtn');
  btn.disabled = true; btn.textContent = '전송 중...';
  const lines = [];
  for(const port of ports){
    const ids = groups[port];
    if(!ids.length) continue;
    try{
      const r = await fetch('/api/start', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({site_id: siteId, unit_id: unitId, scene_ids: ids, ratio, new_project: newProject, port, character_name: characterName, image_count: imageCount})});
      const d = await r.json();
      lines.push(d.error ? `포트 ${port}: 실패 — ${d.error}` : `포트 ${port}: ${ids.length}개 배정(${ids[0]}~${ids[ids.length-1]})`);
    }catch(e){ lines.push(`포트 ${port}: 요청 실패 — ${e}`); }
  }
  btn.disabled = false; btn.textContent = '🔀 대기 씬 자동 분배 시작 (9223~9226 균등 배분)';
  resultDiv.style.color = lines.some(l=>l.includes('실패')) ? '#c66' : '#6a6';
  resultDiv.textContent = lines.join(' / ');
}
// 2026-09-10 추가 — "진행개수보다 번호로 5~10 이렇게 지정하는 게 더 명확하겠다"는 요청.
// "5~10"/"5-10" 모두 허용, num(스토리보드 씬 번호) 기준으로 previewScenes에서 해당 범위의
// id만 순서대로 뽑는다. 비어있으면 null(범위 미사용, 기존 체크박스/진행개수 로직 그대로).
function rangeIds(){
  const raw = (document.getElementById('rangeInput').value || '').trim();
  if(!raw) return null;
  const m = raw.match(/^(\d+)\s*[~\-]\s*(\d+)$/);
  if(!m) return null;
  const lo = parseInt(m[1], 10), hi = parseInt(m[2], 10);
  return (previewScenes||[]).filter(s => s.num >= lo && s.num <= hi).map(s => s.id);
}
function loadUiState(){
  try { return JSON.parse(localStorage.getItem('flowDashUi') || '{}'); } catch(e) { return {}; }
}
async function onSiteChange(keepUnit){
  const siteId = document.getElementById('siteSel').value;
  const unitSel = document.getElementById('unitSel');
  saveUiState();
  if(!siteId){ unitSel.innerHTML = '<option value="">워크플로우를 먼저 선택하세요</option>'; return; }
  unitSel.innerHTML = '<option value="">불러오는 중...</option>';
  const r = await fetch('/api/units?site_id=' + encodeURIComponent(siteId));
  const units = await r.json();
  unitSel.innerHTML = units.map(u=>`<option value="${u.id}">${u.no?u.no+'번 · ':''}${u.title}${u.scene_count!=null?` (${u.scene_count}씬)`:''}</option>`).join('') || '<option value="">콘텐츠 없음</option>';
  if(keepUnit && [...unitSel.options].some(o=>o.value===keepUnit)) unitSel.value = keepUnit;
  await onUnitChange();
}
async function onUnitChange(){
  const siteId = document.getElementById('siteSel').value;
  const unitId = document.getElementById('unitSel').value;
  saveUiState();
  if(!siteId || !unitId){ previewScenes = []; return; }
  const r = await fetch('/api/scenes?site_id=' + encodeURIComponent(siteId) + '&unit_id=' + encodeURIComponent(unitId));
  previewScenes = await r.json();
  // 2026-09-10 — 이미 완료(done)된 씬은 기본적으로 체크 해제해서, 전체 시작을 눌러도
  // 다시 생성되며 섞이지 않게 한다("완성된 건 체크 해제해야 자동 진행에서 안 빠지지 않겠냐"는 지적).
  checkedIds = new Set(previewScenes.filter(s => s.status !== 'done').map(s => s.id));
  updateSelectedCount();
  renderScenes(previewScenes);
}
// 2026-09-11 추가 — 사용자 요청: "여기에 파일업로드를 하나 추가하자~ 니가 만들어준 텍스트로
// 하는 방법". Claude가 만든 씬 JSON 파일을 HongHub 앱(13번 패널)에 따로 안 가고 이 대시보드에서
// 바로 올려서 등록할 수 있게 한다. HongHub 앱의 extractSceneArrays()와 같은 방식으로, 파일
// 안에서 최상위 `[...]` JSON 배열 블록을 전부 찾아(문자열 안의 대괄호는 무시) 이어붙인다 —
// 여러 구간(청크)으로 나눠 만든 파일을 통째로 붙여넣어도 자동으로 합쳐진다.
function extractSceneArrays(raw){
  const results = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '[') {
      const start = i;
      let depth = 0, inString = false, escape = false, j = i;
      for (; j < raw.length; j++) {
        const ch = raw[j];
        if (inString) {
          if (escape) escape = false;
          else if (ch === '\\\\') escape = true;
          else if (ch === '"') inString = false;
        } else {
          if (ch === '"') inString = true;
          else if (ch === '[') depth++;
          else if (ch === ']') { depth--; if (depth === 0) { j++; break; } }
        }
      }
      const candidate = raw.slice(start, j);
      try { const parsed = JSON.parse(candidate); if (Array.isArray(parsed)) results.push(...parsed); }
      catch(e) { /* JSON 배열이 아니면 건너뜀 */ }
      i = Math.max(j, start + 1);
    } else { i++; }
  }
  return results;
}
async function uploadSceneFile(){
  const resultDiv = document.getElementById('sceneFileResult');
  const siteId = document.getElementById('siteSel').value;
  const unitId = document.getElementById('unitSel').value;
  if(!siteId || !unitId){ alert('워크플로우와 콘텐츠를 먼저 선택하세요.'); return; }
  const fileInput = document.getElementById('sceneFileInput');
  const file = fileInput.files[0];
  if(!file){ alert('파일을 먼저 선택하세요.'); return; }
  resultDiv.style.color = '#999'; resultDiv.textContent = '읽는 중...';
  const text = await file.text();
  const scenes = extractSceneArrays(text);
  if(!scenes.length){ resultDiv.style.color = '#c66'; resultDiv.textContent = '❌ 파일에서 JSON 배열을 찾지 못했습니다.'; return; }
  resultDiv.textContent = `${scenes.length}개 파싱됨 — 등록 중...`;
  try{
    const r = await fetch('/api/register_scenes', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({site_id: siteId, unit_id: unitId, scenes})});
    const d = await r.json();
    if(d.error){ resultDiv.style.color = '#c66'; resultDiv.textContent = '⚠ ' + d.error; return; }
    resultDiv.style.color = '#6a6';
    resultDiv.textContent = `✅ ${d.scene_count}개 씬 등록 완료` + (d.images_carried_over ? ` (기존 생성 이미지 ${d.images_carried_over}개 유지됨)` : '');
    fileInput.value = '';
    await onUnitChange();
  }catch(e){ resultDiv.style.color = '#c66'; resultDiv.textContent = '⚠ 요청 실패: ' + e; }
}
let checkedIds = null; // null = 전체 선택(기본), Set이면 그 안의 id만 선택됨
let promptById = {};
// 2026-09-10 수정 — 계정(포트) 여러 개가 동시에 서로 다른 씬을 처리할 수 있게 되면서,
// "지금 하나만 펼침"이 아니라 "지금 실행 중인 애들은 전부(여러 개) 펼침"으로 바꿨다.
let expandedIds = new Set();
let imageUrlById = {};
function renderScenes(scenes){
  const list = document.getElementById('scenes');
  (scenes||[]).forEach(sc => {
    if(sc.prompt) promptById[sc.id] = sc.prompt;
    if(sc.image_url) imageUrlById[sc.id] = sc.image_url;
  });
  list.innerHTML = (scenes||[]).map(sc => {
    const checked = checkedIds === null || checkedIds.has(sc.id);
    const isOpen = expandedIds.has(sc.id);
    const full = promptById[sc.id] || '';
    const imgUrl = imageUrlById[sc.id];
    const doneBlock = imgUrl
      ? `<div style="margin:6px 0"><img src="${imgUrl}" style="max-width:100%;border-radius:8px;border:1px solid #333;display:block;margin-bottom:4px">`
        + `<div style="display:flex;gap:6px;align-items:center">`
        + `<button onclick="navigator.clipboard.writeText('${imgUrl}')">🔗 링크 복사</button>`
        + `<span style="color:#6a6;font-size:11px">✓ 홍허브 저장완료</span></div>`
        + `<input type="text" readonly value="${imgUrl}" onclick="this.select()" style="width:100%;margin-top:4px;background:#111;color:#9ad;border:1px solid #333;border-radius:4px;padding:4px 6px;font-size:10px">`
        + `</div>`
      : '';
    return `<div class="scene-row" onclick="toggleExpand('${sc.id}')" style="cursor:pointer">`
      + `<input type="checkbox" class="scene-chk" data-id="${sc.id}" ${checked?'checked':''} onclick="event.stopPropagation()" onchange="onCheckChange()">`
      + `<span class="scene-id">${sc.id}</span><span class="scene-title">${sc.title}</span><span class="badge ${sc.status}">${sc.status}</span></div>`
      + (isOpen ? `<div class="scene-detail" onclick="event.stopPropagation()">`
          + `<div style="white-space:pre-wrap;color:#ccc;font-size:11px;margin:4px 0">${full.replace(/</g,'&lt;')}</div>`
          + doneBlock
          + `<button onclick="copyPrompt('${sc.id}')">📋 복사</button>`
          + `<button onclick="startOne('${sc.id}')" style="margin-left:6px;background:#275">▶ 생성</button>`
          + `<div style="display:flex;gap:4px;margin-top:6px">`
          + `<input type="text" id="manualUrl_${sc.id}" placeholder="Flow에서 완성됐는데 등록이 안 됐으면 이미지 URL을 여기 붙여넣기" style="flex:1;background:#111;color:#9ad;border:1px solid #333;border-radius:4px;padding:4px 6px;font-size:10px">`
          + `<button onclick="setSceneImageUrl('${sc.id}')" style="background:#358">🔗 링크로 등록</button></div></div>` : '');
  }).join('');
}
function toggleExpand(id){
  if(expandedIds.has(id)) expandedIds.delete(id); else expandedIds.add(id);
  renderScenes(previewScenes.length ? previewScenes : []);
}
function copyPrompt(id){
  const text = promptById[id] || '';
  navigator.clipboard.writeText(text).catch(()=>{});
}
function onCheckChange(){
  const boxes = document.querySelectorAll('.scene-chk');
  checkedIds = new Set([...boxes].filter(b=>b.checked).map(b=>b.dataset.id));
  updateSelectedCount();
}
function selectAll(on){
  checkedIds = on ? null : new Set();
  renderScenes((previewScenes||[]).length ? previewScenes : []);
  updateSelectedCount();
}
// 2026-09-10 추가 — "생성 다 되면 신호 안 와?" 요청으로, 배치 전체가 끝나면(phase가
// all_done/stopped로 바뀌는 순간) 알림+소리+배너로 알려준다. 매 tick마다 반복 알림이 뜨지
// 않게 phase가 실제로 "막 끝난" 전이일 때만 한 번 울린다.
let lastPhaseByPort = {};
try { Notification.requestPermission(); } catch(e) {}
function beep(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.2;
    o.start(); o.stop(ctx.currentTime + 0.3);
  }catch(e){}
}
function notifyIfFinished(port, phase){
  const finished = phase === 'all_done' || phase === 'stopped';
  const last = lastPhaseByPort[port];
  if(finished && last !== phase && last !== undefined){
    beep();
    try{ if(Notification.permission === 'granted') new Notification('씬 이미지 생성 완료', {body: `포트 ${port} 처리가 끝났습니다.`}); }catch(e){}
    const banner = document.createElement('div');
    banner.textContent = `✅ 포트 ${port} 배치 완료!`;
    banner.style.cssText = 'background:#175;color:#fff;padding:8px;border-radius:6px;text-align:center;font-weight:700;margin-bottom:8px';
    document.body.insertBefore(banner, document.body.firstChild);
    setTimeout(()=>banner.remove(), 6000);
  }
  lastPhaseByPort[port] = phase;
}
function updateSelectedCount(){
  // 2026-09-10 수정 — 체크된 개수만 보여줘서 "진행 개수"에 5를 넣었는데 105개로 나온다는
  // 지적이 있었다. "선택됨"은 실제로 이번에 진행될 개수를 보여줘야 헷갈리지 않는다.
  // 번호 범위(예: 5~10)가 채워져 있으면 그게 최우선이다.
  const r = rangeIds();
  if(r !== null){
    document.getElementById('selectedCount').textContent = r.length + '개';
    return;
  }
  const n = checkedIds === null ? (previewScenes||[]).length : checkedIds.size;
  document.getElementById('selectedCount').textContent = n + '개';
}
function selectedIds(){
  if(checkedIds === null) return (previewScenes||[]).map(s=>s.id);
  return [...checkedIds];
}
function runOptions(){
  return {
    ratio: document.getElementById('ratioSel').value,
    new_project: document.getElementById('newProjectChk').checked,
    port: parseInt(document.getElementById('portSel').value, 10),
    character_name: document.getElementById('characterNameInput').value,
    image_count: parseInt(document.getElementById('imageCountSel').value, 10),
  };
}
async function startRun(){
  const siteId = document.getElementById('siteSel').value;
  const unitId = document.getElementById('unitSel').value;
  if(!siteId || !unitId){ alert('워크플로우와 콘텐츠를 먼저 선택하세요.'); return; }
  // 2026-09-10 추가 — "번호 범위"(예: 5~10)가 채워져 있으면 최우선으로 그 범위만 진행한다.
  // 없으면 체크된 씬 전부.
  let ids = rangeIds();
  if(ids === null){ ids = selectedIds(); }
  const r = await fetch('/api/start', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({site_id: siteId, unit_id: unitId, scene_ids: ids, ...runOptions()})});
  const d = await r.json();
  if(d.error) alert(d.error);
}
// 2026-09-11 추가 — 사용자 지적: "그런 오류를 표시를 해줘야 다시 시작을 하던 할꺈 아니야" /
// "패널에 띄어주고 다시 어떻게 하라고 해줘야 하자나 그래야 확인을 누르고 다시 진행을 하지".
// 실패는 phase="failed"로만 기록되고 다음 씬이 시작되면 바로 덮어써져서, 배치가 다 끝나도
// 뭐가 왜 실패했는지 화면에서 전혀 안 보였다(run.log 파일을 직접 열어야만 알 수 있었음).
// 드라이버(flow_econ_driver.py)가 이제 실패를 failures 배열에 누적해서 상태 파일에 실어
// 보내주므로, 여기서는 그걸 배너로 보여주고 "재시작" 버튼 하나로 실패한 씬만 다시 큐에
// 넣을 수 있게 한다 — 사람이 원인 읽고 → 확인 누르고 → 그대로 이어서 진행하는 흐름.
async function retryFailed(port, ids){
  const siteId = document.getElementById('siteSel').value;
  const unitId = document.getElementById('unitSel').value;
  if(!siteId || !unitId){ alert('워크플로우와 콘텐츠를 먼저 선택하세요.'); return; }
  document.getElementById('portSel').value = String(port);
  const r = await fetch('/api/start', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({site_id: siteId, unit_id: unitId, scene_ids: ids, ...runOptions(), port})});
  const d = await r.json();
  if(d.error) alert(d.error);
  document.getElementById('failBanner').style.display = 'none';
}
async function startOne(sceneId){
  const siteId = document.getElementById('siteSel').value;
  const unitId = document.getElementById('unitSel').value;
  if(!siteId || !unitId){ alert('워크플로우와 콘텐츠를 먼저 선택하세요.'); return; }
  const r = await fetch('/api/start', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({site_id: siteId, unit_id: unitId, scene_ids: [sceneId], ...runOptions()})});
  const d = await r.json();
  if(d.error) alert(d.error);
}
// 2026-09-11 추가 — 사용자 지적: "1번이 아까 생성이 되었는데 기록이 안 되었나봐 → 이럴 때
// 수동으로 링크를 입력할 수 있었으면 하는데". 자동 등록(register_scene_image)이 타임아웃 등으로
// 실패해도 Flow 프로젝트 안엔 이미지가 실제로 만들어져 있는 경우가 있다 — 그 URL을 직접
// 붙여넣으면 다른 씬과 동일하게 scenePrompts에 등록되고 화면에도 바로 반영된다.
async function setSceneImageUrl(sceneId){
  const siteId = document.getElementById('siteSel').value;
  const unitId = document.getElementById('unitSel').value;
  if(!siteId || !unitId){ alert('워크플로우와 콘텐츠를 먼저 선택하세요.'); return; }
  const input = document.getElementById('manualUrl_' + sceneId);
  const url = (input.value || '').trim();
  if(!url){ alert('이미지 URL을 입력하세요.'); return; }
  const r = await fetch('/api/set_scene_image', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({site_id: siteId, unit_id: unitId, scene_id: sceneId, image_url: url})});
  const d = await r.json();
  if(d.error){ alert(d.error); return; }
  imageUrlById[sceneId] = url;
  await onUnitChange();
}
async function stopRun(){
  const port = parseInt(document.getElementById('portSel').value, 10);
  await fetch('/api/stop', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({port})});
}
// 2026-09-10 추가 — "계정마다 달라~ 2초마다 가져온다면서?" 지적: 씬 목록 fetch가 실패해도
// catch(e){}로 조용히 삼켜서 화면이 낡은 채로 멈춰 있어도 알 방법이 없었다. 실패하면 lastSync에
// 바로 보이게 표시하고, "새로고침" 버튼으로 2초를 안 기다리고 즉시 다시 가져올 수 있게 한다.
// 2026-09-11 추가 — 사용자 지적: "13단계에서 이미지 업로드 다운받고 하는게 용량을 많이
// 잡아먹는게 아닌가". 확인해보니 실제 원인은 이미지가 아니라, 이 함수가 2초마다 씬 하나 상태만
// 바뀌어도 `script_draft` 전체(경제학 사이트 기준 약 82KB)를 슈퍼베이스에서 통째로 다시 읽어오고
// 있었다 — 패널을 몇 시간 켜두면 그것만으로 수백 MB~GB가 쌓이는 구조. `/api/status`(로컬 파일
// 읽기라 거의 공짜)는 그대로 2초마다 돌리되, 비싼 `/api/scenes`(DB 조회)는 평소엔 10초에 한 번만
// 돌리고, 방금 씬 하나가 완료돼서 목록을 당장 갱신해야 할 때만 예외적으로 바로 돌린다.
let scenesTickCounter = 0;
const SCENES_POLL_EVERY_N_TICKS = 5; // 2초 * 5 = 10초
async function fetchAndRender(){
  try{
    const r = await fetch('/api/status?_=' + Date.now());
    const s = await r.json();
    const workers = s.workers || [];
    // 2026-09-10 재설계 — 포트(계정) 여러 개가 동시에 돌 수 있어서, 한 줄이 아니라
    // 활성 워커별로 한 줄씩("9223: S05 waiting 20초") 보여준다.
    const wdiv = document.getElementById('workers');
    wdiv.innerHTML = workers.map(w => {
      const running = w.phase === 'submitting' || w.phase === 'waiting';
      return `<div class="row"><span style="color:#888;font-size:11px">${w.port}</span>`
        + `<b>${running ? w.current : '-'}</b>`
        + (running ? `<span class="badge waiting" style="font-size:10px">${w.elapsed||0}초</span>` : '')
        + `</div>`;
    }).join('') || '<div class="row" style="color:#666;font-size:11px">실행 중인 계정 없음</div>';
    workers.forEach(w => notifyIfFinished(w.port, w.phase));
    // 2026-09-11 추가 — 실패 배너: 어느 포트가 뭘 왜 실패했는지 사유까지 그대로 보여주고,
    // 바로 그 자리에서 재시작 버튼을 눌러 이어갈 수 있게 한다(위 retryFailed 참고).
    const failBanner = document.getElementById('failBanner');
    const withFailures = workers.filter(w => (w.failures || []).length);
    if(withFailures.length){
      failBanner.style.display = 'block';
      failBanner.innerHTML = withFailures.map(w => {
        const ids = (w.failures || []).map(f => f.id);
        const lines = (w.failures || []).map(f => `${f.id}: ${f.error}`).join('<br>');
        return `<div style="margin-bottom:6px"><b style="color:#f88">⚠ ${w.port} 계정 — ${ids.length}개 씬 실패</b><br>`
          + `<div style="color:#daa;margin:4px 0">${lines}</div>`
          + `<button onclick='retryFailed(${w.port}, ${JSON.stringify(ids)})' style="background:#733;font-weight:700">🔁 이 ${ids.length}개 씬만 재시작</button></div>`;
      }).join('');
    } else {
      failBanner.style.display = 'none';
    }
    // 2026-09-10 추가 — "지금 진행 중인 것만 프롬프트를 펼치고, 완료되면 접고, 다음
    // 진행 중인 걸로 넘어가면서 순차적으로 펼쳐지고 접히게" — 여러 워커가 각자 다른 씬을
    // 처리 중이면 그 씬들을 전부(동시에) 펼친다.
    const runningIds = new Set(workers.filter(w => w.phase === 'submitting' || w.phase === 'waiting')
      .map(w => w.current).filter(Boolean));
    if(runningIds.size){ expandedIds = runningIds; }
    // 2026-09-10 — 씬 목록(done/pending)은 한 워커의 로컬 상태가 아니라 항상 DB에서 새로
    // 읽는다 — 어느 포트가 어느 씬을 끝냈든 정확하게 반영되게(다중 계정 집계 문제 회피).
    const siteId = document.getElementById('siteSel').value;
    const unitId = document.getElementById('unitSel').value;
    const justFinishedAScene = workers.some(w => w.phase === 'done');
    scenesTickCounter++;
    const shouldPollScenes = justFinishedAScene || (scenesTickCounter % SCENES_POLL_EVERY_N_TICKS === 0);
    if(siteId && unitId && shouldPollScenes){
      const sr = await fetch('/api/scenes?site_id=' + encodeURIComponent(siteId) + '&unit_id=' + encodeURIComponent(unitId));
      const fresh = await sr.json();
      fresh.forEach(sc => { if(runningIds.has(sc.id)) sc.status = 'running'; });
      previewScenes = fresh;
      // 완료된 씬은 계속 체크에서 빼준다("완료된 거 체크 해제가 안 되고 있어").
      if(checkedIds !== null){
        fresh.filter(sc => sc.status === 'done').forEach(sc => checkedIds.delete(sc.id));
      }
      updateSelectedCount();
      renderScenes(previewScenes);
    } else if(siteId && unitId && runningIds.size){
      // DB는 다시 안 읽어도, 지금 진행 중인 씬 표시(running 배지)만 캐시된 목록 위에 갱신한다.
      previewScenes.forEach(sc => { if(runningIds.has(sc.id) && sc.status !== 'done') sc.status = 'running'; });
      renderScenes(previewScenes);
    }
    document.getElementById('lastSync').textContent = '동기화 ' + new Date().toLocaleTimeString('ko-KR');
    document.getElementById('lastSync').style.color = '#666';
  }catch(e){
    document.getElementById('lastSync').textContent = '⚠ 동기화 실패: ' + e;
    document.getElementById('lastSync').style.color = '#c66';
  }
}
async function refreshNow(){
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true; btn.textContent = '🔄 갱신 중...';
  // 2026-09-11 추가 — 사용자 실사고: 서버가 재시작되는 타이밍에 페이지가 열리면 loadSites()가
  // 한 번 실패한 채로 "불러오는 중..."에 영원히 멈춰있었다 — 이 함수가 그동안 워크플로우 목록은
  // 다시 안 불러오고 상태/씬 목록만 갱신해서, "새로고침"을 눌러도 안 고쳐졌다("아직
  // 못불러오고 있는데~"). 워크플로우 드롭다운이 비어있으면(첫 로딩 실패 신호) 목록부터 다시
  // 불러오고, 있으면 그대로 둔다(현재 선택값 유지).
  const siteSel = document.getElementById('siteSel');
  if (!siteSel.options.length || siteSel.options[0].value === '' && siteSel.options.length === 1 && siteSel.options[0].textContent.includes('불러오는')) {
    const keepSite = siteSel.value, keepUnit = document.getElementById('unitSel').value;
    await loadSites();
    if (keepSite) { siteSel.value = keepSite; await onSiteChange(keepUnit); }
  }
  await fetchAndRender();
  btn.disabled = false; btn.textContent = '🔄 새로고침';
}
async function tick(){
  await fetchAndRender();
  setTimeout(tick, 2000);
}
async function restoreAndBoot(){
  await loadSites();
  const saved = loadUiState();
  if(saved.siteId){
    document.getElementById('siteSel').value = saved.siteId;
    await onSiteChange(saved.unitId);
  }
  if(saved.ratio) document.getElementById('ratioSel').value = saved.ratio;
  if(saved.newProject) document.getElementById('newProjectChk').checked = true;
  if(saved.range) document.getElementById('rangeInput').value = saved.range;
  if(saved.port) document.getElementById('portSel').value = saved.port;
  if(saved.range9223) document.getElementById('range9223').value = saved.range9223;
  if(saved.range9224) document.getElementById('range9224').value = saved.range9224;
  if(saved.range9225) document.getElementById('range9225').value = saved.range9225;
  if(saved.range9226) document.getElementById('range9226').value = saved.range9226;
  if(saved.characterName) document.getElementById('characterNameInput').value = saved.characterName;
  // 2026-09-11 추가 — 기본값 켜짐(1장만 생성)이므로, 저장된 값이 명시적으로 false일 때만 끈다.
  document.getElementById('imageCountSel').value = saved.imageCount || 1;
  updateSelectedCount();
}
restoreAndBoot();
tick();
</script>
</body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        qs = parse_qs(parsed.query)
        if parsed.path == "/api/sites":
            # 2026-09-10 수정 — 처음엔 hub_sites 전체(23개, 대부분 이 콘텐츠-유닛
            # 파이프라인과 무관한 블로그/툴 프로젝트)를 그대로 보여줘서 사용자가
            # "경제학·공학처럼 실제 콘텐츠 유닛이 있는 것만 가져와야지" 지적함 —
            # script_draft.units가 하나라도 있는 사이트만 필터링한다.
            try:
                r = httpx.get(f"{SUPA_URL}/rest/v1/hub_sites",
                               params={"select": "id,name,script_draft", "order": "sort_order"},
                               headers=supa_headers(), timeout=15)
                r.raise_for_status()
                sites = []
                for row in r.json():
                    units = (row.get("script_draft") or {}).get("units") or []
                    if units:
                        sites.append({"id": row["id"], "name": row["name"], "unit_count": len(units)})
                        site_name_cache[row["id"]] = row["name"]
                self._json(sites)
            except Exception as e:
                self._json({"error": str(e)}, 500)
        elif parsed.path == "/api/units":
            site_id = qs.get("site_id", [""])[0]
            try:
                r = httpx.get(f"{SUPA_URL}/rest/v1/hub_sites", params={"id": f"eq.{site_id}", "select": "script_draft"},
                               headers=supa_headers(), timeout=15)
                r.raise_for_status()
                rows = r.json()
                units = (rows[0].get("script_draft") or {}).get("units") or [] if rows else []
                out = [{"id": u.get("id"), "title": u.get("title", ""),
                        "scene_count": len(parse_scene_prompts(u.get("scenePrompts") or ""))}
                       for u in units]
                self._json(out)
            except Exception as e:
                self._json({"error": str(e)}, 500)
        elif parsed.path == "/api/scenes":
            # 2026-09-10 추가 — 콘텐츠 드롭다운만 선택해도(아직 "시작" 누르기 전에도) 몇 번
            # 씬이 몇 개나 있는지 순서대로 미리 볼 수 있어야 한다는 지적으로 추가.
            site_id = qs.get("site_id", [""])[0]
            unit_id = qs.get("unit_id", [""])[0]
            try:
                r = httpx.get(f"{SUPA_URL}/rest/v1/hub_sites", params={"id": f"eq.{site_id}", "select": "script_draft"},
                               headers=supa_headers(), timeout=15)
                r.raise_for_status()
                rows = r.json()
                units = (rows[0].get("script_draft") or {}).get("units") or [] if rows else []
                unit = next((u for u in units if u.get("id") == unit_id), None)
                scenes = parse_scene_prompts((unit or {}).get("scenePrompts") or "")
                self._json([{"id": s["id"], "num": s["num"], "title": s["title"] or s["prompt"][:40], "prompt": s["prompt"],
                             "status": "done" if s["image_url"] else "pending",
                             "image_url": s["image_url"]} for s in scenes])
            except Exception as e:
                self._json({"error": str(e)}, 500)
        elif parsed.path == "/api/status":
            self._json(worker_status())
        else:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML.encode("utf-8"))

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(body or b"{}")
        except Exception:
            data = {}
        if self.path == "/api/start":
            result = start_run(data.get("site_id", ""), data.get("unit_id", ""), data.get("scene_ids"),
                               data.get("ratio", "16:9"), bool(data.get("new_project")),
                               int(data.get("port", 9223)), data.get("character_name", ""),
                               int(data.get("image_count", 1)))
            self._json(result, 400 if result.get("error") else 200)
        elif self.path == "/api/register_scenes":
            result = register_scenes(data.get("site_id", ""), data.get("unit_id", ""), data.get("scenes") or [])
            self._json(result, 400 if result.get("error") else 200)
        elif self.path == "/api/set_scene_image":
            result = set_scene_image_url(data.get("site_id", ""), data.get("unit_id", ""),
                                          data.get("scene_id", ""), data.get("image_url", ""))
            self._json(result, 400 if result.get("error") else 200)
        elif self.path == "/api/stop":
            self._json(stop_run(int(data.get("port", 9223))))
        else:
            self.send_response(404)
            self.end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8799
    print(f"[dashboard] http://127.0.0.1:{port} 에서 대기 중")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
