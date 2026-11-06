FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends util-linux tzdata && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Install dependencies first so code edits do not invalidate this layer.
COPY backend/pyproject.toml ./pyproject.toml
RUN python -c "import tomllib;print('\n'.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))" > /tmp/req.txt \
 && pip install -r /tmp/req.txt
COPY backend/ ./
RUN useradd --uid 10001 --create-home appuser \
 && mkdir -p /data /staging/.tmp /staging/jobs /logs /backups /secrets \
 && chown -R appuser:appuser /data /staging /logs /backups /secrets /app \
 && sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh
USER appuser
ARG GIT_COMMIT=unknown
ARG BUILD_DATE=
ENV APP_COMMIT=$GIT_COMMIT APP_BUILD_DATE=$BUILD_DATE
EXPOSE 8000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
