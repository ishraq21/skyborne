"""Answering permission requests from the page: the held hook, every way a request ends, and the guards.

A raw socket stands in for the plugin's curl, so a test can hold a request open, read the answer, or hang up.
"""
import datetime
import json
import queue
import socket
import struct
import threading
import time
import urllib.request

from conftest import SLOW, request, wait_until
from skyborne.approvals import ANSWERS

SID = '00000000-0000-4000-8000-0000000000cc'
EMPTY = b''


def event(name, tool_use_id=None, cmd='touch a.txt', agent=None, tool='Bash', **extra):
    p = {'session_id': SID, 'hook_event_name': name, 'cwd': '/tmp/project', 'tool_name': tool,
         'tool_input': {'command': cmd} if tool == 'Bash' else {'questions': [{'question': cmd}]}, **extra}
    if tool_use_id:
        p['tool_use_id'] = tool_use_id
    if agent:
        p['agent_id'], p['agent_type'] = agent, 'Explore'
    return p


def hook(app, p):
    status, _, body = request(app, 'POST', '/hook', json.dumps(p).encode(), {'Content-Type': 'application/json'})
    assert (status, body) == (200, EMPTY)


class Held:
    """One PermissionRequest hook, as the plugin's curl sends it."""

    def __init__(self, app, p, wait=None, entrypoint='cli', origin=None):
        data = json.dumps(p).encode()
        lines = ['POST /permission HTTP/1.1', f'Host: 127.0.0.1:{app.port}', 'Content-Type: application/json',
                 f'Content-Length: {len(data)}', f'X-Skyborne-Entrypoint: {entrypoint}']
        lines += [f'X-Skyborne-Wait: {wait}'] if wait else []
        lines += [f'Origin: {origin}'] if origin else []
        self.sock = socket.create_connection(('127.0.0.1', app.port))
        self.sock.sendall(('\r\n'.join(lines) + '\r\n\r\n').encode() + data)
        self.sock.settimeout(0.05)  # the reader wakes often, so hang_up() can stop it before closing
        self.raw, self.done, self.stopping = b'', threading.Event(), False
        self.reader = threading.Thread(target=self._read, daemon=True)
        self.reader.start()

    def _read(self):
        try:
            while not self.stopping:
                try:
                    chunk = self.sock.recv(65536)
                except socket.timeout:
                    continue
                if not chunk:
                    break
                self.raw += chunk
        except OSError:
            pass
        self.done.set()

    def reply(self, timeout=3.0):
        """(status, body) once the server answered, or None while it still holds the request. On CI the wait is
        longer: a held request is held for minutes, so looking longer never makes a "still held" check wrong."""
        if not self.done.wait(timeout * SLOW):
            return None
        head, _, body = self.raw.partition(b'\r\n\r\n')
        return int(head.split(b' ')[1]), body

    def hang_up(self):
        # an abrupt close (RST). The reader stops first: on Linux a socket another thread is still reading
        # from isn't really closed until that read ends
        self.stopping = True
        self.reader.join(1)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
        self.sock.close()


def answer(app, ask_id, decision='allow', **headers):
    h = {'Content-Type': 'application/json', 'Origin': f'http://127.0.0.1:{app.port}', 'X-Skyborne-Token': app.token, **headers}
    h = {k: v for k, v in h.items() if v is not None}
    status, _, body = request(app, 'POST', '/api/answer', json.dumps({'id': ask_id, 'decision': decision}).encode(), h)
    return status, json.loads(body) if body.startswith(b'{') else body


def cards(app):
    return app.approvals.snapshot()['asks']


def one_card(app):
    got = wait_until(lambda: cards(app), 3)
    assert len(got) == 1, got
    return got[0]


def rows(app, n=1):
    got = wait_until(lambda: len(app.store.decisions()) >= n and app.store.decisions(), 3)
    assert got, 'no decision logged'
    return got


def ask(app, tuid='T1', cmd='touch a.txt', agent=None, transcript=None, **kw):
    """A tool call that needs approval: its PreToolUse, then its held PermissionRequest."""
    extra = {'transcript_path': str(transcript)} if transcript else {}
    hook(app, event('PreToolUse', tuid, cmd, agent, **extra))
    return Held(app, event('PermissionRequest', None, cmd, agent, permission_suggestions=[{'type': 'setMode', 'mode': 'acceptEdits'}], **extra), **kw)


def transcript(app):
    path = app.store.path.parent / 'session.jsonl'
    path.write_text('')
    return path


def write_line(path, line):
    """One transcript line, as Claude Code appends it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'a') as f:
        f.write(json.dumps({**line, 'timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')}) + '\n')


def decision_line(tuid, decision='allow'):
    return {'type': 'attachment', 'attachment': {'type': 'hook_permission_decision', 'decision': decision, 'toolUseID': tuid,
                                                 'hookEvent': 'PermissionRequest'}}


def result_line(tuid, is_error=False):
    return {'type': 'user', 'message': {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': tuid, 'is_error': is_error, 'content': 'done'}]}}


def listen(app):
    q = app.hub.subscribe()

    def answers(timeout=3.0 * SLOW):
        out, end = [], time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                msg = q.get(timeout=0.05).decode()
            except queue.Empty:
                if out:
                    break
                continue
            if msg.startswith('event: answer'):
                out.append(json.loads(msg.split('data: ', 1)[1]))
        return out
    return answers


# ---------------------------------------------------------------- the page answers
def test_approve_from_the_page_answers_the_hook_and_logs_it(app):
    path = transcript(app)
    answers = listen(app)
    held = ask(app, transcript=path)
    card = one_card(app)
    assert (card['session'], card['agent'], card['tool'], card['input'], card['state']) == (SID, 'main', 'Bash', {'command': 'touch a.txt'}, 'open')
    assert held.reply(0.3) is None  # held while nobody answers
    assert answer(app, card['id'], 'allow') == (200, {'ok': True})
    assert held.reply() == (200, b'{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}')
    assert one_card(app)['state'] == 'sent'  # not shown as given until Claude Code says it applied it
    assert not answers(0.5)
    [row] = rows(app)
    assert (row['decision'], row['answered_in'], row['how'], row['confirmed'], row['timed_out']) == ('allow', 'skyborne', 'page', None, 0)
    write_line(path, decision_line('T1'))
    write_line(path, result_line('T1'))
    assert wait_until(lambda: not cards(app), 1.0)
    assert [(a['decision'], a['applied']) for a in answers()] == [('allow', True)]
    assert wait_until(lambda: rows(app)[0]['confirmed'] == 1)
    assert row['request'] == {'tool_input': {'command': 'touch a.txt'}, 'permission_suggestions': [{'type': 'setMode', 'mode': 'acceptEdits'}]}
    assert row['agent_id'] == 'main' and row['tool_name'] == 'Bash' and row['waited_ms'] >= 0


def test_deny_from_the_page_says_so(app):
    held = ask(app)
    assert answer(app, one_card(app)['id'], 'deny')[0] == 200
    status, body = held.reply()
    assert json.loads(body)['hookSpecificOutput']['decision'] == {'behavior': 'deny', 'message': 'Denied from Skyborne'}
    assert rows(app)[0]['decision'] == 'deny'


def test_the_first_click_wins(app):
    held = ask(app)
    ask_id = one_card(app)['id']
    results = []
    threads = [threading.Thread(target=lambda d=d: results.append(answer(app, ask_id, d))) for d in ('allow', 'deny')]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(r[0] for r in results) == [200, 409]
    status, body = held.reply()
    assert json.loads(body)['hookSpecificOutput']['decision']['behavior'] in ('allow', 'deny')
    assert answer(app, ask_id, 'allow') == (409, {'ok': False, 'reason': 'answered'})
    assert len(rows(app)) == 1


def test_a_click_after_a_yes_in_the_terminal_is_shown_as_too_late(app):
    # a "Yes" typed in the terminal doesn't stop the hook, so a click while the tool runs still reaches it, and
    # changes nothing (docs/FINDINGS.md): the call's result then comes with no hook decision before it
    path = transcript(app)
    answers = listen(app)
    held = ask(app, transcript=path)
    assert answer(app, one_card(app)['id'], 'deny')[0] == 200
    held.reply()
    assert one_card(app)['state'] == 'sent'
    write_line(path, result_line('T1'))
    assert wait_until(lambda: not cards(app), 1.0)
    assert [(a['decision'], a['applied']) for a in answers()] == [('deny', False)]
    assert wait_until(lambda: rows(app)[0]['confirmed'] == 0)
    row = rows(app)[0]
    assert (row['decision'], row['answered_in'], row['how']) == ('allow', 'terminal', 'page')


def test_a_helpers_answer_is_read_from_its_own_transcript(app):
    path = transcript(app)
    hook(app, {'session_id': SID, 'hook_event_name': 'SubagentStart', 'agent_id': 'A1', 'agent_type': 'general-purpose'})
    held = ask(app, 'T2', 'touch h.txt', agent='A1', transcript=path)
    answer(app, one_card(app)['id'], 'allow')
    held.reply()
    write_line(path.parent / 'session' / 'subagents' / 'agent-A1.jsonl', decision_line('T2'))
    assert wait_until(lambda: not cards(app), 1.0)
    assert wait_until(lambda: rows(app)[0]['confirmed'] == 1)


def test_with_no_word_from_the_transcript_the_card_still_closes(app, monkeypatch):
    from skyborne import approvals
    monkeypatch.setattr(approvals, 'VERDICT_GRACE_S', 0.3)
    answers = listen(app)
    held = ask(app)  # no transcript to read
    answer(app, one_card(app)['id'], 'allow')
    held.reply()
    hook(app, event('PostToolUse', 'T1'))
    assert wait_until(lambda: not cards(app), 2.0)
    assert [a['applied'] for a in answers()] == [None]
    assert rows(app)[0]['confirmed'] is None


# ---------------------------------------------------------------- the terminal answers, or the session moves on
def test_a_no_in_the_terminal_hangs_up_and_clears_the_card(app):
    held = ask(app)
    ask_id = one_card(app)['id']
    held.hang_up()
    assert wait_until(lambda: not cards(app), 1.0)
    assert answer(app, ask_id, 'allow') == (409, {'ok': False, 'reason': 'terminal'})
    row = rows(app)[0]
    assert (row['decision'], row['answered_in'], row['how']) == ('deny', 'terminal', 'hangup')


def test_a_yes_in_the_terminal_clears_the_card_when_the_tool_finishes(app):
    held = ask(app)
    one_card(app)
    ask_id = cards(app)[0]['id']
    hook(app, event('PostToolUse', 'T1', duration_ms=5))
    assert held.reply(1.0) == (200, EMPTY)
    assert not cards(app)
    assert answer(app, ask_id, 'allow') == (409, {'ok': False, 'reason': 'terminal'})
    row = rows(app)[0]
    assert (row['decision'], row['answered_in'], row['how']) == ('allow', 'terminal', 'ran')


def test_a_failed_call_and_a_refused_call_clear_their_cards(app):
    held1 = ask(app, 'T1', 'touch a.txt')
    held2 = ask(app, 'T2', 'touch b.txt')
    assert wait_until(lambda: len(cards(app)) == 2)
    hook(app, event('PostToolUseFailure', 'T1', 'touch a.txt', error='Exit code 1'))
    app.writer.put(('facts', 0, [{'ts': int(time.time() * 1000), 'session_id': SID, 'kind': 'tool_result', 'tool_use_id': 'T2', 'is_error': True}]))
    assert held1.reply(1.0) == (200, EMPTY) and held2.reply(1.0) == (200, EMPTY)
    assert sorted((r['how'], r['decision']) for r in rows(app, 2)) == [('failed', 'allow'), ('refused', 'deny')]


def test_the_session_ending_clears_the_card(app):
    held = ask(app)
    one_card(app)
    hook(app, {'session_id': SID, 'hook_event_name': 'SessionEnd', 'reason': 'prompt_input_exit'})
    assert held.reply(1.0) == (200, EMPTY)
    row = rows(app)[0]
    assert (row['decision'], row['answered_in'], row['how']) == ('none', 'nowhere', 'ended')


def test_a_new_prompt_clears_the_leads_card_but_not_a_helpers(app):
    hook(app, {'session_id': SID, 'hook_event_name': 'SubagentStart', 'agent_id': 'A1', 'agent_type': 'Explore'})
    lead = ask(app, 'T1', 'touch a.txt')
    helper = ask(app, 'T2', 'wc -l a.txt', agent='A1')
    assert wait_until(lambda: len(cards(app)) == 2)
    time.sleep(0.01)
    hook(app, {'session_id': SID, 'hook_event_name': 'UserPromptSubmit', 'prompt': 'something else'})
    assert lead.reply(1.0) == (200, EMPTY)
    time.sleep(0.5)
    assert [c['agent'] for c in cards(app)] == ['A1'] and helper.reply(0.1) is None
    time.sleep(0.01)
    hook(app, {'session_id': SID, 'hook_event_name': 'SubagentStop', 'agent_id': 'A1', 'agent_type': 'Explore'})
    assert helper.reply(1.0) == (200, EMPTY)
    assert sorted(r['how'] for r in rows(app, 2)) == ['prompt', 'stopped']


def test_two_helpers_asking_for_the_same_command(app):
    for a in ('A1', 'A2'):
        hook(app, {'session_id': SID, 'hook_event_name': 'SubagentStart', 'agent_id': a, 'agent_type': 'Explore'})
    h1 = ask(app, 'T1', 'wc -l a.txt', agent='A1')
    h2 = ask(app, 'T2', 'wc -l a.txt', agent='A2')
    assert wait_until(lambda: len(cards(app)) == 2)
    hook(app, event('PostToolUse', 'T2', 'wc -l a.txt', agent='A2'))
    assert h2.reply(1.0) == (200, EMPTY)
    time.sleep(0.4)
    [left] = cards(app)
    assert left['agent'] == 'A1' and h1.reply(0.1) is None
    assert answer(app, left['id'], 'allow')[0] == 200
    assert json.loads(h1.reply()[1]) == ANSWERS['allow']


def test_two_identical_commands_from_one_agent(app):
    h1 = ask(app, 'T1', 'ls')
    h2 = ask(app, 'T2', 'ls')
    assert wait_until(lambda: len(cards(app)) == 2)
    hook(app, event('PostToolUse', 'T1', 'ls'))
    assert wait_until(lambda: len(cards(app)) == 1, 1.0)
    assert [h.reply(0.1) for h in (h1, h2)].count(None) == 1


# ---------------------------------------------------------------- limits
def test_out_of_time_the_card_says_answer_in_the_terminal(app):
    held = ask(app, wait=1)
    ask_id = one_card(app)['id']
    assert held.reply(2.5) == (200, EMPTY)  # no decision: the dialog stays in the terminal
    [card] = cards(app)
    assert card['state'] == 'terminal'
    assert answer(app, ask_id, 'allow') == (409, {'ok': False, 'reason': 'closed'})
    hook(app, event('PostToolUse', 'T1'))
    assert wait_until(lambda: not cards(app), 1.0)
    row = rows(app)[0]
    assert (row['timed_out'], row['how'], row['answered_in']) == (1, 'ran', 'terminal')


def test_a_card_says_when_skyborne_stops_holding_it(app):
    held = ask(app, wait=30)
    card = one_card(app)
    assert card['until'] == card['since'] + 30_000
    held.hang_up()
    assert wait_until(lambda: not cards(app), 2.0)
    held = ask(app, tuid='T2', cmd='touch b.txt')  # no X-Skyborne-Wait: the server's own limit
    card = one_card(app)
    assert card['until'] == card['since'] + 595_000
    held.hang_up()


def test_questions_and_plans_are_left_to_the_terminal(app):
    hook(app, event('PreToolUse', 'Q1', 'Tea or coffee?', tool='AskUserQuestion'))
    held = Held(app, event('PermissionRequest', None, 'Tea or coffee?', tool='AskUserQuestion'))
    assert held.reply(0.5) == (200, EMPTY)  # answered at once, never held
    card = one_card(app)
    assert (card['state'], card['terminalOnly'], card['until']) == ('terminal', True, None)
    assert answer(app, card['id'], 'allow')[0] == 409
    hook(app, event('PostToolUse', 'Q1', 'Tea or coffee?', tool='AskUserQuestion'))
    assert wait_until(lambda: not cards(app), 1.0)


def test_print_mode_is_never_held(app):
    hook(app, event('PreToolUse', 'T1'))
    held = Held(app, event('PermissionRequest'), entrypoint='sdk-cli')
    assert held.reply(0.5) == (200, EMPTY)
    time.sleep(0.4)
    assert not cards(app)
    assert wait_until(lambda: app.store.stats()['events'] == 2)


def test_stopping_the_server_releases_held_requests(app):
    held = ask(app)
    one_card(app)
    app.stop()
    assert held.reply(2.0) == (200, EMPTY)
    [row] = app.store.decisions()
    assert (row['how'], row['decision']) == ('server_stop', 'none')


# ---------------------------------------------------------------- guards
def test_answers_without_the_token_or_from_elsewhere_change_nothing(app):
    held = ask(app)
    ask_id = one_card(app)['id']
    for headers in ({'X-Skyborne-Token': None}, {'X-Skyborne-Token': 'wrong'}, {'Origin': None},
                    {'Origin': 'https://evil.example'}, {'Origin': f'http://127.0.0.1:{app.port + 1}'},
                    {'Host': 'evil.example'}, {'Host': f'evil.example:{app.port}'}):
        assert answer(app, ask_id, 'allow', **headers)[0] == 403, headers
    assert answer(app, ask_id, 'maybe')[0] == 400
    time.sleep(0.3)
    assert held.reply(0.1) is None and cards(app)[0]['state'] == 'open' and not app.store.decisions()
    assert answer(app, ask_id, 'allow')[0] == 200  # the page itself still can


def test_only_claude_code_may_post_a_permission_request(app):
    for origin in (f'http://127.0.0.1:{app.port}', 'https://evil.example'):
        assert Held(app, event('PermissionRequest'), origin=origin).reply() == (403, b'Forbidden')
    status, _, _ = request(app, 'POST', '/permission', b'{}', {'Host': 'evil.example'})
    assert status == 403
    time.sleep(0.4)
    assert not cards(app) and app.store.stats()['events'] == 0


def test_the_live_stream_sends_the_cards(app):
    held = ask(app)
    one_card(app)
    req = urllib.request.Request(f'http://127.0.0.1:{app.port}/events', headers={'Host': f'127.0.0.1:{app.port}'})
    with urllib.request.urlopen(req, timeout=5) as r:
        seen, event_name = [], None
        while 'asks' not in seen:
            line = r.readline().decode().strip()
            if line.startswith('event: '):
                event_name = line[7:]
                seen.append(event_name)
            elif line.startswith('data: ') and event_name == 'asks':
                data = json.loads(line[6:])
                assert [c['tool'] for c in data['asks']] == ['Bash'] and data['v'] > 0
    assert seen.index('asks') > seen.index('ready')
    held.hang_up()


def test_a_helpers_card_can_still_be_approved_after_the_lead_moves_on(app):
    hook(app, {'session_id': SID, 'hook_event_name': 'SubagentStart', 'agent_id': 'A1', 'agent_type': 'general-purpose'})
    held = ask(app, 'T2', 'touch helper.txt', agent='A1')
    ask_id = one_card(app)['id']
    time.sleep(0.01)
    hook(app, {'session_id': SID, 'hook_event_name': 'UserPromptSubmit', 'prompt': 'meanwhile'})
    time.sleep(0.5)
    assert answer(app, ask_id, 'allow') == (200, {'ok': True})
    assert json.loads(held.reply()[1]) == ANSWERS['allow']


def test_cards_of_sessions_the_server_stops_following_are_ended(app):
    held = ask(app, wait=1)
    one_card(app)
    assert held.reply(2.5) == (200, EMPTY)
    assert cards(app)[0]['state'] == 'terminal'
    app.approvals.forget_sessions(app.hub.evict(older_than_ms=-10_000))  # as if quiet for hours
    assert not cards(app)
    assert rows(app)[0]['how'] == 'ended'


def test_a_strange_wait_header_never_strands_a_card(app):
    hook(app, event('PreToolUse', 'T1'))
    sock = socket.create_connection(('127.0.0.1', app.port))
    data = json.dumps(event('PermissionRequest')).encode()
    sock.sendall(b'POST /permission HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nContent-Length: %d\r\nX-Skyborne-Wait: \xb2\r\n\r\n' % (app.port, len(data)) + data)
    ask_id = one_card(app)['id']  # '²' counts as a digit to str.isdigit(), but not as a number: the default wait applies
    assert answer(app, ask_id, 'allow')[0] == 200
    sock.settimeout(3)
    assert b'"behavior":"allow"' in sock.recv(65536)
    sock.close()


def test_a_click_before_the_request_is_matched_to_its_call_still_counts(app):
    # the PreToolUse comes late (its own background curl): the hook decision line is written before the
    # server knows which call it is, and must not be lost
    path = transcript(app)
    answers = listen(app)
    held = Held(app, event('PermissionRequest', transcript_path=str(path)))
    assert answer(app, one_card(app)['id'], 'allow')[0] == 200
    held.reply()
    write_line(path, decision_line('T1'))
    time.sleep(0.6)
    hook(app, event('PreToolUse', 'T1', transcript_path=str(path)))
    write_line(path, result_line('T1'))
    assert wait_until(lambda: not cards(app), 2.0)
    assert [a['applied'] for a in answers()] == [True]
    assert wait_until(lambda: rows(app)[0]['confirmed'] == 1)


def test_a_tool_that_failed_after_a_yes_in_the_terminal_is_logged_as_allowed(app):
    path = transcript(app)
    held = ask(app, transcript=path)
    answer(app, one_card(app)['id'], 'deny')
    held.reply()
    write_line(path, result_line('T1', is_error=True))  # it ran and failed: no toolDenialKind
    assert wait_until(lambda: rows(app)[0]['confirmed'] == 0)
    row = rows(app)[0]
    assert (row['decision'], row['answered_in']) == ('allow', 'terminal')


def test_a_result_written_just_before_the_click_is_still_seen(app):
    # a Yes in the terminal on a quick command: its result is in the transcript a moment before the click
    path = transcript(app)
    answers = listen(app)
    held = ask(app, transcript=path)
    ask_id = one_card(app)['id']
    write_line(path, result_line('T1'))
    status, body = answer(app, ask_id, 'allow')
    if status == 200:  # the click won the race to the server: the transcript then says it was too late
        held.reply()
        assert wait_until(lambda: not cards(app), 2.0)
        assert [a['applied'] for a in answers()] == [False]
    else:
        assert (status, body) == (409, {'ok': False, 'reason': 'terminal'})
    assert wait_until(lambda: not cards(app), 2.0)
    assert rows(app)[0]['answered_in'] == 'terminal'


def test_a_hook_decision_that_isnt_ours_is_not_taken_as_ours(app):
    # another plugin's PermissionRequest hook answered differently: the line carries no hook name
    path = transcript(app)
    answers = listen(app)
    held = ask(app, transcript=path)
    answer(app, one_card(app)['id'], 'allow')
    held.reply()
    write_line(path, decision_line('T1', 'deny'))
    write_line(path, {**result_line('T1', is_error=True), 'toolDenialKind': 'permission-rule'})
    assert wait_until(lambda: not cards(app), 2.0)
    assert [a['applied'] for a in answers()] == [False]
    assert wait_until(lambda: rows(app)[0]['confirmed'] == 0)
    assert rows(app)[0]['decision'] == 'deny'
