FROM python:3.11-slim

WORKDIR /app

# System deps (needed for psycopg2, bcrypt compile)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev curl && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps first (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Create runtime dirs
RUN mkdir -p runs/artifacts runs/data runs/options runs/sectors runs/sec_cache

EXPOSE 8001

# Worker count is env-driven so deployments can tune without a new image.
# Default is 2 — production can override with WORKERS=N (see railway.json).
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001} --workers ${WORKERS:-2}"]
