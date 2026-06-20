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

    if (text.length > 1000) {
      return jsonResponse({ error: "文章は1000文字以内にしてください。" }, 400);
    }

    if (!env.GEMINI_API_KEY) {
      return jsonResponse(
        { error: "GEMINI_API_KEY が設定されていません。" },
        500
      );
    }

    const prompt = buildPrompt(text, direction);
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
          temperature: 0.2,
          topP: 0.8,
          maxOutputTokens: 800
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

function buildPrompt(text, direction) {
  if (direction === "customer_to_agent") {
    return `
あなたはカスタマーサポート現場のための文章変換AIです。

目的:
お客さまの強い言葉・怒り・命令口調・クレーム表現を、従業員が冷静に受け止めやすい「落ち着いた要望文」に変換してください。

重要:
これは要約ではありません。
短くしすぎないでください。
途中で終わる文章は禁止です。
「〜よう」「〜かと」「〜ですが」「〜なので」で終わらないでください。
必ず自然な日本語の完全文で、1〜3文にしてください。

変換ルール:
- お客さまの要望・不満・緊急性は残す
- 攻撃的な言葉、責める言葉、命令口調を消す
- 従業員が心理的負担を感じにくい表現にする
- ただし、問題が起きていることは伝わるようにする
- 余計な説明や前置きは出さない
- 変換後の文章だけを出力する

変換例:
原文: なんでまだ返事がないの？早くしてください。
変換後: まだ返信を確認できていないため、状況を確認したいです。可能でしたら、できるだけ早めにご対応いただけますと助かります。

原文: 説明がわかりにくいです。ちゃんと対応してください。
変換後: 説明内容について少し分かりにくい点があります。お手数ですが、もう少し詳しくご案内いただけますでしょうか。

原文: 何回言えばわかるんですか？
変換後: 以前お伝えした内容がうまく伝わっていない可能性があります。改めて確認していただけますと助かります。

今回の原文:
${text}

変換後:
`.trim();
  }

  return `
あなたはカスタマーサポート現場のための文章変換AIです。

目的:
従業員の強い言葉・冷たい言い方・命令口調・突き放した表現を、お客さまに安心感を与える「丁寧な案内文」に変換してください。

重要:
これは要約ではありません。
短くしすぎないでください。
途中で終わる文章は禁止です。
「〜よう」「〜かと」「〜ですが」「〜なので」で終わらないでください。
必ず自然な日本語の完全文で、1〜3文にしてください。

変換ルール:
- 必要な案内・依頼内容は残す
- 上から目線、冷たい言い方、責める言い方を消す
- お客さまに安心感と敬意が伝わる表現にする
- カスタマーサポートらしい丁寧な文にする
- 余計な説明や前置きは出さない
- 変換後の文章だけを出力する

変換例:
原文: その言い方では対応できません。必要事項を先に送ってください。
変換後: 恐れ入りますが、確認に必要な情報をご共有いただけますでしょうか。内容を確認でき次第、順番に対応いたします。

原文: こちらでは確認できません。自分で調べてください。
変換後: 恐れ入りますが、こちらでは詳細を確認できない内容です。確認方法をご案内しますので、そちらをご確認いただけますでしょうか。

原文: 何度も同じ説明をしています。
変換後: これまでのご案内内容と重なる部分がございますが、改めて分かりやすくご説明いたします。

今回の原文:
${text}

変換後:
`.trim();
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
