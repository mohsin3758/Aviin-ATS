FROM python:3.12-slim

# Unbuffered stdout — without this, print() output sits in Python's block
# buffer (Docker's stdout isn't a TTY) and doesn't reach `docker logs`
# reliably, which was silently hiding background-task diagnostics
# (stage-change email/WhatsApp send results) well before this comment.
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# System deps: ffmpeg for audio, tesseract+poppler for OCR (Phase D)
RUN apt-get update -qq && \
    apt-get install -y --no-install-recommends \
        ffmpeg curl \
        tesseract-ocr tesseract-ocr-eng \
        poppler-utils \
        libjpeg-dev libpng-dev libtiff-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "2"]
