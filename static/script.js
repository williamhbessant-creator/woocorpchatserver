window.socket = io({
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
});
const socket = window.socket;

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
const aiHistory = document.getElementById("aiHistory");
const newAIChatButton = document.getElementById("newAIChatButton");
const aiChatTitle = document.getElementById("aiChatTitle");
let currentAIConversationId = null;
let aiUsesRemaining = Infinity;
let aiUsesElement = null;
let lastAITrigger = null;
let userMessageCount = 0;
const AI_REQUIRED_MESSAGES = 2;
let aiUnlocked = false;
let aiInfinite = false;

function updateAIAccess(count, infinite = aiInfinite) {
    userMessageCount = Math.max(0, Number(count) || 0);
    aiInfinite = Boolean(infinite);
    aiUnlocked = aiInfinite || userMessageCount >= AI_REQUIRED_MESSAGES;
    aiOpenButton.disabled = !aiUnlocked;
    aiOpenButton.title = aiUnlocked ? (aiInfinite ? "Open AI assistant — unlimited access" : "Open AI assistant") : `Send ${AI_REQUIRED_MESSAGES - userMessageCount} more message${AI_REQUIRED_MESSAGES - userMessageCount === 1 ? "" : "s"} to unlock AI`;
    aiOpenButton.setAttribute("aria-disabled", aiUnlocked ? "false" : "true");
    if (!aiUnlocked) { aiInput.disabled = true; aiSendButton.disabled = true; aiInput.placeholder = `Send ${AI_REQUIRED_MESSAGES - userMessageCount} more message${AI_REQUIRED_MESSAGES - userMessageCount === 1 ? "" : "s"} in chat to unlock AI`; }
    else if (!aiSendButton.dataset.loading && aiUsesRemaining !== 0) { aiInput.disabled = false; aiSendButton.disabled = false; aiInput.placeholder = "Ask WAI..."; }
}
function updateUsesRemaining(remaining) {
    if (remaining === "∞" || remaining === Infinity || (remaining && remaining.unlimited)) aiUsesRemaining = Infinity;
    else if (typeof remaining === "number") aiUsesRemaining = Math.max(0, remaining);
    else return;
    if (!aiUsesElement) aiUsesElement = document.getElementById("aiUsesRemaining");
    if (!aiUsesElement) return;
    aiUsesElement.textContent = aiUsesRemaining === Infinity ? "∞ AI uses remaining" : `${aiUsesRemaining} AI uses remaining`;
    if (aiUsesRemaining === 0) { aiInput.disabled = true; aiSendButton.disabled = true; aiInput.placeholder = "No AI uses remaining"; }
    else if (aiUnlocked && !aiSendButton.dataset.loading) { aiInput.disabled = false; aiSendButton.disabled = false; aiInput.placeholder = "Ask WAI..."; }
}
async function loadAIUses() {
    try { const response = await fetch("/api/ai/usage", { headers: { "Accept": "application/json" }, cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load AI usage."); updateAIAccess(data.message_count || 0, data.infinite === true); updateUsesRemaining(data.uses_remaining); }
    catch (error) { console.error("AI usage error:", error); aiInfinite = false; updateAIAccess(0, false); updateUsesRemaining(0); }
}
function resetAIMessages(title = "New Chat") { aiChatTitle.textContent = title; aiMessages.innerHTML = ""; addAIMessage("Hello! How can I help?", "assistant"); }
function addAIMessage(text, type) { const div = document.createElement("div"); div.className = `ai-message ai-message-${type}`; const name = document.createElement("div"); name.className = "ai-message-name"; name.textContent = type === "user" ? "You" : "WAI"; const body = document.createElement("div"); body.textContent = text; div.append(name, body); aiMessages.appendChild(div); aiMessages.scrollTop = aiMessages.scrollHeight; return div; }
function renderAIHistory(conversations) { aiHistory.innerHTML = ""; if (!conversations.length) { const empty = document.createElement("div"); empty.className = "ai-history-empty"; empty.textContent = "No saved chats yet."; aiHistory.appendChild(empty); return; } conversations.forEach(chat => { const item = document.createElement("div"); item.className = "ai-history-item" + (String(chat.id) === String(currentAIConversationId) ? " active" : ""); const main = document.createElement("button"); main.type = "button"; main.className = "ai-history-main"; main.title = chat.title; const title = document.createElement("span"); title.className = "ai-history-title"; title.textContent = chat.title || "New Chat"; const date = document.createElement("span"); date.className = "ai-history-date"; date.textContent = chat.updated_at ? new Date(chat.updated_at).toLocaleDateString() : ""; main.append(title, date); main.addEventListener("click", () => loadAIConversation(chat.id, chat.title)); const actions = document.createElement("div"); actions.className = "ai-history-actions"; const rename = document.createElement("button"); rename.type = "button"; rename.className = "ai-history-action"; rename.textContent = "✎"; rename.title = "Rename chat"; rename.addEventListener("click", async event => { event.stopPropagation(); const next = prompt("Rename this AI chat:", chat.title || "New Chat"); if (next === null) return; const name = next.trim(); if (!name) return; const response = await fetch(`/api/ai/history/${encodeURIComponent(chat.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: name }) }); if (!response.ok) { const data = await response.json().catch(() => ({})); alert(data.error || "Could not rename the chat."); return; } if (String(chat.id) === String(currentAIConversationId)) aiChatTitle.textContent = name; loadAIHistory(); }); const del = document.createElement("button"); del.type = "button"; del.className = "ai-history-action ai-history-delete"; del.textContent = "🗑"; del.title = "Delete chat"; del.addEventListener("click", async event => { event.stopPropagation(); if (!confirm(`Delete "${chat.title || "New Chat"}"?`)) return; const response = await fetch(`/api/ai/history/${encodeURIComponent(chat.id)}`, { method: "DELETE" }); if (!response.ok) { const data = await response.json().catch(() => ({})); alert(data.error || "Could not delete the chat."); return; } if (String(chat.id) === String(currentAIConversationId)) { currentAIConversationId = null; resetAIMessages(); } loadAIHistory(); }); actions.append(rename, del); item.append(main, actions); aiHistory.appendChild(item); }); }
async function loadAIHistory() { try { const response = await fetch("/api/ai/history", { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load AI history."); renderAIHistory(data.conversations || []); } catch (error) { console.error("AI history error:", error); aiHistory.innerHTML = ""; const empty = document.createElement("div"); empty.className = "ai-history-empty"; empty.textContent = "Could not load chat history."; aiHistory.appendChild(empty); } }
async function loadAIConversation(id, title = "New Chat") { try { const response = await fetch(`/api/ai/history/${encodeURIComponent(id)}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load that chat."); currentAIConversationId = id; aiChatTitle.textContent = title || "New Chat"; aiMessages.innerHTML = ""; const messages = data.messages || []; if (!messages.length) addAIMessage("Hello! How can I help?", "assistant"); messages.forEach(item => addAIMessage(item.content, item.role === "user" ? "user" : "assistant")); aiInput.focus(); } catch (error) { console.error("AI conversation error:", error); alert(error.message || "Could not load that chat."); } }
async function newAIChat() { currentAIConversationId = null; resetAIMessages(); await loadAIHistory(); aiInput.focus(); }
function openAI() { if (!aiUnlocked) { alert(`Send ${AI_REQUIRED_MESSAGES - userMessageCount} more message${AI_REQUIRED_MESSAGES - userMessageCount === 1 ? "" : "s"} in the public chat before using the AI.`); return; } lastAITrigger = document.activeElement; aiSidebar.classList.add("open"); aiOverlay.classList.add("open"); aiSidebar.setAttribute("aria-hidden", "false"); aiOverlay.setAttribute("aria-hidden", "false"); loadAIUses(); loadAIHistory(); if (currentAIConversationId) loadAIConversation(currentAIConversationId, aiChatTitle.textContent); setTimeout(() => aiInput.focus(), 250); }
function closeAI() { const focusTarget = lastAITrigger && document.contains(lastAITrigger) ? lastAITrigger : aiOpenButton; if (aiSidebar.contains(document.activeElement)) { if (focusTarget && typeof focusTarget.focus === "function") focusTarget.focus({ preventScroll: true }); else document.activeElement?.blur(); } aiSidebar.classList.remove("open"); aiOverlay.classList.remove("open"); aiSidebar.setAttribute("aria-hidden", "true"); aiOverlay.setAttribute("aria-hidden", "true"); }
aiOpenButton.addEventListener("click", openAI); aiCloseButton.addEventListener("click", closeAI); aiOverlay.addEventListener("click", closeAI); newAIChatButton.addEventListener("click", newAIChat); document.addEventListener("keydown", event => { if (event.key === "Escape") closeAI(); });
function setAILoading(loading) { aiSendButton.dataset.loading = loading ? "true" : "false"; aiSendButton.disabled = loading || !aiUnlocked; aiInput.disabled = loading || !aiUnlocked; aiSendButton.textContent = loading ? "..." : "Send"; }
async function sendAIMessage() { const text = aiInput.value.trim(); if (!aiUnlocked) { alert(`Send ${AI_REQUIRED_MESSAGES - userMessageCount} more message${AI_REQUIRED_MESSAGES - userMessageCount === 1 ? "" : "s"} in the public chat before using the AI.`); return; } if (!text || aiSendButton.disabled) return; addAIMessage(text, "user"); aiInput.value = ""; setAILoading(true); const loadingMessage = addAIMessage("Thinking...", "assistant"); try { const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, conversation_id: currentAIConversationId }) }); const data = await response.json(); loadingMessage.remove(); if (typeof data.message_count === "number") updateAIAccess(data.message_count, data.infinite === true || aiInfinite); if (typeof data.uses_remaining === "number" || data.uses_remaining === "∞") updateUsesRemaining(data.uses_remaining); if (!response.ok) throw new Error(data.error || "AI request failed."); currentAIConversationId = data.conversation_id || currentAIConversationId; addAIMessage(data.response || "The AI returned an empty response.", "assistant"); await loadAIHistory(); } catch (error) { loadingMessage.remove(); addAIMessage(error.message, "assistant"); console.error("AI request error:", error); } finally { setAILoading(false); aiInput.focus(); } }
aiForm.addEventListener("submit", event => { event.preventDefault(); sendAIMessage(); }); aiInput.addEventListener("keydown", event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); aiForm.requestSubmit(); } });

let activeMessageMenu = null;
function closeMessageMenu() { if (activeMessageMenu) { activeMessageMenu.remove(); activeMessageMenu = null; } document.querySelectorAll(".message.message-selected").forEach(el => el.classList.remove("message-selected")); }
function iconButton(label, icon, className, title, onClick, disabled = false) { const button = document.createElement("button"); button.type = "button"; button.className = className; button.title = title; button.setAttribute("aria-label", title); button.innerHTML = `<span class="message-action-icon" aria-hidden="true">${icon}</span><span class="message-action-label">${label}</span>`; button.disabled = disabled; button.addEventListener("click", event => { event.stopPropagation(); onClick(); }); return button; }
function showMessageMenu(div, id, protectedMessage) { closeMessageMenu(); div.classList.add("message-selected"); const menu = document.createElement("div"); menu.className = "message-actions"; const protectButton = iconButton(protectedMessage ? "Unprotect" : "Protect", "🛡", "message-action-protect", protectedMessage ? "Unprotect message" : "Protect from deletion", () => { socket.emit("toggle_message_protection", { id }); closeMessageMenu(); }); const deleteButton = iconButton("Delete", "🗑", "message-action-delete", protectedMessage ? "Protected message" : "Delete message", () => { if (!protectedMessage && confirm("Delete this message?")) socket.emit("delete_message", { id }); closeMessageMenu(); }, protectedMessage); menu.append(protectButton, deleteButton); div.appendChild(menu); activeMessageMenu = menu; }
function addMessage(id, user, text, time, protectedMessage = false, canManage = false) {
    const div = document.createElement("div");
    div.className = "message";
    div.dataset.messageId = String(id);
    div.dataset.protected = protectedMessage ? "1" : "0";
    div.dataset.canManage = canManage ? "1" : "0";
    const content = document.createElement("div");
    content.className = "message-content";
    const timeEl = document.createElement("small");
    timeEl.className = "message-time";
    timeEl.textContent = time;
    const userEl = document.createElement("strong");
    userEl.className = "message-user";
    userEl.textContent = user;
    const textEl = document.createElement("span");
    textEl.className = "message-text";
    textEl.textContent = text;
    content.append(timeEl, userEl, textEl);
    div.appendChild(content);
    if (canManage) div.addEventListener("click", event => { if (!event.target.closest("button")) showMessageMenu(div, id, protectedMessage); });
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
    return div;
}

socket.on("connect", () => { socket.emit("request_history"); socket.emit("set_username", { username: username.value.trim() || "Guest" }); loadAIUses(); });
socket.on("chat_history", history => { closeMessageMenu(); chatBox.innerHTML = ""; const ordered = [...history].sort((a,b) => Number(a[0]) - Number(b[0])); ordered.forEach(msg => addMessage(msg[0], msg[1], msg[2], msg[3], msg[4], msg[5])); updateAIAccess(ordered.filter(msg => msg[5]).length >= 0 ? ordered.filter(msg => msg[5]).length : 0); });
socket.on("new_message", data => { addMessage(data.id, data.username, data.message, data.timestamp, data.protected, data.can_manage); if (data.can_manage) updateAIAccess((userMessageCount || 0) + 1, aiInfinite); });
socket.on("message_deleted", id => { const messageEl = document.querySelector(`.message[data-message-id="${CSS.escape(String(id))}"]`); if (messageEl) messageEl.remove(); });
socket.on("message_updated", data => { const messageEl = document.querySelector(`.message[data-message-id="${CSS.escape(String(data.id))}"]`); if (messageEl) { const textEl = messageEl.querySelector(".message-text"); if (textEl) textEl.textContent = data.message; } });
socket.on("message_protection_changed", data => { const messageEl = document.querySelector(`.message[data-message-id="${CSS.escape(String(data.id))}"]`); if (messageEl) { messageEl.dataset.protected = data.protected ? "1" : "0"; const menu = messageEl.querySelector(".message-actions"); if (menu) { menu.remove(); activeMessageMenu = null; } } });
socket.on("message_action_error", data => alert(data.error || "Message action failed."));
socket.on("connect_error", error => console.error("Chat server connection error:", error));
socket.on("reconnect_attempt", attempt => console.log("Chat server reconnect attempt:", attempt));
socket.on("reconnect", attempt => { console.log("Reconnected to chat server after", attempt, "attempt(s)"); socket.emit("request_history"); loadAIUses(); });
document.getElementById("username")?.addEventListener("change", () => socket.emit("set_username", { username: username.value.trim() || "Guest" }));
message.addEventListener("input", () => { if (window.socket) window.socket.emit("typing", { username: username.value.trim() || "Guest", typing: true }); });
sendButton.addEventListener("click", () => { socket.emit("send_message", { username: username.value.trim(), message: message.value.trim() }); message.value = ""; });
message.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendButton.click(); } });
clearButton.addEventListener("click", () => socket.emit("clear_chat"));
loadAIUses();