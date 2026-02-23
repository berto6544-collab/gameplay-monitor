from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
import os, shutil
from pathlib import Path
import torch
import torch.nn as nn
import torchvision.models.video as models
from torch.utils.data import DataLoader
from torchvision.datasets import DatasetFolder
import torchvision.io as io
import uvicorn

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
# Dataset paths
# -------------------------
DATASET_DIR = Path("dataset")
CLASSES = ["legit","aimbot","wallhack"]
for c in CLASSES:
    os.makedirs(DATASET_DIR / c, exist_ok=True)

MODEL_PATH = Path("cheat_model.pt")

# -------------------------
# Upload clips
# -------------------------
@app.post("/upload_clip")
async def upload_clip(file: UploadFile = File(...), label: str = Form(...)):
    if label not in CLASSES:
        return {"error": f"Label must be one of {CLASSES}"}
    save_path = DATASET_DIR / label / file.filename
    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"status":"saved","path":str(save_path)}

# -------------------------
# Video loader
# -------------------------
def video_loader(path):
    video, _, _ = io.read_video(str(path), pts_unit="sec")
    video = video.permute(3,0,1,2)  # T,H,W,C -> C,T,H,W
    # Take first 16 frames
    if video.shape[1] > 16:
        video = video[:, :16]
    else:
        pad = video[:, -1:, :, :].repeat(1, 16 - video.shape[1], 1, 1)
        video = torch.cat([video, pad], dim=1)
    return video.float() / 255.0

# -------------------------
# Train model
# -------------------------
@app.post("/train_model")
async def train_model(epochs: int = Form(3), batch_size: int = Form(4)):
    dataset = DatasetFolder(
        root=str(DATASET_DIR),
        loader=video_loader,
        extensions=("mp4",),
    )
    dataset.classes = CLASSES
    dataset.class_to_idx = {cls:i for i,cls in enumerate(CLASSES)}
    dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True)

    # Model
    model = models.r3d_18(pretrained=True)
    model.fc = nn.Linear(model.fc.in_features, len(CLASSES))

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = model.to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-4)
    criterion = nn.CrossEntropyLoss()

    model.train()
    for epoch in range(epochs):
        total_loss = 0
        for videos, labels in dataloader:
            videos = videos.to(device)
            labels = labels.to(device)
            optimizer.zero_grad()
            outputs = model(videos)
            loss = criterion(outputs, labels)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        print(f"Epoch {epoch+1}/{epochs}, Loss: {total_loss:.4f}")

    torch.save(model.state_dict(), MODEL_PATH)
    return {"status":"trained","model_path":str(MODEL_PATH)}

# -------------------------
# Predict clip
# -------------------------
@app.post("/predict_clip")
async def predict_clip(file: UploadFile = File(...)):
    model = models.r3d_18(pretrained=True)
    model.fc = nn.Linear(model.fc.in_features, len(CLASSES))
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.load_state_dict(torch.load(MODEL_PATH, map_location=device))
    model.to(device).eval()

    temp_path = DATASET_DIR / f"temp_{file.filename}"
    with open(temp_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    clip = video_loader(temp_path).unsqueeze(0).to(device)
    temp_path.unlink()

    with torch.no_grad():
        out = model(clip)
        probs = torch.softmax(out, dim=1).cpu().numpy()[0]

    return {cls: float(probs[i]) for i, cls in enumerate(CLASSES)}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)