# Architecture

## Goal
Build a site-aware seismic viability application for conceptual structural screening.

## Top-Level Structure
```text
app/
  frontend/
  backend/
  simulation/
data/
  raw/
    scripps_rom/
  processed/
    scripps_rom/
  scenarios/
scripts/
config/
```

## Data Responsibilities
- `data/raw/scripps_rom/`: downloaded source files only
- `data/processed/scripps_rom/`: extracted metadata, reduced arrays, cached transforms
- `data/scenarios/`: small app-ready scenario files for live demo flows

## App Modules
### Frontend
- site picker map
- parametric structure builder
- scenario selector
- 3D result viewer
- score breakdown panel

### Backend API
- site/hazard summary endpoints
- scenario catalog endpoints
- simulation orchestration endpoints
- scoring endpoints

### Simulation Layer
- building archetype translators
- OpenSees/OpenSeesPy adapters
- response parsers

### Data Processing Layer
- waveform preprocessing
- receiver/site mapping
- scenario extraction
- ROM experiment helpers

## Canonical Flow
1. Raw dataset lives in `data/raw/scripps_rom/`.
2. Scripts derive compact processed artifacts into `data/processed/scripps_rom/`.
3. Scripts generate app-ready demo scenarios in `data/scenarios/`.
4. Frontend interacts with backend.
5. Backend loads processed/scenario artifacts, not raw files by default.
6. Simulation produces response metrics.
7. Scoring returns an explainable viability score.
