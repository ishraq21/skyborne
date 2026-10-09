"""The session detail: Session.detail() evals (tests/evals/detail/*.json), and the GETs that serve it."""
import copy
import json
import pathlib
import random
import threading
import time

import pytest

from conftest import payload, request, wait_until
from skyborne.reducer import Session

EVALS = pathlib.Path(__file__).resolve().parent / 'evals'
DETAILS = sorted((EVALS / 'detail').glob('*.json'))
SID = '00000000-0000-4000-8000-0000000000dd'


def detail_of(events, facts):
    [sid] = {e['payload']['session_id'] for e in events}
    s = Session(sid)
    for e in copy.deepcopy(events):
        s.add_event(e)
    for f in copy.deepcopy(facts):
        s.add_fact(f)
    return s.detail()


def eval_of(path):
    return json.loads((EVALS / path.name).read_text(encoding='utf-8'))


@pytest.mark.parametrize('path', DETAILS, ids=lambda p: p.stem)
def test_detail_matches_saved_result(path):
    e = eval_of(path)
    assert detail_of(e['events'], e['facts']) == json.loads(path.read_text(encoding='utf-8'))['expect']


@pytest.mark.parametrize('path', DETAILS, ids=lambda p: p.stem)
def test_detail_arrival_order_does_not_matter(path):
    e, expect = eval_of(path), json.loads(path.read_text(encoding='utf-8'))['expect']
    rng = random.Random(path.stem)
    for _ in range(5):
        events, facts = copy.deepcopy(e['events']), copy.deepcopy(e['facts'])
        rng.shuffle(events)
        rng.shuffle(facts)
        assert detail_of(events, facts) == expect


def test_every_eval_has_a_detail():
    assert {p.stem for p in DETAILS} == {p.stem for p in EVALS.glob('*.json')}


def test_steps_match_the_feeds_durations():
    """The timeline and the log say the same about every call (one _duration rule)."""
    from skyborne.reducer import reduce
    for path in DETAILS:
        e = eval_of(path)
        [doc] = reduce(e['events'], e['facts'], e['now']).values()
        feed = {f['toolUseId']: f.get('durationMs') for f in doc['feed'] if f.get('toolUseId') and f['kind'] != 'error'}
        for s in json.loads(path.read_text(encoding='utf-8'))['expect']['steps']:
            assert feed.get(s['id']) == s['ms'], (path.stem, s['id'])


def test_files_count_edits_that_ran_and_ones_that_failed():
    d = json.loads((EVALS / 'detail' / 'files-edited.json').read_text(encoding='utf-8'))['expect']
    assert d['files'] == [{'path': '/home/user/project/notes.md', 'edits': 1, 'failed': 1},
                          {'path': '/home/user/project/a.ipynb', 'edits': 1, 'failed': 0},
                          {'path': '/home/user/project/todo.md', 'edits': 1, 'failed': 0}]
    [b1] = [s for s in d['steps'] if s['id'] == 'B1']
    assert (b1['end'], b1['outcome'], b1['ms']) == (9000, None, None)  # never finished: stopped with the session


def test_a_running_call_has_no_end_while_the_session_runs():
    e = eval_of(EVALS / 'detail' / 'waiting-open.json')
    [step] = detail_of(e['events'], e['facts'])['steps']
    assert step['end'] is None and step['outcome'] is None


def test_recorded_session_conversation_helpers_and_refusal():
    d = json.loads((EVALS / 'detail' / 'recorded-live-session.json').read_text(encoding='utf-8'))['expect']
    assert [c['who'] for c in d['conversation']] == ['you', 'claude', 'claude', 'you', 'claude', 'you', 'claude']
    assert [a['name'] for a in d['agents']] == ['Skybot', 'Scout 1', 'Scout 2']
    assert all(a['start'] <= a['end'] for a in d['agents'])
    assert [s['start'] for s in d['steps']] == sorted(s['start'] for s in d['steps'])
    refused = [s for s in d['steps'] if s['outcome'] == 'refused']
    assert len(refused) == 1 and refused[0]['tool'] == 'Bash' and refused[0]['ms'] is None


# ---------------------------------------------------------------- the GETs
def hook(app, name, **changes):
    p = payload(name, session_id=SID, **changes)
    assert request(app, 'POST', '/hook', json.dumps(p).encode(), {'Content-Type': 'application/json'})[0] == 200


def turn(app):
    hook(app, 'UserPromptSubmit.json', prompt='List the files')
    hook(app, 'PreToolUse.json', tool_use_id='T1', tool_input={'command': 'ls'})
    hook(app, 'PostToolUse.json', tool_use_id='T1', tool_input={'command': 'ls'}, tool_response={'stdout': 'a.txt'})
    assert wait_until(lambda: app.store.stats()['events'] == 3)
    # the writer saves a batch, then hands it to the hub one event at a time (and a hook is answered before it's queued,
    # so they can even queue out of order): wait for all three in memory, or a test that evicts the session next can
    # have a late one put it back
    assert wait_until(lambda: in_memory(app, lambda s: s.prompts and (s.calls.get('T1') or {}).get('pre') is not None and s.calls['T1']['outcome'] == 'ok'))


def in_memory(app, check):
    """check(session) on the hub's copy of the session, under its lock (False while it isn't in memory)."""
    with app.hub.lock:
        s = app.hub.sessions.get(SID)
        return bool(s and check(s))


def get(app, path, token='', **headers):
    """GET with the page's token ('' means this app's own; None sends none)."""
    token = app.token if token == '' else token
    h = {**({'X-Skyborne-Token': token} if token is not None else {}), **headers}
    status, hdrs, body = request(app, 'GET', path, headers=h)
    return status, hdrs, json.loads(body) if status == 200 else body


def test_the_page_gets_a_session_with_its_token_and_no_origin(app):
    turn(app)
    status, headers, d = get(app, f'/api/session?id={SID}')
    assert status == 200 and headers['Cache-Control'] == 'no-store'
    assert [s['text'] for s in d['steps']] == ['$ ls'] and d['steps'][0]['outcome'] == 'ok'
    assert d['conversation'] == [{'ts': d['conversation'][0]['ts'], 'who': 'you', 'text': 'List the files'}]
    assert d['approvals'] == []


def test_detail_reads_need_the_token_and_this_server(app):
    turn(app)
    for path in (f'/api/session?id={SID}', f'/api/step?session={SID}&id=T1'):
        assert get(app, path, token=None)[0] == 403
        assert get(app, path, token='wrong')[0] == 403
        assert get(app, path, Host='evil.example')[0] == 403
        assert get(app, path, Origin='https://evil.example')[0] == 403
        assert get(app, path, Origin=f'http://127.0.0.1:{app.port}')[0] == 200


def test_unknown_sessions_and_calls_are_404(app):
    turn(app)
    assert get(app, '/api/session?id=nope')[0] == 404
    assert get(app, '/api/session')[0] == 404
    assert get(app, f'/api/step?session={SID}&id=nope')[0] == 404
    assert get(app, '/api/step?id=T1')[0] == 404


def test_a_step_comes_with_its_input_and_output(app):
    turn(app)
    status, _, step = get(app, f'/api/step?session={SID}&id=T1')
    assert status == 200
    assert step == {'tool': 'Bash', 'input': {'command': 'ls'}, 'output': {'stdout': 'a.txt'}}


def test_a_failed_step_comes_with_its_error_and_a_cut_output_says_so(app):
    hook(app, 'PreToolUse.json', tool_use_id='F1', tool_input={'command': 'false'})
    hook(app, 'PostToolUseFailure.json', tool_use_id='F1', tool_input={'command': 'false'}, error='Exit code 1')
    hook(app, 'PreToolUse.json', tool_use_id='BIG', tool_input={'command': 'cat big'})
    hook(app, 'PostToolUse.json', tool_use_id='BIG', tool_input={'command': 'cat big'}, tool_response={'stdout': 'x' * 30000})
    assert wait_until(lambda: app.store.stats()['events'] == 4)
    assert get(app, f'/api/step?session={SID}&id=F1')[2]['error'] == 'Exit code 1'
    out = get(app, f'/api/step?session={SID}&id=BIG')[2]['output']
    assert out['skyborneTruncated'] is True and out['bytes'] > 30000


def test_a_past_session_is_rebuilt_once_and_kept(app, monkeypatch):
    turn(app)
    app.hub.evict(older_than_ms=-1000)
    assert not app.hub.knows(SID)
    loads, real = [], app.store.load

    def slow_load(sids):
        loads.append(sids)
        time.sleep(0.3)
        return real(sids)
    monkeypatch.setattr(app.store, 'load', slow_load)
    got = []
    threads = [threading.Thread(target=lambda: got.append(app.session_detail(SID))) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(loads) == 1  # the second asker waited for the first rebuild
    assert got[0] == got[1] and [s['text'] for s in got[0]['steps']] == ['$ ls']
    app.session_detail(SID)
    assert len(loads) == 1  # kept
    hook(app, 'Stop.json')  # a new event (the server reads the history back in): the kept copy is out of date
    assert wait_until(lambda: app.store.stats()['events'] == 4)
    assert wait_until(lambda: in_memory(app, lambda s: s.stops))  # in memory too (see turn)
    app.hub.evict(older_than_ms=-1000)
    before = len(loads)
    assert app.session_detail(SID)['conversation'][-1]['who'] == 'claude'
    assert len(loads) == before + 1


def test_approvals_are_the_sessions_own(app):
    turn(app)
    row = {'agent_id': 'main', 'tool_name': 'Bash', 'request': {'tool_input': {'command': 'rm x'}}, 'asked_at': 1000,
           'answered_at': 4000, 'decision': 'allow', 'answered_in': 'skyborne', 'how': 'page', 'timed_out': 0,
           'waited_ms': 3000, 'confirmed': 1}
    app.store.add_decision({**row, 'id': 'd1', 'session_id': SID})
    app.store.add_decision({**row, 'id': 'd2', 'session_id': 'someone-else'})
    app.store.db.commit()
    [a] = get(app, f'/api/session?id={SID}')[2]['approvals']
    assert a == {'tool': 'Bash', 'agent': 'main', 'text': '$ rm x', 'askedAt': 1000, 'answeredAt': 4000, 'decision': 'allow',
                 'answeredIn': 'skyborne', 'how': 'page', 'waitedMs': 3000, 'timedOut': False, 'confirmed': True}


def test_the_call_index_exists(app):
    with app.store.connect() as db:
        names = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'index'")}
    assert 'events_call' in names


def test_rebuilds_pause_the_cycle_collector_and_free_in_slices():
    """A long session's rebuild must not stall the hooks: the collector waits (nested pauses count up) and big
    lists are emptied a slice at a time."""
    import gc
    from skyborne.server import free_slowly, gc_paused
    was = gc.isenabled()
    gc.enable()
    with gc_paused():
        assert not gc.isenabled()
        with gc_paused():
            assert not gc.isenabled()
        assert not gc.isenabled()  # the outer pause still holds
    assert gc.isenabled()
    a, b = list(range(5000)), [1]
    free_slowly(a, b)
    assert a == [] and b == []
    if not was:
        gc.disable()


def test_the_server_hands_the_gil_to_waiting_hooks_quickly(app):
    """While a big detail is built and encoded, hooks wait for the GIL; at Python's default 5 ms they waited
    up to 45 ms on a 40,000-step session, at 1 ms under 10 ms."""
    import sys
    assert sys.getswitchinterval() == pytest.approx(0.001)
