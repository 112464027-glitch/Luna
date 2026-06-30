const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function normalizeRagLevel(ragCondition = "無資料庫") {
  const text = String(ragCondition).toLowerCase();
  if (text.includes("300")) return "300";
  if (text.includes("100")) return "100";
  if (text.includes("60")) return "60";
  if (text.includes("20")) return "20";
  return "none";
}

function getMaxOutputTokensByLevel(ragCondition = "無資料庫") {
  const level = normalizeRagLevel(ragCondition);
  return {
    none: 850,
    "20": 1050,
    "60": 1450,
    "100": 2000,
    "300": 3200,
  }[level] || 1200;
}

function buildProgressionContract(ragCondition = "無資料庫") {
  const level = normalizeRagLevel(ragCondition);
  const contracts = {
    none: `
【本輪進展式回答契約：無資料庫 baseline】
你必須刻意維持「低資訊量」。只允許：
1. 一句最基本衛教方向。
2. 一句安全提醒。
3. 一個下一步建議。
嚴格禁止：列症狀清單、診斷流程、排除病因、生育影響、後續追蹤、醫師可問問題、來源 chunk_id。
中文段落控制在 120 字以內；印尼文段也要同等簡短。
`.trim(),
    "20": `
【本輪進展式回答契約：20 筆資料庫】
本輪只能呈現「第一層進展：核心定義」。只允許：
1. 情緒承接：一句溫柔承接。
2. 陪她整理：回答核心定義或基本差異。
3. 安全提醒：最多 1 個最重要紅旗警訊。
4. 本次使用來源：列 1–2 個 chunk_id 或片段名稱。
嚴格禁止：完整症狀清單、診斷流程、排除病因、生育影響、後續追蹤、檢查項目、治療細節、可問醫師問題。
如果檢索片段含有更深資料，也不能在 20 筆條件提前講出來。
`.trim(),
    "60": `
【本輪進展式回答契約：60 筆資料庫】
本輪必須比 20 筆多，但只能呈現「第二層進展：症狀辨識與警訊」。必須包含：
1. 情緒承接。
2. 核心定義或差異。
3. 2–3 個相關症狀或辨識線索。
4. 2 個需要就醫的警訊。
5. 本次使用來源：列 2–4 個 chunk_id 或片段名稱。
嚴格禁止：系統性診斷流程、鑑別/排除病因、生育影響、長期追蹤計畫、完整醫師提問清單。
不要把 100 或 300 筆才該出現的內容提前講完。
`.trim(),
    "100": `
【本輪進展式回答契約：100 筆資料庫】
本輪必須比 60 筆多，呈現「第三層進展：診斷流程與排除病因」。必須包含：
1. 情緒承接。
2. 核心定義或差異。
3. 症狀/警訊。
4. 醫師可能如何評估：病史、理學/骨盆檢查、超音波、抽血、感染檢驗等，依題目選擇相關項目。
5. 需要排除的相似病因或風險狀況。
6. 本次使用來源：列 4–7 個 chunk_id 或片段名稱。
限制：生育影響只能在題目直接詢問時簡短提到；不要展開長期追蹤、台灣就醫流程、完整醫病溝通腳本，那是 300 筆條件。
`.trim(),
    "300": `
【本輪進展式回答契約：300 筆資料庫】
本輪必須明顯比 100 筆更完整，呈現「第四層進展：完整照顧脈絡」。必須包含：
1. 情緒承接，語氣像自然的印尼姐姐，不要像翻譯腔。
2. 核心定義或差異。
3. 症狀與警訊。
4. 診斷流程與需要排除的病因。
5. 若主題相關，說明生育、長期健康或心理壓力影響。
6. 後續追蹤或回診觀察重點。
7. 陪她準備 2–3 個可以問醫師的問題。
8. 用自然印尼語補上文化/語用上較像真人的說法。
9. 本次使用來源：列 6–12 個 chunk_id 或片段名稱。
這一層不能只是把 100 筆重講一次；必須新增「追蹤、就醫準備、醫病溝通、生育/長期影響」至少兩類內容。
`.trim(),
  };
  return contracts[level] || contracts.none;
}

function buildSystemInstruction(dbContext, retrievedSources = "", ragCondition = "無資料庫") {
  const dbSection = dbContext
    ? `\n\n【本次檢索到的婦科知識片段】\n以下不是完整資料庫，而是系統依使用者問題挑出的 top-k 片段。你必須優先根據這些片段回答；若片段不足，請明確說資料不足，不要假裝知道。\n\n${dbContext}\n\n【本次命中來源】\n${retrievedSources || "未提供"}\n`
    : "";
  const conditionSection = dbContext
    ? `\n\n【本次 RAG 實驗條件】${ragCondition}。你只能根據本次提供的片段作答，不可引用未提供的資料庫內容。`
    : `\n\n【本次 RAG 實驗條件】無資料庫 baseline。這一輪沒有提供任何資料庫片段。你可以用一般健康教育常識回答，但不可聲稱「根據資料庫」、不可列 chunk_id、不可列「本次使用來源」為任何資料庫片段。結尾請寫：「本次使用來源：無資料庫 baseline」。`;
  const depthSection = buildProgressionContract(ragCondition);

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
（第二段：Bahasa Indonesia 在地化改寫，意思與中文一致，但不要逐字翻譯）

重要規定：
1. 中文段和印尼文段之間只用單獨一行「---」分隔
2. 兩段都必須是完整內容；印尼文不能只是摘要或省略，但必須用印尼人自然會說的句子重新表達
3. 絕對不可以只回覆中文、只回覆印尼文、或跳過任何一段
4. 即使問題很簡單，也必須同時提供中文和印尼文兩段完整回答
5. 免責聲明也必須中文和印尼文各一份，分別放在各自段落的結尾

【Bahasa Indonesia 在地口吻規則】
- 印尼文不是中文逐字翻譯；請先理解中文重點，再用自然 Bahasa Indonesia 重寫。
- 口吻要像印尼女性日常聊天：溫暖、簡短、有人味，但不要亂承諾或假裝醫療經驗。
- 可以自然使用：Mbak、sayang、pelan-pelan ya、aku paham、nggak perlu langsung panik、kita rapikan dulu、kalau begini sebaiknya cek ke dokter。
- 避免過度正式的翻譯腔，例如「melakukan evaluasi lebih lanjut」可以視情境改成「perlu diperiksa lagi」或「dokter perlu cek lebih jauh」。
- 醫學詞第一次出現可用「簡單詞＋醫學詞」，例如 nyeri haid (dismenore)、radang panggul (PID)、kista ovarium。
- 句子要短一點、像真人安撫與整理，不要像客服、表單、Google Translate 或中文語序。

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
- 印尼文段：自然、親近、像印尼姐姐聊天，不逐字翻譯中文；可以比中文更口語、更在地，但內容不可省略紅旗警訊。
- 每次最多問一個澄清問題。
- 不要叫使用者自行買抗生素、荷爾蒙藥或不明藥物。
- 若問題涉及診斷或用藥，務必提醒使用者就醫。
- 回答詳略必須依照 RAG 條件調整；無資料庫與20筆要簡短，100與300筆要明顯更完整，但紅旗警訊與下一步都不能省略。
${dbSection}${conditionSection}

${depthSection}`.trim();
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
3. Bagian kedua: Bahasa Indonesia lengkap, natural, hangat, seperti Mbak Indonesia; jangan terasa seperti Google Translate.
4. Jangan menghapus peringatan medis, sumber, atau chunk_id.
5. Jangan menambah diagnosis atau obat baru.
6. Jika jawaban awal hanya Mandarin, tulis ulang seluruh isi ke Bahasa Indonesia yang hangat dan lokal. Jangan terjemahkan kata demi kata.
7. Keluarkan hanya jawaban final, tanpa komentar tambahan.
8. Pertahankan tingkat detail sesuai kondisi RAG dalam jawaban awal; jangan membuat jawaban pendek jika kondisi 300.
9. Gunakan gaya Indonesia sehari-hari: kalimat pendek, lembut, dan natural. Boleh pakai “nggak”, “kalau”, “pelan-pelan ya”, “Mbak”, atau “sayang” secukupnya.
10. Hindari struktur yang terdengar seperti Mandarin, kalimat terlalu panjang, atau istilah medis kaku tanpa penjelasan sederhana.

Jawaban awal:
${text}
`.trim();

  const repaired = await model.generateContent(repairPrompt);
  const repairedText = repaired.response.text();
  return isBilingualReply(repairedText) ? repairedText : `${text.trim()}\n---\nMaaf sayang, format Bahasa Indonesia belum berhasil dibuat. Coba kirim ulang pertanyaannya ya. Luna bukan dokter dan tidak bisa memberi diagnosis atau obat.`;
}

function extractRagFacts(dbContext = "") {
  const zhFacts = [...String(dbContext).matchAll(/answer_zh:\s*([^\n]+)/g)].map((m) => m[1].trim()).filter(Boolean);
  const idFacts = [...String(dbContext).matchAll(/answer_id:\s*([^\n]+)/g)].map((m) => m[1].trim()).filter(Boolean);
  const chunks = [...String(dbContext).matchAll(/chunk_id:\s*([^\n]+)/g)].map((m) => m[1].trim()).filter(Boolean);
  return {
    zhFacts: [...new Set(zhFacts)],
    idFacts: [...new Set(idFacts)],
    chunks: [...new Set(chunks)],
  };
}

function firstItems(items, count, fallback) {
  const picked = items.filter(Boolean).slice(0, count);
  return picked.length ? picked : [fallback];
}

function formatSources(chunks, retrievedSources, count) {
  const fromChunks = firstItems(chunks, count, "").filter(Boolean);
  if (fromChunks.length) return fromChunks.join("、");
  return retrievedSources || "本次檢索片段";
}

function buildFallbackReply(prompt, dbContext = "", retrievedSources = "", ragCondition = "無資料庫") {
  const level = normalizeRagLevel(ragCondition);
  const { zhFacts, idFacts, chunks } = extractRagFacts(dbContext);
  const sourceCount = { none: 0, "20": 2, "60": 4, "100": 7, "300": 12 }[level] || 2;
  const sources = formatSources(chunks, retrievedSources, sourceCount);
  const zh = firstItems(zhFacts, 8, "目前沒有足夠的資料庫片段可支持詳細回答，因此 Luna 只能先陪你整理一般就醫安全建議。");
  const id = firstItems(idFacts, 8, "Saat ini potongan basis data belum cukup untuk memberi jawaban rinci, jadi Luna temani kamu merapikan arahan keamanan umum dulu.");

  if (level === "none") {
    return `我知道這種問題會讓人有點不安。先用最基本方式看：如果症狀持續、變嚴重，或有劇烈疼痛、大量出血、發燒、暈厥，請儘快就醫。你可以先記錄症狀開始時間。本次使用來源：無資料庫 baseline。\n---\nAku paham ini bisa bikin khawatir. Gambaran gampangnya begini, sayang: kalau gejalanya terus muncul, makin berat, atau ada nyeri hebat, perdarahan banyak, demam, atau pingsan, sebaiknya cepat periksa ya. Kamu bisa mulai dari mencatat kapan gejalanya muncul. Sumber yang dipakai: baseline tanpa basis data.`;
  }

  if (level === "20") {
    return `我先陪你抓最核心的重點：${zh[0]}\n\n先不用自己嚇自己，但如果症狀突然變嚴重、疼痛很強、發燒、暈厥或大量出血，請儘快就醫。\n\n本次使用來源：${sources}\n---\nAku temani kamu ambil inti utamanya dulu: ${id[0]}\n\nPelan-pelan ya, tidak perlu langsung panik. Tapi kalau gejala tiba-tiba memburuk, nyeri sangat kuat, demam, pingsan, atau perdarahan banyak, sebaiknya segera periksa.\n\nSumber yang dipakai: ${sources}`;
  }

  if (level === "60") {
    return `我知道你想弄清楚差別，我們慢慢整理。核心重點是：${zh[0]}\n\n可以觀察的症狀線索：\n1. ${zh[1] || zh[0]}\n2. ${zh[2] || "症狀是否持續、變嚴重，或和月經、分泌物、發燒等變化一起出現。"}\n\n比較需要趕快就醫的是：劇烈疼痛、大量出血、發燒、暈厥、懷孕合併出血，或症狀快速惡化。\n\n本次使用來源：${sources}\n---\nAku paham kamu ingin membedakan kondisinya, kita rapikan pelan-pelan ya. Intinya: ${id[0]}\n\nTanda gejala yang bisa diperhatikan:\n1. ${id[1] || id[0]}\n2. ${id[2] || "Apakah gejala menetap, makin berat, atau muncul bersama perubahan haid, keputihan, atau demam."}\n\nYang sebaiknya cepat diperiksa: nyeri hebat, perdarahan banyak, demam, pingsan, hamil disertai perdarahan, atau gejala cepat memburuk.\n\nSumber yang dipakai: ${sources}`;
  }

  if (level === "100") {
    return `你願意把問題問清楚很重要，我們把它整理成看診時能用的方向。核心重點：${zh[0]}\n\n症狀與警訊：${zh[1] || zh[0]}\n\n醫師可能會怎麼評估：通常會問症狀開始時間、月經或出血狀況、疼痛位置、是否發燒、是否可能懷孕與過去病史；再依情況安排骨盆檢查、超音波、抽血或感染檢驗。\n\n需要排除的狀況：醫師會判斷是否可能有感染、荷爾蒙或排卵問題、卵巢/子宮結構問題，或其他需要急性處理的原因。\n\n本次使用來源：${sources}\n---\nMakasih ya sudah bertanya dengan jelas. Kita susun jadi bekal untuk periksa. Intinya: ${id[0]}\n\nGejala dan tanda bahaya: ${id[1] || id[0]}\n\nBiasanya dokter akan mulai dari cerita gejalanya dulu: kapan mulai, pola haid atau perdarahan, bagian mana yang nyeri, ada demam atau tidak, kemungkinan hamil, dan riwayat kesehatan. Setelah itu, kalau perlu, dokter bisa menyarankan pemeriksaan panggul, USG, tes darah, atau cek infeksi.\n\nHal yang perlu disingkirkan: dokter akan menilai kemungkinan infeksi, masalah hormon atau ovulasi, masalah struktur ovarium/rahim, atau kondisi akut yang perlu ditangani cepat.\n\nSumber yang dipakai: ${sources}`;
  }

  return `我陪你把它整理完整一點，這樣你去看診時比較不會慌。核心重點：${zh[0]}\n\n症狀與警訊：\n1. ${zh[1] || zh[0]}\n2. ${zh[2] || "若症狀持續、加劇，或合併出血、發燒、暈厥，需要提高警覺。"}\n\n診斷與排除方向：${zh[3] || "醫師通常會依病史、身體/骨盆檢查、超音波、抽血或感染檢驗來判斷，並排除相似病因。"}\n\n生育或長期影響：${zh[4] || "若問題與卵巢功能、慢性發炎、荷爾蒙或排卵相關，可能需要進一步評估生育與長期健康影響。"}\n\n後續可以記錄：症狀何時出現、疼痛程度、出血量、分泌物變化、是否發燒，以及休息或用藥後是否改善。\n\n你可以溫和但清楚地問醫師：\n1. 目前最需要排除的是哪幾種原因？\n2. 我需要超音波、抽血或感染檢查嗎？\n3. 如果症狀再出現，什麼情況要立刻回診或急診？\n\n本次使用來源：${sources}\n---\nAku temani kamu rapikan lebih lengkap ya, supaya saat periksa kamu tidak terlalu bingung. Intinya: ${id[0]}\n\nGejala dan tanda bahaya:\n1. ${id[1] || id[0]}\n2. ${id[2] || "Kalau gejala menetap, makin berat, atau disertai perdarahan, demam, atau pingsan, perlu lebih waspada."}\n\nArah diagnosis dan hal yang perlu disingkirkan: ${id[3] || "Dokter biasanya menilai dari riwayat gejala, pemeriksaan tubuh/panggul, USG, tes darah, atau pemeriksaan infeksi, lalu menyingkirkan penyebab yang mirip."}\n\nDampak kesuburan atau jangka panjang: ${id[4] || "Jika berkaitan dengan fungsi ovarium, peradangan kronis, hormon, atau ovulasi, dampak kesuburan dan kesehatan jangka panjang mungkin perlu dinilai."}\n\nYang bisa kamu catat: kapan gejala muncul, tingkat nyeri, jumlah perdarahan, perubahan keputihan, apakah ada demam, dan apakah membaik setelah istirahat atau obat.\n\nKamu bisa tanya dokter dengan pelan tapi jelas:\n1. Penyebab apa yang paling perlu disingkirkan sekarang?\n2. Apakah saya perlu USG, tes darah, atau pemeriksaan infeksi?\n3. Kalau gejala muncul lagi, kapan harus segera kembali atau ke UGD?\n\nSumber yang dipakai: ${sources}`;
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
        maxOutputTokens: getMaxOutputTokensByLevel(ragCondition),
        temperature: 0.25,
      },
    });

    const result = await chat.sendMessage(prompt.trim());
    const text = await ensureBilingualReply(result.response.text(), model);

    return res.status(200).json({ reply: text });
  } catch (err) {
    console.error("Gemini API Error:", err);
    const fallback = buildFallbackReply(prompt.trim(), dbContext, retrievedSources, ragCondition);
    return res.status(200).json({ reply: fallback, fallback: true });
    /*
    const message =
      err.message?.includes("API_KEY_INVALID")
        ? "API 金鑰無效，請確認 GEMINI_API_KEY 設定是否正確"
        : err.message?.includes("quota")
        ? "已超過 API 使用額度，請稍後再試"
        : "AI 服務暫時無法使用，請稍後再試";
    return res.status(500).json({ error: message });
    */
  }
};
