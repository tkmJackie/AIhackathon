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

      const parsed = parseAiResult(aiText);

      if (isCompleteSentence(parsed)) {
        finalText = parsed;
        break;
      }

      console.warn("Incomplete AI result. Retry:", {
        attempt,
        aiText,
        parsed
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
        temperature: 0.1,
        topP: 0.7,
        maxOutputTokens: 180
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
前回の出力は途中で終わっている可能性があります。
今回は必ず最後まで完結した自然な1文にしてください。
`.trim();

  return `
あなたは、一般人同士の会話をやさしく言い換えるAIです。

目的:
${senderName}の強い言葉を、${receiverName}が受け取りやすい自然でやさしい言葉に言い換えてください。

${retryInstruction}

絶対ルール:
- 原文の意味を大きく変えない
- 原文にない事実を足さない
- 原文にない謝罪を足さない
- 原文にない約束を足さない
- カスタマーサポート風にしない
- ビジネス敬語にしない
- 攻撃的な言葉だけをやわらげる
- 一般人同士の自然な会話にする
- 必ず1文だけにする
- 必ず最後は「。」「！」「？」のどれかで終える
- 途中で終わる文は禁止
- 箇条書きは禁止
- 説明は禁止
- 改行は禁止

禁止する終わり方:
「〜けど」
「〜ので」
「〜だし」
「〜かも」
「〜かな」
「〜というか」
「〜ような」
「〜感じ」
「〜気がする」
「〜思って」

出力形式:
必ず次のJSONだけを返してください。

{"message":"変換後の文章"}

変換例:
原文: 遅れたってレベルじゃなくない？毎回そうだけど、こっちのこと軽く見てる感じして普通にムカつく。
出力: {"message":"毎回こういうことが続くと、大事にされていないように感じて少しつらいです。"}

原文: ごめん、返信遅れた。
出力: {"message":"返信が遅くなってごめんね。"}

原文: 何回言えばわかるの？
出力: {"message":"前にも伝えたことなので、もう一度ちゃんと受け取ってもらえるとうれしいです。"}

原文: まあ、そんなに気にしなくてもよくない？
出力: {"message":"あまり深く考えすぎなくても大丈夫だと思うよ。"}

原文: 全然納得できない。ちゃんと説明して。
出力: {"message":"まだ納得できていないので、もう少し分かりやすく説明してもらえるとうれしいです。"}

直近の会話:
${historyText}

今回の原文:
${text}

出力:
`.trim();
}

function parseAiResult(aiText) {
  let text = String(aiText || "").trim();

  text = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(text);
    return cleanResult(parsed.message || "");
  } catch {
    const match = text.match(/\{[\s\S]*\}/);

    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        return cleanResult(parsed.message || "");
      } catch {
        // 何もしない
      }
    }
  }

  return cleanResult(text);
}

function isCompleteSentence(text) {
  if (!text) {
    return false;
  }

  const normalized = text.trim();

  if (normalized.length < 8) {
    return false;
  }

  if (normalized.includes("\n")) {
    return false;
  }

  if (!/[。！？]$/.test(normalized)) {
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
    "思う。"
  ];

  return !badEndings.some((ending) => normalized.endsWith(ending));
}

function createFallbackMessage(originalText) {
  const text = String(originalText || "");

  if (text.includes("返事") || text.includes("返信")) {
    return "返事がなくて少し不安になっているので、時間があるときに返してもらえるとうれしいです。";
  }

  if (text.includes("遅れ") || text.includes("遅い")) {
    return "遅れていることが少し気になっているので、今の状況を教えてもらえるとうれしいです。";
  }

  if (text.includes("納得") || text.includes("説明")) {
    return "まだ納得できていないところがあるので、もう少し分かりやすく説明してもらえるとうれしいです。";
  }

  if (text.includes("むかつく") || text.includes("ムカつく") || text.includes("傷つ")) {
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
  let result = String(text || "")
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
