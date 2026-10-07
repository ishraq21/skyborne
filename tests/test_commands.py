"""The commands Claude Code runs (silent, never failing) and `skyborne doctor`."""
import json
import os
import subprocess
import sys

from conftest import payload, wait_until
from test_server import stored
from skyborne import __version__


def run(*args, stdin=b'', env=None):
    return subprocess.run([sys.executable, '-m', 'skyborne', *args], input=stdin, capture_output=True, timeout=60,
                          env={**os.environ, **(env or {})})


def test_version_prints_the_package_version_without_creating_data(fake_home):
    r = run('--version')
    # a printed line ends in \r\n on Windows: compare with the platform's line ending taken out
    assert (r.returncode, r.stdout.replace(b'\r\n', b'\n'), r.stderr) == (0, f'skyborne {__version__}\n'.encode(), b'')
    assert list(fake_home.iterdir()) == []


def test_help_lists_the_version_option(fake_home):
    r = run('--help')
    assert r.returncode == 0 and r.stderr == b''
    assert b'--version' in r.stdout
    assert list(fake_home.iterdir()) == []


def test_hook_is_silent_and_exits_0_when_the_server_is_down():
    for args in (['hook', '--port', '1'], ['hook', '--port', 'not-a-number'], ['hook', '--nonsense']):
        r = run(*args, stdin=b'{"hook_event_name": "Stop"}')
        assert (r.returncode, r.stdout, r.stderr) == (0, b'', b''), args


def test_hook_forwards_to_the_server(app):
    r = run('hook', '--port', str(app.port), stdin=json.dumps(payload('Stop.json')).encode())
    assert (r.returncode, r.stdout) == (0, b'')
    assert wait_until(lambda: stored(app) == 1)


def test_statusline_prints_a_short_line_even_with_the_server_down():
    r = run('statusline', '--port', '1', stdin=json.dumps(payload('statusLine-with-rate-limits.json')).encode())
    assert r.returncode == 0
    assert r.stdout.decode().strip() == 'Skyborne · Haiku 4.5 · $0.06 · Context 21%'


def test_doctor_explains_a_fresh_machine():
    r = run('doctor', '--port', '1')
    out = r.stdout.decode()
    assert 'The plugin is not installed. Run `skyborne install`.' in out
    assert r.returncode == 1  # a problem was found


def test_doctor_is_happy_once_installed(app):
    assert run('install', '--port', str(app.port), '--no-statusline').returncode == 0
    r = run('doctor', '--port', str(app.port))
    out = r.stdout.decode()
    assert 'The server is running' in out and 'The plugin is installed' in out
    assert 'Problem' not in out or 'curl is not on PATH' in out


def test_doctor_notices_an_older_plugin_or_a_changed_timeout(app):
    import json
    from skyborne import config, install
    assert run('install', '--port', str(app.port), '--no-statusline').returncode == 0
    assert 'older Skyborne' not in run('doctor', '--port', str(app.port)).stdout.decode()
    config.ensure_home()
    (config.home() / 'config.json').write_text(json.dumps({'approval_timeout_seconds': 120}))
    assert 'approval_timeout_seconds changed' in run('doctor', '--port', str(app.port)).stdout.decode()
    hooks = install.plugin_dir() / 'hooks' / 'hooks.json'
    old = install.hooks_json(app.port)
    old['hooks']['PermissionRequest'] = old['hooks']['PreToolUse']  # how an older Skyborne installed it
    hooks.write_text(json.dumps(old))
    assert 'older Skyborne' in run('doctor', '--port', str(app.port)).stdout.decode()


def test_doctor_shows_the_home_folder_as_a_tilde(tmp_path, monkeypatch):
    """Its output gets pasted into bug reports, so it must not carry the user name that home paths contain."""
    home = tmp_path / 'alice-smith'
    home.mkdir()
    env = {'HOME': str(home), 'USERPROFILE': str(home), 'SKYBORNE_HOME': str(home / '.skyborne'), 'CLAUDE_CONFIG_DIR': str(home / '.claude')}
    assert run('install', '--port', '1', '--no-statusline', env=env).returncode == 0
    out = run('doctor', '--port', '1', env=env).stdout.decode()
    assert 'alice-smith' not in out and str(tmp_path) not in out
    assert f'The plugin is installed in ~{os.sep}.claude{os.sep}skills{os.sep}skyborne.' in out
    assert f'The database can be written: ~{os.sep}.skyborne{os.sep}skyborne.db.' in out


def test_tidy_only_touches_paths_inside_the_home_folder(tmp_path, monkeypatch):
    from skyborne import doctor
    home = tmp_path / 'bob'
    home.mkdir()
    for var in ('HOME', 'USERPROFILE'):
        monkeypatch.setenv(var, str(home))
    assert doctor.tidy(home) == '~'
    assert doctor.tidy(home / 'x') == f'~{os.sep}x'
    for outside in (tmp_path / 'elsewhere', tmp_path / 'bob2' / 'x'):  # bob2 only starts with the same letters
        assert doctor.tidy(outside) == str(outside)


def test_tidy_survives_a_missing_home_folder(tmp_path, monkeypatch):
    from skyborne import doctor

    def no_home():
        raise RuntimeError('Could not determine home directory.')
    monkeypatch.setattr(doctor.pathlib.Path, 'home', staticmethod(no_home))
    assert doctor.tidy(tmp_path / 'x') == str(tmp_path / 'x')


def test_doctor_copes_with_a_settings_file_that_has_the_wrong_shape(app):
    from skyborne import config
    config.claude_dir().mkdir(parents=True, exist_ok=True)
    (config.claude_dir() / 'settings.json').write_text(json.dumps({'enabledPlugins': ['skyborne']}))
    r = run('doctor', '--port', str(app.port))
    assert r.returncode in (0, 1) and b'Traceback' not in r.stderr


def test_install_with_a_new_port_moves_the_status_line_and_the_doctor_notices_when_it_doesnt(app):
    from skyborne import config
    assert run('install', '--port', str(app.port), '--statusline').returncode == 0
    settings = config.claude_dir() / 'settings.json'
    assert '--port' in json.loads(settings.read_text())['statusLine']['command']
    assert 'sends cost, context and rate limits' in run('doctor', '--port', str(app.port)).stdout.decode()
    other = app.port + 1
    out = run('doctor', '--port', str(other)).stdout.decode()
    assert f'The status line sends to port {app.port}, not {other}.' in out
    r = run('install', '--port', str(other))
    assert f'The status line now sends to port {other}' in r.stdout.decode()
    assert json.loads(settings.read_text())['statusLine']['command'].endswith(f'--port {other}')
    assert 'The status line sends to port' not in run('doctor', '--port', str(other)).stdout.decode()
    r = run('install', '--port', str(other))
    assert r.returncode == 0 and 'The status line is already set up.' in r.stdout.decode()
    r = run('install', '--port', str(app.port), '--no-statusline')  # an explicit "leave it alone"
    assert r.returncode == 0 and 'Status line left as it was.' in r.stdout.decode()
    assert json.loads(settings.read_text())['statusLine']['command'].endswith(f'--port {other}')
    settings.unlink()
    r = run('install', '--port', str(app.port))  # settings.json deleted since: say so, don't fail the install
    assert r.returncode == 0 and 'no longer exists' in r.stdout.decode()

