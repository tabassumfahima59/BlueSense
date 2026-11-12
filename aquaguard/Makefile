# AquaGuard — one-command workflows (GNU make; on Windows use Git Bash or WSL, or run the commands shown).
PY ?= .venv/bin/python
ifeq ($(OS),Windows_NT)
PY := .venv/Scripts/python
endif
export PYTHONIOENCODING := utf-8

.PHONY: setup data fetch process db ml mocks test lint dev-backend dev-frontend build all

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

db:               ## build SQLite (data/aquaguard.db) and refresh the offline sample snapshot
	$(PY) ml/build_db.py --sample
	cp data/raw/openmeteo/forecast_*.json data/sample/ 2>/dev/null || true

data: fetch process db

ml:               ## features -> train -> evaluate -> forecast -> SHAP -> demand projection -> DB
	$(PY) ml/build_features.py
	$(PY) ml/train_scarcity.py
	$(PY) ml/evaluate.py
	$(PY) ml/predict.py
	$(PY) ml/explain_shap.py
	$(PY) ml/project_demand.py
	$(PY) ml/model_card.py
	$(PY) ml/build_db.py --sample

mocks:            ## export OpenAPI spec, Phase-0 mocks and regenerate TypeScript types
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
