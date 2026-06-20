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

      const aiText = await callGemini({
        prompt,
        model,
        apiKey: env.GEMINI_API_KEY
      });

      const cleaned = cleanResult(aiText);

      if (isGoodSoftMessage(cleaned)) {
        finalText = cleaned;
        break;
      }

      console.warn("AI result rejected. Retry:", {
        attempt,
        raw: aiText,
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
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature: 0.15,
        topP: 0.75,
        maxOutputTokens: 256
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
前回の出力は、短すぎる・途中で終わっている・JSONのような形式になっている可能性があります。
今回は必ず、自然で完結した日本語の文章だけを出力してください。
`.trim();

  return `
あなたは、一般人同士の会話をやさしく言い換えるAIです。

目的:
${senderName}の少し強い言葉を、${receiverName}が受け取りやすい自然でやさしい言葉に変換してください。

${retryInstruction}

絶対ルール:
- JSONで返さない
- {"message": "..."} のような形式にしない
- コードブロックにしない
- 箇条書きにしない
- 解説しない
- 変換後の文章だけを出力する
- 原文の意味を大きく変えない
- 原文にない事実を足さない
- 原文にない謝罪を足さない
- 原文にない約束を足さない
- 原文にない解決策を足さない
- カスタマーサポート風にしない
- ビジネス敬語にしない
- 一般人同士の自然な会話にする
- きつい言葉、嫌味、責める表現だけをやわらげる
- 相手を責めるより、自分の気持ちやお願いとして表現する
- 1〜2文で返す
- 必ず最後は「。」「！」「？」のどれかで終える
- 途中で終わらない

禁止する終わり方:
- 「〜けど」
- 「〜ので」
- 「〜だし」
- 「〜かも」
- 「〜かな」
- 「〜というか」
- 「〜ような」
- 「〜感じ」
- 「〜気がする」
- 「〜思って」
- 「〜言われる」

良い変換例:
原文: 当日に言われる。
変換後: 当日に言われると少し困るから、できればもう少し早めに教えてもらえるとうれしいです。

原文: いきなり言われても無理。
変換後: 急に言われると少し対応が難しいので、できれば前もって相談してもらえると助かります。

原文: 遅れたってレベルじゃなくない？毎回そうだけど、こっちのこと軽く見てる感じして普通にムカつく。
変換後: 毎回こういうことが続くと、大事にされていないように感じて少しつらいです。もう少し気にかけてもらえるとうれしいです。

原文: 何回言えばわかるの？
変換後: 前にも伝えたことなので、もう一度ちゃんと受け取ってもらえるとうれしいです。

原文: その言い方ちょっときついんだけど。
変換後: その言い方だと少しきつく感じてしまったよ。もう少しやわらかく話してもらえるとうれしいです。

原文: 全然納得できない。ちゃんと説明して。
変換後: まだ納得できていないので、もう少し分かりやすく説明してもらえるとうれしいです。

直近の会話:
${historyText}

今回の原文:
${text}

変換後の文章だけを出力:
`.trim();
}

function isGoodSoftMessage(text) {
  if (!text) {
    return false;
  }

  const value = text.trim();

  if (value.length < 16) {
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

  if (value.includes("\n-") || value.includes("\n・")) {
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

  return true;
}

function createFallbackMessage(originalText) {
  const text = String(originalText || "");

  if (text.includes("当日") || text.includes("いきなり") || text.includes("急")) {
    return "急に言われると少し困るので、できればもう少し早めに教えてもらえるとうれしいです。";
  }

  if (text.includes("返事") || text.includes("返信")) {
    return "返事がなくて少し不安になっているので、時間があるときに返してもらえるとうれしいです。";
  }

  if (text.includes("遅れ") || text.includes("遅い")) {
    return "遅れていることが少し気になっているので、今の状況を教えてもらえるとうれしいです。";
  }

  if (text.includes("納得") || text.includes("説明")) {
    return "まだ納得できていないところがあるので、もう少し分かりやすく説明してもらえるとうれしいです。";
  }

  if (
    text.includes("むかつく") ||
    text.includes("ムカつく") ||
    text.includes("傷つ")
  ) {
    return "その言い方だと少し傷ついてしまうので、もう少しやわらかく話してもらえるとうれしいです。";
  }

  return "少し強く感じてしまったので、もう少しやさしく伝えてもらえるとうれしいです。";
}

function formatHistory(history) {
  if (!history.length) {
    return "なし";
  }

  return history
    .slice(-6)
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

  // 壊れたJSONっぽい出力を除去
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
