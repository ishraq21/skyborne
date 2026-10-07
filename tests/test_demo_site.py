"""The demo site's recording (page/demo/recording.json, made by scripts/make_demo_recording.py) is public:
it must be a stand-ins recording with nothing personal or secret in it, and it must hold what the site shows
(a request that waits and is approved, another that is denied, and a loop that ends where its frames end)."""
import json
import os
import pathlib
import re

import pytest

from skyborne import scrub

REC = pathlib.Path(__file__).resolve().parents[1] / 'page' / 'demo' / 'recording.json'


@pytest.fixture(scope='module')
def rec():
    return json.loads(REC.read_text(encoding='utf-8'))


def test_it_is_a_stand_ins_recording(rec):
    assert rec['format'] == 'skyborne-recording' and rec['version'] == 1
    assert rec['standIns'] is True
    assert rec['frames'] and rec['session']


def test_nothing_personal_or_secret_is_in_it():
    text = REC.read_text(encoding='utf-8')
    # no identity needed for these: other people's home folders, any email but the stand-in, keys and tokens, random-looking strings
    assert scrub.leaks(text, scrub.Identity()) == []
    # on a developer's machine, also this person's own login, names, computer and email (CI's runner name would only add noise)
    if not os.environ.get('CI'):
        assert scrub.leaks(text, scrub.local_identity()) == []
    # the folder the recording was made in must not show: it is a temp path of the machine that made it
    assert not re.search(r'skyborne-demo|/var/folders|/private/', text)


def test_the_site_has_its_two_requests(rec):
    asks = [e['payload'] for e in rec['events'] if e['payload'].get('hook_event_name') == 'PermissionRequest']
    commands = [a['tool_input'].get('command', '') for a in asks]
    assert len(commands) == 2 and 'unittest' in commands[0] and commands[1].startswith('rm -rf')
    waiting = [f['doc']['waiting'] for f in rec['frames'] if f['doc'].get('waiting')]
    assert waiting and not rec['frames'][-1]['doc'].get('waiting')  # a request left open at the end would show for good
    assert len({w['since'] for w in waiting}) == 2


def test_the_loop_ends_where_the_frames_end(rec):
    # the page loops after `duration` (+5 s): a longer value would leave the city standing there
    assert abs(rec['duration'] - rec['frames'][-1]['t']) < 1000
    assert rec['duration'] < 120_000


def test_each_request_opens_when_its_event_arrives(rec):
    # the page matches a waiting frame to its request by time: the two must agree for the site's own recording
    at = sorted({f['doc']['waiting']['since'] for f in rec['frames'] if f['doc'].get('waiting')})
    events = sorted(e['t'] for e in rec['events'] if e['payload'].get('hook_event_name') == 'PermissionRequest')
    assert len(at) == len(events) and all(abs(a - b) < 1000 for a, b in zip(at, events))
