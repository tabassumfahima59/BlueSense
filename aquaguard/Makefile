# AquaGuard — one-command workflows (GNU make; on Windows use Git Bash or WSL, or run the commands shown).
PY ?= .venv/bin/python
ifeq ($(OS),Windows_NT)
PY := .venv/Scripts/python
endif
export PYTHONIOENCODING := utf-8

.PHONY: setup data fetch process db migrate migrate-status sync sync-status ml mocks test lint dev-backend dev-frontend build all

setup:            ## create venv, install Python + Node dependencies
	python -m venv .venv
	$(PY) -m pip install -r requirements-dev.txt
	cd frontend && npm install

fetch:            ## download raw datasets (Open-Meteo archive takes ~12 min because of rate limits)
	$(PY) ml/fetch_static.py all
	$(PY) ml/fetch_openmeteo.py all

process:          ## clean raw data -> data/processed (+ GRACE if the NetCDF file is present)
	$(PY) ml/build_geo.py
	$(PY) ml/process_weather.py
	$(PY) ml/grace_trend.py

db:               ## idempotent import into data/aquaguard.db (migrations + verified backup first); refresh sample
	$(PY) ml/build_db.py

migrate:          ## apply pending versioned SQL migrations (verified backup first)
	cd backend && ../$(PY) -m app.db.migrate

migrate-status:   ## list applied / pending migrations
	cd backend && ../$(PY) -m app.db.migrate --status

sync:             ## run every data-source sync job once (skips jobs that ran recently)
	cd backend && ../$(PY) -m app.sync.run all

sync-status:      ## data-source status: fresh / stale / unavailable / not_configured
	cd backend && ../$(PY) -m app.sync.run status

data: fetch process db

ml:               ## features -> train -> evaluate -> forecast -> SHAP -> demand projection -> DB
	$(PY) ml/build_features.py
	$(PY) ml/train_scarcity.py
	$(PY) ml/evaluate.py
	$(PY) ml/predict.py
	$(PY) ml/explain_shap.py
	$(PY) ml/project_demand.py
	$(PY) ml/model_card.py
	$(PY) ml/build_db.py

mocks:            ## export the OpenAPI spec and regenerate TypeScript types (mock capture removed in P2)
	$(PY) backend/scripts/export_openapi_and_mocks.py
	cd frontend && npm run gen:api

test:             ## pytest (engines, API, ML, consistency, copilot) + vitest
	$(PY) -m pytest -q
	cd frontend && npm test

lint:
	$(PY) -m ruff check backend ml
	cd frontend && npm run lint && npm run typecheck

dev-backend:
	cd backend && ../$(PY) -m uvicorn app.main:app --reload --port 8001

dev-frontend:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

all: data ml mocks lint test build
