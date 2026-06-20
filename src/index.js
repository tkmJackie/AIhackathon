export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/api/soften") {
      return handleSoften(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleSoften(request, env) {
  try {
    const body = await request.json();

    const text = String(body.text || "").trim();
    const from = String(body.from || "personA");
    const history = Array.isArray(body.history) ? body.history : [];

    if (!text) {
      return jsonResponse({ error: "文章が空です。" }, 400);
    }

    if (text.length > 1000) {
      return jsonResponse({ error: "文章は1000文字以内にしてください。" }, 400);
    }

    if (!env.GEMINI_API_KEY) {
      return jsonResponse(
        { error: "GEMINI_API_KEY が設定されていません。" },
        500
      );
    }

    const model = env.GEMINI_MODEL || "gemini-3.5-flash";

    let finalText = "";

    for (let attempt = 1; attempt <= 3; attempt++) {
      const prompt = buildPrompt({
        text,
        from,
        history,
        attempt
      });

      const rawText = await callGemini({
        prompt,
        model,
        apiKey: env.GEMINI_API_KEY
      });

      const cleaned = cleanResult(rawText);

      if (isValidSoftMessage(cleaned)) {
        finalText = cleaned;
        break;
      }

      console.warn("Rejected AI output:", {
        attempt,
        rawText,
        cleaned
      });
    }

    if (!finalText) {
      finalText = createFallbackMessage(text);
    }

    return jsonResponse({ result: finalText });
  } catch (error) {
    console.error(error);

    return jsonResponse(
      { error: "サーバー側でエラーが発生しました。" },
      500
    );
  }
}

async function callGemini({ prompt, model, apiKey }) {
  const apiUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
    `?key=${apiKey}`;

  const geminiResponse = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.05,
        topP: 0.6,
        maxOutputTokens: 220
      }
    })
  });

  const geminiData = await geminiResponse.json();

  if (!geminiResponse.ok) {
    console.error("Gemini API error:", JSON.stringify(geminiData));
    throw new Error("AI変換APIの呼び出しに失敗しました。");
  }

  return extractGeminiText(geminiData);
}

function buildPrompt({ text, from, history, attempt }) {
  const senderName = from === "personA" ? "Aさん" : "Bさん";
  const receiverName = from === "personA" ? "Bさん" : "Aさん";
  const historyText = formatHistory(history);

  const retryInstruction =
    attempt === 1
      ? ""
      : `
前回の出力は不自然、短すぎる、JSON形式、または途中で終わっている可能性があります。
今回は必ず、自然で完結した日本語の会話文だけを出力してください。
`.trim();

  return `
あなたは、一般人同士の会話をやわらかく言い換えるAIです。

目的:
${senderName}のメッセージを、${receiverName}が受け取りやすい自然でやさしい言葉に変換してください。

${retryInstruction}

最重要ルール:
- 原文の意味を変えない
- 丁寧にしすぎない
- カスタマーサポート風にしない
- ビジネス敬語にしない
- 一般人同士の自然な会話にする

出力ルール:
- 変換後の文章だけを出力する
- JSONで返さない
- {"message":"..."} の形式は禁止
- コードブロックは禁止
- 箇条書きは禁止
- 途中で終わらない
- 必ず、変換後の文章のみを出力してください。


今回の原文:
${text}

変換後:
`.trim();
}

function isValidSoftMessage(text) {
  if (!text) {
    return false;
  }

  const value = text.trim();

  if (value.length < 10) {
    return false;
  }

  if (value.length > 180) {
    return false;
  }

  if (!/[。！？]$/.test(value)) {
    return false;
  }

  if (value.includes("{") || value.includes("}") || value.includes('"message"')) {
    return false;
  }

  if (value.includes("```")) {
    return false;
  }

  if (value.includes("原文:") || value.includes("変換後:")) {
    return false;
  }

  if (value.includes("\n")) {
    return false;
  }

  const badEndings = [
    "けど。",
    "けれど。",
    "けれども。",
    "ので。",
    "だし。",
    "かも。",
    "かな。",
    "というか。",
    "ような。",
    "感じ。",
    "気がする。",
    "思って。",
    "言われる。"
  ];

  if (badEndings.some((ending) => value.endsWith(ending))) {
    return false;
  }

  const badPhrases = [
    "恐れ入ります",
    "ご案内いたします",
    "対応いたします",
    "確認いたします",
    "お客様",
    "弊社",
    "貴社"
  ];

  if (badPhrases.some((phrase) => value.includes(phrase))) {
    return false;
  }

  return true;
}

function createFallbackMessage(originalText) {
  const text = String(originalText || "");

  if (text.includes("当日")) {
    return "当日に言われると少し困るから、できればもう少し早めに教えてほしいです。";
  }

  if (text.includes("いきなり") || text.includes("急")) {
    return "急に言われると対応が難しいので、できれば前もって相談してほしいです。";
  }

  if (text.includes("返事") || text.includes("返信")) {
    return "返事がなくて少し不安になっているので、時間があるときに返してほしいです。";
  }

  if (text.includes("遅れ") || text.includes("遅い")) {
    return "遅れていることが少し気になっているので、今の状況を教えてほしいです。";
  }

  if (text.includes("納得") || text.includes("説明")) {
    return "まだ納得できていないところがあるので、もう少し分かりやすく説明してほしいです。";
  }

  if (
    text.includes("むかつく") ||
    text.includes("ムカつく") ||
    text.includes("うざ") ||
    text.includes("傷つ")
  ) {
    return "その言い方だと少し傷ついてしまうので、もう少しやわらかく話してほしいです。";
  }

  if (text.includes("無理") || text.includes("できない")) {
    return "それは少し難しいので、別の形で相談できると助かります。";
  }

  if (text.includes("勝手にして") || text.includes("もういい")) {
    return "今は少し気持ちを整理したいので、少し時間を置きたいです。";
  }

  return "少し強く聞こえてしまうかもしれないので、もう少しやわらかく伝えたいです。";
}

function formatHistory(history) {
  if (!history.length) {
    return "なし";
  }

  return history
    .slice(-4)
    .map((message) => {
      const name = message.from === "personA" ? "Aさん" : "Bさん";
      const original = String(message.original || "").trim();
      return `${name}: ${original}`;
    })
    .join("\n");
}

function extractGeminiText(geminiData) {
  return (
    geminiData?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim() || ""
  );
}

function cleanResult(text) {
  let result = String(text || "").trim();

  result = result
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  result = result
    .replace(/^\{\s*"message"\s*:\s*"/i, "")
    .replace(/"\s*\}\s*$/i, "")
    .replace(/^\{\s*message\s*:\s*/i, "")
    .replace(/^\{\s*/i, "")
    .replace(/\s*\}\s*$/i, "")
    .trim();

  result = result
    .replace(/^変換後[:：]\s*/g, "")
    .replace(/^出力[:：]\s*/g, "")
    .replace(/^message[:：]\s*/g, "")
    .replace(/^["「『]/g, "")
    .replace(/["」』]$/g, "")
    .replace(/^\s*[-•・]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!result) {
    return "";
  }

  if (!/[。！？]$/.test(result)) {
    result += "。";
  }

  return result;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
