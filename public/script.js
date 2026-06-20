const customerMessages = document.getElementById("customerMessages");
const agentMessages = document.getElementById("agentMessages");

const customerForm = document.getElementById("customerForm");
const agentForm = document.getElementById("agentForm");

const customerInput = document.getElementById("customerInput");
const agentInput = document.getElementById("agentInput");

const customerSendButton = document.getElementById("customerSendButton");
const agentSendButton = document.getElementById("agentSendButton");

const resetButton = document.getElementById("resetButton");

const STORAGE_KEY = "soft-conversation-history";

init();

function init() {
  renderAll();

  customerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handleSend("personA");
  });

  agentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handleSend("personB");
  });

  resetButton.addEventListener("click", () => {
    if (!confirm("会話をリセットしますか？")) {
      return;
    }

    localStorage.removeItem(STORAGE_KEY);
    renderAll();
  });
}

function loadMessages() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveMessages(messages) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
}

function renderAll() {
  const messages = loadMessages().sort((a, b) => a.createdAt - b.createdAt);

  renderPanel(customerMessages, messages, "personA");
  renderPanel(agentMessages, messages, "personB");
}

function renderPanel(container, messages, viewerRole) {
  container.innerHTML = "";

  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <p>まだ会話はありません。</p>
      <p>Aさん、またはBさんとしてメッセージを送信してみてください。</p>
    `;
    container.appendChild(empty);
    return;
  }

  messages.forEach((message) => {
    const isSelf = message.from === viewerRole;

    const row = document.createElement("div");
    row.className = `message-row ${isSelf ? "self" : "other"}`;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const text = document.createElement("div");
    text.className = "message-text";

    const badge = document.createElement("div");

    if (isSelf) {
      meta.textContent = "自分が送信した原文";
      text.textContent = message.original;
      badge.className = "original-badge";
      badge.textContent = "原文表示";
    } else {
      meta.textContent =
        message.from === "personA" ? "Aさんから受信" : "Bさんから受信";

      text.textContent = message.softened;
      badge.className = "ai-badge";
      badge.textContent = "AIでやわらかく変換";
    }

    bubble.appendChild(meta);
    bubble.appendChild(text);
    bubble.appendChild(badge);

    row.appendChild(bubble);
    container.appendChild(row);
  });

  container.scrollTop = container.scrollHeight;
}

async function handleSend(from) {
  const input = from === "personA" ? customerInput : agentInput;
  const button = from === "personA" ? customerSendButton : agentSendButton;

  const original = input.value.trim();

  if (!original) {
    alert("メッセージを入力してください。");
    return;
  }

  setSending(button, true);

  try {
    const messages = loadMessages();

    const softened = await softenMessage({
      text: original,
      from,
      history: messages
    });

    const message = {
      id: crypto.randomUUID(),
      from,
      original,
      softened,
      createdAt: Date.now()
    };

    messages.push(message);
    saveMessages(messages);

    input.value = "";
    renderAll();
  } catch (error) {
    console.error(error);
    alert(error.message || "送信に失敗しました。");
  } finally {
    setSending(button, false);
  }
}

async function softenMessage({ text, from, history }) {
  const recentHistory = history
    .slice(-8)
    .map((message) => ({
      from: message.from,
      original: message.original
    }));

  const response = await fetch("/api/soften", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      from,
      history: recentHistory,
      mode: "general_conversation"
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "AI変換に失敗しました。");
  }

  return data.result;
}

function setSending(button, isSending) {
  button.disabled = isSending;
  button.textContent = isSending ? "AI変換中..." : getDefaultButtonText(button);
}

function getDefaultButtonText(button) {
  if (button.id === "customerSendButton") {
    return "Aさんとして送信";
  }

  return "Bさんとして送信";
}
