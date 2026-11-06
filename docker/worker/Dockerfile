FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/pyproject.toml ./pyproject.toml
RUN python -c "import tomllib;print('\n'.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))" > /tmp/req.txt \
 && pip install -r /tmp/req.txt
COPY backend/ ./
RUN useradd --uid 10001 --create-home appuser \
 && mkdir -p /data /staging/.tmp /staging/jobs /logs /backups /secrets \
 && chown -R appuser:appuser /data /staging /logs /backups /secrets /app
USER appuser
# The worker never runs migrations (the backend does) and never publishes a port.
CMD ["python", "-m", "app.workers.main"]
