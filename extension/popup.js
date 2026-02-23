let mediaRecorder;
let recordedChunks = [];

const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const resultBox = document.getElementById("result");
const labelSelect = document.getElementById("labelSelect");

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
    resultBox.innerText = "Recording started...";
  } catch (err) {
    console.error("Recording error:", err);
    alert("Could not start recording: " + err.message);
  }
};

stopBtn.onclick = async () => {
  if (!mediaRecorder) return;

  mediaRecorder.onstop = async () => {
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
    const file = new File([blob], "recording.webm", { type: blob.type });

    const formData = new FormData();
    formData.append("file", file);
    formData.append("label", labelSelect.value); // <-- label selection

    resultBox.innerText = "Uploading...";

    try {
      // Upload to training server with chosen label
      const res = await fetch("http://127.0.0.1:8000/upload_clip", {
        method: "POST",
        body: formData
      });

      const data = await res.json();
      resultBox.innerText = "✅ Upload complete!\n\n" + JSON.stringify(data, null, 2);
    } catch (err) {
      console.error("Upload failed:", err);
      resultBox.innerText = "Upload failed: " + err.message;
    }

    startBtn.disabled = false;
    stopBtn.disabled = true;
  };

  mediaRecorder.stop();
};