"""Placeholder scenario extraction script.
Reads processed artifacts and emits tiny app-ready scenario files into data/scenarios/.
"""

from pathlib import Path

PROC = Path("data/processed/scripps_rom")
SCEN = Path("data/scenarios")
SCEN.mkdir(parents=True, exist_ok=True)

print("Read from:", PROC)
print("Write demo scenarios to:", SCEN)
