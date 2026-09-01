(() => {
  const socket = window.socket || (typeof io === "function" ? io() : null);
  const chatBox = document.getElementById("chat-box");
  const messageInput = document.getElementById("message");
  const usernameInput = document.getElementById("username");
  const header = document.querySelector("header");
  const aiHeaderActions = document.querySelector(".ai-header-actions");

  if (header) {
    const presence = document.createElement("div");
    presence.id = "presenceStatus";
    presence.className = "presence-status";
    presence.innerHTML = '<span class="presence-dot"></span><span>Online: 0</span>';
    header.appendChild(presence);
  }

  if (chatBox) {
    const typing = document.createElement("div");
    typing.id = "typingIndicator";
    typing.className = "typing-indicator";
    chatBox.parentElement?.insertBefore(typing, chatBox.nextSibling);
  }

  let typingTimer;
  let lastTyping = false;
  function setTyping(value) {
    if (!socket) return;
    const name = usernameInput?.value.trim() || "Guest";
    if (value === lastTyping) return;
    lastTyping = value;
    socket.emit("typing", { username: name, typing: value });
  }
  messageInput?.addEventListener("input", () => {
    setTyping(true);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => setTyping(false), 900);
  });
  messageInput?.addEventListener("blur", () => setTyping(false));

  if (socket) {
    socket.on("presence_update", data => {
      const status = document.getElementById("presenceStatus");
      if (status) status.innerHTML = `<span class="presence-dot"></span><span>Online: ${Number(data.online) || 0}</span>`;
    });
    socket.on("user_typing", data => {
      const el = document.getElementById("typingIndicator");
      if (!el) return;
      if (data.typing) {
        el.textContent = `${data.username || "Someone"} is typing…`;
        el.classList.add("show");
      } else {
        el.classList.remove("show");
      }
    });
  }

  const reactionChoices = ["👍", "❤️", "😂", "😮", "😢", "🔥"];
  function renderReactionCounts(message, reactions) {
    if (!message) return;
    let counts = message.querySelector(".reaction-counts");
    if (!counts) {
      counts = document.createElement("div");
      counts.className = "reaction-counts";
      message.appendChild(counts);
    }
    counts.innerHTML = "";
    Object.entries(reactions || {}).forEach(([emoji, count]) => {
      const chip = document.createElement("span");
      chip.className = "reaction-chip";
      chip.textContent = `${emoji} ${count}`;
      counts.appendChild(chip);
    });
    if (!Object.keys(reactions || {}).length) counts.remove();
  }

  const addReactionUI = message => {
    if (!message || message.dataset.messageId === undefined || message.querySelector(".reaction-bar") || message.classList.contains("server-message")) return;
    const bar = document.createElement("div");
    bar.className = "reaction-bar";
    reactionChoices.forEach(emoji => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "reaction-button";
      button.dataset.emoji = emoji;
      button.title = `React ${emoji}`;
      button.textContent = emoji;
      button.addEventListener("click", event => {
        event.stopPropagation();
        socket?.emit("toggle_reaction", { message_id: Number(message.dataset.messageId), emoji });
      });
      bar.appendChild(button);
    });
    message.appendChild(bar);
  };

  async function loadPersistedReactions(ids) {
    const cleanIds = [...new Set((ids || []).map(Number).filter(Number.isInteger).filter(id => id > 0))];
    if (!cleanIds.length) return;
    try {
      const response = await fetch(`/api/reactions?ids=${encodeURIComponent(cleanIds.join(","))}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      Object.entries(data.reactions || {}).forEach(([id, reactions]) => {
        const message = document.querySelector(`.message[data-message-id="${CSS.escape(String(id))}"]`);
        if (message) renderReactionCounts(message, reactions);
      });
    } catch (error) {
      console.error("Reaction history error:", error);
    }
  }

  if (chatBox) {
    new MutationObserver(() => chatBox.querySelectorAll(".message").forEach(addReactionUI)).observe(chatBox, { childList: true });
    chatBox.querySelectorAll(".message").forEach(addReactionUI);
  }
  if (socket) {
    socket.on("message_reactions", data => {
      const message = document.querySelector(`.message[data-message-id="${CSS.escape(String(data.message_id))}"]`);
      if (message) renderReactionCounts(message, data.reactions || {});
    });
    socket.on("chat_history", history => {
      setTimeout(() => loadPersistedReactions((history || []).map(msg => msg[0])), 0);
    });
    socket.on("new_message", data => {
      setTimeout(() => loadPersistedReactions([data.id]), 0);
    });
  }

  if (aiHeaderActions) {
    const memoryButton = document.createElement("button");
    memoryButton.type = "button";
    memoryButton.className = "ai-memory-button";
    memoryButton.textContent = "Memory";
    aiHeaderActions.insertBefore(memoryButton, aiHeaderActions.firstChild);

    const modal = document.createElement("div");
    modal.className = "memory-modal";
    modal.innerHTML = `
      <div class="memory-card">
        <div class="memory-card-header"><strong>WAI Memory</strong><button type="button" class="memory-close">×</button></div>
        <p class="memory-help">Saved memories are separate from chat history.</p>
        <div class="memory-add"><input maxlength="500" placeholder="Add something WAI should remember…"><button type="button">Add</button></div>
        <div class="memory-list"></div>
        <button type="button" class="memory-clear">Clear all memories</button>
      </div>`;
    document.body.appendChild(modal);
    const list = modal.querySelector(".memory-list");
    const input = modal.querySelector(".memory-add input");

    async function loadMemory() {
      const response = await fetch("/api/ai/memory", { cache: "no-store" });
      const data = await response.json();
      list.innerHTML = "";
      (data.memories || []).forEach(memory => {
        const row = document.createElement("div"); row.className = "memory-row";
        const text = document.createElement("span"); text.textContent = memory.memory;
        const del = document.createElement("button"); del.type = "button"; del.textContent = "×";
        del.addEventListener("click", async () => { await fetch(`/api/ai/memory/${memory.id}`, { method: "DELETE" }); loadMemory(); });
        row.append(text, del); list.appendChild(row);
      });
      if (!list.children.length) list.innerHTML = '<div class="memory-empty">No memories saved.</div>';
    }
    memoryButton.addEventListener("click", () => { modal.classList.add("open"); loadMemory(); });
    modal.querySelector(".memory-close").addEventListener("click", () => modal.classList.remove("open"));
    modal.addEventListener("click", event => { if (event.target === modal) modal.classList.remove("open"); });
    modal.querySelector(".memory-add button").addEventListener("click", async () => {
      const value = input.value.trim(); if (!value) return;
      await fetch("/api/ai/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memory: value }) });
      input.value = ""; loadMemory();
    });
    modal.querySelector(".memory-clear").addEventListener("click", async () => {
      if (!confirm("Clear all WAI memories?")) return;
      await fetch("/api/ai/memory", { method: "DELETE" }); loadMemory();
    });
  }
})();