FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY embed_service.py .

EXPOSE 8081

CMD ["uvicorn", "embed_service:app", "--host", "0.0.0.0", "--port", "8081"]
