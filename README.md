# Seismo - Seismic Viability

This updated starter package reflects the recommended data layout for the Scripps reduced-order seismogram dataset.

## Put these files here
- `data/raw/scripps_rom/seismos_16_receivers.npy`
- `data/raw/scripps_rom/seismogram_rom_demo.ipynb`

## Why
Raw research assets should live under `data/raw/`, not inside frontend or backend source folders.
The app should primarily consume processed outputs from `data/processed/` and demo-ready files from `data/scenarios/`.

## Included
- `CLAUDE.md` project memory rules for Claude Code
- `.claude/commands/` reusable project commands
- `.claude/agents/` task-specific sub-agent templates
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DATA_LAYOUT.md`
- `prompts/INITIAL_PROMPT.md`
- `.gitignore`
- `config/data_paths.example.json`
- placeholder scripts for preprocessing and scenario extraction
