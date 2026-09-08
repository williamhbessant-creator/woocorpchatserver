(() => {
  const usesElement = document.getElementById("aiUsesRemaining");
  if (!usesElement) return;

  const button = document.createElement("button");
  button.type = "button";
  button.id = "buyAIUsesButton";
  button.className = "ai-buy-uses-button";
  button.hidden = true;
  button.textContent = "Buy more AI uses";
  usesElement.insertAdjacentElement("afterend", button);

  async function loadPaidAIConfig() {
    try {
      const response = await fetch("/api/ai/paid/config", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.enabled) return;

      const price = (Number(data.price_pence || 0) / 100).toFixed(2);
      const currency = String(data.currency || "gbp").toUpperCase();
      button.textContent = `Buy ${Number(data.uses) || 0} more AI uses — ${currency} ${price}`;
      button.hidden = false;
      button.addEventListener("click", startCheckout, { once: false });
    } catch (error) {
      console.error("Paid AI config error:", error);
    }
  }

  async function startCheckout() {
    if (button.disabled) return;
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = "Opening checkout...";
    try {
      const response = await fetch("/api/ai/paid/checkout", {
        method: "POST",
        headers: { "Accept": "application/json" }
      });
      const data = await response.json();
      if (!response.ok || !data.url) throw new Error(data.error || "Could not start payment.");
      window.location.href = data.url;
    } catch (error) {
      alert(error.message || "Could not start payment.");
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  loadPaidAIConfig();
})();
