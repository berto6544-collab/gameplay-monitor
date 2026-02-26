from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os, shutil
from pathlib import Path
import torch
import torch.nn as nn
import torchvision.models.video as models
import torchvision.transforms.functional as TF
from torch.utils.data import DataLoader, Dataset
import torchvision.io as io
import uvicorn
from typing import Optional

# -------------------------
# FastAPI setup
# -------------------------
app = FastAPI(title="Cheat Clip Training Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------
# Config
# -------------------------
DATASET_DIR = Path("dataset")
CLASSES = ["legit", "aimbot", "wallhack"]
CLASS_TO_IDX = {cls: i for i, cls in enumerate(CLASSES)}
MODEL_PATH = Path("cheat_model.pt")
NUM_FRAMES = 16
FRAME_SIZE = 112  # R3D-18 expects 112x112

for c in CLASSES:
    os.makedirs(DATASET_DIR / c, exist_ok=True)

# Cache loaded model in memory to avoid reloading on every prediction
_cached_model: Optional[nn.Module] = None
_model_mtime: Optional[float] = None


# -------------------------
# Video loader (fixed + resize)
# -------------------------
def load_video_clip(path: Path) -> torch.Tensor:
    """
    Returns tensor of shape (C, T, H, W) normalized to [0, 1].
    Resizes spatial dims to FRAME_SIZE x FRAME_SIZE for R3D-18.
    """
    video, _, _ = io.read_video(str(path), pts_unit="sec", output_format="TCHW")
    # video is now (T, C, H, W) — output_format="TCHW" avoids manual permute

    # Temporal padding/trimming to NUM_FRAMES
    T = video.shape[0]
    if T >= NUM_FRAMES:
        # Uniformly sample NUM_FRAMES across the clip
        indices = torch.linspace(0, T - 1, NUM_FRAMES).long()
        video = video[indices]
    else:
        pad = video[-1:].repeat(NUM_FRAMES - T, 1, 1, 1)
        video = torch.cat([video, pad], dim=0)

    # Spatial resize to 112x112
    video = torch.stack([
        TF.resize(frame, [FRAME_SIZE, FRAME_SIZE])
        for frame in video
    ])  # (T, C, H, W)

    # R3D expects (C, T, H, W)
    video = video.permute(1, 0, 2, 3).float() / 255.0
    return video


# -------------------------
# Custom Dataset
# -------------------------
class VideoDataset(Dataset):
    def __init__(self, root: Path):
        self.samples = []
        for cls in CLASSES:
            cls_dir = root / cls
            if not cls_dir.exists():
                continue
            for f in cls_dir.glob("*.mp4"):
                self.samples.append((f, CLASS_TO_IDX[cls]))

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        path, label = self.samples[idx]
        return load_video_clip(path), label


# -------------------------
# Model factory
# -------------------------
def build_model() -> nn.Module:
    model = models.r3d_18(weights=models.R3D_18_Weights.DEFAULT)
    model.fc = nn.Linear(model.fc.in_features, len(CLASSES))
    return model


def get_cached_model(device: str) -> nn.Module:
    """Load model from disk, using in-memory cache if file hasn't changed."""
    global _cached_model, _model_mtime
    if not MODEL_PATH.exists():
        raise HTTPException(status_code=404, detail="No trained model found. Run /train_model first.")
    mtime = MODEL_PATH.stat().st_mtime
    if _cached_model is None or mtime != _model_mtime:
        model = build_model()
        model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
        model.to(device).eval()
        _cached_model = model
        _model_mtime = mtime
    return _cached_model


# -------------------------
# Routes
# -------------------------
@app.post("/upload_clip")
async def upload_clip(file: UploadFile = File(...), label: str = Form(...)):
    """Upload a labeled gameplay clip for training."""
    if label not in CLASSES:
        raise HTTPException(status_code=400, detail=f"Label must be one of {CLASSES}")
    if not file.filename.endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Only .mp4 files are supported")

    save_path = DATASET_DIR / label / file.filename
    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"status": "saved", "path": str(save_path)}


@app.get("/dataset_stats")
async def dataset_stats():
    """Return how many clips exist per class."""
    stats = {}
    for cls in CLASSES:
        stats[cls] = len(list((DATASET_DIR / cls).glob("*.mp4")))
    stats["total"] = sum(stats.values())
    return stats


@app.post("/train_model")
async def train_model(epochs: int = Form(3), batch_size: int = Form(4)):
    """Train the R3D-18 model on uploaded clips."""
    global _cached_model, _model_mtime

    dataset = VideoDataset(DATASET_DIR)
    if len(dataset) == 0:
        raise HTTPException(status_code=400, detail="No training clips found. Upload some first.")

    dataloader = DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=0,  # set >0 if not on Windows
        pin_memory=True,
    )

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = build_model().to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-4)
    criterion = nn.CrossEntropyLoss()

    history = []
    model.train()
    for epoch in range(epochs):
        total_loss = 0.0
        correct = 0
        total = 0
        for videos, labels in dataloader:
            videos, labels = videos.to(device), labels.to(device)
            optimizer.zero_grad()
            outputs = model(videos)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
            correct += (outputs.argmax(1) == labels).sum().item()
            total += labels.size(0)

        acc = correct / total if total > 0 else 0
        epoch_info = {"epoch": epoch + 1, "loss": round(total_loss, 4), "accuracy": round(acc, 4)}
        history.append(epoch_info)
        print(epoch_info)

    torch.save(model.state_dict(), MODEL_PATH)
    # Invalidate cache
    _cached_model = None
    _model_mtime = None

    return {"status": "trained", "model_path": str(MODEL_PATH), "history": history}


@app.post("/predict_clip")
async def predict_clip(file: UploadFile = File(...)):
    """Predict whether a clip shows legit play, aimbot, or wallhack."""
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = get_cached_model(device)

    temp_path = DATASET_DIR / f"_temp_{file.filename}"
    try:
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        clip = load_video_clip(temp_path).unsqueeze(0).to(device)
    finally:
        if temp_path.exists():
            temp_path.unlink()

    with torch.no_grad():
        out = model(clip)
        probs = torch.softmax(out, dim=1).cpu().numpy()[0]

    result = {cls: round(float(probs[i]), 4) for i, cls in enumerate(CLASSES)}
    result["prediction"] = CLASSES[int(probs.argmax())]
    return result


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)