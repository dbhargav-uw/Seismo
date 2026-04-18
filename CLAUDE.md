# CLAUDE.md

## Project
Build a location-aware seismic viability platform for conceptual structural screening.
The user should be able to:
1. create a simplified 3D structure,
2. place it at a real Southern California site,
3. evaluate site-aware hazard proxies,
4. run structural response analysis,
5. receive an explainable viability score.

This is not licensed engineering software or building approval software.
All outputs must be framed as conceptual screening results.

## Data Layout Rules
The Scripps reduced-order dataset files must live here:
- `data/raw/scripps_rom/seismos_16_receivers.npy`
- `data/raw/scripps_rom/seismogram_rom_demo.ipynb`

Rules:
- Never place raw data files in `app/frontend`, `app/backend`, or `app/simulation`.
- Treat `data/raw/` as immutable source data.
- Write transformed artifacts to `data/processed/`.
- Write app-ready demo scenario files to `data/scenarios/`.
- Prefer the app reading compact processed outputs rather than loading raw `.npy` directly in user-facing flows.
- Do not rename the original raw source files.

## Tech Preferences
- Frontend: TypeScript, React, Vite, Tailwind, React Three Fiber, Mapbox GL JS or Leaflet.
- Backend: Python FastAPI.
- Simulation: OpenSeesPy preferred.
- Data processing: Python with NumPy, Pandas, SciPy.
- Keep TypeScript strict.
- Keep API contracts explicit and typed.

## Architecture Rules
- Separate frontend, API, simulation, and data processing concerns.
- Use translator layers:
  - site selection -> hazard input model
  - structure config -> simulation model
  - raw waveform/ROM outputs -> processed scenario artifacts
  - solver outputs -> score breakdown
- Prefer parameterized buildings over arbitrary CAD complexity.
- Keep the viability score explainable.

## Workflow Rules
- Start in plan mode before coding.
- Ask clarifying questions if needed.
- Use Context7 when current docs matter.
- Prefer small, reviewable implementation batches.
- Add error handling on every backend endpoint.
- Add loading, empty, success, and error states in the frontend.
- After each feature, run a review pass for correctness and demo reliability.

## Scope Guardrails
Allowed MVP:
- Parametric building creation
- Site picker map
- Hazard overlay summary
- Scenario selection
- OpenSees-backed structural response
- Explainable viability score
- Comparison mode

Avoid unless explicitly approved:
- Full BIM import
- Arbitrary meshing
- permit/code-compliance claims
- enterprise auth/billing complexity
- direct dependence on the full 176.7 GB dataset for the demo path

## Definition of Done
A feature is done when:
- it runs,
- failure states are handled,
- types and lint pass,
- the demo path is clear,
- docs are updated,
- and the conceptual-screening framing remains intact.
