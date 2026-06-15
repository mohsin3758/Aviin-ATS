"""BGE-small-en-v1.5 embedding service (Tier 1, zero-token cascade).

384-dim vectors only — HARD RULE #3. Runs fully on CPU via fastembed
(onnxruntime), no external API calls.
"""

from fastapi import FastAPI
from pydantic import BaseModel
from fastembed import TextEmbedding

MODEL_NAME = "BAAI/bge-small-en-v1.5"
DIMS = 384

app = FastAPI(title="AIrecruit Embedding Service")
model = TextEmbedding(model_name=MODEL_NAME)


class EmbedRequest(BaseModel):
    texts: list[str]


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_NAME, "dims": DIMS}


@app.post("/embed")
def embed(req: EmbedRequest):
    vectors = model.embed(req.texts)
    return {"embeddings": [v.tolist() for v in vectors]}
