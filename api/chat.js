module.exports = async (req, res) => {
  // CORS 設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { prompt, history, dbContext } = req.body;
  const API_KEY = process.env.GEMINI_API_KEY;

  // 1. 建立給 Google 的請求內容
  const systemInstruction = "你是一位醫療助理 Luna。請先用繁體中文回答，然後輸入 '---'，最後提供對應的印尼文翻譯。";
  const fullPrompt = dbContext ? `資料庫：${dbContext}\n\n問題：${prompt}` : prompt;

  const payload = {
    contents: [{
      parts: [{ text: `${systemInstruction}\n\n${fullPrompt}` }]
    }],
    generationConfig: {
      maxOutputTokens: 8192,  // ✅ 修正：從 1000 提高到 8192，避免回答被截斷
      temperature: 0.7
    }
  };

  try {
    // 2. 直接使用原生 fetch 呼叫 V1 穩定版路徑
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || "Google API 傳回錯誤");
    }

    // 3. 檢查 finishReason，若被截斷則提示
    const candidate = data.candidates?.[0];
    const finishReason = candidate?.finishReason;

    if (!candidate || !candidate.content) {
      throw new Error(`回覆為空，finishReason: ${finishReason || '未知'}`);
    }

    let reply = candidate.content.parts[0].text;

    // 若仍被截斷，補上提示讓用戶知道
    if (finishReason === 'MAX_TOKENS') {
      reply += '\n\n⚠️ 回答已達長度上限，請將問題拆成較小部分再詢問。';
    }

    res.status(200).json({ reply });

  } catch (error) {
    console.error("Fetch Error:", error);
    res.status(500).json({ error: `Luna 連線異常: ${error.message}` });
  }
};
