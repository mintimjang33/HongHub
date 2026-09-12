"""browser-harness 대체 실행기.

flow-media 팩(scripts/flow_media.py 등)은 원래 저자 개인 도구인 `browser-harness` CLI에
파이프로 흘려 넣어 실행하도록 짜여 있다. 우리에겐 그 도구가 없어서, 같은 계약
(js·cdp·capture_screenshot·goto_url·page_info 를 전역으로 주입해 스크립트를 exec)을
구현하는 동등한 실행기를 이 파일로 대신한다. Chrome 원격디버깅 포트(CDP)에
`httpx`(탭 목록)+`websockets`(동기 클라이언트)로 직접 붙는다 — 추가 설치 불필요.

사용법 (flow-media-pack 폴더에서):
    BU_CDP_URL=http://127.0.0.1:9223 FLOW_JOB=<프로젝트>/flow.json \
      FLOW_STAGE=images FLOW_LIMIT=1 PYTHONUTF8=1 \
      python scripts/cdp_harness.py scripts/flow_media.py

stdin 으로도 된다 (원본 관례와 동일):
    ... | python scripts/cdp_harness.py
"""
from __future__ import annotations

import base64
import io
import json
import os
import sys

import httpx
from websockets.sync.client import connect as ws_connect


class CDP:
    def __init__(self, base_url: str, prefer: tuple[str, ...] = ("flow.google.com", "labs.google")):
        self.base_url = base_url.rstrip("/")
        try:
            targets = httpx.get(f"{self.base_url}/json", timeout=10).json()
        except httpx.HTTPError as e:
            raise RuntimeError(
                f"★{self.base_url} 에 붙지 못했습니다 — 디버깅 포트를 연 Chrome이 떠 있는지 확인하세요.\n"
                f"  chrome --remote-debugging-port=9223 --user-data-dir=<전용프로필> "
                f"https://labs.google/fx/ko/tools/flow\n  원인: {e}"
            ) from e
        pages = [t for t in targets if t.get("type") == "page"]
        if not pages:
            raise RuntimeError("★연결 가능한 탭이 없습니다 — Chrome 창에 페이지가 하나는 떠 있어야 합니다.")
        target = next((t for t in pages if any(p in t.get("url", "") for p in prefer)), pages[0])
        self.target = target
        self.ws = ws_connect(target["webSocketDebuggerUrl"], max_size=None, open_timeout=15)
        self._id = 0
        self.send("Page.enable")
        self.send("Runtime.enable")

    # 2026-09-12 실사고 수정 — 9223 계정이 S52에서 90분 넘게 "waiting"인 채로 멈춰있었는데,
    # 실제로는 죽은 게 아니라 이 recv()가 타임아웃 없이 응답을 무한정 기다리고 있었다(Chrome
    # 탭이 멈추거나 CDP 프레임이 유실되면 이 소켓 읽기가 영원히 안 풀림) — 대시보드를 재시작해도
    # 이 프로세스 자체는 그 자리에서 계속 살아있었던 이유이기도 하다. RECV_TIMEOUT을 넘기면
    # 예외를 던져서, flow_econ_driver.py의 바깥 try/except가 "이 씬만 건너뛰고 다음으로"
    # 처리하도록 만든다 — 조용히 영원히 멈추는 대신 눈에 보이는 실패로 바꾼 것.
    RECV_TIMEOUT = 60

    def send(self, method: str, **params):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            try:
                raw = self.ws.recv(timeout=self.RECV_TIMEOUT)
            except TimeoutError as e:
                raise RuntimeError(
                    f"CDP {method} 응답 없음({self.RECV_TIMEOUT}초 초과) — Chrome 탭이 멈췄거나 "
                    f"연결이 끊겼을 수 있습니다."
                ) from e
            msg = json.loads(raw)
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"CDP {method} 실패: {msg['error']}")
                return msg.get("result", {})
            # id 없는 메시지는 이벤트 — 무시하고 다음 프레임을 기다린다

    # ── harness 가 주입해야 하는 5개 함수 ────────────────────────
    def js(self, expr: str):
        r = self.send("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        if r.get("exceptionDetails"):
            raise RuntimeError(f"JS 오류: {r['exceptionDetails']}")
        return r.get("result", {}).get("value")

    def cdp(self, method: str, **params):
        return self.send(method, **params)

    def capture_screenshot(self, path: str, max_dim: int = 900):
        r = self.send("Page.captureScreenshot", format="png")
        data = base64.b64decode(r["data"])
        with open(path, "wb") as f:
            f.write(data)
        try:
            from PIL import Image

            im = Image.open(io.BytesIO(data))
            if max(im.size) > max_dim:
                ratio = max_dim / max(im.size)
                im = im.resize((max(1, int(im.width * ratio)), max(1, int(im.height * ratio))))
                im.save(path)
        except ImportError:
            pass  # Pillow 없으면 원본 해상도 그대로 둔다 — 콘택트시트 눈검수만 못 함

    def goto_url(self, url: str):
        self.send("Page.navigate", url=url)

    def page_info(self):
        return self.js("(()=>({url: location.href, title: document.title}))()") or {}


def main():
    cdp_url = os.environ.get("BU_CDP_URL", "http://127.0.0.1:9222")
    c = CDP(cdp_url)
    print(f"[harness] 연결됨 → {c.target.get('url')}", file=sys.stderr)

    if len(sys.argv) > 1:
        script_path = sys.argv[1]
        src = open(script_path, encoding="utf-8").read()
        src_name = script_path
    else:
        src = sys.stdin.read()
        src_name = "<stdin>"

    injected = {
        "js": c.js,
        "cdp": c.cdp,
        "capture_screenshot": c.capture_screenshot,
        "goto_url": c.goto_url,
        "page_info": c.page_info,
        "__name__": "__main__",
        "__file__": src_name,
    }
    exec(compile(src, src_name, "exec"), injected)


if __name__ == "__main__":
    main()
