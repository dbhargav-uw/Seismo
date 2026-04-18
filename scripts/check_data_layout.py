from pathlib import Path

REQUIRED = [
    Path("data/raw/scripps_rom/seismos_16_receivers.npy"),
    Path("data/raw/scripps_rom/seismogram_rom_demo.ipynb"),
]

for path in REQUIRED:
    print(f"{'OK' if path.exists() else 'MISSING'}  {path}")
