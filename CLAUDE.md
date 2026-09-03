# MixerM8

## What this repo is

A monorepo with two independently released halves:

| Path            | What it is                    | How it ships                          |
| --------------- | ----------------------------- | ------------------------------------- |
| `docs/`         | Static GitHub Pages site      | Auto-deployed on push to `main`       |
| `src/mixerm8/`  | Python bridge package         | Manually released to PyPI             |
| `content/`      | Shared assets/data            | Not part of either release by default |
| `tests/`        | Tests for the bridge          | —                                     |

**The two halves release separately.** A site change must not require a package
version bump, and a package change must not require touching `docs/`. Keep them
decoupled — no build step generates `docs/` from `src/`.

## Commands

```bash
pip install -e ".[dev]"      # set up the bridge for development
pytest                       # run bridge tests
ruff check .                 # lint
python -m http.server -d docs 8000   # preview the Pages site locally
```

## Conventions

- **Python**: 3.10+ target, `from __future__ import annotations` at the top of modules,
  type hints on public functions. Line length 100 (ruff-enforced).
- **Package layout**: src-layout. Import as `mixerm8.*`, never by relative path from the repo root.
- **CLI**: entry point is `mixerm8.cli:main`, which returns an int exit code. Keep `__main__.py` a
  thin wrapper.
- **Site**: `docs/` is hand-written static HTML with inline CSS. No framework, no bundler,
  no npm dependency. `docs/.nojekyll` is intentional — do not delete it.
- **Version**: lives in two places, `pyproject.toml` and `src/mixerm8/__init__.py`. Bump both together.

## Gotchas

- `docs/` is the Pages publishing source. Renaming or removing it breaks the live site.
- `content/` is excluded from the sdist (see `[tool.hatch.build.targets.sdist]`). If the bridge
  ever needs to read from it at runtime, that exclusion has to change first.
