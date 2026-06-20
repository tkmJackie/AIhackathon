const convertForm = document.getElementById("convertForm");
const originalText = document.getElementById("originalText");
const softText = document.getElementById("softText");
const toneLevel = document.getElementById("toneLevel");
const convertButton = document.getElementById("convertButton");
const copyButton = document.getElementById("copyButton");
const sendButton = document.getElementById("sendButton");
const chatMessages = document.getElementById("chatMessages");

function addMessage(text, type) {
  const message = document.createElement("div");
  message.className = `message ${type}`;

  const p = document.createElement("p");
  p.textContent = text;

  message.appendChild(p);
  chatMessages.appendChild(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setLoading(isLoading) {
  convertButton.disabled = isLoading;
  convertButton.textContent = isLoading
    ? "変換中..."
    : "柔らかい言葉に変換";
}

convertForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = originalText.value.trim();

  if (!text) {
    alert("文章を入力してください。");
    return;
  }

  setLoading(true);
  softText.value = "";

  try {
    const response = await fetch("/api/soften", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text,
        tone: toneLevel.value
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "変換に失敗しました。");
    }

    // ここではチャット欄に追加しない
    // 変換結果エリアにだけ表示する
    softText.value = data.result;
  } catch (error) {
    console.error(error);
    alert(error.message || "エラーが発生しました。");
  } finally {
    setLoading(false);
  }
});

copyButton.addEventListener("click", async () => {
  const text = softText.value.trim();

  if (!text) {
    alert("コピーする文章がありません。");
    return;
  }

  await navigator.clipboard.writeText(text);
  copyButton.textContent = "コピーしました";

  setTimeout(() => {
    copyButton.textContent = "コピー";
  }, 1200);
});

sendButton.addEventListener("click", () => {
  const text = softText.value.trim();

  if (!text) {
    alert("送信する文章がありません。");
    return;
  }

  // チャット欄に表示するのは送信ボタンを押した時だけ
  addMessage(text, "soft");

  originalText.value = "";
  softText.value = "";
});
