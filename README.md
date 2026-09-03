# MixerM8

A monorepo holding two independently released pieces:

- **The site** — static files in `docs/`, served by GitHub Pages at
  <https://rwm6857.github.io/mixerm8/>.
- **The bridge** — a Python package in `src/mixerm8/`, released to PyPI as `mixerm8`.

They ship on separate cadences. Changing the site does not require a package release,
and vice versa.

## Layout

```
mixerm8/
  docs/            GitHub Pages site (deployed on push to main)
    index.html
  src/mixerm8/     the Python bridge
  content/         shared assets/data
  tests/           bridge tests
  pyproject.toml
```

## The bridge

Requires Python 3.10+.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
mixerm8 --version
```

Run the checks:

```bash
pytest
ruff check .
```

## The site

`docs/` is plain static HTML — no build step. Open `docs/index.html` directly, or serve it:

```bash
python -m http.server -d docs 8000
```

GitHub Pages publishes it automatically on every push to `main`.

## Releasing the bridge

Bump `version` in `pyproject.toml` and `__version__` in `src/mixerm8/__init__.py`, then:

```bash
python -m build && python -m twine upload dist/*
```

## License

MIT — see [LICENSE](LICENSE).
