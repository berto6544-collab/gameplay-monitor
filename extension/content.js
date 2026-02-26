/**
 * content.js — Anti-Cheat Clip Recorder
 * Injects a floating HUD into any game page for recording, labeling,
 * and uploading gameplay clips to the training server.
 * Clips are converted to MP4 via FFmpeg WASM before upload/predict.
 */

(() => {
  "use strict";

  const SERVER = "http://127.0.0.1:8000";
  const CLASSES = ["legit", "aimbot", "wallhack"];

  // ── Prevent double-inject ──────────────────────────────────────────────────
  if (document.getElementById("acc-root")) return;

  // ── Inject FFmpeg WASM script ──────────────────────────────────────────────
  const ffmpegScript = document.createElement("script");
  ffmpegScript.src = "https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js";
  document.head.appendChild(ffmpegScript);

  // ── State ──────────────────────────────────────────────────────────────────
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordingStream = null;
  let timerInterval = null;
  let elapsedSeconds = 0;
  let selectedLabel = "legit";
  let isMinimized = false;
  let stats = { legit: 0, aimbot: 0, wallhack: 0, total: 0 };

  // ── FFmpeg state ───────────────────────────────────────────────────────────
  let ffmpegReady = false;
  let ffmpegInstance = null;

  async function loadFFmpeg() {
    if (ffmpegReady) return ffmpegInstance;
    const { createFFmpeg } = FFmpeg;
    ffmpegInstance = createFFmpeg({ log: false });
    await ffmpegInstance.load();
    ffmpegReady = true;
    return ffmpegInstance;
  }

  // ── Inject styles ──────────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@500;700&display=swap');

    #acc-root * { box-sizing: border-box; margin: 0; padding: 0; }

    #acc-root {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      font-family: 'Rajdhani', sans-serif;
      user-select: none;
    }

    /* Hide the HUD while recording so it doesn't appear in captured footage */
    #acc-root.recording-hidden {
      opacity: 0;
      pointer-events: none;
      visibility: hidden;
    }

    #acc-panel {
      width: 280px;
      background: #0a0c10;
      border: 1px solid #1e2535;
      border-radius: 8px;
      overflow: hidden;
      box-shadow:
        0 0 0 1px rgba(0,255,150,0.08),
        0 20px 60px rgba(0,0,0,0.7),
        inset 0 1px 0 rgba(255,255,255,0.04);
      transition: transform 0.25s cubic-bezier(.4,0,.2,1), opacity 0.25s ease;
    }

    #acc-panel.minimized { transform: translateY(calc(100% - 42px)); }

    /* Header */
    #acc-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #0d1017;
      border-bottom: 1px solid #1e2535;
      cursor: pointer;
    }

    #acc-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #00ff96;
    }

    #acc-title-dot {
      width: 7px; height: 7px;
      border-radius: 50%;
      background: #00ff96;
      box-shadow: 0 0 8px #00ff96;
      animation: acc-pulse 2s ease-in-out infinite;
    }

    #acc-title-dot.recording {
      background: #ff3c5a;
      box-shadow: 0 0 12px #ff3c5a;
      animation: acc-blink 0.8s ease-in-out infinite;
    }

    @keyframes acc-pulse {
      0%,100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.85); }
    }
    @keyframes acc-blink {
      0%,100% { opacity: 1; }
      50% { opacity: 0.2; }
    }

    #acc-minimize-btn {
      background: none;
      border: none;
      color: #4a5568;
      font-size: 16px;
      cursor: pointer;
      line-height: 1;
      transition: color 0.15s;
      padding: 2px 4px;
    }
    #acc-minimize-btn:hover { color: #a0aec0; }

    /* Body */
    #acc-body { padding: 14px; display: flex; flex-direction: column; gap: 12px; }

    /* Timer */
    #acc-timer {
      font-family: 'Share Tech Mono', monospace;
      font-size: 28px;
      color: #e2e8f0;
      text-align: center;
      letter-spacing: 3px;
      padding: 8px 0 4px;
      position: relative;
    }
    #acc-timer.recording { color: #ff3c5a; text-shadow: 0 0 20px rgba(255,60,90,0.4); }

    /* Label selector */
    #acc-label-section { display: flex; flex-direction: column; gap: 6px; }

    .acc-section-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #4a5568;
    }

    #acc-label-btns { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }

    .acc-label-btn {
      padding: 7px 4px;
      border-radius: 5px;
      border: 1px solid transparent;
      background: #131720;
      color: #718096;
      font-family: 'Rajdhani', sans-serif;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.15s;
      text-align: center;
    }
    .acc-label-btn:hover { background: #1a2030; color: #a0aec0; }
    .acc-label-btn.active[data-label="legit"]   { border-color: #00ff96; color: #00ff96; background: rgba(0,255,150,0.08); }
    .acc-label-btn.active[data-label="aimbot"]  { border-color: #ff3c5a; color: #ff3c5a; background: rgba(255,60,90,0.08); }
    .acc-label-btn.active[data-label="wallhack"]{ border-color: #f6ad55; color: #f6ad55; background: rgba(246,173,85,0.08); }

    /* Controls */
    #acc-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

    .acc-btn {
      padding: 10px;
      border-radius: 5px;
      border: none;
      font-family: 'Rajdhani', sans-serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      cursor: pointer;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .acc-btn:disabled { opacity: 0.3; cursor: not-allowed; }

    #acc-record-btn {
      background: linear-gradient(135deg, #ff3c5a, #c41a34);
      color: #fff;
      box-shadow: 0 2px 12px rgba(255,60,90,0.3);
    }
    #acc-record-btn:hover:not(:disabled) { box-shadow: 0 4px 20px rgba(255,60,90,0.5); transform: translateY(-1px); }
    #acc-record-btn.recording {
      background: linear-gradient(135deg, #2d3748, #1a202c);
      box-shadow: none;
    }

    #acc-upload-btn {
      background: linear-gradient(135deg, #00c870, #008f4e);
      color: #fff;
      box-shadow: 0 2px 12px rgba(0,200,112,0.3);
    }
    #acc-upload-btn:hover:not(:disabled) { box-shadow: 0 4px 20px rgba(0,200,112,0.5); transform: translateY(-1px); }

    #acc-predict-btn {
      grid-column: span 2;
      background: linear-gradient(135deg, #667eea, #4c51bf);
      color: #fff;
      box-shadow: 0 2px 12px rgba(102,126,234,0.3);
    }
    #acc-predict-btn:hover:not(:disabled) { box-shadow: 0 4px 20px rgba(102,126,234,0.5); transform: translateY(-1px); }

    /* Stats bar */
    #acc-stats {
      border-top: 1px solid #1e2535;
      padding-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .acc-stat-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .acc-stat-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      width: 62px;
      flex-shrink: 0;
    }
    .acc-stat-label.legit   { color: #00ff96; }
    .acc-stat-label.aimbot  { color: #ff3c5a; }
    .acc-stat-label.wallhack{ color: #f6ad55; }
    .acc-stat-bar-track {
      flex: 1;
      height: 4px;
      background: #1a2030;
      border-radius: 2px;
      overflow: hidden;
    }
    .acc-stat-bar-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 0.4s cubic-bezier(.4,0,.2,1);
    }
    .acc-stat-bar-fill.legit   { background: #00ff96; }
    .acc-stat-bar-fill.aimbot  { background: #ff3c5a; }
    .acc-stat-bar-fill.wallhack{ background: #f6ad55; }
    .acc-stat-count {
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px;
      color: #4a5568;
      width: 20px;
      text-align: right;
      flex-shrink: 0;
    }

    /* Toast */
    #acc-toast-container {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483648;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }

    .acc-toast {
      padding: 10px 18px;
      border-radius: 6px;
      font-family: 'Rajdhani', sans-serif;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      color: #fff;
      box-shadow: 0 8px 30px rgba(0,0,0,0.5);
      animation: acc-toast-in 0.3s cubic-bezier(.4,0,.2,1) forwards;
      white-space: nowrap;
    }
    .acc-toast.success { background: #065f46; border: 1px solid #00ff96; }
    .acc-toast.error   { background: #7f1d1d; border: 1px solid #ff3c5a; }
    .acc-toast.info    { background: #1e1b4b; border: 1px solid #667eea; }
    .acc-toast.warning { background: #78350f; border: 1px solid #f6ad55; }
    .acc-toast.out     { animation: acc-toast-out 0.3s ease forwards; }

    @keyframes acc-toast-in  { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
    @keyframes acc-toast-out { from { opacity:1; transform:translateY(0); } to { opacity:0; transform:translateY(-8px); } }

    /* Prediction result */
    #acc-prediction {
      background: #0d1017;
      border: 1px solid #1e2535;
      border-radius: 5px;
      padding: 10px 12px;
      display: none;
      flex-direction: column;
      gap: 8px;
    }
    #acc-prediction.visible { display: flex; }

    #acc-prediction-title {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #4a5568;
    }

    #acc-prediction-verdict {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    #acc-prediction-verdict.legit    { color: #00ff96; }
    #acc-prediction-verdict.aimbot   { color: #ff3c5a; }
    #acc-prediction-verdict.wallhack { color: #f6ad55; }

    .acc-prob-row { display: flex; align-items: center; gap: 8px; }
    .acc-prob-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      width: 62px;
      flex-shrink: 0;
    }
    .acc-prob-label.legit    { color: #00ff96; }
    .acc-prob-label.aimbot   { color: #ff3c5a; }
    .acc-prob-label.wallhack { color: #f6ad55; }
    .acc-prob-bar-track { flex: 1; height: 4px; background: #1a2030; border-radius: 2px; overflow: hidden; }
    .acc-prob-bar-fill  { height: 100%; border-radius: 2px; transition: width 0.5s cubic-bezier(.4,0,.2,1); }
    .acc-prob-bar-fill.legit    { background: #00ff96; }
    .acc-prob-bar-fill.aimbot   { background: #ff3c5a; }
    .acc-prob-bar-fill.wallhack { background: #f6ad55; }
    .acc-prob-pct {
      font-family: 'Share Tech Mono', monospace;
      font-size: 11px;
      color: #4a5568;
      width: 36px;
      text-align: right;
      flex-shrink: 0;
    }

    /* Drag handle cursor */
    #acc-panel { cursor: default; }
  `;
  document.head.appendChild(style);

  // ── Build DOM ──────────────────────────────────────────────────────────────
  const root = document.createElement("div");
  root.id = "acc-root";
  root.innerHTML = `
    <div id="acc-panel">
      <div id="acc-header">
        <div id="acc-title">
          <div id="acc-title-dot"></div>
          <span>AntiCheat·AI</span>
        </div>
        <button id="acc-minimize-btn" title="Minimize">▾</button>
      </div>

      <div id="acc-body">
        <div id="acc-timer">00:00</div>

        <div id="acc-label-section">
          <div class="acc-section-label">Label</div>
          <div id="acc-label-btns">
            ${CLASSES.map(c => `
              <button class="acc-label-btn ${c === 'legit' ? 'active' : ''}" data-label="${c}">${c}</button>
            `).join('')}
          </div>
        </div>

        <div id="acc-controls">
          <button id="acc-record-btn" class="acc-btn">⏺ Record</button>
          <button id="acc-upload-btn" class="acc-btn" disabled>⬆ Upload</button>
          <button id="acc-predict-btn" class="acc-btn" disabled>🔍 Analyze Clip</button>
        </div>

        <div id="acc-prediction">
          <div id="acc-prediction-title">AI Verdict</div>
          <div id="acc-prediction-verdict">—</div>
          ${CLASSES.map(c => `
            <div class="acc-prob-row">
              <span class="acc-prob-label ${c}">${c}</span>
              <div class="acc-prob-bar-track">
                <div class="acc-prob-bar-fill ${c}" id="acc-prob-fill-${c}" style="width:0%"></div>
              </div>
              <span class="acc-prob-pct" id="acc-prob-pct-${c}">0%</span>
            </div>
          `).join('')}
        </div>

        <div id="acc-stats">
          <div class="acc-section-label">Dataset Clips</div>
          ${CLASSES.map(c => `
            <div class="acc-stat-row">
              <span class="acc-stat-label ${c}">${c}</span>
              <div class="acc-stat-bar-track">
                <div class="acc-stat-bar-fill ${c}" id="acc-stat-fill-${c}" style="width:0%"></div>
              </div>
              <span class="acc-stat-count" id="acc-stat-count-${c}">0</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // Toast container (outside panel so it doesn't clip)
  const toastContainer = document.createElement("div");
  toastContainer.id = "acc-toast-container";
  document.body.appendChild(toastContainer);

  // ── Element refs ───────────────────────────────────────────────────────────
  const panel       = document.getElementById("acc-panel");
  const titleDot    = document.getElementById("acc-title-dot");
  const timer       = document.getElementById("acc-timer");
  const recordBtn   = document.getElementById("acc-record-btn");
  const uploadBtn   = document.getElementById("acc-upload-btn");
  const predictBtn  = document.getElementById("acc-predict-btn");
  const minimizeBtn = document.getElementById("acc-minimize-btn");
  const prediction  = document.getElementById("acc-prediction");

  // ── Toast ──────────────────────────────────────────────────────────────────
  function toast(msg, type = "info", duration = 3500) {
    const el = document.createElement("div");
    el.className = `acc-toast ${type}`;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 350);
    }, duration);
  }

  // ── Timer ──────────────────────────────────────────────────────────────────
  function startTimer() {
    elapsedSeconds = 0;
    updateTimerDisplay();
    timerInterval = setInterval(() => {
      elapsedSeconds++;
      updateTimerDisplay();
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function updateTimerDisplay() {
    const m = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
    const s = String(elapsedSeconds % 60).padStart(2, "0");
    timer.textContent = `${m}:${s}`;
  }

  // ── Dataset stats ──────────────────────────────────────────────────────────
  async function refreshStats() {
    try {
      const res = await fetch(`${SERVER}/dataset_stats`);
      if (!res.ok) return;
      stats = await res.json();
      const max = Math.max(stats.total, 1);
      CLASSES.forEach(c => {
        const count = stats[c] || 0;
        document.getElementById(`acc-stat-fill-${c}`).style.width = `${(count / max) * 100}%`;
        document.getElementById(`acc-stat-count-${c}`).textContent = count;
      });
    } catch (_) { /* server might not be running yet */ }
  }

  // ── Label selection ────────────────────────────────────────────────────────
  document.getElementById("acc-label-btns").addEventListener("click", e => {
    const btn = e.target.closest(".acc-label-btn");
    if (!btn) return;
    selectedLabel = btn.dataset.label;
    document.querySelectorAll(".acc-label-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });

  // ── Minimize toggle ────────────────────────────────────────────────────────
  minimizeBtn.addEventListener("click", () => {
    isMinimized = !isMinimized;
    panel.classList.toggle("minimized", isMinimized);
    minimizeBtn.textContent = isMinimized ? "▴" : "▾";
  });

  // ── Drag to reposition ─────────────────────────────────────────────────────
  let dragging = false, dragOffX = 0, dragOffY = 0;
  document.getElementById("acc-header").addEventListener("mousedown", e => {
    if (e.target === minimizeBtn) return;
    dragging = true;
    const rect = root.getBoundingClientRect();
    dragOffX = e.clientX - rect.left;
    dragOffY = e.clientY - rect.top;
    root.style.right = "auto";
    root.style.bottom = "auto";
  });
  document.addEventListener("mousemove", e => {
    if (!dragging) return;
    root.style.left = `${e.clientX - dragOffX}px`;
    root.style.top  = `${e.clientY - dragOffY}px`;
  });
  document.addEventListener("mouseup", () => { dragging = false; });

  // ── Recording ─────────────────────────────────────────────────────────────
  recordBtn.addEventListener("click", async () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      stopRecording();
    } else {
      await startRecording();
    }
  });

  async function startRecording() {
    try {
      recordingStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (err) {
      toast("Screen capture denied or cancelled", "error");
      return;
    }

    recordedChunks = [];
    const mimeType = getSupportedMimeType();
    mediaRecorder = new MediaRecorder(recordingStream, { mimeType, videoBitsPerSecond: 2_500_000 });

    mediaRecorder.ondataavailable = e => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
      recordingStream.getTracks().forEach(t => t.stop());
      recordingStream = null;
      stopTimer();
      timer.classList.remove("recording");
      titleDot.classList.remove("recording");
      recordBtn.classList.remove("recording");
      recordBtn.innerHTML = "⏺ Record";

      // Restore the HUD now that recording has stopped
      root.classList.remove("recording-hidden");

      const hasClip = recordedChunks.length > 0;
      uploadBtn.disabled  = !hasClip;
      predictBtn.disabled = !hasClip;
      if (hasClip) toast(`Clip ready — ${elapsedSeconds}s recorded`, "success");
    };

    mediaRecorder.start(1000); // collect in 1s chunks
    startTimer();
    timer.classList.add("recording");
    titleDot.classList.add("recording");
    recordBtn.classList.add("recording");
    recordBtn.innerHTML = "⏹ Stop";
    uploadBtn.disabled  = true;
    predictBtn.disabled = true;
    prediction.classList.remove("visible");

    // Hide the HUD before the first frame is captured so it's clean footage
    root.classList.add("recording-hidden");
    toast("Recording started — capture your gameplay!", "info");

    // Auto-stop if stream ends (user stops share from browser UI)
    recordingStream.getTracks()[0].onended = () => {
      if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
    };
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
  }

  function getSupportedMimeType() {
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];
    return candidates.find(t => MediaRecorder.isTypeSupported(t)) || "";
  }

  // ── MP4 conversion via FFmpeg WASM ─────────────────────────────────────────
  async function buildMp4Blob() {
    const rawMime = (mediaRecorder?.mimeType || "video/webm").split(";")[0];
    const rawBlob = new Blob(recordedChunks, { type: rawMime });

    // If the browser already recorded as mp4, skip conversion
    if (rawMime === "video/mp4") {
      toast("Clip is already MP4 — skipping conversion", "info", 2000);
      return rawBlob;
    }

    try {
      toast("Converting to MP4… please wait", "info", 8000);

      // Wait for FFmpeg script to be available (may still be loading)
      if (typeof FFmpeg === "undefined") {
        await new Promise((resolve, reject) => {
          ffmpegScript.addEventListener("load", resolve);
          ffmpegScript.addEventListener("error", () => reject(new Error("FFmpeg script failed to load")));
          setTimeout(() => reject(new Error("FFmpeg script load timeout")), 15000);
        });
      }

      const ff = await loadFFmpeg();
      const { fetchFile } = FFmpeg;

      ff.FS("writeFile", "input.webm", await fetchFile(rawBlob));

      await ff.run(
        "-i", "input.webm",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-movflags", "+faststart",
        "-an",           // no audio track (we recorded without audio)
        "output.mp4"
      );

      const data = ff.FS("readFile", "output.mp4");

      // Clean up WASM virtual filesystem
      try { ff.FS("unlink", "input.webm"); } catch (_) {}
      try { ff.FS("unlink", "output.mp4"); } catch (_) {}

      toast("Conversion complete ✓", "success", 2500);
      return new Blob([data.buffer], { type: "video/mp4" });

    } catch (err) {
      console.error("[ACC] FFmpeg conversion failed:", err);
      toast("MP4 conversion failed — uploading original WebM", "warning", 4000);
      return rawBlob;
    }
  }

  function buildFilename(suffix = "clip") {
    return `${suffix}_${Date.now()}.mp4`;
  }

  // ── Upload ─────────────────────────────────────────────────────────────────
  uploadBtn.addEventListener("click", async () => {
    if (!recordedChunks.length) return;
    uploadBtn.disabled = true;
    uploadBtn.innerHTML = "⏳ Converting…";

    const blob = await buildMp4Blob();

    uploadBtn.innerHTML = "⏳ Uploading…";
    const filename = buildFilename(selectedLabel);
    const form = new FormData();
    form.append("file", new File([blob], filename, { type: blob.type }));
    form.append("label", selectedLabel);

    try {
      const res = await fetch(`${SERVER}/upload_clip`, { method: "POST", body: form });
      const data = await res.json();
      if (data.status === "saved") {
        toast(`✓ Uploaded as "${selectedLabel}"`, "success");
        refreshStats();
      } else {
        toast(data.error || "Upload failed", "error");
      }
    } catch (_) {
      toast("Cannot reach server — is it running?", "error");
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.innerHTML = "⬆ Upload";
    }
  });

  // ── Predict ────────────────────────────────────────────────────────────────
  predictBtn.addEventListener("click", async () => {
    if (!recordedChunks.length) return;
    predictBtn.disabled = true;
    predictBtn.innerHTML = "⏳ Converting…";
    prediction.classList.remove("visible");

    const blob = await buildMp4Blob();

    predictBtn.innerHTML = "⏳ Analyzing…";
    const filename = buildFilename("predict");
    const form = new FormData();
    form.append("file", new File([blob], filename, { type: blob.type }));

    try {
      const res = await fetch(`${SERVER}/predict_clip`, { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json();
        toast(err.detail || "Prediction failed", "error");
        return;
      }
      const data = await res.json();
      showPrediction(data);
    } catch (_) {
      toast("Cannot reach server — is it running?", "error");
    } finally {
      predictBtn.disabled = false;
      predictBtn.innerHTML = "🔍 Analyze Clip";
    }
  });

  function showPrediction(data) {
    const verdict = document.getElementById("acc-prediction-verdict");
    verdict.textContent = data.prediction.toUpperCase();
    verdict.className = `${data.prediction}`;

    CLASSES.forEach(c => {
      const pct = Math.round((data[c] || 0) * 100);
      document.getElementById(`acc-prob-fill-${c}`).style.width = `${pct}%`;
      document.getElementById(`acc-prob-pct-${c}`).textContent = `${pct}%`;
    });

    prediction.classList.add("visible");

    const type = data.prediction === "legit" ? "success" : "warning";
    toast(`Verdict: ${data.prediction.toUpperCase()} (${Math.round(data[data.prediction] * 100)}% confidence)`, type, 5000);
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  refreshStats();
  setInterval(refreshStats, 30_000); // refresh every 30s
})();