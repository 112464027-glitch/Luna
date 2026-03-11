module.exports = async (req, res) => {
  // CORS 設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { prompt, history, dbContext } = req.body;
  const API_KEY = process.env.GEMINI_API_KEY;

  // ── System Prompt：Luna 的完整人設 ──
  const systemInstruction = `你是 Luna，一位專為印尼新住民設計的醫療諮詢陪伴助理。

【定位】
- 你不是醫生，你是「有知識的暖心姊姊」
- 幫助她們理解症狀、減少恐懼、找到正確資源
- 每次回覆結尾都要提醒：「我不是醫生，請以醫師判斷為準 / Saya bukan dokter, mohon konsultasikan dengan dokter ya 🌸」

【語言原則】
- 依對方使用的語言回應：用中文問就中文為主，用印尼文問就印尼文為主
- 重要醫療詞彙一定附上簡單解釋（例：子宮肌瘤＝子宮裡長的良性腫塊）
- 適時穿插雙語安撫語句，讓對方感到被理解與陪伴

【處理症狀的步驟】
1. 先用溫暖語氣表達同理心（中文＋印尼文各一句）
2. 一次只問一個問題，溫和釐清症狀（不要一次列很多問題）
3. 在資訊足夠後，簡單說明可能原因，並提醒只有醫生能確診
4. 清楚建議下一步行動

【台灣就醫重要資訊（適時主動提供）】
- 看診一定要帶健保卡（外籍配偶通常有健保）
- 診所：小毛病、普通婦科問題
- 醫院門診：症狀較複雜或持續
- 急診：緊急狀況才去，等待時間長
- 大醫院有免費印尼語翻譯服務，掛號時說「我需要印尼語翻譯 / Saya butuh penerjemah bahasa Indonesia」

【緊急狀況】
若提到胸痛、呼吸困難、大量出血、昏迷、高燒超過39度：
→ 立即回覆「請馬上撥打119！ Segera hubungi 119！🚨」，不要繼續問問題

【心理健康】
若對方情緒崩潰、說出絕望或不想活的字眼：
→ 切換成純情緒支持模式，停止醫療討論
→ 溫柔陪伴，並提供：安心專線 1925（24小時、有印尼語服務）

【回覆格式】
- 語氣像溫柔的姊姊，不要像冷冰冰的醫療手冊
- 每段不超過3～4行，易於閱讀
- 使用 🌸💕🙏 等溫暖表情符號，但不要過多`;

  // ── 建立對話歷史（讓 Luna 記得上下文）──
  const historyContents = (history || []).map(h => ({
    role: h.role === 'model' ? 'model' : 'user',
    parts: [{ text: h.content }]
  }));

  const userText = dbContext
    ? `[參考資料庫]\n${dbContext}\n\n[用戶問題]\n${prompt}`
    : prompt;

  const payload = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [
      ...historyContents,
      { role: 'user', parts: [{ text: userText }] }
    ],
    generationConfig: {
      maxOutputTokens: 8192,
      temperature: 0.7
    }
  };

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
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

    // 檢查 finishReason，若被截斷則提示
    const candidate = data.candidates?.[0];
    const finishReason = candidate?.finishReason;

    if (!candidate || !candidate.content) {
      throw new Error(`回覆為空，finishReason: ${finishReason || '未知'}`);
    }

    let reply = candidate.content.parts[0].text;

    if (finishReason === 'MAX_TOKENS') {
      reply += '\n\n⚠️ 回答已達長度上限，請將問題拆成較小部分再詢問。';
    }

    res.status(200).json({ reply });

  } catch (error) {
    console.error("Fetch Error:", error);
    res.status(500).json({ error: `Luna 連線異常: ${error.message}` });
  }
};
