const socket = io({
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
});

const chatBox = document.getElementById("chat-box");
const username = document.getElementById("username");
const message = document.getElementById("message");
const sendButton = document.getElementById("sendButton");
const clearButton = document.getElementById("clearButton");
const themeButton = document.getElementById("themeButton");
const themeStylesheet = document.getElementById("themeStylesheet");

function applyTheme(theme) {
    if (theme === "light") themeStylesheet.href = "/static/lightstyle.css";
    else { themeStylesheet.href = "/static/darkstyle.css"; theme = "dark"; }
    localStorage.setItem("chatTheme", theme);
}
function toggleTheme() { applyTheme((localStorage.getItem("chatTheme") || "dark") === "dark" ? "light" : "dark"); }
themeButton.addEventListener("click", toggleTheme);
applyTheme(localStorage.getItem("chatTheme") || "dark");

const aiOpenButton = document.getElementById("aiOpenButton");
const aiCloseButton = document.getElementById("aiCloseButton");
const aiSidebar = document.getElementById("aiSidebar");
const aiOverlay = document.getElementById("aiOverlay");
const aiForm = document.getElementById("aiForm");
const aiInput = document.getElementById("aiInput");
const aiMessages = document.getElementById("aiMessages");
const aiSendButton = document.getElementById("aiSendButton");
const aiConversation = [];
let aiUsesRemaining = Infinity;
let aiUsesElement = null;
let lastAITrigger = null;
let userMessageCount = 0;
const AI_REQUIRED_MESSAGES = 2;
let aiUnlocked = false;
let aiInfinite = false;

// The server is authoritative. Infinite permission comes from /api/ai/usage,
// never from localStorage or a value supplied by the browser.
function updateAIAccess(count, infinite = aiInfinite) {
    userMessageCount = Math.max(0, Number(count) || 0);
    aiInfinite = Boolean(infinite);
    aiUnlocked = aiInfinite || userMessageCount >= AI_REQUIRED_MESSAGES;
    aiOpenButton.disabled = !aiUnlocked;
    aiOpenButton.title = aiUnlocked
        ? (aiInfinite ? "Open AI assistant — unlimited access" : "Open AI assistant")
        : `Send ${AI_REQUIRED_MESSAGES - userMessageCount} more message${AI_REQUIRED_MESSAGES - userMessageCount === 1 ? "" : "s"} to unlock AI`;
    aiOpenButton.setAttribute("aria-disabled", aiUnlocked ? "false" : "true");
    if (!aiUnlocked) {
        aiInput.disabled = true;
        aiSendButton.disabled = true;
        aiInput.placeholder = `Send ${AI_REQUIRED_MESSAGES - userMessageCount} more message${AI_REQUIRED_MESSAGES - userMessageCount === 1 ? "" : "s"} in chat to unlock AI`;
    } else if (!aiSendButton.dataset.loading && aiUsesRemaining !== 0) {
        aiInput.disabled = false;
        aiSendButton.disabled = false;
        aiInput.placeholder = "Ask the AI...";
    }
}

function updateUsesRemaining(remaining) {
    if (remaining === "∞" || remaining === Infinity || (remaining && remaining.unlimited)) aiUsesRemaining = Infinity;
    else if (typeof remaining === "number") aiUsesRemaining = Math.max(0, remaining);
    else return;
    if (!aiUsesElement) aiUsesElement = document.getElementById("aiUsesRemaining");
    if (!aiUsesElement) {
        aiUsesElement = document.createElement("div");
        aiUsesElement.id = "aiUsesRemaining";
        aiUsesElement.className = "ai-uses-remaining";
        aiForm.appendChild(aiUsesElement);
    }
    aiUsesElement.textContent = aiUsesRemaining === Infinity ? "∞ AI uses remaining" : `${aiUsesRemaining} AI uses remaining`;
    if (aiUsesRemaining === 0) {
        aiInput.disabled = true; aiSendButton.disabled = true; aiInput.placeholder = "No AI uses remaining";
    } else if (aiUnlocked && !aiSendButton.dataset.loading) {
        aiInput.disabled = false; aiSendButton.disabled = false; aiInput.placeholder = "Ask the AI...";
    }
}

async function loadAIUses() {
    try {
        const response = await fetch("/api/ai/usage", { headers: { "Accept": "application/json" }, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load AI usage.");

        // IMPORTANT: pass the server's infinite flag into the access check.
        // Previously the client ignored this value, so infinite users stayed locked.
        updateAIAccess(data.message_count || 0, data.infinite === true);
        updateUsesRemaining(data.uses_remaining);
    } catch (error) {
        console.error("AI usage error:", error);
        // Fail closed: an unavailable permission check must NOT grant access.
        aiInfinite = false;
        updateAIAccess(0, false);
        updateUsesRemaining(0);
    }
}

function openAI() {
    if (!aiUnlocked) {
        alert(`Send ${AI_REQUIRED_MESSAGES - userMessageCount} more message${AI_REQUIRED_MESSAGES - userMessageCount === 1 ? "" : "s"} in the public chat before using the AI.`);
        return;
    }
    lastAITrigger = document.activeElement;
    aiSidebar.classList.add("open"); aiOverlay.classList.add("open");
    aiSidebar.setAttribute("aria-hidden", "false"); aiOverlay.setAttribute("aria-hidden", "false");
    loadAIUses(); setTimeout(() => aiInput.focus(), 250);
}
function closeAI() {
    const focusTarget = lastAITrigger && document.contains(lastAITrigger) ? lastAITrigger : aiOpenButton;
    if (aiSidebar.contains(document.activeElement)) {
        if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus({ preventScroll: true });
        else document.activeElement?.blur();
    }
    aiSidebar.classList.remove("open"); aiOverlay.classList.remove("open");
    aiSidebar.setAttribute("aria-hidden", "true"); aiOverlay.setAttribute("aria-hidden", "true");
}
aiOpenButton.addEventListener("click", openAI);
aiCloseButton.addEventListener("click", closeAI);
aiOverlay.addEventListener("click", closeAI);
document.addEventListener("keydown", event => { if (event.key === "Escape") closeAI(); });

function addAIMessage(text, type) {
    const div = document.createElement("div"); div.className = `ai-message ai-message-${type}`;
    const name = document.createElement("div"); name.className = "ai-message-name";
    name.textContent = type === "user" ? "You" : "AI Assistant";
    const body = document.createElement("div"); body.textContent = text;
    div.appendChild(name); div.appendChild(body); aiMessages.appendChild(div);
    aiMessages.scrollTop = aiMessages.scrollHeight; return div;
}
function setAILoading(loading) {
    aiSendButton.dataset.loading = loading ? "true" : "false";
    aiSendButton.disabled = loading || !aiUnlocked; aiInput.disabled = loading || !aiUnlocked; aiSendButton.textContent = loading ? "..." : "Send";
}
async function sendAIMessage() {
    const text = aiInput.value.trim();
    if (!aiUnlocked) {
        alert(`Send ${AI_REQUIRED_MESSAGES - userMessageCount} more message${AI_REQUIRED_MESSAGES - userMessageCount === 1 ? "" : "s"} in the public chat before using the AI.`);
        return;
    }
    if (!text || aiSendButton.disabled) return;
    addAIMessage(text, "user"); aiConversation.push({ role: "user", content: text }); aiInput.value = "";
    setAILoading(true); const loadingMessage = addAIMessage("Thinking...", "assistant");
    try {
        const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, history: aiConversation.slice(-12) }) });
        const data = await response.json(); loadingMessage.remove();
        if (typeof data.message_count === "number") updateAIAccess(data.message_count, data.infinite === true || aiInfinite);
        if (typeof data.uses_remaining === "number" || data.uses_remaining === "∞") updateUsesRemaining(data.uses_remaining);
        if (!response.ok) throw new Error(data.error || "AI request failed.");
        const reply = data.response || "The AI returned an empty response.";
        addAIMessage(reply, "assistant"); aiConversation.push({ role: "assistant", content: reply });
    } catch (error) { loadingMessage.remove(); addAIMessage(error.message, "assistant"); console.error("AI request error:", error); }
    finally { setAILoading(false); aiInput.focus(); }
}
aiForm.addEventListener("submit", event => { event.preventDefault(); sendAIMessage(); });
aiInput.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); aiForm.requestSubmit(); } });

function escapeHtml(text) { const div = document.createElement("div"); div.textContent = text; return div.innerHTML; }
let activeMessageMenu = null;
function closeMessageMenu() {
    if (activeMessageMenu) { activeMessageMenu.remove(); activeMessageMenu = null; }
    document.querySelectorAll(".message.message-selected").forEach(el => el.classList.remove("message-selected"));
}
function iconButton(label, icon, className, title, onClick, disabled = false) {
    const button = document.createElement("button"); button.type = "button"; button.className = className; button.title = title;
    button.setAttribute("aria-label", title); button.innerHTML = `<span class="message-action-icon" aria-hidden="true">${icon}</span><span class="message-action-label">${label}</span>`;
    button.disabled = disabled; button.addEventListener("click", event => { event.stopPropagation(); onClick(); }); return button;
}

function showMessageMenu(div, id, protectedMessage) {
    closeMessageMenu(); div.classList.add("message-selected");
    const menu = document.createElement("div"); menu.className = "message-actions";
    const protectButton = iconButton(protectedMessage ? "Unprotect" : "Protect", "🛡", "message-action-protect", protectedMessage ? "Unprotect message" : "Protect from deletion", () => {
        socket.emit("toggle_message_protection", { id }); closeMessageMenu();
    });
    const deleteButton = iconButton("Delete", "🗑", "message-action-delete", protectedMessage ? "Protected message" : "Delete message", () => {
        if (!protectedMessage && confirm("Delete this message?")) socket.emit("delete_message", { id });
        closeMessageMenu();
    }, protectedMessage);
    menu.appendChild(protectButton); menu.appendChild(deleteButton); div.appendChild(menu); activeMessageMenu = menu;
}

function addMessage(id, user, text, time, protectedMessage = false, canManage = false) {
    const div = document.createElement("div");
    div.className = user === "[SERVER]" ? "message server-message" : "message";
    div.dataset.messageId = id; div.dataset.protected = protectedMessage ? "true" : "false"; div.dataset.canManage = canManage ? "true" : "false";
    div.innerHTML = `<span class="time">[${escapeHtml(time)}]</span> <span class="user">${escapeHtml(user)}</span>: <span class="text">${escapeHtml(text)}</span>`;
    if (protectedMessage) {
        const badge = document.createElement("span"); badge.className = "protected-badge"; badge.textContent = " Protected"; div.appendChild(badge);
    }
    if (canManage) {
        div.addEventListener("click", event => {
            if (event.target.closest(".message-actions")) return;
            showMessageMenu(div, id, div.dataset.protected === "true");
        });
    }
    chatBox.appendChild(div); chatBox.scrollTop = chatBox.scrollHeight;
}
function updateMessageProtection(id, protectedMessage) {
    const div = document.querySelector(`.message[data-message-id="${CSS.escape(String(id))}"]`);
    if (!div) return;
    div.dataset.protected = protectedMessage ? "true" : "false";
    div.querySelector(".protected-badge")?.remove();
    if (protectedMessage) {
        const badge = document.createElement("span"); badge.className = "protected-badge"; badge.textContent = " Protected"; div.appendChild(badge);
    }
}

socket.on("connect", () => { console.log("Connected to chat server", socket.id); socket.emit("request_history"); loadAIUses(); });
socket.on("disconnect", reason => { console.log("Disconnected from chat server:", reason); if (reason === "io server disconnect") socket.connect(); });
socket.on("connect_error", error => console.error("Socket.IO connection error:", error));
socket.io.on("reconnect_attempt", attempt => console.log("Chat server reconnect attempt:", attempt));
socket.io.on("reconnect", attempt => { console.log("Reconnected to chat server after", attempt, "attempt(s)"); socket.emit("request_history"); loadAIUses(); });
socket.io.on("reconnect_error", error => console.error("Chat server reconnect error:", error));
socket.io.on("reconnect_failed", () => console.error("Could not reconnect to chat server."));
window.addEventListener("pageshow", event => { if (event.persisted) { if (!socket.connected) socket.connect(); loadAIUses(); } });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !socket.connected) socket.connect(); });

socket.on("chat_history", history => {
    closeMessageMenu(); chatBox.innerHTML = "";
    history.forEach(msg => addMessage(msg[0], msg[1], msg[2], msg[3], msg[4], msg[5]));
});
socket.on("new_message", data => addMessage(data.id, data.username, data.message, data.timestamp, data.protected, data.can_manage));
socket.on("message_count_updated", data => updateAIAccess(data.message_count, aiInfinite));
socket.on("message_deleted", data => { closeMessageMenu(); const div = document.querySelector(`.message[data-message-id="${CSS.escape(String(data.id))}"]`); if (div) div.remove(); });
socket.on("message_protection_changed", data => updateMessageProtection(data.id, data.protected));
socket.on("message_action_error", data => alert(data.error || "The message action could not be completed."));
socket.on("history_cleared", () => { closeMessageMenu(); document.querySelectorAll(".message:not([data-protected='true'])").forEach(div => div.remove()); loadAIUses(); });

function sendMessage() {
    const user = username.value.trim(), text = message.value.trim();
    if (!user) { alert("Please enter a username."); username.focus(); return; }
    if (!text) { message.focus(); return; }
    if (!socket.connected) { alert("Chat server is reconnecting. Please try again in a moment."); socket.connect(); return; }
    socket.emit("send_message", { username: user, message: text }); message.value = ""; message.focus();
}
sendButton.addEventListener("click", sendMessage);
message.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); sendMessage(); } });
clearButton.addEventListener("click", () => { if (confirm("Clear the chat? Protected messages will stay.")) socket.emit("clear_history"); });
document.addEventListener("click", event => { if (!event.target.closest(".message")) closeMessageMenu(); });

updateAIAccess(0, false);
loadAIUses();
