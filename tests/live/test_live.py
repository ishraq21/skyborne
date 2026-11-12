"""Opt-in live tests against a real Claude Code session (macOS and Linux; they spend a little usage).

    SKYBORNE_LIVE=1 .venv/bin/python -m pytest tests/live -s

Each run starts Skyborne on a free port, writes the plugin (pointing at that port) into tmp/live/,
and drives `claude` in a pseudo-terminal in tmp/live/project with --permission-mode default, so the
approval dialog really shows. The installed Skyborne plugin is switched off there, so test sessions
reach only this test's server. Every step's timing is printed, and the session's events are saved to
tmp/live/recording.json.
"""
import json
import os
import pathlib
import socket
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request

import pytest

pytestmark = pytest.mark.skipif(os.environ.get('SKYBORNE_LIVE') != '1' or sys.platform == 'win32',
                                reason='live tests run only with SKYBORNE_LIVE=1 on macOS or Linux')

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
if sys.platform != 'win32':  # the driver needs pty, which Windows doesn't have
    from driver import Session, clean_env  # noqa: E402

LIVE = ROOT / 'tmp' / 'live'
MODEL = os.environ.get('SKYBORNE_LIVE_MODEL', 'claude-haiku-4-5-20251001')
DIALOG = r'(?i)do\s*you\s*want\s*to\s*proceed'  # the terminal may draw it without spaces


class Stream:
    """Listens to /events and keeps every message with the time it arrived."""

    def __init__(self, port):
        self.port, self.got, self.lock = port, [], threading.Lock()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        s = socket.create_connection(('127.0.0.1', self.port))
        s.sendall(f'GET /events HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n\r\n'.encode())
        buf = b''
        while True:
            chunk = s.recv(1 << 20)
            if not chunk:
                return
            buf += chunk
            while b'\n\n' in buf:
                block, buf = buf.split(b'\n\n', 1)
                lines = block.split(b'\n')
                if b'event: state' not in lines:  # names, ready and gone carry no doc
                    continue
                for line in lines:
                    if line.startswith(b'data: '):
                        with self.lock:
                            self.got.append((time.time(), json.loads(line[6:])))

    def wait(self, check, timeout=120, since=None):
        """The first (time, doc) since `since` (default: now) whose doc passes `check`."""
        start = time.time() if since is None else since
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            with self.lock:
                hits = [(t, d['doc']) for t, d in self.got if t >= start - 0.05 and check(d['doc'])]
            if hits:
                return hits[0]
            time.sleep(0.05)
        return None, None

    def latest(self):
        with self.lock:
            return self.got[-1][1]['doc'] if self.got else None


def lead(doc):
    return doc['agents'][0]


def deny(app, ask_id):
    """Deny a waiting request as the page does it: the launch token and the server's own Origin."""
    req = urllib.request.Request(f'http://127.0.0.1:{app.port}/api/answer', method='POST',
                                 data=json.dumps({'id': ask_id, 'decision': 'deny'}).encode(),
                                 headers={'Content-Type': 'application/json', 'X-Skyborne-Token': app.token,
                                          'Origin': f'http://127.0.0.1:{app.port}'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, TimeoutError) as e:  # recorded, so the step's report still prints
        return f'no answer: {e}'


@pytest.fixture
def live(monkeypatch):
    from conftest import REAL_CLAUDE_CONFIG_DIR
    from skyborne import install
    from skyborne.server import App
    # the session must start with the person's real Claude Code folder (their login and folder trust);
    # only Skyborne's own folder stays a temporary one
    if REAL_CLAUDE_CONFIG_DIR:
        monkeypatch.setenv('CLAUDE_CONFIG_DIR', REAL_CLAUDE_CONFIG_DIR)
    else:
        monkeypatch.delenv('CLAUDE_CONFIG_DIR', raising=False)
    project = LIVE / 'project'
    (project / '.claude').mkdir(parents=True, exist_ok=True)
    (project / '.claude' / 'settings.local.json').write_text(json.dumps({
        'enabledPlugins': {'skyborne@skills-dir': False},
        # the helpers' read-only commands usually run without a dialog (one on a path with shell characters, such as
        # this checkout's '&', can still ask: step 1 denies it); the test's own touch commands still ask
        'permissions': {'allow': ['Read', 'Grep', 'Glob', 'Bash(wc:*)', 'Bash(grep:*)', 'Bash(cat:*)', 'Bash(head:*)']}}))
    (project / 'alpha.txt').write_text('one\ntwo\nthree\nfour\n')
    (project / 'beta.txt').write_text('The secret word is pineapple.\n')
    for f in project.glob('made-*.txt'):
        f.unlink()
    db = LIVE / 'skyborne.db'
    for f in LIVE.glob('skyborne.db*'):
        f.unlink()
    app = App(port=0, db_path=db)
    app.start()
    install.write_plugin(LIVE / 'plugin', app.port)
    state = {'app': app, 'project': project, 'db': db}
    yield state
    state['app'].stop()


def start_claude(project, debug):
    s = Session(['claude', '--plugin-dir', str(LIVE / 'plugin'), '--permission-mode', 'default', '--model', MODEL,
                 '--debug-file', str(debug)], cwd=str(project), env=clean_env())
    if s.wait_for(r'(?i)trust (the files in )?this folder|do you trust', 20):
        s.send('\r')
    time.sleep(6)
    return s


def count_events(db):
    with sqlite3.connect(db) as c:
        return dict(c.execute('SELECT event, COUNT(*) FROM events GROUP BY event').fetchall())


def test_a_real_session_end_to_end(live):
    app, project = live['app'], live['project']
    stream = Stream(app.port)
    timings = {}
    launched = time.time()
    s = start_claude(project, LIVE / 'debug-1.txt')
    try:
        t, doc = stream.wait(lambda d: d['agents'] and d['feed'], 30, since=launched)
        assert doc, 'no document after SessionStart'
        timings['claude launched -> first doc'] = t - launched

        # 1) two helpers in parallel, linked and done at SubagentStop. Each gets its file's full path and is told to use
        # only Read, but a helper can still reach for a command that asks first (with Claude Code 2.1.322 one asked to
        # run `find` to locate beta.txt). Nobody is at the terminal here, so the test denies such a request through
        # Skyborne, as the page would (never approves: the command could be anything), and the helper carries on
        step_at = time.time()
        s.type_line('In ONE message, call the Agent tool twice in parallel, both with subagent_type Explore: '
                    f'one counts the lines in {project / "alpha.txt"}, the other finds the secret word in {project / "beta.txt"}. '
                    'Give each helper its full path and tell it to use only the Read tool. Then report both answers.')
        done = lambda d: len(d['agents']) == 3 and all(a['status'] == 'done' for a in d['agents'][1:]) and lead(d)['status'] == 'done'
        denied, doc, end = {}, None, time.monotonic() + 180
        while doc is None and time.monotonic() < end:
            for ask in app.approvals.snapshot()['asks']:
                if ask['state'] == 'open' and ask['id'] not in denied:
                    denied[ask['id']] = (ask['agent'], ask['tool'], json.dumps(ask['input'])[:120], deny(app, ask['id']))
            t, doc = stream.wait(done, 1, since=step_at)
        if denied:
            print('\nstep 1, denied through Skyborne (agent, tool, input, status):', list(denied.values()))
        assert doc, f'helpers never finished ({len(stream.latest()["agents"])} agents): {json.dumps(stream.latest())[:2000]}'
        assert all(status == 200 for *_, status in denied.values()), denied
        helpers = doc['agents'][1:]
        assert all(h['parent'] == 'main' and h['description'] and h['type'] == 'Explore' for h in helpers), helpers
        assert doc['turns'] == 1

        # 2) a command that needs approval: waiting shows, then clears when approved
        asked_at, mark = time.time(), s.mark()
        s.type_line('Run exactly this bash command and nothing else: touch made-by-test.txt')
        seen = s.wait_for(DIALOG, 90, since=mark)
        dialog_at = time.time()
        assert seen, 'no approval dialog appeared'
        t, doc = stream.wait(lambda d: d['waiting'] is not None, 10, since=asked_at)
        assert doc and doc['waiting']['tool'] == 'Bash'
        timings['dialog on screen -> waiting in /events'] = t - dialog_at
        time.sleep(1)
        s.send('1')
        approved_at = time.time()
        t, doc = stream.wait(lambda d: d['waiting'] is None and any(f.get('durationMs') is not None and f.get('tool') == 'Bash' for f in d['feed']), 30)
        assert doc, 'waiting never cleared after Yes'
        timings['Yes typed -> waiting cleared'] = t - approved_at

        # 3) a "No" typed in the terminal: no hook fires; the transcript clears the wait
        asked_at, mark = time.time(), s.mark()
        s.type_line('Run exactly this bash command and nothing else: touch made-second.txt')
        assert s.wait_for(DIALOG, 90, since=mark)
        assert stream.wait(lambda d: d['waiting'] is not None, 10, since=asked_at)[1]
        time.sleep(1)
        s.send('3')
        no_at = time.time()
        t, doc = stream.wait(lambda d: d['waiting'] is None, 30)
        assert doc, 'waiting never cleared after No'
        timings['No typed -> waiting cleared (via transcript)'] = t - no_at
        assert not (project / 'made-second.txt').exists()

        # tokens: the transcript's messages, each counted once
        time.sleep(2)
        doc = stream.latest()
        assert doc['tokens']['total'] > 0 and all(sum(h['usage'].values()) > 0 for h in doc['tokens']['helpers'])
    finally:
        s.type_line('/exit')
        time.sleep(4)
        s.close()
    counts = count_events(live['db'])
    print('\nevents stored:', counts)
    for k, v in timings.items():
        print(f'{k}: {v:.2f} s')
    assert counts.get('SessionStart') == 1 and counts.get('SubagentStart') == 2 and counts.get('PermissionRequest', 0) >= 2
    with sqlite3.connect(live['db']) as c:
        rows = [{'ts': ts, 'payload': json.loads(p)} for ts, p in c.execute('SELECT received_at, payload FROM events ORDER BY id')]
    (LIVE / 'recording.json').write_text(json.dumps({'events': rows, 'timings': timings, 'counts': counts}, indent=1))
    assert timings['dialog on screen -> waiting in /events'] < 1.0


def test_killing_skyborne_does_not_disturb_claude_code(live, tmp_path):
    """Acceptance 2: the server dies mid-session, the session carries on; a restart restores and backfills."""
    from skyborne.server import App
    app, project = live['app'], live['project']
    port = app.port
    stream = Stream(port)
    s = start_claude(project, LIVE / 'debug-2.txt')
    try:
        s.type_line('Reply with just the word: first')
        assert stream.wait(lambda d: lead(d)['status'] == 'done', 120)[1]
        before = count_events(live['db'])
        app.stop()  # Skyborne goes away mid-session
        mark = s.mark()
        s.type_line('Use the Read tool on alpha.txt, then reply with just the word: second')
        assert s.wait_for(r'second', 120, since=mark), 'the session did not answer while Skyborne was down'
        time.sleep(3)
        screen = s.text(mark)
        notices = [l.strip() for l in screen.splitlines() if 'hook error' in l.lower() or 'ECONNREFUSED' in l]
        (LIVE / 'down-screen.txt').write_text(screen)
        print('\nhook notices while Skyborne was down:', notices or 'none')
        assert not notices
        # restart on the same port and database
        app2 = App(port=port, db_path=live['db'])
        app2.start()
        live['app'] = app2
        try:
            time.sleep(2)
            doc = next(d for sid, d in app2.hub.snapshot())
            assert doc['headline'] in ('first', 'First') or doc['turns'] >= 1  # history from before the stop
            after_backfill = doc['tokens']['total']
            mids = len(app2.hub.sessions[next(iter(app2.hub.sessions))].usage)
            print('history restored: turns', doc['turns'], '| tokens after transcript backfill', after_backfill, '| messages', mids,
                  '| events before stop', before)
            assert mids >= 2  # the answer given while Skyborne was down came back from the transcript
        finally:
            pass
    finally:
        s.type_line('/exit')
        time.sleep(3)
        s.close()
