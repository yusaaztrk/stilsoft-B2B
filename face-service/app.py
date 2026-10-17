"""
Face Recognition Microservice
- POST /encode   : base64 image → 128-d face embedding
- POST /compare  : probe embedding vs gallery → best match
- GET  /health   : liveness check
"""

import base64
import io
import logging
import threading
from typing import List, Optional

import cv2
import face_recognition
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("face-service")

# ── dlib erisim kilidi ─────────────────────────────────────────────
#
# Uc fonksiyonlari `async def` degil `def` olarak tanimli; FastAPI bunlari bir is parcacigi
# HAVUZUNDA calistirir. Yuz ile giris ekrani 1200 ms'de bir kare gonderdigi ve her istek
# bundan daha uzun surebildigi icin istekler ust uste biniyor ve dlib'e AYNI ANDA birden
# fazla is parcacigindan giriliyordu.
#
# dlib/face_recognition is parcacigi guvenli degil: es zamanli cagri bellegi bozuyor ve
# surec "0xC0000005 access violation" ile tamamen coküyordu. Windows'ta bu, Gorev
# Zamanlayici'nin servisi surekli yeniden baslatmasina ve API'nin araliklarla 502 almasina
# yol aciyordu.
#
# Kilit, yerel kutuphaneye girisleri sirayla yapar. Islem hala tek tek yurur ama surec
# ayakta kalir; tarama araligi zaten tek kullanicilik bir hiz gerektiriyor.
_dlib_lock = threading.Lock()

app = FastAPI(title="Face Recognition Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response models ──────────────────────────────────────

class EncodeRequest(BaseModel):
    image_base64: str = Field(..., description="Base64-encoded JPEG/PNG image")


class EncodeResponse(BaseModel):
    success: bool
    embedding: List[float] = []
    message: str = ""


class GalleryItem(BaseModel):
    employeeId: int
    embedding: List[float]


class CompareRequest(BaseModel):
    probe_embedding: List[float] = Field(..., description="128-d embedding of the probe face")
    gallery: List[GalleryItem] = Field(..., description="List of known embeddings")
    tolerance: float = Field(0.45, description="Max Euclidean distance for a match")


class CompareResponse(BaseModel):
    matched: bool
    employeeId: Optional[int] = None
    distance: Optional[float] = None
    message: str = ""


# ── Helpers ────────────────────────────────────────────────────────

def decode_base64_image(b64: str) -> np.ndarray:
    """Decode a base64 string into an RGB numpy array."""
    # Strip optional data-URI prefix
    if "," in b64:
        b64 = b64.split(",", 1)[1]

    raw = base64.b64decode(b64)
    arr = np.frombuffer(raw, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)

    if bgr is None:
        raise ValueError("Görsel çözümlenemedi")

    # face_recognition expects RGB
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)


def euclidean_distance(a: List[float], b: List[float]) -> float:
    return float(np.linalg.norm(np.array(a) - np.array(b)))


# ── Endpoints ──────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/encode", response_model=EncodeResponse)
def encode_face(req: EncodeRequest):
    try:
        rgb = decode_base64_image(req.image_base64)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Görsel okunamadı: {exc}")

    # Yuz tespiti ve kodlamasi TEK kilit altinda: ikisi de dlib'in yerel koduna giriyor ve
    # arada kilit birakilirsa baska bir istek araya girip ayni bellegi bozabiliyor.
    with _dlib_lock:
        locations = face_recognition.face_locations(rgb, number_of_times_to_upsample=1, model="hog")
        if len(locations) == 0:
            locations = face_recognition.face_locations(rgb, number_of_times_to_upsample=2, model="hog")

        if len(locations) == 0:
            return EncodeResponse(success=False, message="Yüz bulunamadı. Lütfen yüzünüzü kameraya gösterin.")

        if len(locations) > 1:
            return EncodeResponse(success=False, message="Birden fazla yüz algılandı. Lütfen tek yüz gösterin.")

        encodings = face_recognition.face_encodings(rgb, known_face_locations=locations)

    if len(encodings) == 0:
        return EncodeResponse(success=False, message="Yüz kodlaması yapılamadı.")

    embedding = encodings[0].tolist()
    return EncodeResponse(success=True, embedding=embedding, message="Yüz başarıyla kodlandı")


@app.post("/compare", response_model=CompareResponse)
def compare_faces(req: CompareRequest):
    if not req.gallery:
        return CompareResponse(matched=False, message="Karşılaştırma için kayıtlı yüz bulunamadı")

    if len(req.probe_embedding) != 128:
        raise HTTPException(status_code=400, detail="Probe embedding 128 boyutunda olmalı")

    best_distance = float("inf")
    best_employee_id: Optional[int] = None

    for item in req.gallery:
        if len(item.embedding) != 128:
            continue
        dist = euclidean_distance(req.probe_embedding, item.embedding)
        if dist < best_distance:
            best_distance = dist
            best_employee_id = item.employeeId

    if best_distance <= req.tolerance and best_employee_id is not None:
        logger.info(f"Match found: employeeId={best_employee_id}, distance={best_distance:.4f}")
        return CompareResponse(
            matched=True,
            employeeId=best_employee_id,
            distance=round(best_distance, 4),
            message="Yüz eşleşti",
        )

    logger.info(f"No match: best_distance={best_distance:.4f}, tolerance={req.tolerance}")
    return CompareResponse(
        matched=False,
        distance=round(best_distance, 4) if best_distance < float("inf") else None,
        message="Yüz eşleşmedi",
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=5300, reload=True)
