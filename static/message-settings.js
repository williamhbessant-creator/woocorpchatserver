(() => {
  "use strict";
  const KEY = "woocorpMessageColors";
  const defaults = { dark: {time:"#a6abc1",person:"#b9a5ff",message:"#d8c9ff"}, light: {time:"#74728a",person:"#6848d1",message:"#6549b8"} };
  const dialog = document.getElementById("messageSettingsDialog");
  const openButton = document.getElementById("messageSettingsButton");
  if (!dialog || !openButton) return;
  const closeButton = document.getElementById("closeMessageSettings");
  const inputs = { time: document.getElementById("messageTimeColor"), person: document.getElementById("messagePersonColor"), message: document.getElementById("messageTextColor") };
  const preview = { time: document.getElementById("messagePreviewTime"), person: document.getElementById("messagePreviewPerson"), message: document.getElementById("messagePreviewText") };
  const status = document.getElementById("messageSettingsStatus");
  function theme() { return localStorage.getItem("chatTheme") === "light" ? "light" : "dark"; }
  function defaultsForTheme() { return Object.assign({}, defaults[theme()]); }
  function readSaved() { try { const value = JSON.parse(localStorage.getItem(KEY) || "null"); if (value && ["time","person","message"].every(k => /^#[0-9a-f]{6}$/i.test(value[k] || ""))) return value; } catch (error) { console.warn("Could not read message colours", error); } return defaultsForTheme(); }
  function values() { return { time: inputs.time.value, person: inputs.person.value, message: inputs.message.value }; }
  function apply(colors) { document.documentElement.style.setProperty("--chat-message-time-color", colors.time); document.documentElement.style.setProperty("--chat-message-person-color", colors.person); document.documentElement.style.setProperty("--chat-message-text-color", colors.message); preview.time.style.color = colors.time; preview.person.style.color = colors.person; preview.message.style.color = colors.message; }
  function load() { const colors = readSaved(); Object.keys(inputs).forEach(k => inputs[k].value = colors[k]); apply(colors); }
  function close() { dialog.hidden = true; openButton.focus(); }
  openButton.addEventListener("click", () => { load(); status.textContent = ""; dialog.hidden = false; closeButton.focus(); });
  closeButton.addEventListener("click", close);
  dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && !dialog.hidden) close(); });
  Object.values(inputs).forEach(input => input.addEventListener("input", () => apply(values())));
  document.getElementById("saveMessageColors").addEventListener("click", () => { const colors = values(); localStorage.setItem(KEY, JSON.stringify(colors)); apply(colors); status.textContent = "Your message colours have been saved on this device."; });
  document.getElementById("resetMessageColors").addEventListener("click", () => { const colors = defaultsForTheme(); Object.keys(inputs).forEach(k => inputs[k].value = colors[k]); localStorage.removeItem(KEY); apply(colors); status.textContent = "Default colours restored."; });
  load();
})();