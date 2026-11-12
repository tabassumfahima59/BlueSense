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
COPY data/sample data/sample
COPY data/geo data/geo
# Build SQLite from the committed processed data (raw downloads are not needed at runtime).
RUN python ml/build_db.py
WORKDIR /app/backend
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
