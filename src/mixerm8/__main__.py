# Absolute, not relative: PyInstaller compiles this file as a top-level
# __main__ with no package around it, so `from .cli import main` fails at
# startup in the frozen exe. `python -m mixerm8` works either way.
from mixerm8.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
