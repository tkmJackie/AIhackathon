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

    const prompt = buildPrompt({
      text,
      from,
      history
    });

    const model = env.GEMINI_MODEL || "gemini-3.5-flash";

    const apiUrl =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` +
      `?key=${env.GEMINI_API_KEY}`;

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
          temperature: 0.15,
          topP: 0.75,
          maxOutputTokens: 500
        }
      })
    });

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error("Gemini API error:", JSON.stringify(geminiData));
      return jsonResponse(
        { error: "AI変換APIの呼び出しに失敗しました。" },
        500
      );
    }

    const result = extractGeminiText(geminiData);

    if (!result) {
      console.error("Gemini empty result:", JSON.stringify(geminiData));
      return jsonResponse(
        { error: "変換結果を取得できませんでした。" },
        500
      );
    }

    return jsonResponse({ result: cleanResult(result) });
  } catch (error) {
    console.error(error);

    return jsonResponse(
      { error: "サーバー側でエラーが発生しました。" },
      500
    );
  }
}

function buildPrompt({ text, from, history }) {
  const senderName = from === "personA" ? "Aさん" : "Bさん";
  const receiverName = from === "personA" ? "Bさん" : "Aさん";

  const historyText = formatHistory(history);

  return `
あなたは、一般人同士の会話をやわらかく言い換えるAIです。

目的:
${senderName}が送った強い言葉を、${receiverName}が受け取りやすい自然な言葉に言い換えてください。

最重要ルール:
- 文脈とニュアンスを変えない
- 原文にない事実を足さない
- 原文にない謝罪を勝手に足さない
- 原文にない約束を勝手に足さない
- 原文にない解決策を勝手に足さない
- 原文の主張、依頼、不満、拒否、疑問は残す
- 怒りや不満は消さず、「冷静な不満」として残す
- 相手への攻撃、嫌味、命令口調だけをやわらげる
- 丁寧すぎるビジネス文にしない
- 「恐れ入ります」「ご案内いたします」「対応いたします」「確認いたします」は使わない
- カスタマーサポート風にしない
- 日常会話として自然な日本語にする
- 1〜2文にする
- 途中で終わらない
- 変換後の文章だけを出力する

変換の考え方:
悪い変換:
原文: それは対応できません。規約に書いてあります。
変換後: 恐れ入りますが、今回の内容は規約上ご対応が難しい状況です。
理由: カスタマーサポート風で、一般会話として不自然。

良い変換:
原文: それは対応できません。規約に書いてあります。
変換後: それは難しそうです。理由は決まりに書かれている内容だからです。

悪い変換:
原文: 全然納得できません。ちゃんと説明してください。
変換後: ご説明いただけますと幸いです。
理由: 不満の強さが消えている。

良い変換:
原文: 全然納得できません。ちゃんと説明してください。
変換後: まだ納得できていないので、もう少し分かりやすく説明してほしいです。

悪い変換:
原文: こちらのミスではないため、対応できません。
変換後: ご不便をおかけして申し訳ありません。順番に対応いたします。
理由: 原文にない謝罪と対応約束が追加されている。

良い変換:
原文: こちらのミスではないため、対応できません。
変換後: こちらのミスではないので、その件は対応するのが難しいです。

直近の会話:
${historyText}

今回の原文:
${text}

変換後:
`.trim();
}

function formatHistory(history) {
  if (!history.length) {
    return "なし";
  }

  return history
    .slice(-8)
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
  return text
    .replace(/^変換後[:：]\s*/g, "")
    .replace(/^["「『]/g, "")
    .replace(/["」』]$/g, "")
    .trim();
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
