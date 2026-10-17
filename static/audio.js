(() => {
  const $ = id => document.getElementById(id);
  const button = $("voiceRecordButton");
  const panel = $("inlineVoiceComposer");
  const stopButton = $("inlineVoiceStop");
  const sendButton = $("inlineVoiceSend");
  const discardButton = $("inlineVoiceDiscard");
  const preview = $("inlineVoicePreview");
  const status = $("inlineVoiceStatus");
  const dot = $("inlineVoiceDot");
  const timer = $("inlineVoiceTimer");
  if (!button || !panel) return;

  let recorder = null, stream = null, chunks = [], blob = null, previewUrl = null;
  let startedAt = 0, duration = 0, timerHandle = null, uploading = false;

  const formatTime = seconds => {
    seconds = Math.max(0, Math.floor(Number(seconds) || 0));
    return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  };
  const setStatus = value => { status.textContent = value; };
  const releaseStream = () => { if (stream) stream.getTracks().forEach(track => track.stop()); stream = null; };
  const supportedMime = () => {
    if (!window.MediaRecorder) return "";
    return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"].find(type => MediaRecorder.isTypeSupported(type)) || "";
  };
  function resetPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null; blob = null; preview.removeAttribute("src"); preview.load();
    preview.hidden = true; discardButton.hidden = true; sendButton.disabled = true;
    timer.textContent = "00:00"; button.disabled = false;
  }
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      panel.hidden = false; setStatus("Voice recording is not supported in this browser."); return;
    }
    try {
      resetPreview(); panel.hidden = false;
      stream = await navigator.mediaDevices.getUserMedia({audio:true});
      chunks = [];
      const mimeType = supportedMime();
      recorder = new MediaRecorder(stream, mimeType ? {mimeType} : undefined);
      recorder.addEventListener("dataavailable", event => { if (event.data?.size) chunks.push(event.data); });
      recorder.addEventListener("stop", () => {
        clearInterval(timerHandle); timerHandle = null; releaseStream();
        duration = Math.min(180, Math.round((Date.now() - startedAt) / 1000));
        blob = new Blob(chunks, {type:recorder.mimeType || (chunks[0]?.type) || "audio/webm"});
        previewUrl = URL.createObjectURL(blob); preview.src = previewUrl; preview.hidden = false;
        discardButton.hidden = false; sendButton.disabled = false; stopButton.disabled = true;
        button.disabled = false; dot.classList.remove("recording"); setStatus("Preview your voice message, then send it");
        timer.textContent = formatTime(duration);
      });
      recorder.start(250); startedAt = Date.now();
      button.disabled = true; stopButton.disabled = false; setStatus("Recording… tap Stop when finished");
      dot.classList.add("recording"); timer.textContent = "00:00";
      timerHandle = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        timer.textContent = formatTime(elapsed);
        if (elapsed >= 180 && recorder?.state === "recording") recorder.stop();
      }, 250);
    } catch (error) {
      releaseStream(); setStatus(error.name === "NotAllowedError" ? "Microphone permission was denied." : "Could not start the microphone.");
      panel.hidden = false; button.disabled = false;
    }
  }
  function stopRecording() { if (recorder?.state === "recording") recorder.stop(); stopButton.disabled = true; }
  async function sendVoiceMessage() {
    if (!blob || uploading) return;
    const username = $("username").value.trim();
    if (!username) { setStatus("Enter a username before sending."); $("username").focus(); return; }
    uploading = true; sendButton.disabled = true; button.disabled = true; setStatus("Sending voice message…");
    try {
      const form = new FormData();
      const type = blob.type.toLowerCase();
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : type.includes("mpeg") ? "mp3" : type.includes("wav") ? "wav" : "webm";
      form.append("audio", blob, "voice-message." + ext);
      form.append("title", "Voice message");
      form.append("duration_seconds", String(duration));
      const response = await fetch("/api/audio", {method:"POST", body:form});
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.message?.url) throw new Error(data.error || "Could not upload voice message.");
      const marker = "[[VOICE_MESSAGE|" + data.message.url + "|" + duration + "]]";
      window.socket.emit("send_message", {username, message:marker});
      resetPreview(); panel.hidden = true; setStatus("Voice message sent");
    } catch (error) {
      setStatus(error.message || "Could not send voice message."); sendButton.disabled = false;
    } finally { uploading = false; button.disabled = false; }
  }
  button.addEventListener("click", startRecording);
  stopButton.addEventListener("click", stopRecording);
  sendButton.addEventListener("click", sendVoiceMessage);
  discardButton.addEventListener("click", () => { if (recorder?.state === "recording") stopRecording(); resetPreview(); panel.hidden = true; setStatus("Recording discarded"); });
  window.addEventListener("beforeunload", () => { clearInterval(timerHandle); releaseStream(); if (previewUrl) URL.revokeObjectURL(previewUrl); });
})();