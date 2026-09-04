# PyInstaller spec for the booth machine build.
#
# Produces a single MixerM8.exe with the tablet app baked in, so the media
# computer needs no Python and no internet. Build with:
#     python -m PyInstaller packaging/mixerm8.spec --noconfirm
#
# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

ROOT = Path(SPECPATH).parent

a = Analysis(
    [str(ROOT / "src" / "mixerm8" / "__main__.py")],
    pathex=[str(ROOT / "src")],
    binaries=[],
    # The same docs/ that GitHub Pages serves, carried inside the exe.
    datas=[(str(ROOT / "docs"), "webroot"),
           (str(ROOT / "editor"), "editorroot")],
    hiddenimports=["mixerm8.cli", "mixerm8.console", "mixerm8.server",
                   "mixerm8.editor", "mixerm8.validate"],
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "unittest", "pydoc", "email", "xml", "pdb"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="MixerM8",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # A console window is kept on purpose: it is the only place the booth
    # can see "which console am I watching" and any startup error.
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
