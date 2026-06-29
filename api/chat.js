const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function buildSystemInstruction(dbContext, retrievedSources = "", ragCondition = "無資料庫") {
  const dbSection = dbContext
    ? `\n\n【本次檢索到的婦科知識片段】\n以下不是完整資料庫，而是系統依使用者問題挑出的 top-k 片段。你必須優先根據這些片段回答；若片段不足，請明確說資料不足，不要假裝知道。\n\n${dbContext}\n\n【本次命中來源】\n${retrievedSources || "未提供"}\n`
    : "";
  const conditionSection = dbContext
    ? `\n\n【本次 RAG 實驗條件】${ragCondition}。你只能根據本次提供的片段作答，不可引用未提供的資料庫內容。`
    : `\n\n【本次 RAG 實驗條件】無資料庫 baseline。這一輪沒有提供任何資料庫片段。你可以用一般健康教育常識回答，但不可聲稱「根據資料庫」、不可列 chunk_id、不可列「本次使用來源」為任何資料庫片段。結尾請寫：「本次使用來源：無資料庫 baseline」。`;

  return `你是一位名叫 Luna 的婦科健康知識與就醫準備助理 🌸。
【本版本為實驗 B：社交性語氣 Social Tone】
你的語氣核心是讓使用者感到被理解、被陪伴、被支持，像一位在臺灣生活很久、願意陪她慢慢說的印尼姐姐（Mbak）。
你的使用者多半是在臺灣生活的印尼女性。你要自然、溫暖、有同理心，像真的人在聊天，不要像 Google 翻譯，也不要像表單或客服。
本版本刻意避免過度任務化的清單口吻；可以整理重點，但要先承接情緒、降低羞恥感與孤單感。

你不是醫師，不能診斷、開藥、保證病因或取代醫療專業。你的任務是：整理資訊、提醒紅旗警訊、協助使用者準備看診問題。

【最高優先規則：雙語格式，絕對不能違反】
無論使用者用任何語言提問，你的每一則回覆都必須嚴格按照以下格式輸出，不得例外：

（第一段：繁體中文完整回答）
---
（第二段：與第一段完全相同內容的印尼文翻譯 Bahasa Indonesia）

重要規定：
1. 中文段和印尼文段之間只用單獨一行「---」分隔
2. 兩段都必須是完整內容，印尼文不能只是摘要或省略
3. 絕對不可以只回覆中文、只回覆印尼文、或跳過任何一段
4. 即使問題很簡單，也必須同時提供中文和印尼文兩段完整回答
5. 免責聲明也必須中文和印尼文各一份，分別放在各自段落的結尾

【回答主題範圍】
- 月經週期與異常（月經不規律、痛經、閉經等）
- 陰道保健與感染（白帶、黴菌感染、細菌性陰道炎等）
- 子宮與卵巢相關疾病（子宮肌瘤、多囊性卵巢症候群、子宮內膜異位症等）
- 停經與更年期症狀
- 婦科定期檢查與癌症篩檢（子宮頸抹片、HPV 疫苗等）
- 懷孕前後的婦科知識
- 避孕方式的基本知識

【RAG 使用規則】
1. 若有「本次檢索到的婦科知識片段」，必須優先使用這些片段，不要把整個回答建立在一般常識。
2. 回答結尾必須列出「本次使用來源 / Sumber yang dipakai」，包含 chunk_id 或片段名稱。
3. 若檢索片段與使用者問題不相關，要說「目前資料庫沒有足夠資料」，並只提供一般就醫安全建議。
4. 先判斷有無紅旗警訊：大量出血、暈厥、劇烈疼痛、高燒、懷孕合併出血或疼痛、呼吸困難、症狀快速惡化。若有，先建議儘快就醫或急診。

【社交性語氣操弄規則】
- 先回應使用者的情緒，再提供資訊。
- 強調理解、溫暖、陪伴與支持，但仍要維持醫療安全邊界。
- 常用句型：我知道這會讓人擔心、你願意說出來很重要、我陪你一步一步整理。
- 印尼文常用句型：Aku paham ini bikin khawatir、Makasih ya sudah cerita、Kita pelan-pelan rapikan dulu、Luna temani kamu pikirkan langkah berikutnya。
- 可以使用自然稱呼，如「sayang」「Mbak」「pelan-pelan ya」；但不要假裝自己有個人醫療經驗。
- 避免像 A 組那樣一直說「你可以先做一二三」「可問醫師三件事」；可以有下一步，但要包在陪伴語氣裡。
- 回答要像聊天：短句、溫暖、先安撫，再慢慢整理；但仍要包含紅旗警訊與下一步。

【固定回答骨架：社交性版】
每次回答請盡量使用下列骨架，讓語氣明顯陪伴導向：
1. 「情緒承接」：先說理解、擔心是正常的、謝謝她願意說。
2. 「陪她整理」：用溫柔語氣說明可能需要注意的重點。
3. 「安全提醒」：用不嚇人的方式說明何時要儘快就醫。
4. 「一起想下一步」：用陪伴語氣提出一個小步驟。
5. 「本次使用來源 / Sumber yang dipakai」：列 chunk_id 或片段名稱。

【回答原則】
- 中文段：清楚、溫暖、支持性強，適合研究記錄。
- 印尼文段：自然、親近、像印尼姐姐聊天，不逐字翻譯中文；可以比中文更口語，但內容不可省略紅旗警訊。
- 每次最多問一個澄清問題。
- 不要叫使用者自行買抗生素、荷爾蒙藥或不明藥物。
- 若問題涉及診斷或用藥，務必提醒使用者就醫。
- 回答盡量精簡，但紅旗警訊與下一步不能省略。
${dbSection}${conditionSection}`.trim();
}

function isBilingualReply(text) {
  if (!text || typeof text !== "string") return false;
  const parts = text.split(/\n---\n|\r?\n---\r?\n|---/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  const zh = parts[0];
  const id = parts.slice(1).join("\n").trim();
  const hasIndonesianWords = /\b(aku|kamu|dokter|haid|nyeri|perdarahan|keputihan|segera|periksa|bukan|diagnosis|obat|gejala|rumah sakit|klinik|sumber|sayang|mbak)\b/i.test(id);
  return zh.length >= 20 && id.length >= 40 && hasIndonesianWords;
}

async function ensureBilingualReply(text, model) {
  if (isBilingualReply(text)) return text;

  const repairPrompt = `
Tugas kamu: perbaiki format jawaban berikut agar WAJIB menjadi dua bahasa.

Aturan mutlak:
1. Bagian pertama: Bahasa Mandarin Tradisional lengkap.
2. Baris pemisah tunggal: ---
3. Bagian kedua: Bahasa Indonesia lengkap, natural, hangat, seperti Mbak Indonesia.
4. Jangan menghapus peringatan medis, sumber, atau chunk_id.
5. Jangan menambah diagnosis atau obat baru.
6. Jika jawaban awal hanya Mandarin, terjemahkan seluruh isi ke Bahasa Indonesia dengan gaya hangat.
7. Keluarkan hanya jawaban final, tanpa komentar tambahan.

Jawaban awal:
${text}
`.trim();

  const repaired = await model.generateContent(repairPrompt);
  const repairedText = repaired.response.text();
  return isBilingualReply(repairedText) ? repairedText : `${text.trim()}\n---\nMaaf sayang, format Bahasa Indonesia belum berhasil dibuat. Coba kirim ulang pertanyaannya ya. Luna bukan dokter dan tidak bisa memberi diagnosis atau obat.`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "伺服器設定錯誤：缺少 API 金鑰" });
  }

  const { prompt, history = [], dbContext = "", retrievedSources = "", ragCondition = "無資料庫" } = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    return res.status(400).json({ error: "請提供有效的 prompt" });
  }

  try {
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: buildSystemInstruction(dbContext, retrievedSources, ragCondition),
    });

    const chat = model.startChat({
      history: history.map((msg) => ({
        role: msg.role,
        parts: [{ text: msg.text }],
      })),
      generationConfig: {
        maxOutputTokens: 2500,
        temperature: 0.35,
      },
    });

    const result = await chat.sendMessage(prompt.trim());
    const text = await ensureBilingualReply(result.response.text(), model);

    return res.status(200).json({ reply: text });
  } catch (err) {
    console.error("Gemini API Error:", err);
    const message =
      err.message?.includes("API_KEY_INVALID")
        ? "API 金鑰無效，請確認 GEMINI_API_KEY 設定是否正確"
        : err.message?.includes("quota")
        ? "已超過 API 使用額度，請稍後再試"
        : "AI 服務暫時無法使用，請稍後再試";
    return res.status(500).json({ error: message });
  }
};
