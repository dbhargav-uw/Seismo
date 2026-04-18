# Implementation Plan

## Phase 0 - Project Setup
- scaffold frontend and backend
- add typed API contracts
- add `.gitignore`, config templates, and data layout docs
- confirm raw data path conventions

## Phase 1 - Data Spine
- place raw files in `data/raw/scripps_rom/`
- write `scripts/check_data_layout.py`
- write `scripts/preprocess_rom.py`
- write `scripts/extract_demo_scenarios.py`
- produce small processed outputs and scenario fixtures

Deliverable:
A repeatable local data pipeline that transforms raw Scripps assets into app-ready inputs.

## Phase 2 - UX Spine
- site picker map
- structure creation form
- scenario picker
- placeholder score/result panel

## Phase 3 - Simulation
- OpenSeesPy integration
- structural archetype translation
- response metrics

## Phase 4 - Score + Explanations
- site hazard contribution
- ground-failure contribution
- structural response contribution
- uncertainty penalty
- top risk drivers

## Phase 5 - Demo Hardening
- canned scenarios
- fallback paths
- polish
- documentation
