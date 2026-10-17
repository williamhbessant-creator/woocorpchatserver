(() => {
  const $ = id => document.getElementById(id);
  const titleInput = $("recordingTitle");
  const recordButton = $("recordButton");
  const stopButton = $("stopButton");
  const saveButton = $("saveButton");
  const discardButton = $("discardButton");
  const previewArea = $("previewArea");
  const previewAudio = $("previewAudio");
  const recordStatus = $("recordStatus");
  const recordDot = $("recordDot");
  const recordTimer = $("recordTimer");
  const listStatus = $("listStatus");
  const recordingList = $("recordingList");
  let recorder = null, stream = null, chunks = [], recordingBlob = null;
  const voicePanel = $("homeVoiceMessages");
  const voiceToggles = [$("voicePanelToggle"), $("voicePanelToggleInline")].filter(Boolean);
  function setVoicePanelOpen(open) {
    voicePanel.hidden = !open;
    voiceToggles.forEach(button => button.setAttribute("aria-expanded", String(open)));
    if (open) voicePanel.scrollIntoView({behavior:"smooth", block:"nearest"});
  }
  voiceToggles.forEach(button => button.addEventListener("click", () => setVoicePanelOpen(voicePanel.hidden)));

  let recordingStarted = 0, recordingDuration = 0, timerHandle = null, previewUrl = null, uploading = false;

  const formatTime = seconds => {
    const value = Math.max(0, Math.floor(seconds || 0));
    return String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0");
  };
  const setStatus = text => { recordStatus.textContent = text; };
  const releaseStream = () => { if (stream) stream.getTracks().forEach(track => track.stop()); stream = null; };
  const resetPreview = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; recordingBlob = null;
    previewAudio.removeAttribute("src"); previewAudio.load(); previewArea.hidden = true;
    saveButton.disabled = false; recordButton.disabled = false; recordTimer.textContent = "00:00";
  };
  const supportedMime = () => {
    if (!window.MediaRecorder) return "";
    return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"]
      .find(type => MediaRecorder.isTypeSupported(type)) || "";
  };

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setStatus("Audio recording is not supported in this browser."); return;
    }
    try {
      resetPreview();
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
      chunks = [];
      const mimeType = supportedMime();
      recorder = new MediaRecorder(stream, mimeType ? {mimeType} : undefined);
      recorder.addEventListener("dataavailable", event => { if (event.data && event.data.size) chunks.push(event.data); });
      recorder.addEventListener("stop", () => {
        clearInterval(timerHandle); timerHandle = null; releaseStream();
        recordingDuration = Math.min(180, Math.round((Date.now() - recordingStarted) / 1000));
        recordingBlob = new Blob(chunks, {type:recorder.mimeType || (chunks[0] && chunks[0].type) || "audio/webm"});
        previewUrl = URL.createObjectURL(recordingBlob); previewAudio.src = previewUrl; previewArea.hidden = false;
        recordDot.classList.remove("live"); setStatus("Recording ready to preview");
        recordButton.disabled = false; stopButton.disabled = true; recordTimer.textContent = formatTime(recordingDuration);
      });
      recorder.start(250); recordingStarted = Date.now();
      recordButton.disabled = true; stopButton.disabled = false; recordDot.classList.add("live");
      setStatus("Recording… maximum 3 minutes");
      timerHandle = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStarted) / 1000);
        recordTimer.textContent = formatTime(elapsed);
        if (elapsed >= 180 && recorder && recorder.state === "recording") recorder.stop();
      }, 250);
    } catch (error) {
      releaseStream(); console.error(error);
      setStatus(error.name === "NotAllowedError" ? "Microphone permission was denied." : "Could not start the microphone.");
    }
  }
  function stopRecording() { if (recorder && recorder.state === "recording") recorder.stop(); stopButton.disabled = true; }

  async function saveRecording() {
    if (!recordingBlob || uploading) return;
    uploading = true; saveButton.disabled = true; recordButton.disabled = true; setStatus("Sending voice message…");
    try {
      const form = new FormData();
      const type = recordingBlob.type.toLowerCase();
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("mpeg") ? "mp3" : type.includes("wav") ? "wav" : "webm";
      form.append("audio", recordingBlob, "voice-message." + ext);
      form.append("title", titleInput.value.trim() || "Voice message");
      form.append("duration_seconds", String(recordingDuration));
      const response = await fetch("/api/audio", {method:"POST", body:form});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Upload failed.");
      resetPreview(); titleInput.value = ""; setStatus("Voice message sent"); await loadRecordings();
    } catch (error) {
      setStatus(error.message || "Could not save the recording.");
      saveButton.disabled = false; recordButton.disabled = false;
    } finally { uploading = false; }
  }

  function renderRecording(item) {
    const card = document.createElement("article"); card.className = "recording-card";
    const top = document.createElement("div"); top.className = "recording-top";
    const info = document.createElement("div");
    const title = document.createElement("div"); title.className = "recording-title"; title.textContent = item.title || "Voice message";
    const meta = document.createElement("div"); meta.className = "recording-meta";
    meta.textContent = (item.created_at ? new Date(item.created_at).toLocaleString() : "Date unavailable") + " · " + formatTime(item.duration_seconds);
    info.append(title, meta); top.appendChild(info);
    if (item.can_delete) {
      const del = document.createElement("button"); del.type = "button"; del.className = "delete-button"; del.textContent = "Delete";
      del.addEventListener("click", async () => {
        if (!confirm("Delete this recording? This cannot be undone.")) return;
        del.disabled = true;
        try {
          const response = await fetch("/api/audio/" + encodeURIComponent(item.id), {method:"DELETE"});
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || "Could not delete recording.");
          await loadRecordings();
        } catch (error) { alert(error.message || "Could not delete recording."); del.disabled = false; }
      });
      top.appendChild(del);
    }
    const audio = document.createElement("audio"); audio.controls = true; audio.preload = "none"; audio.src = item.url || "";
    audio.setAttribute("aria-label", "Play " + (item.title || "voice message"));
    card.append(top, audio); return card;
  }

  async function loadRecordings() {
    listStatus.textContent = "Loading recordings…"; listStatus.classList.remove("error-text"); recordingList.replaceChildren();
    try {
      const response = await fetch("/api/audio", {headers:{Accept:"application/json"}, cache:"no-store"});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load recordings.");
      const messages = data.messages || [];
      if (!messages.length) {
        listStatus.textContent = "No voice messages yet. Record and send the first one!";
        const empty = document.createElement("div"); empty.className = "empty-state"; empty.textContent = "Sent voice messages will appear here."; recordingList.appendChild(empty);
      } else {
        listStatus.textContent = messages.length + " voice message" + (messages.length === 1 ? "" : "s");
        messages.forEach(item => recordingList.appendChild(renderRecording(item)));
      }
    } catch (error) { listStatus.textContent = error.message || "Could not load saved recordings."; listStatus.classList.add("error-text"); }
  }

  recordButton.addEventListener("click", startRecording);
  stopButton.addEventListener("click", stopRecording);
  saveButton.addEventListener("click", saveRecording);
  discardButton.addEventListener("click", () => {
    if (recorder && recorder.state === "recording") stopRecording();
    resetPreview(); setStatus("Recording discarded");
  });
  $("refreshButton").addEventListener("click", loadRecordings);
  window.addEventListener("beforeunload", () => { clearInterval(timerHandle); releaseStream(); if (previewUrl) URL.revokeObjectURL(previewUrl); });
  loadRecordings();
})();
