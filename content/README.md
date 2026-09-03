# content/

Source material that is *not* shipped to the tablet or the wheel.

Put things here that you want version-controlled but that no volunteer needs
to load over the network: X32 scene files, booth photos, notes on how the
stage is patched, the original single-file prototype, and so on.

The guides the tablet actually shows live in `docs/data/` — served directly
with no build step, so editing them is the whole publishing process.

Two layers there, and the distinction matters:

| File | Committed? | Contains |
| --- | --- | --- |
| `docs/data/*.json` | yes | the generic example, site-specific parts left blank |
| `docs/data/*.local.json` | **no**, gitignored | one church's real wording |

Anything naming a staff member, a phone number, or the channel layout goes in
a `.local.json`. See "Your own wording" in the README.

Note that this folder is *not* reachable from the tablet — the browser can
only fetch what is under `docs/`. So a filled-in guide cannot live here; it
goes in `docs/data/*.local.json`, or in `%APPDATA%\MixerM8\data\` on the booth
computer.

The original single-file prototypes (`docs/content.json`, `x32_booth.py`) are
worth dropping in here if you still have them — they are the only record of
what was tried before the package existed.
