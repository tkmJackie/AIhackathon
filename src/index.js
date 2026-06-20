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
          temperature: 0.2,
          topP: 0.8,
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

    const cleaned = cleanResult(result);

    return jsonResponse({ result: cleaned });
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
あなたは、一般人同士の会話をやわらかく整えるAIです。

目的:
${senderName}が送った少し強い言い方のメッセージを、
${receiverName}が受け取りやすい、やさしく自然な言葉に言い換えてください。

最重要ルール:
- 原文の意味・意図・文脈をできるだけ保つ
- 強い口調、責める言い方、トゲのある表現だけをやわらげる
- 元の気持ちや不満は完全には消さず、やさしく伝わる形にする
- 原文にない事実を足さない
- 原文にない謝罪を勝手に足さない
- 原文にない約束を勝手に足さない
- 原文にない解決策を勝手に足さない
- カスタマーサポート風にしない
- ビジネス文にしない
- 「恐れ入ります」「ご案内いたします」「対応いたします」「確認いたします」は使わない
- 一般人同士の自然な会話として返す
- できるだけやさしく、相手を傷つけにくい表現にする
- ただし、意味が別物になるほど言い換えすぎない

出力ルール:
- 必ず自然な日本語の完全文で返す
- 途中で文を終わらせない
- 語尾が「〜かな？」「〜けど」「〜だし」「〜なので」「〜かも」「〜というか」だけで不自然に終わらない
- 箇条書きにしない
- 会話の解説をしない
- 引用符を付けない
- 1〜2文で返す
- 変換後の文章だけを出力する

やわらかさの基準:
- 「ムカつく」「ありえない」「最悪」「何回言えばわかるの」などの強い言葉は使わない
- できるだけ「少し気になった」「悲しかった」「そう感じた」「もう少しこうしてほしい」のような伝え方にする
- 相手を否定するより、自分の気持ちやお願いとして表現する
- きつい拒否は、やわらかい断り方にする
- 強い不満は、落ち着いた不満にする

変換例:
原文: 遅れたってレベルじゃなくない？毎回そうだけど、こっちのこと軽く見てる感じして普通にムカつく。
変換後: 毎回こういうことが続くと、あまり大事にされていないように感じてしまってつらいです。もう少し気にかけてもらえたらうれしいです。

原文: まあ、そんなに気にしなくてもよくない？
変換後: あまり深く考えすぎなくても大丈夫かもしれないけど、気になるならその気持ちも大事にしていいと思うよ。

原文: 何回言えばわかるの？
変換後: 前にも伝えたことなので、もう一度ちゃんと受け取ってもらえるとうれしいです。

原文: その言い方ちょっときついんだけど。
変換後: その言い方だと少しきつく感じてしまったよ。もう少しやわらかく話してもらえるとうれしいな。

原文: もういい。勝手にして。
変換後: 今は少し気持ちを整理したいから、少し時間を置かせてもらえるとうれしいです。

原文: 全然納得できない。ちゃんと説明して。
変換後: まだ納得しきれていないところがあるから、もう少し詳しく説明してもらえるとうれしいです。

原文: こっちは忙しいんだけど。
変換後: 今ちょっと余裕がないから、少し時間をもらえると助かります。

原文: それはさすがにひどくない？
変換後: それは少しつらく感じたよ。もう少し配慮してもらえたらうれしいです。

原文: なんで返事くれないの？
変換後: 返事がなくて少し不安になっているよ。時間があるときに返してもらえるとうれしいです。

原文: 普通に傷ついたんだけど。
変換後: その言葉で少し傷ついてしまったよ。できればもう少しやさしく伝えてもらえるとうれしいです。

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
  let result = text
    .replace(/^変換後[:：]\s*/g, "")
    .replace(/^["「『]/g, "")
    .replace(/["」』]$/g, "")
    .replace(/^\s*[-•・]\s*/gm, "")
    .trim();

  // 途中で切れたような語尾を軽く補正
  const badEndings = [
    "けど",
    "けれど",
    "かな",
    "かも",
    "なので",
    "だし",
    "というか",
    "けどね",
    "ですが",
    "けれども"
  ];

  for (const ending of badEndings) {
    if (result.endsWith(ending)) {
      result += "。";
      break;
    }
  }

  // 文末記号がない場合は句点を付ける
  if (!/[。！？]$/.test(result)) {
    result += "。";
  }

  // 連続改行を整理
  result = result.replace(/\n{2,}/g, "\n").trim();

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
