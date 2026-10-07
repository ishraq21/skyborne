"""Make the demo site's recording: one real Claude Code session on a tiny throwaway project.

    .venv/bin/python scripts/make_demo_recording.py --out demo-raw.json

Needs a logged-in `claude` on this machine and spends a little usage (a small model, about two minutes).
A private Skyborne server runs on a free port with its own database in a temp folder, and `claude` runs in a
pseudo-terminal (tests/live/driver.py) with that server's plugin only. The session: three Explore helpers
read three folders, one Bash request is approved from Skyborne, another is denied from Skyborne (answered
the way the page does: POST /api/answer with the launch token). Any other request stops the run. Then `skyborne record --stand-ins` writes
the file. Read what it prints before using the recording: it lists every line the page will show.
"""
import argparse
import json
import pathlib
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'tests' / 'live'))
from driver import Session, clean_env  # type: ignore  # noqa: E402

BASE = pathlib.Path(tempfile.gettempdir()) / 'skyborne-demo'  # a plain path: no spaces or & for the commands to trip on
MODEL = 'claude-haiku-4-5-20251001'
SHOW_FOR = 4  # seconds a request stays on screen before it is answered, so a viewer can read it

FILES = {
    'README.md': '# Bookshelf\n\nA tiny library for keeping a reading list.\n',
    'src/shelf.py': 'class Shelf:\n    """A reading list: add books, mark them read, ask what is left."""\n\n'
                    '    def __init__(self):\n        self.books = {}\n\n'
                    '    def add(self, title, author):\n        self.books[title] = {"author": author, "read": False}\n\n'
                    '    def finish(self, title):\n        self.books[title]["read"] = True\n\n'
                    '    def unread(self):\n        return [t for t, b in self.books.items() if not b["read"]]\n',
    'src/search.py': 'def by_author(shelf, author):\n    """Titles on the shelf by one author."""\n'
                     '    return [t for t, b in shelf.books.items() if b["author"] == author]\n',
    'docs/usage.md': '# Using Bookshelf\n\n```python\nshelf = Shelf()\nshelf.add("Dune", "Frank Herbert")\n'
                     'shelf.finish("Dune")\nprint(shelf.unread())\n```\n\nSearch with `by_author(shelf, name)`.\n',
    'docs/ideas.md': '# Ideas\n\n- Ratings\n- Export to CSV\n- A reading streak counter\n',
    'tests/test_shelf.py': 'import sys\nimport unittest\n\nsys.path.insert(0, "src")\nfrom shelf import Shelf\nfrom search import by_author\n\n\n'
                           'class ShelfTests(unittest.TestCase):\n    def test_unread(self):\n        s = Shelf()\n'
                           '        s.add("Dune", "Frank Herbert")\n        s.add("Emma", "Jane Austen")\n        s.finish("Dune")\n'
                           '        self.assertEqual(s.unread(), ["Emma"])\n\n    def test_by_author(self):\n        s = Shelf()\n'
                           '        s.add("Emma", "Jane Austen")\n        self.assertEqual(by_author(s, "Jane Austen"), ["Emma"])\n\n\n'
                           'if __name__ == "__main__":\n    unittest.main()\n',
}
TOUR = ('Give me a quick tour of this small project. Start three Explore helpers in parallel, one each for the src, docs '
        'and tests folders, and have each report in two sentences what it found. Then run the tests with exactly this '
        'bash command: python3 -m unittest discover -s tests -q')
CLEAN_UP = 'Now clean up with exactly this bash command and nothing else: rm -rf src/__pycache__'


def wait_until(check, timeout, step=0.1):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        v = check()
        if v:
            return v
        time.sleep(step)
    return None


def answer(app, ask_id, decision):
    """As the page does it: the launch token and the server's own Origin."""
    req = urllib.request.Request(f'http://127.0.0.1:{app.port}/api/answer', method='POST',
                                 data=json.dumps({'id': ask_id, 'decision': decision}).encode(),
                                 headers={'Content-Type': 'application/json', 'X-Skyborne-Token': app.token,
                                          'Origin': f'http://127.0.0.1:{app.port}', 'Host': f'127.0.0.1:{app.port}'})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def next_ask(app, timeout):
    return wait_until(lambda: next(iter(app.approvals.snapshot()['asks']), None), timeout, 0.05)


def settle(app, want, decision, timeout):
    """Answer the request containing `want` with `decision`. Any other request stops the run: this script
    never answers a request it didn't expect (the project's own settings let the helpers look around freely)."""
    ask = next_ask(app, timeout)
    if not ask:
        return False
    command = str((ask.get('input') or {}).get('command', ''))
    if want not in command:
        raise SystemExit(f'An unexpected request needs a person to look at it: {command[:120]}. Nothing recorded.')
    time.sleep(SHOW_FOR)
    print(f'{decision} ({command[:60]}) ->', answer(app, ask['id'], decision))
    return True


def quiet(app, seconds, timeout=120):
    """Wait until no event has arrived for `seconds`."""
    def idle():
        with app.store.connect() as con:
            last = con.execute('SELECT MAX(received_at) FROM events').fetchone()[0] or 0
        return time.time() * 1000 - last > seconds * 1000
    wait_until(idle, timeout, 1)


def main():
    p = argparse.ArgumentParser(description=(__doc__ or '').splitlines()[0])
    p.add_argument('--out', required=True, help='where to write the recording (it is not the squeezed demo file)')
    args = p.parse_args()
    from skyborne import install, record
    from skyborne.server import App

    shutil.rmtree(BASE, ignore_errors=True)
    project = BASE / 'project'
    for name, text in FILES.items():
        f = project / name
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text)
    (project / '.claude').mkdir()
    # the plugin installed for real use stays off here: only this run's plugin sends to this run's server
    # the helpers' read-only commands run without asking; only the test run and the clean-up are asked about
    settings = {'enabledPlugins': {'skyborne@skills-dir': False},
                'permissions': {'allow': [f'Bash({c}:*)' for c in ('find', 'ls', 'cat', 'head', 'tail', 'wc', 'tree', 'grep', 'pwd')]}}
    (project / '.claude' / 'settings.local.json').write_text(json.dumps(settings))

    db = BASE / 'skyborne.db'
    app = App(port=0, db_path=db)
    app.start()
    install.write_plugin(BASE / 'plugin', app.port)
    s = Session(['claude', '--plugin-dir', str(BASE / 'plugin'), '--permission-mode', 'default', '--model', MODEL],
                cwd=str(project), env=clean_env())
    try:
        if s.wait_for(r'(?i)trust\s*(the\s*files\s*in\s*)?this\s*folder|do\s*you\s*trust', 20):
            time.sleep(1)
            if 'No,exit' in s.text().replace(' ', ''):  # the pre-approved commands dialog starts on "No, exit"
                s.send('\x1b[B')
                time.sleep(0.3)
            s.send('\r')
        time.sleep(6)

        s.type_line(TOUR)
        if not settle(app, 'unittest', 'allow', 240):
            print(s.text()[-1800:])
            raise SystemExit('The test command never needed approval. Nothing recorded.')
        quiet(app, 8)  # Claude reads the result and writes the tour

        s.type_line(CLEAN_UP)
        if not settle(app, 'rm -rf', 'deny', 120):
            raise SystemExit('The clean-up command never needed approval. Nothing recorded.')
        quiet(app, 8)  # Claude acknowledges the denial
    finally:
        s.close()
        time.sleep(2)
        app.stop()
    with app.store.connect() as con:
        ids = [r[0] for r in con.execute('SELECT DISTINCT session_id FROM events WHERE session_id IS NOT NULL')]
    if len(ids) != 1:
        raise SystemExit(f'Expected one session in the database, found {len(ids)}.')
    return record.main(ids[0], args.out, stand_ins=True, db_path=db)


if __name__ == '__main__':
    sys.exit(main())
