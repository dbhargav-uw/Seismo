You are helping me build a hackathon MVP called Seismic Viability.

Read these files first:
- `CLAUDE.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/DATA_LAYOUT.md`

Project summary:
We are building a location-aware seismic viability platform for conceptual structural screening in Southern California.
A user should be able to:
1. create a simplified 3D structure,
2. place it on a real map location,
3. evaluate site hazard proxies,
4. run structural response analysis,
5. receive an explainable viability score.

Critical data rule:
The raw Scripps files live here:
- `data/raw/scripps_rom/seismos_16_receivers.npy`
- `data/raw/scripps_rom/seismogram_rom_demo.ipynb`

The app should mainly consume derived outputs from:
- `data/processed/`
- `data/scenarios/`

Constraints:
- This is conceptual screening software, not engineering approval software.
- Optimize for a hackathon demo.
- Use strict TypeScript in the frontend.
- Prefer FastAPI + Python for the backend.
- Prefer OpenSeesPy for simulation integration.
- Use parameterized structures, not full CAD/BIM.
- Keep all API contracts typed.
- Add error handling everywhere.
- Use Context7 when current docs would help.

Workflow requirements:
- Start in PLAN MODE.
- Ask the minimum clarifying questions first.
- Then produce:
  1. repo structure,
  2. build order,
  3. milestone 1,
  4. the exact first files to create,
  5. the local data preprocessing flow.
- Do not write code until the plan is approved.
- After approval, implement in small batches and summarize changed files after each batch.
- After each major batch, run a self-review for correctness, error handling, and demo reliability.

Preferred first milestone:
- validate local data layout
- add preprocessing scripts
- scaffold frontend and backend
- create map site picker
- create structure form
- create typed placeholder result panel
