"""Placeholder preprocessing script.
Reads raw Scripps ROM assets from data/raw/scripps_rom/
and writes derived artifacts to data/processed/scripps_rom/.
"""

from pathlib import Path

RAW = Path("data/raw/scripps_rom")
OUT = Path("data/processed/scripps_rom")
OUT.mkdir(parents=True, exist_ok=True)

print("Expected raw inputs:")
print("-", RAW / "seismos_16_receivers.npy")
print("-", RAW / "seismogram_rom_demo.ipynb")
print("Write derived outputs into:", OUT)
