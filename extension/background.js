let mediaRecorder;
let recordedChunks = [];
let recordingTimeout;
let suspected = false;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "start_record") {
    startRecording();
    sendResponse({status: "recording_started"});
  }

  if (msg.action === "clip_and_upload") {
    stopRecording(msg.label).then(res => sendResponse(res));
    return true;
  }

  if (msg.action === "suspicious_detected") {
    suspected = true;
    chrome.action.setBadgeText({text: "!"});
    chrome.action.setBadgeBackgroundColor({color: "#ff0000"});
    // send to popup to prompt user
    chrome.runtime.sendMessage({action: "prompt_clip"});
  }
});

// Recording functions (same as before)
async function startRecording() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm; codecs=vp9" });
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.start();

  recordingTimeout = setInterval(() => {
    recordedChunks = recordedChunks.slice(-60);
  }, 1000);
}

async function stopRecording(label) {
  return new Promise(resolve => {
    if (!mediaRecorder) return resolve({error: "Not recording"});
    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, {type: "video/webm"});
      recordedChunks = [];

      const form = new FormData();
      form.append("file", blob, `clip_${Date.now()}.webm`);
      form.append("label", label);

      try {
        const res = await fetch("http://localhost:8000/upload_clip", { method: "POST", body: form });
        const data = await res.json();
        suspected = false;
        chrome.action.setBadgeText({text: ""});
        resolve(data);
      } catch (err) {
        resolve({error: err.toString()});
      }
    };
    mediaRecorder.stop();
    clearInterval(recordingTimeout);
  });
}