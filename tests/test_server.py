"""The server: security checks, speed, nothing lost, the live stream, and quiet logs."""
import json
import logging
import os
import select
import socket
import sqlite3
import threading
import time
import urllib.request
import warnings

from conftest import SLOW, payload, request, wait_until

SID = '00000000-0000-4000-8000-0000000000bb'


def post(app, body, path='/hook', **headers):
    return request(app, 'POST', path, body if isinstance(body, bytes) else json.dumps(body).encode(),
                   {'Content-Type': 'application/json', **headers})


def stored(app):
    with sqlite3.connect(app.store.path) as db:
        return db.execute('SELECT COUNT(*) FROM events').fetchone()[0]


def test_listens_on_ipv4_loopback_only(app):
    assert app.httpd.server_address[0] == '127.0.0.1'


def test_hook_answers_200_empty_and_stores_the_event(app):
    status, headers, body = post(app, payload('PreToolUse.json', session_id=SID))
    assert (status, body) == (200, b'')
    assert 'Access-Control-Allow-Origin' not in headers
    assert wait_until(lambda: stored(app) == 1)


def test_wrong_host_is_refused(app):
    for host in ('evil.example', f'evil.example:{app.port}', '127.0.0.1:1', f'0.0.0.0:{app.port}'):
        status, _, _ = post(app, payload('PreToolUse.json'), Host=host)
        assert status == 403, host
        assert request(app, 'GET', '/health', headers={'Host': host})[0] == 403
    assert stored(app) == 0


def test_browser_requests_from_other_pages_are_refused(app):
    assert post(app, payload('PreToolUse.json'), Origin='https://evil.example')[0] == 403
    assert post(app, payload('PreToolUse.json'), Origin='null')[0] == 403
    assert request(app, 'GET', '/events', headers={'Origin': 'http://localhost:1'})[0] == 403
    assert request(app, 'GET', '/health', headers={'Origin': f'http://127.0.0.1:{app.port}'})[0] == 200
    assert request(app, 'GET', '/health', headers={'Host': f'localhost:{app.port}'})[0] == 200


def send_raw(app, head, parts, pause=0.0):
    """Send a request by hand, waiting `pause` seconds before each body part; returns (whether the answer
    came before the whole body was sent, the whole answer)."""
    early = False
    with socket.create_connection(('127.0.0.1', app.port), timeout=5 * SLOW) as s:
        s.sendall(head)
        for part in parts:
            early = early or bool(select.select([s], [], [], pause)[0])
            s.sendall(part)
        out = b''
        while chunk := s.recv(65536):
            out += chunk
    return early, out


def test_refusals_read_the_body_first(app):
    """A socket closed with the body unread resets the connection on Windows, losing the answer."""
    body = json.dumps(payload('PreToolUse.json')).encode()
    for path, host, want in (('/hook', 'evil.example', b'403'), ('/api/answer', f'127.0.0.1:{app.port}', b'403'),
                             ('/nowhere', f'127.0.0.1:{app.port}', b'404')):
        head = (f'POST {path} HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\n'
                f'Content-Length: {len(body)}\r\n\r\n').encode()
        early, out = send_raw(app, head, [body[:10], body[10:]], pause=0.3)
        assert out.split(b' ')[1] == want, path
        assert not early, path
    assert stored(app) == 0


def test_a_huge_chunk_is_dropped(app):
    head = (f'POST /hook HTTP/1.1\r\nHost: 127.0.0.1:{app.port}\r\nContent-Type: application/json\r\n'
            'Transfer-Encoding: chunked\r\n\r\n').encode()
    _, out = send_raw(app, head, [b'%x\r\n{}\r\n0\r\n\r\n' % (1 << 80)])
    assert out.startswith(b'HTTP/1.0 200') and out.endswith(b'\r\n\r\n')
    assert request(app, 'GET', '/health')[0] == 200
    time.sleep(0.4)
    assert stored(app) == 0


def test_garbage_gets_200_fast_and_is_dropped(app):
    """Garbage must not make the hook hang. Real latency is test_50_events_a_second_fast_and_nothing_lost. On shared CI
    runners one request has stalled for 2-3 s, so there a slow answer is a warning (which names the body, and which
    pytest prints even when the run passes) and only 4 s fails; a real hang trips request()'s own timeout (5 s, 15 s on CI)."""
    limit = 4.0 if os.environ.get('CI') else 0.5
    for body in (b'{not json', b'[1, 2]', b'\xff\xfe', b''):
        t = time.perf_counter()
        status, _, out = post(app, body)
        took = time.perf_counter() - t
        if took > 0.5:
            warnings.warn(f'{body!r} took {took:.2f} s to get its answer')
        assert (status, out) == (200, b'') and took < limit, f'{body!r} got {status} {out!r} in {took:.2f} s'
    time.sleep(0.4)
    assert stored(app) == 0
    assert request(app, 'GET', '/health')[0] == 200  # still up


def test_oversize_body_gets_200_and_is_dropped(app):
    big = json.dumps(payload('PostToolUse.json', session_id=SID, tool_response={'stdout': 'x' * (3 * 1024 * 1024)})).encode()
    status, _, _ = post(app, big)
    assert status == 200
    time.sleep(0.4)
    assert stored(app) == 0
    assert post(app, payload('PreToolUse.json', session_id=SID))[0] == 200
    assert wait_until(lambda: stored(app) == 1)


def test_tool_output_is_stored_truncated(app):
    post(app, payload('PostToolUse.json', session_id=SID, tool_response={'stdout': 'y' * 100_000}))
    assert wait_until(lambda: stored(app) == 1)
    with sqlite3.connect(app.store.path) as db:
        p = json.loads(db.execute('SELECT payload FROM events').fetchone()[0])
    assert p['tool_response']['skyborneTruncated'] is True and len(p['tool_response']['head']) <= 20 * 1024


def test_50_events_a_second_fast_and_nothing_lost(app):
    """p99 under 50 ms locally; CI runners are shared and noisy, so there the bound is looser."""
    limit = 0.25 if os.environ.get('CI') else 0.05
    body = json.dumps(payload('PreToolUse.json', session_id=SID)).encode()
    times, start = [], time.perf_counter()
    for i in range(500):  # 10 seconds at 50 a second
        t = time.perf_counter()
        assert post(app, body)[0] == 200
        times.append(time.perf_counter() - t)
        time.sleep(max(0, start + (i + 1) / 50 - time.perf_counter()))
    times.sort()
    p99 = times[int(len(times) * 0.99) - 1]
    print(f'/hook at 50 events/s: p50 {times[len(times) // 2] * 1000:.1f} ms, p99 {p99 * 1000:.1f} ms, max {times[-1] * 1000:.1f} ms')
    assert p99 < limit, f'p99 {p99 * 1000:.1f} ms'
    assert wait_until(lambda: stored(app) == 500, 10)


def read_sse(app, want, timeout=5, only=('state',), path='/events'):
    """The first `want` messages from /events of the given kinds, as (event, data) pairs."""
    s = socket.create_connection(('127.0.0.1', app.port), timeout=timeout * SLOW)
    s.sendall(f'GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{app.port}\r\n\r\n'.encode())
    buf, out, end = b'', [], time.monotonic() + timeout * SLOW  # waits for messages to come, never for none to
    while len(out) < want and time.monotonic() < end:
        chunk = s.recv(65536)
        if not chunk:  # the stream closed (the app stopped): nothing more will come
            break
        buf += chunk
        while b'\n\n' in buf:
            block, buf = buf.split(b'\n\n', 1)
            lines = block.decode().split('\n')
            ev = next((l[7:] for l in lines if l.startswith('event: ')), None)
            data = next((l[6:] for l in lines if l.startswith('data: ')), None)
            if ev and data and (only is None or ev in only):
                out.append((ev, json.loads(data)))
    s.close()
    return out[:want]  # several messages can arrive in one read


def test_live_stream_delivers_a_change_within_a_second(app):
    got, done = [], threading.Event()

    def listen():
        got.extend(read_sse(app, 1, timeout=5))
        done.set()

    threading.Thread(target=listen, daemon=True).start()
    time.sleep(0.3)  # listening before the event
    t = time.monotonic()
    post(app, payload('UserPromptSubmit.json', session_id=SID, prompt='Hello city'))
    assert done.wait(5)
    took = time.monotonic() - t
    assert took < (4.0 if os.environ.get('CI') else 1.0), f'the change took {took:.2f} s to arrive'  # CI runners stall
    [(event, data)] = got
    assert event == 'state' and data['id'] == SID and data['doc']['headline'] == 'Hello city'


def test_a_new_listener_gets_every_session_first(app):
    post(app, payload('UserPromptSubmit.json', session_id=SID))
    post(app, payload('UserPromptSubmit.json', session_id=SID[:-2] + 'cc'))
    time.sleep(0.6)
    ids = {d['id'] for _, d in read_sse(app, 2)}
    assert ids == {SID, SID[:-2] + 'cc'}


def test_status_line_reaches_the_document(app):
    post(app, payload('UserPromptSubmit.json', session_id=SID))
    post(app, payload('statusLine-with-rate-limits.json', session_id=SID), path='/statusline')
    assert wait_until(lambda: (dict(app.hub.snapshot()).get(SID) or {}).get('cost') == {'usd': 0.0608294})


def test_logs_never_carry_payloads(app, caplog):
    caplog.set_level(logging.DEBUG, logger='skyborne')
    secret = 'pineapple-secret-7f3a'
    post(app, payload('UserPromptSubmit.json', session_id=SID, prompt=secret))
    post(app, b'{broken ' + secret.encode())
    assert wait_until(lambda: stored(app) == 1)
    time.sleep(0.3)
    assert secret not in caplog.text
    assert 'UserPromptSubmit' in caplog.text  # the event's name is fine


def test_failed_requests_print_no_traceback(app, capsys, caplog):
    """A client that hung up early is normal; anything else is one log line, never a traceback."""
    caplog.set_level(logging.DEBUG, logger='skyborne')
    for err in (BrokenPipeError(32, 'Broken pipe'), ConnectionResetError(), TimeoutError(), RuntimeError('pineapple')):
        try:
            raise err
        except Exception:
            app.httpd.handle_error(None, ('127.0.0.1', 1))
    assert capsys.readouterr().err == ''
    assert [r.getMessage() for r in caplog.records] == ['a request failed: RuntimeError']


def test_health_and_status_page(app):
    status, _, body = request(app, 'GET', '/health')
    h = json.loads(body)
    assert status == 200 and h['name'] == 'skyborne' and h['port'] == app.port
    status, headers, page = request(app, 'GET', '/status')
    assert status == 200 and b'Skyborne' in page and 'text/html' in headers['Content-Type']
    assert b'http://' not in page.replace(b'http-equiv', b'')  # no outside assets
    assert request(app, 'GET', '/nope')[0] == 404


def test_restart_restores_history(tmp_path):
    from skyborne.server import App
    a = App(port=0, db_path=tmp_path / 'x.db')
    a.start()
    post(a, payload('UserPromptSubmit.json', session_id=SID, prompt='Before the restart'))
    assert wait_until(lambda: stored(a) == 1)
    a.stop()
    b = App(port=0, db_path=tmp_path / 'x.db')
    b.start()
    try:
        assert dict(b.hub.snapshot())[SID]['headline'] == 'Before the restart'
    finally:
        b.stop()


# ---- the page, its assets, renames, past districts ----

def raw_get(app, path, **headers):
    """GET with the path sent exactly as written (urllib would tidy `..` away)."""
    import http.client
    c = http.client.HTTPConnection('127.0.0.1', app.port, timeout=5 * SLOW)
    c.putrequest('GET', path, skip_host=True)
    c.putheader('Host', f'127.0.0.1:{app.port}')
    for k, v in headers.items():
        c.putheader(k, v)
    c.endheaders()
    r = c.getresponse()
    return r.status, dict(r.getheaders()), r.read()


def fake_web(tmp_path, monkeypatch):
    from skyborne import server
    web = tmp_path / 'web'
    (web / 'assets' / 'three').mkdir(parents=True)
    (web / 'index.html').write_text('<!doctype html><meta name="skyborne-token" content="__SKYBORNE_TOKEN__"><p>City</p>')
    (web / 'assets' / 'three' / 'three.module.min.js').write_text('export const REVISION = "170";')
    (web / 'assets' / 'icons').mkdir()
    (web / 'assets' / 'icons' / 'icon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
    (web / 'assets' / 'icons' / 'icon-32.png').write_bytes(b'\x89PNG\r\n\x1a\n')
    (web / 'assets' / 'secret.py').write_text('nope')
    (tmp_path / 'outside.js').write_text('nope')
    monkeypatch.setattr(server, 'WEB', web)
    return web


def test_the_page_carries_this_launchs_token_and_a_strict_policy(app, tmp_path, monkeypatch):
    fake_web(tmp_path, monkeypatch)
    status, headers, body = request(app, 'GET', '/')
    assert status == 200 and app.token.encode() in body and b'__SKYBORNE_TOKEN__' not in body
    csp = headers['Content-Security-Policy']
    assert "default-src 'self'" in csp and "connect-src 'self'" in csp and "frame-ancestors 'none'" in csp
    assert headers['Cache-Control'] == 'no-store' and headers['Referrer-Policy'] == 'no-referrer'
    assert len(app.token) >= 40


def test_assets_are_served_and_nothing_else(app, tmp_path, monkeypatch):
    fake_web(tmp_path, monkeypatch)
    status, headers, body = raw_get(app, '/assets/three/three.module.min.js')
    assert status == 200 and headers['Content-Type'].startswith('text/javascript') and b'REVISION' in body
    status, headers, _ = raw_get(app, '/assets/icons/icon.svg')  # the tab icon
    assert status == 200 and headers['Content-Type'] == 'image/svg+xml' and headers['X-Content-Type-Options'] == 'nosniff'
    assert 'sandbox' in headers['Content-Security-Policy']  # opened on its own, it can run nothing
    status, headers, _ = raw_get(app, '/assets/icons/icon-32.png')
    assert status == 200 and headers['Content-Type'] == 'image/png' and 'Content-Security-Policy' not in headers
    for path in ('/assets/../index.html', '/assets/%2e%2e/index.html', '/assets/..%2f..%2foutside.js', '/assets/secret.py',
                 '/assets/three', '/assets/', '/assets/nope.js', '/assets/three/..\\..\\..\\outside.js'):
        assert raw_get(app, path)[0] == 404, path


def test_without_a_built_page_the_root_says_how_to_build_it(app, tmp_path, monkeypatch):
    from skyborne import server
    monkeypatch.setattr(server, 'WEB', tmp_path / 'missing')
    status, _, body = request(app, 'GET', '/')
    assert status == 503 and b'node build.js' in body


def test_a_listener_gets_names_then_every_session_then_ready(app):
    post(app, payload('UserPromptSubmit.json', session_id=SID))
    assert wait_until(lambda: SID in dict(app.hub.snapshot()))
    got = read_sse(app, 3, only=None)
    assert [e for e, _ in got] == ['names', 'state', 'ready']
    assert got[2][1] == {'token': app.token}  # a page that reconnects after a restart takes the new token


def test_the_live_stream_is_never_handed_to_another_sites_script(app):
    req = urllib.request.Request(f'http://127.0.0.1:{app.port}/events', headers={'Host': f'127.0.0.1:{app.port}'})
    with urllib.request.urlopen(req, timeout=5 * SLOW) as r:
        assert r.headers['X-Content-Type-Options'] == 'nosniff'
        assert r.headers['Cross-Origin-Resource-Policy'] == 'same-origin'


def test_feed_limit_keeps_the_newest_items(app):
    for i in range(6):
        post(app, payload('UserPromptSubmit.json', session_id=SID, prompt=f'Prompt {i}'))
    assert wait_until(lambda: (dict(app.hub.snapshot()).get(SID) or {}).get('turns') == 6)
    [(_, full)] = read_sse(app, 1)
    [(_, short)] = read_sse(app, 1, path='/events?feed=2')
    assert len(full['doc']['feed']) == 6 and [f['text'] for f in short['doc']['feed']] == ['Prompt 5', 'Prompt 4']


def rename(app, body, token=None, origin='own'):
    headers = {'Content-Type': 'application/json'}
    if token is not None:
        headers['X-Skyborne-Token'] = token
    if origin:
        headers['Origin'] = f'http://127.0.0.1:{app.port}' if origin == 'own' else origin
    return request(app, 'POST', '/api/names', json.dumps(body).encode(), headers)[0]


def test_renaming_needs_the_page_token(app):
    good = {'id': SID, 'name': '  Rate   limits  '}
    assert rename(app, good) == 403                                  # no token
    assert rename(app, good, token='x' * 43) == 403                  # wrong token
    assert rename(app, good, token=app.token, origin=None) == 403    # not from the page
    assert rename(app, good, token=app.token, origin='https://evil.example') == 403
    assert rename(app, {'id': 7, 'name': 'x'}, token=app.token) == 400
    assert rename(app, {'id': SID, 'name': ['x']}, token=app.token) == 400
    assert rename(app, good, token=app.token) == 200
    assert wait_until(lambda: app.store.names() == {SID: 'Rate limits'})
    assert wait_until(lambda: app.hub.names_now() == {SID: 'Rate limits'})  # the hub hears it just after the commit
    assert rename(app, {'id': SID, 'name': ''}, token=app.token) == 200
    assert wait_until(lambda: app.store.names() == {})


def test_a_rename_reaches_every_listener(app):
    got = []
    t = threading.Thread(target=lambda: got.extend(read_sse(app, 2, only=('names',))), daemon=True)
    t.start()
    time.sleep(0.4)
    assert rename(app, {'id': SID, 'name': 'Login fixer'}, token=app.token) == 200
    t.join(5 * SLOW)  # as long as read_sse may wait
    assert got[-1] == ('names', {'names': {SID: 'Login fixer'}})


def test_two_listeners_both_stay_live(app):
    results = [[], []]
    threads = [threading.Thread(target=lambda r=r: r.extend(read_sse(app, 1)), daemon=True) for r in results]
    for t in threads:
        t.start()
    time.sleep(0.4)
    post(app, payload('UserPromptSubmit.json', session_id=SID, prompt='Both tabs'))
    for t in threads:
        t.join(5 * SLOW)
    assert all(r and r[0][1]['doc']['headline'] == 'Both tabs' for r in results)


def test_a_new_session_is_never_sent_empty():
    """Its (empty) history is loaded before its first event is written: the flusher must not send that."""
    from skyborne.server import Hub
    hub = Hub()
    q = hub.subscribe()
    hub.load_history(SID, [], [])
    hub.flush()
    assert q.empty()
    hub.add_event({'ts': 1, 'payload': payload('UserPromptSubmit.json', session_id=SID, prompt='First'), 'source': 'hook'})
    hub.flush()
    assert json.loads(q.get_nowait().decode().split('data: ', 1)[1])['doc']['headline'] == 'First'


def test_an_import_landing_after_the_first_live_event_is_counted(app):
    """The race: the first live event's history read ran while the import was still writing, so it found
    nothing; the import commits a moment later and must still reach the live session, once."""
    from skyborne.reducer import reduce
    app.hub.load_history(SID, [], [])  # the history read that found nothing
    post(app, payload('UserPromptSubmit.json', session_id=SID, prompt='Live'))
    assert wait_until(lambda: stored(app) == 1)
    st = seed(app.store.path, SID, 60_000, 'SessionStart-cmdhook.json', 'UserPromptSubmit.json', source='imported')
    st.add_event(int(time.time() * 1000) - 50_000, payload('SessionEnd.json', session_id=SID, reason='imported'), source='imported')
    st.add_import(SID, 'x.jsonl', 3, 0)
    st.commit()
    app.writer.put(('imports', 0, None))
    assert wait_until(lambda: (app.hub.docs.get(SID) or {}).get('turns') == 2), app.hub.docs.get(SID)
    assert reduce(*app.store.load([SID]))[SID]['turns'] == 2 and 'ended' not in app.hub.docs[SID]


def seed(path, sid, ago_ms, *names, source='hook'):
    """Events stored `ago_ms` ago, as an earlier run (or an import) would have left them."""
    from skyborne.store import Store
    st = Store(path)
    t = int(time.time() * 1000) - ago_ms
    for i, name in enumerate(names):
        st.add_event(t + i * 10, payload(name, session_id=sid), source=source)
    st.commit()
    return st


def test_past_sessions_come_back_as_past_districts(tmp_path):
    from skyborne.server import App
    seed(tmp_path / 'x.db', SID, 2 * 86400_000, 'SessionStart-cmdhook.json', 'UserPromptSubmit.json', 'SessionEnd.json')
    a = App(port=0, db_path=tmp_path / 'x.db')
    a.start()
    try:
        [(_, data)] = read_sse(a, 1)
        assert data['id'] == SID and data['doc']['ended'] and data['doc']['turns'] == 1
        assert SID not in a.hub.sessions  # a past district, not a live session
    finally:
        a.stop()


def test_a_session_back_after_hours_keeps_its_history_counted_once(tmp_path):
    from skyborne.server import App
    seed(tmp_path / 'x.db', SID, 8 * 3600_000, 'SessionStart-cmdhook.json', 'UserPromptSubmit.json')
    a = App(port=0, db_path=tmp_path / 'x.db')
    a.start()
    try:
        assert wait_until(lambda: a.hub.ready.is_set())
        post(a, payload('UserPromptSubmit.json', session_id=SID, prompt='Back again'))
        time.sleep(0.02)  # real prompts are turns apart; in the same millisecond a tie goes by text, not arrival
        post(a, payload('UserPromptSubmit.json', session_id=SID, prompt='And again'))
        assert wait_until(lambda: (dict(a.hub.snapshot()).get(SID) or {}).get('headline') == 'And again')
        doc = dict(a.hub.snapshot())[SID]
        assert doc['turns'] == 3 and sum(f['kind'] == 'join' for f in doc['feed']) == 1
        assert SID in a.hub.sessions and SID not in a.hub.past
        # quiet for 6 h: it leaves memory but stays a past district, then comes back with everything
        a.hub.evict(older_than_ms=-60_000)
        assert SID not in a.hub.sessions and a.hub.past[SID]['turns'] == 3
        post(a, payload('UserPromptSubmit.json', session_id=SID, prompt='Third time'))
        assert wait_until(lambda: (dict(a.hub.snapshot()).get(SID) or {}).get('turns') == 4)
    finally:
        a.stop()


def test_sessions_imported_while_running_appear(app):
    from skyborne.store import Store
    other = Store(app.store.path)  # `skyborne import` is another process with its own connection
    t = int(time.time() * 1000) - 3 * 86400_000
    other.add_event(t, payload('SessionStart-cmdhook.json', session_id=SID), source='imported')
    other.add_event(t + 50, payload('UserPromptSubmit.json', session_id=SID, prompt='From last week'), source='imported')
    other.add_import(SID, '/x.jsonl', 2, 0)
    other.commit()
    app.writer.put(('imports', 0, None))  # the server checks every 5 s; don't wait for it
    assert wait_until(lambda: SID in app.hub.past)
    doc = app.hub.past[SID]
    assert doc['imported'] is True and doc['headline'] == 'From last week'
    assert app.health()['lastEventAt'] is None  # imported history isn't "an event received"


def test_rejections_from_the_transcript_survive_a_rebuild(tmp_path):
    from skyborne.server import App
    a = App(port=0, db_path=tmp_path / 'x.db')
    a.start()
    try:
        post(a, payload('PreToolUse.json', session_id=SID, tool_use_id='toolu_no'))
        assert wait_until(lambda: stored(a) == 1)
        a.writer.put(('facts', 0, [{'ts': int(time.time() * 1000), 'session_id': SID, 'kind': 'tool_result',
                                    'tool_use_id': 'toolu_no', 'is_error': True}]))
        assert wait_until(lambda: any(f['kind'] == 'error' for f in (dict(a.hub.snapshot()).get(SID) or {}).get('feed', [])))
    finally:
        a.stop()
    events, facts = a.store.load([SID])
    assert [f['tool_use_id'] for f in facts if f['kind'] == 'tool_result'] == ['toolu_no']


def test_a_deeply_nested_body_does_not_stop_the_writer(app):
    deep = b'[' * 10_000 + b']' * 10_000  # json.loads raises RecursionError, not ValueError
    assert post(app, deep)[0] == 200
    post(app, payload('PreToolUse.json', session_id=SID))
    assert wait_until(lambda: stored(app) == 1)


# ---- what transcripts say that no hook does: a hand-over to another session, and the session's titles
OLD, NEW = '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c2'


def started(app, sid=OLD):
    for name, extra in (('SessionStart-cmdhook.json', {}), ('UserPromptSubmit.json', {'prompt': 'Make the film'})):
        body = json.dumps(payload(name, session_id=sid, **extra)).encode()
        assert request(app, 'POST', '/hook', body, {'Content-Type': 'application/json'})[0] == 200
    # both in memory, not just saved: the writer hands a saved batch to the hub one event at a time (and a hook is
    # answered before it's queued, so they can queue out of order); a test that evicts the session next mustn't have
    # a late one put it back
    def both():
        with app.hub.lock:
            s = app.hub.sessions.get(sid)
            return bool(s and s.starts and s.prompts)
    assert wait_until(both)


def handed_over(app, ts, sid=OLD, new=NEW):
    app.writer.put(('facts', 0, [{'ts': ts, 'session_id': sid, 'kind': 'continued', 'continued_in': new}]))


def transcript_ends(app, sid=OLD):
    with app.store.connect() as db:
        return db.execute("SELECT count(*) FROM events WHERE session_id = ? AND source = 'transcript'", (sid,)).fetchone()[0]


def doc(app, sid=OLD):
    with app.hub.lock:
        return app.hub.docs.get(sid) or app.hub.past.get(sid)


def test_a_hand_over_ends_the_session_once(app):
    started(app)
    at = int(time.time() * 1000) + 1000
    handed_over(app, at)
    handed_over(app, at)  # a restart reads the file again
    assert wait_until(lambda: (doc(app) or {}).get('ended'))
    assert doc(app)['ended'] == {'at': at, 'reason': 'continued', 'continuedIn': NEW}
    assert wait_until(lambda: transcript_ends(app) == 1) and transcript_ends(app) == 1
    assert app.store.stats()['events'] == 3  # two hooks and the stored hand-over


def test_a_hand_over_for_a_session_no_longer_in_memory_keeps_its_history(app):
    started(app)
    app.hub.evict(older_than_ms=-1000)
    assert not app.hub.knows(OLD)
    handed_over(app, int(time.time() * 1000) + 1000)
    assert wait_until(lambda: (doc(app) or {}).get('ended'))
    assert doc(app)['turns'] == 1 and doc(app)['ended']['reason'] == 'continued'


def test_a_name_given_in_skyborne_goes_with_the_conversation(app):
    started(app)
    app.store.set_name(OLD, 'Film studio', 1)
    app.hub.set_name(OLD, 'Film studio')
    handed_over(app, int(time.time() * 1000) + 1000)
    assert wait_until(lambda: app.hub.names_now().get(NEW) == 'Film studio')
    assert app.store.names().get(NEW) == 'Film studio'


def test_titles_are_kept_once_and_go_after_30_days(app):
    started(app)
    assert wait_until(lambda: (doc(app) or {}).get('turns') == 1)  # both hooks applied, not just stored
    before = doc(app)['updatedAt']
    later = int(time.time() * 1000) + 3_600_000  # a read long after the session went quiet
    titles = [{'ts': later, 'session_id': OLD, 'kind': 'title', 'title': t, 'custom': c, 'seq': seq}
              for t, c, seq in (('film-draft', False, 10), ('film-voice', False, 400), ('Film studio', True, 200))]
    app.writer.put(('facts', 0, titles))
    assert wait_until(lambda: (doc(app) or {}).get('sessionName') == 'Film studio')
    with app.store.connect() as db:
        assert db.execute('SELECT custom, ai FROM titles WHERE session_id = ?', (OLD,)).fetchall() == [('Film studio', 'film-voice')]
    # what a restart reads back, before the transcript is read again
    loaded = [f for f in app.store.load([OLD])[1] if f['kind'] == 'title']
    assert {(f['title'], f['custom'], f['seq']) for f in loaded} == {('Film studio', True, -1), ('film-voice', False, -1)}
    assert doc(app)['updatedAt'] == before  # titles never move the session's time
    app.store.db.execute('UPDATE titles SET at = 1')
    app.store.prune(30)
    with app.store.connect() as db:
        assert db.execute('SELECT count(*) FROM titles').fetchone()[0] == 0


def test_a_hand_over_to_itself_is_a_copied_line_and_is_not_stored(app):
    started(app)
    handed_over(app, int(time.time() * 1000) + 1000, new=OLD)
    started(app, NEW)  # something after it, so the writer has run
    assert wait_until(lambda: app.hub.knows(NEW) and doc(app) and doc(app, NEW))
    assert transcript_ends(app) == 0 and not doc(app).get('ended')
