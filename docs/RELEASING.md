# Releasing Skyborne

Notes for the maintainer. A release is a version tag; [release.yml](../.github/workflows/release.yml)
does the rest, using PyPI trusted publishing (no API tokens anywhere).

## Once

- PyPI and TestPyPI each need an account with two-factor sign-in.
- On each, add a **pending publisher** (account menu, **Publishing**): project `skyborne`, owner
  `ishraq21`, repository `skyborne`, workflow `release.yml`, and environment `pypi` on PyPI or
  `testpypi` on TestPyPI. A pending publisher doesn't reserve the name until the first publish.
- GitHub environments `pypi` (you must approve each run, tags `v*` only) and `testpypi` (branch `main`
  only) exist in the repository settings.

## Each release

1. Change the version in `pyproject.toml`, `skyborne/__init__.py` and `plugin/.claude-plugin/plugin.json`. The
   workflow fails if the first two differ or the tag isn't `v` plus that version, and a test fails if the plugin
   file differs. Update the README if the install steps
   changed: PyPI shows the README as it is at the tag, and a published version can't be edited. In
   [CHANGELOG.md](../CHANGELOG.md), rename `[Unreleased]` to `[X.Y.Z] - date` (and add a fresh empty
   `[Unreleased]` above it). Write it for someone using Skyborne, in this shape: a bold feature name on
   its own line, a bulleted list of what changed under it, no section headers. If there is a real gap a
   user would hit, end with one more item starting `Known gap:` and a link to its issue; leave it out
   when there's nothing to flag.
2. Merge to `main` and wait for CI to be green.
3. **Dry run**: Actions, **Release**, **Run workflow** on `main`. It runs all of CI, builds the commit as
   `X.Y.Z.devN` and publishes it to TestPyPI. Check the page at <https://test.pypi.org/project/skyborne/>
   (images show), then in a clean folder:

   ```sh
   uv tool install --default-index https://test.pypi.org/simple/ --prerelease allow skyborne
   skyborne --help && skyborne doctor
   uv tool uninstall skyborne
   ```

4. **Release**: tag the commit and push the tag (push `main` with it, in one go, if `main` isn't pushed yet):

   ```sh
   git tag vX.Y.Z
   git push --atomic origin main vX.Y.Z
   ```

   The workflow runs all of CI, builds, then waits for you to approve the `pypi` environment (Actions,
   the run, **Review deployments**). Approve it, and the package is on PyPI a minute later.
5. From a clean folder, check `uv tool install skyborne` and `uvx skyborne --help`, then create the
   GitHub Release for the tag, with that version's section of CHANGELOG.md as its notes, followed by
   a link to the PyPI page.

Pushing the tag also publishes the demo site (the **Demo site** workflow, [pages.yml](../.github/workflows/pages.yml)), and it
can be run by hand from Actions at any time. It needs no approval, but the `github-pages` environment (Settings, Environments)
must allow deployments from tags `v*` as well as `main`, or a tag run is refused. It runs beside the release, not after it.

A version on PyPI can never be replaced or reused. If something is wrong, publish a new version.
