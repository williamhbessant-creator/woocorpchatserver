(() => {
    const clearButton = document.getElementById("clearButton");
    const chatBox = document.getElementById("chat-box");

    if (!clearButton || typeof socket === "undefined") return;

    clearButton.addEventListener("click", () => {
        const messages = chatBox ? chatBox.querySelectorAll(".message") : [];
        const protectedMessages = chatBox ? chatBox.querySelectorAll('.message[data-protected="true"], .message[data-protected="1"]').length : 0;
        const deletableCount = Math.max(0, messages.length - protectedMessages);

        if (deletableCount === 0) {
            alert("There are no messages that can be cleared.");
            return;
        }

        if (!confirm(`Clear ${deletableCount} message${deletableCount === 1 ? "" : "s"}? Protected messages will be kept.`)) return;

        clearButton.disabled = true;
        clearButton.textContent = "Clearing...";
        socket.emit("clear_history");
    });

    socket.on("history_cleared", () => {
        if (chatBox) {
            chatBox.querySelectorAll(".message").forEach(message => {
                const protectedMessage = message.dataset.protected === "true" || message.dataset.protected === "1";
                if (!protectedMessage) message.remove();
            });
        }
        clearButton.disabled = false;
        clearButton.textContent = "Clear Chat";
    });

    socket.on("message_action_error", data => {
        if (clearButton.disabled) {
            clearButton.disabled = false;
            clearButton.textContent = "Clear Chat";
            if (data?.error) alert(data.error);
        }
    });
})();
