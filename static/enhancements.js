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

  function refreshChatFromServer() {
    if (socket?.connected) socket.emit("request_history");
  }

  function sortMessagesById() {
    if (!chatBox) return;
    const messages = [...chatBox.querySelectorAll(".message")];
    messages.sort((a, b) => Number(a.dataset.messageId || 0) - Number(b.dataset.messageId || 0));
    messages.forEach(message => chatBox.appendChild(message));
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  if (chatBox) {
  }

  if (socket) {
    socket.on("chat_history", history => {
      const rows = history || [];
      setTimeout(() => {
        sortMessagesById();
      }, 0);
    });

    socket.on("new_message", data => {
      setTimeout(() => {
        sortMessagesById();
      }, 0);
    });

    // Protect/unprotect is persisted server-side. Refresh the message list after
    // the server confirms the change so the badge and controls match the DB.
    socket.on("message_protection_changed", () => {
      setTimeout(refreshChatFromServer, 25);
    });

    // Keep the visible chat synchronized after single or bulk deletes.
    socket.on("message_deleted", () => {
      setTimeout(refreshChatFromServer, 25);
    });
    socket.on("messages_deleted", () => {
      setTimeout(refreshChatFromServer, 25);
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
      const response = await fetch("/api/ai/memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memory: value }) });
      if (!response.ok) { console.error("Could not save memory", await response.text()); return; }
      input.value = ""; loadMemory();
    });
    modal.querySelector(".memory-clear").addEventListener("click", async () => {
      if (!confirm("Clear all WAI memories?")) return;
      await fetch("/api/ai/memory", { method: "DELETE" }); loadMemory();
    });
  }
})();