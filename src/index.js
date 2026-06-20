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
    const direction = String(body.direction || "customer_to_agent");

    if (!text) {
      return jsonResponse({ error: "文章が空です。" }, 400);
    }

    if (!env.GEMINI_API_KEY) {
      return jsonResponse({ error: "GEMINI_API_KEY が設定されていません。" }, 500);
    }

    const prompt = buildPrompt(text, direction);
    const model = env.GEMINI_MODEL || "gemini-3.5-flash";

    const apiUrl =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

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
          temperature: 0.4,
          maxOutputTokens: 300
        }
      })
    });

    const geminiData = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error("Gemini API error:", geminiData);
      return jsonResponse({ error: "AI変換APIの呼び出しに失敗しました。" }, 500);
    }

    const result =
      geminiData?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim() || "";

    if (!result) {
      return jsonResponse({ error: "変換結果を取得できませんでした。" }, 500);
    }

    return jsonResponse({ result });
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: "サーバー側でエラーが発生しました。" }, 500);
  }
}

function buildPrompt(text, direction) {
  if (direction === "customer_to_agent") {
    return `
あなたはカスタマーサポート向け文章変換AIです。

これは「お客さまから従業員」に送られるメッセージです。
従業員が心理的な負担を感じにくいように、強い言い方・攻撃的な表現・命令口調を和らげてください。
ただし、お客さまの要望、不満、確認事項、緊急性は残してください。

条件:
- 受信する従業員にとって読みやすい自然な日本語
- クレームの意図は残す
- 感情的すぎる表現は冷静な要望・確認文にする
- 余計な説明は不要
- 変換後の文章だけ出力する

変換対象:
${text}
`.trim();
  }

  return `
あなたはカスタマーサポート向け文章変換AIです。

これは「従業員からお客さま」に送られるメッセージです。
お客さまに安心感と敬意が伝わるように、強い言い方・命令口調・突き放した印象をなくし、
丁寧で誠実なカスタマーサポート文に変換してください。

条件:
- お客さま向けの丁寧な文
- 失礼な印象をなくす
- 必要な案内や依頼内容は残す
- 余計な説明は不要
- 変換後の文章だけ出力する

変換対象:
${text}
`.trim();
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
