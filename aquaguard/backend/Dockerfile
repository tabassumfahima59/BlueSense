# AquaGuard API image. Build from the aquaguard/ directory:
#   docker build -f backend/Dockerfile -t aquaguard-api .
FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend backend
COPY ml/*.py ml/
COPY ml/artifacts ml/artifacts
COPY data/processed data/processed
COPY data/geo data/geo
# Build SQLite from the committed processed data (bootstrap seed: original dates kept, sources show "stale" until the
# first scheduled sync). Raw downloads are not needed at runtime; there is no sample/mock fallback.
RUN python ml/build_db.py
WORKDIR /app/backend
EXPOSE 8000
# --proxy-headers: behind the host's proxy (Render) the visitor address comes from X-Forwarded-For, so per-client
# limits (Copilot, refresh) count each visitor separately instead of the proxy as one client.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
