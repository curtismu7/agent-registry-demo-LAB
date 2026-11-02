# Changelog

## 0.1.0 (step AR0)
Core: registry simulator, grants, mock gateway, nine stories in three verticals, trace envelope, netguard, doctor, health, reset, content pack, shelf entry, CI, tests and a mutation check. UI follows in AR1.

## AR1 - web UI

React + Vite SPA: registry list and register wizard (llm RealKey rule, workload mode), grant panel, rotate-by-replacement stepper with the no-in-place-rotation explanation, revoke and delete traps, gateway simulator (401/403/429 with trace and gateway log), story player with persona picker, presenter mode, ReactFlow lifecycle diagram, Raw trace tab, vitest suite.

## Mock/Real toggle

Mock/Real toggle in every page header, `GET /api/info`, `POST /api/mode`, `HOSTED=1` lock. Mock only by design: Real is disabled (409 from the API). Vendored `standalone-ui.css` re-synced to the canonical copy (comment line only).

## AR2 - integration and docs

Dockerfile and docker-compose (loopback-only publish pinned by a test, read-only container, healthcheck), run.sh builds the UI, README true as run, talk track, optional owner-run live-checks guide, shelf entry points at the compose file.
