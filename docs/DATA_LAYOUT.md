# Data Layout

## Exact placement
Put the downloaded files here:

```text
data/raw/scripps_rom/seismos_16_receivers.npy
data/raw/scripps_rom/seismogram_rom_demo.ipynb
```

## Meaning of each folder
- `data/raw/`: original downloaded files, unchanged
- `data/processed/`: derived outputs created by scripts
- `data/scenarios/`: tiny files optimized for the app demo

## Rule
The frontend and backend should generally consume `data/processed/` or `data/scenarios/`, not the raw `.npy` file directly.

## Suggested first derived files
- `data/processed/scripps_rom/receiver_metadata.json`
- `data/processed/scripps_rom/source_metadata.json`
- `data/processed/scripps_rom/waveform_summary.parquet`
- `data/scenarios/demo_site_a_quake_01.json`
