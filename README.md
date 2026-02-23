# Game Cheat Recorder & Analyzer

Record and upload gameplay clips to detect cheats like aimbots, wallhacks, and other suspicious behavior using video analysis.

---

## 🚀 Features

- Floating overlay with **Start/Stop Recording** and cheat type selection.
- Supports multiple cheat types: `legit`, `aimbot`, `wallhack`.
- Generates **unique filenames** for each recording.
- Upload clips to a **FastAPI server** for cheat analysis.
- Easy to extend for **additional cheat detection logic**.

---

## 🎮 Supported Use-Cases

This tool is designed for monitoring gameplay in competitive shooters such as:

- Counter-Strike 2
- Valorant
- Call of Duty: Warzone

It can analyze:

- Player movement & tracking
- Aim trajectory and snap angles
- Crosshair accuracy
- Wallhacks & visibility cheats

---

## 🛠️ Installation

### 1. Clone the repository

```bash
git clone https://github.com/your-username/game-cheat-recorder.git
cd game-cheat-recorder
```

### 2. Install Python dependencies for the server

```bash
python -m venv venv
source venv/bin/activate  # Linux / Mac
venv\Scripts\activate     # Windows

pip install -r requirements.txt
```

### 3. Run the FastAPI server

```bash
uvicorn server:app --reload
```

The server will run at: `http://127.0.0.1:8000`

---

## 🖥️ Chrome Extension Setup

1. Open Chrome → `chrome://extensions/` → **Developer mode** → **Load unpacked**  
2. Select the folder containing the extension files (`content.js`, `manifest.json`)  
3. Use the floating overlay in-game to:  
   - Start recording  
   - Select cheat type (`legit`, `aimbot`, `wallhack`)  
   - Stop & upload to the server

---

## ⚙️ How It Works

1. **Recording:** The extension captures the screen via `MediaRecorder`.  
2. **Labeling:** You choose a label before uploading (`legit`, `aimbot`, `wallhack`).  
3. **Uploading:** The clip is sent to the FastAPI server (`/upload_clip`) for storage and analysis.  
4. **Analysis:** The server can run models to detect cheating behavior from uploaded videos.

---

## 📝 Example Usage

1. Record a gameplay session with suspicious aimbot behavior.  
2. Select `aimbot` from the overlay.  
3. Click **Stop & Upload**.  
4. Check the server response for upload confirmation.

---

## 📁 Folder Structure

```text
game-cheat-recorder/
│
├─ server/
│  ├─ server.py             # FastAPI server
│  └─ requirements.txt
│
├─ extension/
│  ├─ content.js            # Floating overlay script
│  ├─ manifest.json
│  └─ ...other files
│
└─ README.md
```

---

## ⚡ Future Improvements

- Live timer / recording duration in overlay  
- Integration with AI-based cheat detection models  
- Automatic detection and scoring for uploaded clips  
- Support for additional games

---

## 📝 License

MIT License © Roberto D'Amico

