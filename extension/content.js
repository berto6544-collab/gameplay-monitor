let mediaRecorder;
let recordedChunks = [];

// Generate a unique ID for this floating box
const containerId = "cheat_overlay_" + Math.random().toString(36).substring(2, 10);

// Create floating UI container
const container = document.createElement("div");
container.id = containerId;
container.style.position = "fixed";
container.style.top = "20px";
container.style.right = "20px";
container.style.background = "rgba(0,0,0,0.85)";
container.style.color = "#fff";
container.style.padding = "10px";
container.style.zIndex = 999999;
container.style.fontFamily = "Arial, sans-serif";
container.style.borderRadius = "8px";
container.style.boxShadow = "0 0 10px rgba(0,0,0,0.5)";
container.style.width = "200px";
container.style.display = "flex";
container.style.flexDirection = "column";
container.style.gap = "5px";
document.body.appendChild(container);

// Buttons and selector
const startBtn = document.createElement("button");
startBtn.innerText = "Start Recording";

const labelSelect = document.createElement("select");
["legit", "aimbot", "wallhack"].forEach(label => {
  const option = document.createElement("option");
  option.value = label;
  option.innerText = label;
  labelSelect.appendChild(option);
});

const resultBox = document.createElement("pre");
resultBox.innerText = "Status: idle";
resultBox.style.maxHeight = "150px";
resultBox.style.overflowY = "auto";

// Stop button at the bottom
const stopBtn = document.createElement("button");
stopBtn.innerText = "Stop & Upload";
stopBtn.disabled = true;

// Append elements in order: Start, Label, Status, Stop
container.appendChild(startBtn);
container.appendChild(labelSelect);
container.appendChild(resultBox);
container.appendChild(stopBtn);

// Generate unique filename
function getUniqueFilename() {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  return `recording_${timestamp}_${randomStr}.webm`;
}

// Start recording
startBtn.onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });

    let options = { mimeType: "video/webm; codecs=vp9" };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: "video/webm; codecs=vp8" };
    }

    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.start();

    startBtn.disabled = true;
    stopBtn.disabled = false;
    resultBox.innerText = "Status: Recording...";
    console.log("Recording started...");
  } catch (err) {
    console.error("Recording error:", err);
    alert("Could not start recording: " + err.message);
  }
};

// Stop recording and upload
stopBtn.onclick = async () => {
  if (!mediaRecorder) return;

  mediaRecorder.onstop = async () => {
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
    const filename = getUniqueFilename();
    const file = new File([blob], filename, { type: blob.type });

    const formData = new FormData();
    formData.append("file", file);
    formData.append("label", labelSelect.value);

    resultBox.innerText = "Status: Uploading...";

    try {
      const res = await fetch("http://127.0.0.1:8000/upload_clip", {
        method: "POST",
        body: formData
      });
      const data = await res.json();
      resultBox.innerText = `✅ Upload complete!\nFilename: ${filename}\n` + JSON.stringify(data, null, 2);
    } catch (err) {
      console.error("Upload failed:", err);
      resultBox.innerText = "❌ Upload failed: " + err.message;
    }

    startBtn.disabled = false;
    stopBtn.disabled = true;
  };

  mediaRecorder.stop();
};