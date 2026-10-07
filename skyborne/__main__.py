"""The `skyborne` command.

    skyborne [--port 7317] [--no-open]   start the server and open the city (Ctrl+C stops it)
    skyborne install [--port N]          install the Claude Code plugin; asks before adding the status line
    skyborne uninstall                   remove the plugin and put the status line back as it was
    skyborne doctor [--port N]           check the setup and explain any problem
    skyborne import [--days 7]           bring in past sessions from Claude Code's transcripts
    skyborne record <session> --out F    export one session, scrubbed, for the page to play back
"""
import argparse
import sys

from . import __version__

DEFAULT_PORT = 7317  # config.DEFAULT_PORT, repeated so the fast commands below import nothing else


def _ask(question: str, default: bool = False) -> bool:
    try:
        answer = input(question + (' [Y/n] ' if default else ' [y/N] ')).strip().lower()
    except EOFError:
        return default
    return default if not answer else answer in ('y', 'yes')


def _import(days, db_path=None):
    from . import importer
    result = importer.run(days, db_path=db_path)
    s = result['summary']
    print(f"Imported {s.get('imported', 0)} session{'s' if s.get('imported', 0) != 1 else ''} "
          f"({s.get('events', 0):,} events, {s.get('tokens', 0):,} tokens).")
    skipped = [f'{n} {why}' for why in ('recorded live', 'imported before', 'empty', 'unreadable') if (n := s.get(why))]
    if skipped:
        print('Skipped: ' + ', '.join(skipped) + '.')
    return 0


def _install(args):
    from . import install
    try:
        target = install.install_plugin(args.port)
    except install.InstallError as e:
        print(e)
        return 1
    print(f'Installed the Claude Code plugin in {target}.')
    print('New Claude Code sessions send their events to Skyborne. Sessions already open are not affected.')
    if install._load_state().get('statusline'):
        if args.statusline is False:
            print('Status line left as it was.')
            return 0
        try:
            print(install.set_statusline_port(args.port) or 'The status line is already set up.')
        except install.InstallError as e:
            print(e)
            return 1
        return 0
    want = args.statusline if args.statusline is not None else _ask(
        "Also set Claude Code's status line to Skyborne's? It adds cost, context and rate limits. "
        'Your settings.json is backed up first, only its statusLine key changes, and uninstall puts it back.')
    if want:
        try:
            previous = install.install_statusline(args.port)
        except install.InstallError as e:
            print(e)
            return 1
        print('Status line installed.' + (' Your earlier status line still shows: Skyborne runs it and prints its output.' if previous else ''))
    else:
        print('Status line left as it was.')
    return 0


def _uninstall(args):
    from . import install
    try:
        print(install.uninstall_statusline())
    except install.InstallError as e:
        print(e)
        return 1
    print(install.uninstall_plugin())
    return 0


def _run(args):
    import logging
    import webbrowser
    from . import doctor, server
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format='%(asctime)s %(message)s', datefmt='%H:%M:%S')
    try:
        app = server.App(args.port)
    except OSError:
        h = doctor.health(args.port)
        if h and h.get('name') == 'skyborne':
            print(f'Skyborne is already running at http://127.0.0.1:{args.port}/')
        else:
            print(f'Port {args.port} is taken by another program. Try `skyborne --port <other>` '
                  f'(and `skyborne install --port <other>` so the plugin sends there).')
        return 1
    _first_run(app)
    app.start()
    url = f'http://127.0.0.1:{app.port}/'
    print(f'Skyborne is running at {url} (Ctrl+C to stop). Database: {app.store.path}', flush=True)
    if not args.no_open:
        webbrowser.open(url)
    try:
        while True:
            import time
            time.sleep(1)
    except KeyboardInterrupt:
        print('Stopping.')
    finally:
        app.stop()
    return 0


def _first_run(app):
    """The first time Skyborne starts, offer to bring in the last week of sessions."""
    import time
    from . import config
    state = config.load_state()
    if 'import_asked' in state:
        return
    if not sys.stdin.isatty():
        print('Tip: `skyborne import --days 7` brings in your Claude Code sessions from the last week.')
        return
    yes = _ask('Import your Claude Code sessions from the last 7 days so they show in the city?', default=True)
    if yes:
        _import(7, db_path=app.store.path)
    config.save_state({**state, 'import_asked': int(time.time()), 'imported': yes})


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    p = argparse.ArgumentParser(prog='skyborne', description='A local monitor for Claude Code.')
    p.add_argument('--version', action='version', version=f'skyborne {__version__}')
    p.add_argument('--port', type=int, default=DEFAULT_PORT, help='port to listen on (default 7317)')
    p.add_argument('--no-open', action='store_true', help="don't open the city in a browser")
    p.add_argument('--verbose', action='store_true', help='log every event (name and short session id only)')
    sub = p.add_subparsers(dest='command')
    i = sub.add_parser('install', help='install the Claude Code plugin')
    i.add_argument('--port', type=int, default=DEFAULT_PORT)
    g = i.add_mutually_exclusive_group()
    g.add_argument('--statusline', dest='statusline', action='store_true', default=None, help='also install the status line, without asking')
    g.add_argument('--no-statusline', dest='statusline', action='store_false', help='leave the status line alone, without asking')
    sub.add_parser('uninstall', help='remove the plugin and restore the status line')
    d = sub.add_parser('doctor', help='check the setup')
    d.add_argument('--port', type=int, default=DEFAULT_PORT)
    m = sub.add_parser('import', help="bring in past sessions from Claude Code's transcripts")
    m.add_argument('--days', type=float, default=7, help='how far back to look (default 7)')
    r = sub.add_parser('record', help='export one session, scrubbed, for the page to play back')
    r.add_argument('session', nargs='?', default='', help='a session id, or the start of one')
    r.add_argument('--out', default='', help='the file to write, e.g. demo.json')
    r.add_argument('--stand-ins', action='store_true', help='also replace prompts, replies and file contents with stand-ins')
    for name in ('statusline', 'hook'):  # run by Claude Code, not by people
        s = sub.add_parser(name)
        s.add_argument('--port', type=int, default=DEFAULT_PORT)

    if argv[:1] == ['hook']:  # must never print or fail, even on bad arguments
        from .forward import hook
        try:
            port = int(argv[argv.index('--port') + 1]) if '--port' in argv else DEFAULT_PORT
        except (ValueError, IndexError):
            port = DEFAULT_PORT
        return hook(port)
    args = p.parse_args(argv)
    if args.command == 'statusline':
        from .forward import statusline
        return statusline(args.port)
    if args.command == 'install':
        return _install(args)
    if args.command == 'uninstall':
        return _uninstall(args)
    if args.command == 'doctor':
        from .doctor import run
        return run(args.port)
    if args.command == 'import':
        return _import(args.days)
    if args.command == 'record':
        from .record import main as record
        return record(args.session, args.out, args.stand_ins)
    return _run(args)


if __name__ == '__main__':
    sys.exit(main())
