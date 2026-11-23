FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agent ./agent
COPY services ./services
# Pre-download model files (Silero VAD) so the first call does not wait on downloads.
RUN python -m agent.main download-files || true

RUN useradd --create-home agent && chown -R agent /app
USER agent
CMD ["python", "-m", "agent.main", "start"]
