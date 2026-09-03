# MixerM8

A tablet guide for sound booth volunteers that follows along with the mixer.

When someone at the Behringer X32 Compact opens the EQ tab, the tablet beside
them shows what EQ does and whether they should touch it. There is a
**Follow the mixer** switch to turn that off, plus the full set of guides and
a service running order that work on their own.

**The bridge never writes to the console.** It cannot: the only OSC encoder in
the codebase takes an address and no arguments, and on the X32 a message
without arguments is a read. See [Read-only by construction](#read-only-by-construction).

## The two halves

| Path            | What it is                                | How it ships                     |
| --------------- | ----------------------------------------- | -------------------------------- |
| `docs/`         | The tablet app — plain HTML, CSS, JS      | GitHub Pages, and inside the exe |
| `src/mixerm8/`  | The Windows bridge that watches the X32   | PyPI, and a frozen .exe          |

Same files, two delivery paths:

- **In the booth**, the bridge serves the app itself on the LAN. Everything is
  same-origin, and it works with the church internet completely down.
- **Everywhere else**, <https://rwm6857.github.io/mixerm8/> serves the same app
  in reference mode — guides and service flow, no live mixer. Good for training
  a volunteer on a Tuesday.

The app detects which mode it is in. Nothing is configured.

> GitHub Pages **cannot** be the live booth page. It is served over HTTPS, and an
> HTTPS page is not allowed to open `http://` or `ws://` connections to a LAN
> address — browsers block that as mixed content. That is why the bridge serves
> its own copy.

## Running it in the booth

Download `MixerM8-windows.zip` from the [latest release][releases], unzip it on
the media computer, and run:

```powershell
powershell -ExecutionPolicy Bypass -File install_startup.ps1
```

That installs the exe, starts it minimized at every login, and puts a
**Booth Guide** shortcut on the desktop. Then open the address it prints on
the tablet — something like `http://192.168.1.20:8080`.

Undo it all with `install_startup.ps1 -Uninstall`.

[releases]: https://github.com/rwm6857/mixerm8/releases/latest

### Finding the console

MixerM8 finds the desk by itself on first run and remembers it afterwards. If
you need to be explicit, the IP is on the console under **SETUP → Network**:

```powershell
MixerM8.exe 192.168.1.50
mixerm8 --discover        # list every console answering on the network
```

## Development

Python 3.10+, no runtime dependencies.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
pytest && ruff check .
mixerm8 --discover
```

To work on the tablet app without a mixer, serve `docs/` directly — it comes up
in reference mode:

```bash
python -m http.server -d docs 8000
```

## Read-only by construction

The X32 has one useful property: a message **with** arguments sets a value, and a
message **without** arguments asks for one. MixerM8 leans on that.

- `osc.encode_query(address)` is the only encoder. It takes no `*args`, so there
  is no expressible way to attach a value.
- Every address is matched against a full-string allowlist, so a typo cannot
  wander onto a fader.
- A test asserts the package contains exactly two `sendto()` calls and that both
  route through `encode_query`.

`/node` queries are deliberately unsupported. They are reads, but they take a
string argument, and that would cost the invariant more than it is worth.

## Mapping the tabs

`SCREENS` in `src/mixerm8/console.py` is confirmed. `CHAN_PAGES` — the numbers
for CONFIG / GATE / DYNAMICS / EQ / SENDS — is **a guess that needs checking on a
real Compact.**

Stand at the desk with the tablet visible and press each tab. Anything unmapped
shows as *"Tab 4 — not mapped yet"* along with its number. Write the numbers
down, correct `CHAN_PAGES`, and the guides attach themselves.

## Editing the guides

`docs/data/guides.json` and `docs/data/flow.json` are plain JSON, English and
Korean side by side. There is no build step — edit, commit, push. GitHub Pages
updates immediately; the booth picks the change up at the next release.

## Releasing

Bump `version` in `pyproject.toml` and `__version__` in
`src/mixerm8/__init__.py`, then push a tag:

```bash
git tag v0.1.1 && git push origin v0.1.1
```

GitHub Actions builds the Windows exe and attaches it to the release. Running
copies of MixerM8 notice the new version on startup and print the link.

## License

MIT — see [LICENSE](LICENSE).
