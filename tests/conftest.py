import json
import os
import pathlib
import time
import urllib.request

import pytest

FIX = pathlib.Path(__file__).resolve().parent / 'fixtures'
REAL_CLAUDE_CONFIG_DIR = os.environ.get('CLAUDE_CONFIG_DIR')  # live tests need the real one (the login)
SLOW = 3 if os.environ.get('CI') else 1  # CI runners are shared and stall for seconds: waits there are longer


@pytest.fixture(autouse=True)
def fake_home(tmp_path, monkeypatch):
    """Every test gets its own Skyborne folder and Claude Code folder; nothing real is touched."""
    monkeypatch.setenv('SKYBORNE_HOME', str(tmp_path / 'skyborne-home'))
    monkeypatch.setenv('CLAUDE_CONFIG_DIR', str(tmp_path / 'claude'))
    return tmp_path


def payload(name, **changes):
    p = json.loads((FIX / 'payloads' / name).read_text(encoding='utf-8'))
    p.pop('_source', None)
    p.update(changes)
    return p


@pytest.fixture
def app(tmp_path):
    from skyborne.server import App
    a = App(port=0, db_path=tmp_path / 'skyborne.db')
    a.start()
    yield a
    a.stop()


def request(app, method, path, body=None, headers=None, timeout=5):
    """(status, headers, body) for one request; error statuses are returned, not raised."""
    h = {'Host': f'127.0.0.1:{app.port}', **(headers or {})}
    req = urllib.request.Request(f'http://127.0.0.1:{app.port}{path}', data=body, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def wait_until(check, timeout=5.0):
    """Waits for something to happen (never for it not to). On CI the wait is longer, so a runner stall isn't a failure;
    local runs keep the real limits, which is where a slow regression shows."""
    end = time.monotonic() + timeout * SLOW
    while time.monotonic() < end:
        value = check()
        if value:
            return value
        time.sleep(0.02)
    return check()
