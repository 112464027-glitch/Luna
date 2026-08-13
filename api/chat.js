const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function normalizeRagLevel(ragCondition = "420 筆資料庫") {
  const text = String(ragCondition).toLowerCase();
  if (text.includes("420")) return "420";
  if (text.includes("300")) return "300";
  if (text.includes("100")) return "100";
  if (text.includes("60")) return "60";
  if (text.includes("20")) return "20";
  return "none";
}

function getMaxOutputTokensByLevel(ragCondition = "420 筆資料庫") {
  const level = normalizeRagLevel(ragCondition);
  return {
    none: 850,
    "20": 1050,
    "60": 1450,
    "100": 2000,
    "300": 3200,
    "420": 2400,
  }[level] || 1200;
}

function buildProgressionContract(ragCondition = "420 筆資料庫") {
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
1. 先整理重點：回答使用者問的核心定義或基本差異。
2. 需要注意：最多 1 個最重要紅旗警訊。
3. 本次使用來源：列 1–2 個 chunk_id 或片段名稱。
嚴格禁止：完整症狀清單、診斷流程、排除病因、生育影響、後續追蹤、檢查項目、治療細節、可問醫師問題。
如果檢索片段含有更深資料，也不能在 20 筆條件提前講出來。
`.trim(),
    "60": `
【本輪進展式回答契約：60 筆資料庫】
本輪必須比 20 筆多，但只能呈現「第二層進展：症狀辨識與警訊」。必須包含：
1. 核心定義或差異。
2. 2–3 個相關症狀或辨識線索。
3. 2 個需要就醫的警訊。
4. 本次使用來源：列 2–4 個 chunk_id 或片段名稱。
嚴格禁止：系統性診斷流程、鑑別/排除病因、生育影響、長期追蹤計畫、完整醫師提問清單。
不要把 100 或 300 筆才該出現的內容提前講完。
`.trim(),
    "100": `
【本輪進展式回答契約：100 筆資料庫】
本輪必須比 60 筆多，呈現「第三層進展：診斷流程與排除病因」。必須包含：
1. 核心定義或差異。
2. 症狀/警訊。
3. 醫師可能如何評估：病史、理學/骨盆檢查、超音波、抽血、感染檢驗等，依題目選擇相關項目。
4. 需要排除的相似病因或風險狀況。
5. 本次使用來源：列 4–7 個 chunk_id 或片段名稱。
限制：生育影響只能在題目直接詢問時簡短提到；不要展開長期追蹤、台灣就醫流程、完整醫病溝通腳本，那是 300 筆條件。
`.trim(),
    "300": `
【本輪進展式回答契約：300 筆資料庫】
本輪必須明顯比 100 筆更完整，呈現「第四層進展：完整照顧脈絡」。必須包含：
1. 核心定義或差異。
2. 症狀與警訊。
3. 診斷流程與需要排除的病因。
4. 若主題相關，說明生育、長期健康或心理壓力影響。
5. 後續追蹤或回診觀察重點。
6. 使用者可以帶去看診的 2–3 個問題。
7. 用自然印尼語補上文化/語用上較像真人的說法。
8. 本次使用來源：列 6–12 個 chunk_id 或片段名稱。
這一層不能只是把 100 筆重講一次；必須新增「追蹤、就醫準備、醫病溝通、生育/長期影響」至少兩類內容。
`.trim(),
    "420": `
【本輪進展式回答契約：420 筆擴充資料庫】
本輪是目前最完整的擴充資料庫，必須比 300 筆更能處理白帶、陰道分泌物、keputihan、異味、搔癢等問題。
如果使用者問分泌物/白帶/keputihan，必須優先回答分泌物主題，不可轉去經痛、PCOS 或其他主題。
必須包含：
1. 核心定義或可能原因。
2. 正常變化與異常警訊的區分。
3. 醫師可能如何檢查與需要排除的感染或其他原因。
4. 自我照護與不要自行亂用抗生素/塞劑的提醒。
5. 何時需要就醫或急診。
6. 使用者可以問醫師的 2–3 個問題。
7. 自然 Bahasa Indonesia 表達，不要 Google 翻譯腔。
8. 本次使用來源：列 6–14 個 chunk_id 或片段名稱。
`.trim(),
  };
  return contracts[level] || contracts.none;
}

function buildExperimentAnswerContract() {
  return `
【本研究固定回答契約：資料內容一致，只操弄支持性語氣】
420 筆代表可檢索的候選知識池大小，不代表每次回答要把大量資料全部說完；回答長度由使用者問題決定。

作答前先在內部形成相同的醫療內容計畫，再套用本組語氣；不要輸出計畫本身：
1. 問題重點：只回答使用者真正詢問的主題，不可因片段提到 PCOS、POI 或其他疾病就自行改題或暗示診斷。
2. 醫療回答優先：「醫療回答」先用一個連貫段落整合核心說明、主要原因、現在可做的處理與證據支持的治療方向；該段不得少於150個中文字，通常控制在180–450字，視覺上至少約四行。不得改成四個短條列，也不得只教使用者怎麼看醫生。
3. 就醫賦權輔助：在醫療問題回答完後，才補充症狀紀錄、檢查方向、可詢問醫師的問題與中印尼雙語看診說明句。
4. 需要儘快就醫的情況：只列與問題或已描述症狀相關的 1–2 個警訊；不要每題都貼完整通用警訊清單。
5. 本次使用來源：只列實際支持上述內容的 3–5 個 chunk_id，不得列來源網址、內部標籤或未使用片段。

嚴格禁止：
- 輸出「深度回答素材」「Luna 應清楚說」「可用的醫病溝通句」等資料庫內部文字。
- 把檢索片段逐段貼上、重複同一句事實，或為了湊段落加入診斷流程、生育影響與長期追蹤。
- 將「月經」自動等同於 PCOS；資訊不足時最多問一個澄清問題。
- 中文與印尼文使用不同醫療事實。answer_zh 是內容依據；answer_id 只作為印尼語用詞參考，印尼文必須完整表達與中文相同的事實、警訊、下一步及來源。

一般完整回覆以繁體中文約 500–850 字為原則，印尼文資訊量相等。依序呈現：核心醫療回答、可能原因與判斷線索、現在可做的安全處理、證據支持的治療方向、相關警訊，最後才是必要的就醫賦權資訊。完整不等於推測診斷，也不能加入無關疾病或重複片段。
`.trim();
}

function buildClarificationReply() {
  return `問題重點：妳問「月經怎麼辦」，但月經問題可能是週期不規律、經痛、出血量改變或月經沒來；一時不知道怎麼描述是可以理解的，我們可以一步一步整理。

現在不用一次說得很完整，可以先記錄最近一次月經日期、平常週期、本次疼痛或出血變化，以及是否可能懷孕。我們先把最明顯的變化整理出來。

妳現在比較在意的是：①月經不規律或沒來、②經痛、③經血量很多或非經期出血，還是④分泌物或其他不舒服？若有劇烈疼痛、大量出血、暈厥，或可能懷孕且出血，建議儘快就醫。

本次使用來源：尚未使用特定資料片段，等待問題釐清。
---
Intinya: kamu bertanya harus bagaimana soal haid, tetapi masalahnya bisa berupa haid tidak teratur, nyeri haid, perubahan jumlah darah, atau haid yang belum datang. Wajar kalau belum tahu cara menjelaskannya; kita bisa merapikannya pelan-pelan.

Tidak perlu menjelaskan semuanya sekaligus. Kamu bisa mulai dengan mencatat tanggal haid terakhir, pola haid biasanya, perubahan nyeri atau perdarahan kali ini, dan apakah mungkin hamil. Kita rapikan dulu perubahan yang paling terlihat.

Saat ini kamu paling khawatir tentang yang mana: ① haid tidak teratur atau belum datang, ② nyeri haid, ③ darah sangat banyak atau perdarahan di luar haid, atau ④ keputihan maupun keluhan lain? Jika ada nyeri hebat, perdarahan banyak, pingsan, atau kemungkinan hamil disertai perdarahan, sebaiknya segera periksa.

Sumber yang dipakai: belum memakai potongan khusus karena pertanyaannya masih perlu diperjelas.`;
}

function parseEvidenceContext(dbContext = "") {
  return String(dbContext)
    .split(/(?=【證據\s+\d+】)/)
    .map((block) => {
      const field = (name) => block.match(new RegExp(`(?:^|\\n)${name}:[ \\t]*([^\\n]+)`, "i"))?.[1]?.trim() || "";
      return {
        chunkId: field("chunk_id"),
        type: field("type"),
        answerZh: field("answer_zh"),
        answerId: field("answer_id"),
        redFlagsZh: field("red_flags_zh") || field("red_flags"),
        redFlagsId: field("red_flags_id"),
        sourceName: field("source_name"),
      };
    })
    .filter((item) => item.chunkId && item.answerZh && item.answerId)
    .filter((item, index, items) => items.findIndex((other) => other.answerZh === item.answerZh) === index)
    .slice(0, 5);
}

function getOfficialDialogueSupport(chunkId = "") {
  const code = String(chunkId).toUpperCase();
  const bundle = /^V[23]-(?:HPV|HPA)-/.test(code)
    ? "CERVICAL"
    : code.match(/^V[23]-([A-Z]+)-/)?.[1] || "GENERAL";
  const support = {
    MEN: {
      questionZh: "看診時可以問：①依我的週期紀錄與懷孕可能，目前需要先做哪些評估？②如果月經仍沒來，多久應再回診？",
      questionId: "Saat periksa, kamu bisa bertanya: ① Berdasarkan catatan siklus dan kemungkinan hamil, pemeriksaan apa yang perlu dilakukan dulu? ② Jika haid tetap belum datang, kapan perlu kontrol lagi?",
      followUpZh: "若要繼續由 Luna 協助整理，請告訴我：最後一次月經何時開始、平常週期約幾天、目前遲了多久、是否可能懷孕，以及有沒有腹痛或出血？",
      followUpId: "Kalau ingin lanjut merapikan bersama Luna, kapan hari pertama haid terakhir, biasanya siklusmu berapa hari, sekarang terlambat berapa lama, apakah mungkin hamil, dan apakah ada nyeri perut atau perdarahan?",
    },
    AUB: {
      questionZh: "看診時可以問：①依我的出血量與週期，需要驗孕、抽血或超音波嗎？②哪些變化表示我需要更快回診？",
      questionId: "Saat periksa, kamu bisa bertanya: ① Berdasarkan jumlah darah dan pola siklus saya, apakah perlu tes kehamilan, tes darah, atau USG? ② Perubahan apa yang berarti saya perlu kembali lebih cepat?",
      followUpZh: "若要繼續整理，請告訴我：出血第幾天、每小時大約更換幾片衛生棉、是否有大血塊，以及有沒有頭暈、胸痛、呼吸困難或懷孕可能？",
      followUpId: "Kalau ingin lanjut, perdarahan sudah hari ke berapa, kira-kira berapa pembalut yang diganti tiap jam, apakah ada gumpalan besar, pusing, nyeri dada, sesak napas, atau kemungkinan hamil?",
    },
    DYSM: {
      questionZh: "看診時可以問：①這種疼痛是否需要評估次發性經痛？②依我的症狀是否需要超音波或其他檢查？",
      questionId: "Saat periksa, kamu bisa bertanya: ① Apakah nyeri ini perlu dinilai sebagai nyeri haid sekunder? ② Berdasarkan gejala saya, apakah perlu USG atau pemeriksaan lain?",
      followUpZh: "若要繼續整理，請告訴我：疼痛從何時開始、0到10分有多痛、是否逐月加重，以及有沒有發燒、大量出血、昏厥或懷孕可能？",
      followUpId: "Kalau ingin lanjut, sejak kapan nyeri mulai, seberapa berat dari 0 sampai 10, apakah makin berat tiap bulan, dan apakah ada demam, perdarahan banyak, pingsan, atau kemungkinan hamil?",
    },
    VAG: {
      questionZh: "看診時可以問：①這次需要做分泌物採樣或感染檢驗嗎？②檢查前有哪些藥物或清潔用品需要暫停？",
      questionId: "Saat periksa, kamu bisa bertanya: ① Apakah kali ini perlu pengambilan sampel keputihan atau tes infeksi? ② Obat atau produk pembersih apa yang perlu dihentikan sebelum pemeriksaan?",
      followUpZh: "若要繼續整理，請告訴我：分泌物何時開始改變、顏色與氣味、是否搔癢或灼熱，以及有沒有下腹痛、發燒、出血或懷孕可能？",
      followUpId: "Kalau ingin lanjut, sejak kapan keputihan berubah, bagaimana warna dan baunya, apakah gatal atau terasa panas, dan apakah ada nyeri perut bawah, demam, perdarahan, atau kemungkinan hamil?",
    },
    PID: {
      questionZh: "看診時可以問：①我的症狀是否需要感染檢驗或其他檢查？②若開始治療，哪些變化表示不必等滿72小時就要回診？",
      questionId: "Saat periksa, kamu bisa bertanya: ① Apakah gejala saya memerlukan tes infeksi atau pemeriksaan lain? ② Jika pengobatan sudah dimulai, perubahan apa yang berarti saya tidak perlu menunggu 72 jam untuk kembali?",
      followUpZh: "若要繼續整理，請告訴我：下腹或骨盆痛有多嚴重、是否發燒或嘔吐、分泌物或出血是否異常，以及是否可能懷孕？",
      followUpId: "Kalau ingin lanjut, seberapa berat nyeri perut bawah atau panggul, apakah ada demam atau muntah, apakah keputihan atau perdarahan berubah, dan apakah mungkin hamil?",
    },
    ENDO: {
      questionZh: "看診時可以問：①依我的症狀是否需要超音波或其他評估？②治療選擇如何兼顧疼痛、生活影響與生育計畫？",
      questionId: "Saat periksa, kamu bisa bertanya: ① Berdasarkan gejala saya, apakah perlu USG atau pemeriksaan lain? ② Bagaimana pilihan penanganan dapat mempertimbangkan nyeri, dampak pada aktivitas, dan rencana kehamilan?",
      followUpZh: "若要繼續整理，請告訴我：疼痛是否與月經有關、持續多久、是否影響工作或睡眠，以及有沒有性交痛、排便排尿痛或受孕困難？",
      followUpId: "Kalau ingin lanjut, apakah nyeri berkaitan dengan haid, sudah berlangsung berapa lama, apakah mengganggu kerja atau tidur, dan apakah ada nyeri saat berhubungan, buang air, atau sulit hamil?",
    },
    CONTRA: {
      questionZh: "看診時可以問：①依我的健康狀況、可接受的副作用與生育計畫，哪些避孕方式較適合？②我是否也需要保險套來降低感染風險？",
      questionId: "Saat periksa, kamu bisa bertanya: ① Berdasarkan kondisi kesehatan, efek samping yang bisa saya terima, dan rencana kehamilan, metode apa yang cocok? ② Apakah saya juga perlu kondom untuk mengurangi risiko infeksi?",
      followUpZh: "若要繼續整理，請告訴我：妳希望避孕多久、未來是否計畫懷孕、最在意便利性或副作用中的哪一點，以及是否需要同時預防性傳染感染？",
      followUpId: "Kalau ingin lanjut, berapa lama kamu ingin mencegah kehamilan, apakah ada rencana hamil nanti, apa yang paling penting soal kemudahan atau efek samping, dan apakah juga perlu perlindungan dari infeksi menular seksual?",
    },
    CERVICAL: {
      questionZh: "看診時可以問：①依我的年齡與過去篩檢紀錄，目前適合做抹片或HPV檢測嗎？②我是否需要諮詢HPV疫苗？",
      questionId: "Saat periksa, kamu bisa bertanya: ① Berdasarkan usia dan riwayat skrining saya, apakah sekarang perlu Pap smear atau tes HPV? ② Apakah saya perlu berkonsultasi tentang vaksin HPV?",
      followUpZh: "若要繼續整理，請告訴我：妳的年齡、以前是否做過子宮頸抹片或HPV檢測、最近一次結果，以及是否接種過HPV疫苗？",
      followUpId: "Kalau ingin lanjut, berapa usiamu, apakah pernah Pap smear atau tes HPV, bagaimana hasil terakhirnya, dan apakah sudah pernah mendapat vaksin HPV?",
    },
    CYST: {
      questionZh: "看診時可以問：依囊腫的大小與超音波外觀，適合先追蹤還是需要治療？",
      questionId: "Saat periksa, kamu bisa bertanya: berdasarkan ukuran dan gambaran USG kista, apakah cukup dipantau atau perlu ditangani?",
      followUpZh: "若要繼續整理，請告訴我囊腫大小、超音波怎麼描述，以及是否有單側下腹痛、腹脹、噁心或暈厥？",
      followUpId: "Kalau ingin lanjut, berapa ukuran kista, bagaimana hasil USG menjelaskannya, dan apakah ada nyeri satu sisi, kembung, mual, atau pingsan?",
    },
    PCOS: {
      questionZh: "看診時可以問：依我的月經、雄性素表現與檢查結果，目前最需要處理的是週期、代謝風險還是生育需求？",
      questionId: "Saat periksa, kamu bisa bertanya: berdasarkan haid, tanda androgen, dan hasil pemeriksaan saya, apakah prioritasnya mengatur siklus, risiko metabolik, atau rencana hamil?",
      followUpZh: "若要繼續整理，請告訴我月經間隔、最近一次月經、痘痘或毛髮變化、體重變化，以及目前是否希望懷孕？",
      followUpId: "Kalau ingin lanjut, bagaimana jarak haid, kapan haid terakhir, apakah ada perubahan jerawat, rambut, atau berat badan, dan apakah sedang ingin hamil?",
    },
    MENO: {
      questionZh: "看診時可以問：依我的症狀與病史，較適合生活調整、非荷爾蒙治療，還是荷爾蒙治療？",
      questionId: "Saat periksa, kamu bisa bertanya: berdasarkan gejala dan riwayat saya, apakah lebih sesuai perubahan gaya hidup, terapi nonhormonal, atau terapi hormon?",
      followUpZh: "若要繼續整理，請告訴我年齡、最後一次月經、熱潮紅與睡眠影響，以及是否有停經後出血？",
      followUpId: "Kalau ingin lanjut, berapa usia kamu, kapan haid terakhir, bagaimana hot flush dan gangguan tidur, dan apakah ada perdarahan setelah menopause?",
    },
    POI: {
      questionZh: "看診時可以問：目前需要哪些檢查確認原因，治療如何兼顧症狀、骨骼、心血管與生育需求？",
      questionId: "Saat periksa, kamu bisa bertanya: pemeriksaan apa yang diperlukan untuk memastikan penyebab, dan bagaimana terapi mempertimbangkan gejala, tulang, jantung, serta kesuburan?",
      followUpZh: "若要繼續整理，請告訴我年齡、月經改變多久、是否有熱潮紅或陰道乾澀，以及懷孕與生育計畫？",
      followUpId: "Kalau ingin lanjut, berapa usia kamu, sudah berapa lama haid berubah, apakah ada hot flush atau vagina kering, dan bagaimana rencana kehamilan?",
    },
    GENERAL: {
      questionZh: "看診時可以問：「依我的症狀與紀錄，下一步最需要確認什麼？」",
      questionId: "Saat periksa, kamu bisa bertanya: ‘Berdasarkan gejala dan catatan saya, hal apa yang paling perlu dipastikan selanjutnya?’",
      followUpZh: "若要繼續整理，請告訴我症狀何時開始、嚴重程度，以及是否伴隨疼痛、出血、分泌物變化、發燒或懷孕可能？",
      followUpId: "Kalau ingin lanjut, sejak kapan gejala mulai, seberapa berat, dan apakah disertai nyeri, perdarahan, perubahan keputihan, demam, atau kemungkinan hamil?",
    },
  };
  const clinicScripts = {
    MEN: {
      clinicScriptZh: "「我的最後一次月經開始日是＿＿，平常週期約＿＿天，目前遲了＿＿天；我（有／沒有／不確定）懷孕可能，另外有＿＿。」",
      clinicScriptId: "‘Hari pertama haid terakhir saya tanggal ____. Siklus saya biasanya sekitar ____ hari dan sekarang terlambat ____ hari. Kemungkinan hamil: ada/tidak/tidak yakin. Keluhan lain: ____.’",
    },
    AUB: {
      clinicScriptZh: "「我從＿＿開始出血，目前第＿＿天；最嚴重時每小時約更換＿＿片衛生棉，血塊約＿＿大，另有＿＿症狀。」",
      clinicScriptId: "‘Saya mulai berdarah sejak ____, sekarang hari ke-____. Saat paling banyak, saya mengganti sekitar ____ pembalut per jam, ukuran gumpalan sekitar ____, dan ada keluhan ____.’",
    },
    DYSM: {
      clinicScriptZh: "「疼痛從＿＿開始，程度約＿＿／10分，會／不會影響工作或睡眠；同時有／沒有發燒、大量出血或其他症狀＿＿。」",
      clinicScriptId: "‘Nyeri mulai sejak ____, tingkatnya sekitar ____ dari 10, dan mengganggu/tidak mengganggu kerja atau tidur. Ada/tidak ada demam, perdarahan banyak, atau keluhan lain: ____.’",
    },
    VAG: {
      clinicScriptZh: "「分泌物從＿＿開始改變，顏色是＿＿、氣味是＿＿，並有／沒有搔癢、灼熱、下腹痛、發燒或出血。」",
      clinicScriptId: "‘Keputihan berubah sejak ____. Warnanya ____, baunya ____. Ada/tidak ada gatal, rasa panas, nyeri perut bawah, demam, atau perdarahan.’",
    },
    PID: {
      clinicScriptZh: "「下腹或骨盆痛從＿＿開始，程度約＿＿／10分；同時有／沒有發燒、嘔吐、分泌物或出血異常，懷孕可能是＿＿。」",
      clinicScriptId: "‘Nyeri perut bawah atau panggul mulai sejak ____, tingkatnya ____ dari 10. Ada/tidak ada demam, muntah, perubahan keputihan atau perdarahan. Kemungkinan hamil: ____.’",
    },
    ENDO: {
      clinicScriptZh: "「疼痛已持續＿＿，與月經的關係是＿＿，對工作、睡眠或性行為的影響是＿＿；我目前的生育計畫是＿＿。」",
      clinicScriptId: "‘Nyeri sudah berlangsung ____. Hubungannya dengan haid adalah ____. Dampaknya pada kerja, tidur, atau hubungan seksual adalah ____. Rencana kehamilan saya: ____.’",
    },
    CONTRA: {
      clinicScriptZh: "「我希望避孕約＿＿，未來（有／沒有／尚未確定）懷孕計畫；我最重視＿＿，最擔心的副作用或使用困難是＿＿。」",
      clinicScriptId: "‘Saya ingin mencegah kehamilan selama sekitar ____. Rencana hamil nanti: ada/tidak/belum yakin. Hal yang paling penting bagi saya adalah ____, dan efek samping atau kesulitan yang paling saya khawatirkan adalah ____.’",
    },
    CERVICAL: {
      clinicScriptZh: "「我今年＿＿歲，上次子宮頸抹片或HPV檢測是在＿＿，結果是＿＿；HPV疫苗接種情況是＿＿。」",
      clinicScriptId: "‘Usia saya ____ tahun. Pap smear atau tes HPV terakhir dilakukan pada ____, hasilnya ____. Riwayat vaksin HPV saya: ____.’",
    },
    CYST: {
      clinicScriptZh: "「超音波顯示囊腫約＿＿公分，報告描述為＿＿；我從＿＿開始有＿＿側下腹痛／腹脹，最近變化是＿＿。」",
      clinicScriptId: "‘USG menunjukkan kista sekitar ____ cm dan laporan menjelaskannya sebagai ____. Sejak ____ saya mengalami nyeri sisi ____ atau kembung, dengan perubahan terbaru ____.’",
    },
    PCOS: {
      clinicScriptZh: "「我的月經大約每＿＿天一次，最近一次是＿＿；另有＿＿變化。我目前最想改善的是＿＿，生育計畫是＿＿。」",
      clinicScriptId: "‘Haid saya biasanya setiap ____ hari dan terakhir pada ____. Perubahan lain: ____. Hal yang paling ingin saya perbaiki adalah ____, dan rencana kehamilan saya ____.’",
    },
    MENO: {
      clinicScriptZh: "「我今年＿＿歲，最後一次月經是＿＿；目前熱潮紅／睡眠／陰道乾澀對生活的影響是＿＿，另有／沒有出血。」",
      clinicScriptId: "‘Usia saya ____ tahun dan haid terakhir pada ____. Dampak hot flush, tidur, atau vagina kering pada aktivitas saya adalah ____. Ada/tidak ada perdarahan.’",
    },
    POI: {
      clinicScriptZh: "「我今年＿＿歲，月經從＿＿開始變化；另有＿＿症狀。我想了解對骨骼、心血管與生育的影響及治療選項。」",
      clinicScriptId: "‘Usia saya ____ tahun dan haid berubah sejak ____. Gejala lain: ____. Saya ingin memahami dampaknya pada tulang, jantung, kesuburan, dan pilihan terapi.’",
    },
    GENERAL: {
      clinicScriptZh: "「我的症狀從＿＿開始，最困擾的是＿＿，嚴重程度約＿＿／10分，並伴隨＿＿；我想確認是否需要檢查或回診。」",
      clinicScriptId: "‘Keluhan saya mulai sejak ____. Yang paling mengganggu adalah ____, tingkatnya sekitar ____ dari 10, disertai ____. Saya ingin memastikan apakah perlu pemeriksaan atau kontrol.’",
    },
  };
  return { ...(support[bundle] || support.GENERAL), ...(clinicScripts[bundle] || clinicScripts.GENERAL) };
}

function buildDeterministicOfficialPlan(dbContext = "") {
  const evidence = parseEvidenceContext(dbContext).filter((item) => /^V[23]-/.test(item.chunkId));
  if (!evidence.length) return null;
  const unique = (items) => [...new Set(items.filter(Boolean))];
  const uniquePairs = (items) => items.filter((item, index, all) =>
    item.answerZh && item.answerId && all.findIndex((other) => other.answerZh === item.answerZh) === index
  );
  const isWarning = (item) => /紅旗|警訊/.test(item.type);
  const isAction = (item) => /處理|治療|自我照護|預防|就醫準備/.test(item.type);
  const primary = evidence[0];
  const supporting = evidence.slice(1);
  const paragraphPairs = [primary];
  for (const item of supporting.filter((entry) => !isWarning(entry))) {
    if (paragraphPairs.map((entry) => entry.answerZh).join("").length >= 180 || paragraphPairs.length >= 5) break;
    paragraphPairs.push(item);
  }
  const paragraphChunkIds = new Set(paragraphPairs.map((item) => item.chunkId));
  const remainingSupporting = supporting.filter((item) => !paragraphChunkIds.has(item.chunkId));
  const medicalDetails = uniquePairs(remainingSupporting.filter((item) => !isWarning(item) && !isAction(item)));
  const actions = uniquePairs(remainingSupporting.filter((item) => !isWarning(item) && isAction(item)));
  const warnings = uniquePairs(evidence.filter(isWarning));
  const dialogue = getOfficialDialogueSupport(primary.chunkId);
  return {
    insufficient: false,
    direct_zh: paragraphPairs.map((item) => item.answerZh).join(""),
    direct_id: paragraphPairs.map((item) => item.answerId).join(" "),
    medical_details_zh: medicalDetails.map((item) => item.answerZh),
    medical_details_id: medicalDetails.map((item) => item.answerId),
    actions_zh: actions.map((item) => item.answerZh),
    actions_id: actions.map((item) => item.answerId),
    warning_zh: unique([
      ...evidence.map((item) => item.redFlagsZh),
      ...warnings.filter((item) => !item.redFlagsZh).map((item) => item.answerZh),
    ]).join("；"),
    warning_id: unique([
      ...evidence.map((item) => item.redFlagsId),
      ...warnings.filter((item) => !item.redFlagsId).map((item) => item.answerId),
    ]).join("; "),
    question_zh: dialogue.questionZh,
    question_id: dialogue.questionId,
    follow_up_zh: dialogue.followUpZh,
    follow_up_id: dialogue.followUpId,
    clinic_script_zh: dialogue.clinicScriptZh,
    clinic_script_id: dialogue.clinicScriptId,
    sources: unique(evidence.map((item) => item.chunkId)),
    source_names: unique(evidence.map((item) => item.sourceName)),
  };
}

async function buildGroundedContentPlan(prompt, dbContext, queryIntent, answerGoal) {
  const evidence = parseEvidenceContext(dbContext);
  const allowedSources = evidence.map((item) => item.chunkId);
  if (!allowedSources.length) throw new Error("No valid RAG evidence");

  const planner = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: `你是婦科健康對話 RAG 的內容規劃器。你只產生中立的醫療內容，不加入自主支持或情緒支持語氣。先回答醫療問題，再補充就醫準備。所有醫療說法與行動建議都必須能由提供的證據直接支持；不能因關鍵字相近就把某疾病當成使用者的狀況。若證據無法直接回答，必須標記 insufficient=true 並提出一個具體澄清問題，禁止用不相關資料硬湊。`,
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 1800,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          insufficient: { type: "BOOLEAN" },
          direct_zh: { type: "STRING" },
          direct_id: { type: "STRING" },
          actions_zh: { type: "ARRAY", items: { type: "STRING" } },
          actions_id: { type: "ARRAY", items: { type: "STRING" } },
          warning_zh: { type: "STRING" },
          warning_id: { type: "STRING" },
          question_zh: { type: "STRING" },
          question_id: { type: "STRING" },
          sources: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["insufficient", "direct_zh", "direct_id", "actions_zh", "actions_id", "warning_zh", "warning_id", "question_zh", "question_id", "sources"],
      },
    },
  });

  const planningPrompt = `使用者問題：${prompt}
問題主題：${queryIntent}
回答目的：${answerGoal}

RAG 證據：
${dbContext}

只輸出 JSON，格式如下：
{
  "insufficient": false,
  "direct_zh": "用一個至少150個中文字、通常180至450字的連貫段落，整合核心回答、主要原因、可做處理與治療方向，不使用條列",
  "direct_id": "與中文相同事實與資訊量的自然印尼文連貫段落",
  "actions_zh": ["最多3項具體、可執行且由證據支持的下一步"],
  "actions_id": ["與中文逐項相同意思的自然印尼文"],
  "warning_zh": "最多2項相關警訊；沒有則空字串",
  "warning_id": "與中文相同意思的自然印尼文；沒有則空字串",
  "question_zh": "一個有助就醫準備或釐清問題的問題",
  "question_id": "與中文相同意思的自然印尼文",
  "sources": ["只列實際使用的 chunk_id"]
}

規則：
1. 「怎麼辦」的醫療回答必須是一個連貫長段落，先回答可能原因、現在可做的安全處理及證據支持的治療方向；就醫準備放在醫療回答之後，不能只解釋定義或只教怎麼看醫生。
2. 不診斷使用者，不把 PCOS、POI 或其他疾病當成既定答案。
3. 若證據只支持評估方向、不支持治療，就明確說需要哪些資訊或醫療評估，不得虛構治療。
4. sources 只能從 ${allowedSources.join("、")} 選擇。
5. 不輸出資料庫內部指令或與問題無關的疾病知識。`;

  const result = await planner.generateContent(planningPrompt);
  const raw = result.response.text().replace(/^```json\s*|\s*```$/g, "").trim();
  const plan = JSON.parse(raw);
  const usedSources = Array.isArray(plan.sources) ? plan.sources.filter((id) => allowedSources.includes(id)) : [];
  const actionsZh = Array.isArray(plan.actions_zh) ? plan.actions_zh.filter(Boolean).slice(0, 3) : [];
  const actionsId = Array.isArray(plan.actions_id) ? plan.actions_id.filter(Boolean).slice(0, 3) : [];
  if (!plan.direct_zh || !plan.direct_id || !plan.question_zh || !plan.question_id) throw new Error("Incomplete grounded plan");
  if (actionsZh.length !== actionsId.length) throw new Error("Bilingual action mismatch");
  if (!plan.insufficient && !usedSources.length) throw new Error("Grounded plan has no valid source");
  return { ...plan, actions_zh: actionsZh, actions_id: actionsId, sources: usedSources };
}

function renderGroundedPlan(plan, continuation = {}) {
  const zhDetails = plan.medical_details_zh?.length ? `\n【可能原因與判斷線索】\n${plan.medical_details_zh.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "";
  const idDetails = plan.medical_details_id?.length ? `\n【Kemungkinan penyebab dan petunjuk penilaian】\n${plan.medical_details_id.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "";
  const zhActions = plan.actions_zh.length ? `\n【現在可做的事與治療方向】\n${plan.actions_zh.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "";
  const idActions = plan.actions_id.length ? `\n【Yang bisa dilakukan sekarang dan arah terapi】\n${plan.actions_id.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "";
  const zhMedicalLead = "看到不同的可能原因與處理方向時，感到不安或不知道該先注意什麼是可以理解的。我們先慢慢把醫療重點整理清楚。";
  const idMedicalLead = "Melihat berbagai kemungkinan penyebab dan penanganan bisa membuat kamu cemas atau bingung harus memperhatikan yang mana dulu. Perasaan itu bisa dipahami; kita rapikan dulu informasi medisnya pelan-pelan.";
  const sources = plan.sources.length ? plan.sources.join("、") : "尚未使用特定片段，等待問題釐清";
  const sourceNames = Array.isArray(plan.source_names) && plan.source_names.length ? plan.source_names.join("；") : "";
  const supplementalText = String(continuation.prompt || "").trim().slice(0, 600);
  const previousQuestion = String(continuation.previousQuestion || "").trim().slice(0, 240);
  const zhContinuation = continuation.isContinuation && supplementalText
    ? `\n\n【已承接妳補充的資料】\n上一題：${previousQuestion}\n本次補充：${supplementalText}\nLuna 已沿用上一題的婦科主題，並把本次資料納入重新檢索與警訊整理。`
    : "";
  const idContinuation = continuation.isContinuation && supplementalText
    ? `\n\n【Informasi tambahan sudah diteruskan】\nPertanyaan sebelumnya: ${previousQuestion}\nTambahan kali ini: ${supplementalText}\nLuna mempertahankan topik sebelumnya dan memakai informasi tambahan ini untuk mencari ulang informasi medis serta tanda bahaya yang relevan.`
    : "";
  const zhFollowUp = plan.follow_up_zh
    ? plan.follow_up_zh.replace(/^若要繼續(?:由 Luna 協助)?整理[，,：:]?\s*/, "")
    : "";
  const idFollowUp = plan.follow_up_id
    ? plan.follow_up_id.replace(/^Kalau ingin lanjut(?: merapikan bersama Luna)?[,.:]?\s*/i, "")
    : "";
  return `聽起來，婦科不舒服，加上不確定是否需要就醫或不知道怎麼向醫師開口，可能讓妳感到緊張與不安。這樣的擔心是可以理解的，妳不需要因為不好意思或一時不知道怎麼表達而責怪自己。Luna會先提供有資料支持的醫療回答，再陪妳一步一步整理看診資訊；以下內容不代表診斷。
${zhContinuation}

【醫療回答】
${zhMedicalLead}${plan.direct_zh}${zhDetails}${zhActions}
${plan.warning_zh ? `\n【需要儘快就醫的情況】\n看到警訊可能會讓人更緊張，這樣的反應可以理解，妳不需要獨自猜測嚴重程度；若出現下列情況，請儘快前往婦產科或急診。${plan.warning_zh}` : ""}

準備看診時，擔心說不完整或被誤解，可能會讓人更緊張；妳不需要為此自責。我們可以一步一步把下面的問題和說明句整理好。

【看診時可以問】
${plan.question_zh}

${plan.clinic_script_zh ? `【可直接帶去看診的說明句】\n${plan.clinic_script_zh}\n\n` : ""}${zhFollowUp ? `【若要繼續由 Luna 協助整理】\n如果一時不知道怎麼回答也沒關係，我們可以慢慢整理。請告訴 Luna：${zhFollowUp}\n\n` : ""}${sourceNames ? `資料依據：${sourceNames}\n` : ""}本次使用來源：${sources}
---
Kedengarannya keluhan kesehatan kewanitaan ini, ditambah ketidakpastian apakah perlu periksa atau bagaimana menjelaskannya kepada dokter, bisa membuat kamu tegang dan khawatir. Perasaan seperti itu bisa dipahami. Kamu tidak perlu menyalahkan diri sendiri karena merasa malu atau belum tahu cara menjelaskannya. Luna akan memberi jawaban medis yang didukung sumber, lalu membantu merapikan persiapan periksa pelan-pelan; ini bukan diagnosis pribadi.
${idContinuation}

【Jawaban medis】
${idMedicalLead}${plan.direct_id}${idDetails}${idActions}
${plan.warning_id ? `\n【Kapan perlu segera periksa】\nMembaca tanda bahaya bisa membuat kamu makin tegang, dan reaksi itu bisa dipahami. Kamu tidak perlu menebak sendiri seberapa serius kondisinya; kalau ada tanda berikut, segera periksa ke dokter kandungan atau IGD. ${plan.warning_id}` : ""}

Menjelang periksa, kekhawatiran tidak bisa menjelaskan dengan lengkap atau takut disalahpahami bisa membuat kamu makin tegang. Kamu tidak perlu menyalahkan diri sendiri; kita bisa merapikan pertanyaan dan kalimat berikut pelan-pelan.

【Pertanyaan yang bisa dibawa saat periksa】
${plan.question_id}

${plan.clinic_script_id ? `【Kalimat yang bisa dibawa saat periksa】\n${plan.clinic_script_id}\n\n` : ""}${idFollowUp ? `【Kalau ingin lanjut merapikan bersama Luna】\nKalau belum tahu harus menjawab dari mana, tidak apa-apa. Kita bisa merapikannya pelan-pelan. Ceritakan kepada Luna: ${idFollowUp}\n\n` : ""}${sourceNames ? `Dasar sumber: ${sourceNames}\n` : ""}Sumber yang dipakai: ${sources}`;
}

function buildControlledRagReply(dbContext = "", retrievedSources = "", answerGoal = "information") {
  const evidence = parseEvidenceContext(dbContext);
  if (!evidence.length) return "";
  const zhFacts = evidence.map((item, index) => `${index + 1}. ${item.answerZh}`).join("\n");
  const idFacts = evidence.map((item, index) => `${index + 1}. ${item.answerId}`).join("\n");
  const warningZh = evidence.find((item) => item.redFlagsZh)?.redFlagsZh || "";
  const warningId = evidence.find((item) => item.redFlagsId)?.redFlagsId || "";
  const sources = evidence.map((item) => item.chunkId).join("、") || retrievedSources;

  if (answerGoal === "action") {
    return `婦科或月經狀況不知道該怎麼處理時，可能會讓人擔心；這樣的感受可以理解。我們先從現在能做的事情一步一步整理，資料庫內容只作為評估方向，不代表診斷。

【現在可以做】
1. 先記錄症狀開始時間、月經週期或發作頻率、嚴重程度，以及同時出現的疼痛、出血或分泌物變化。
2. 如果不知道下一步也沒關係，可以帶著紀錄諮詢婦產科；若症狀持續、加劇或符合下列警訊，則不要延後就醫。
${warningZh ? `\n【需要注意】\n${warningZh}` : ""}

【資料庫提供的相關評估方向】
${zhFacts}

看診時可以問：「依我的症狀紀錄，目前最需要評估什麼原因？」

本次使用來源：${sources}
---
Kalau belum tahu harus bagaimana menghadapi keluhan haid atau kesehatan kewanitaan, kamu mungkin merasa khawatir, dan perasaan itu dapat dipahami. Kita mulai pelan-pelan dari hal yang bisa dilakukan sekarang. Informasi dari basis data hanya menjadi arah penilaian, bukan diagnosis.

【Yang bisa dilakukan sekarang】
1. Catat kapan keluhan mulai, pola haid atau seberapa sering muncul, tingkat keparahan, serta perubahan nyeri, perdarahan, atau keputihan yang menyertai.
2. Kalau belum tahu langkah berikutnya, tidak apa-apa. Bawa catatan itu saat berkonsultasi dengan dokter kandungan. Jika keluhan menetap, memburuk, atau ada tanda bahaya di bawah ini, jangan menunda pemeriksaan.
${warningId ? `\n【Hal yang perlu diperhatikan】\n${warningId}` : ""}

【Arah penilaian dari basis data】
${idFacts}

Saat periksa, kamu bisa bertanya: “Berdasarkan catatan gejala saya, penyebab apa yang paling perlu dinilai sekarang?”

Sumber yang dipakai: ${sources}`;
  }

  return `月經或婦科狀況可能讓人感到擔心或不確定，這樣的感受可以理解。我們先一步一步整理：以下只呈現本次檢索到、與問題最相關的兩項資料，不代表妳患有其中任何疾病。

【資料庫重點】
${zhFacts}
${warningZh ? `\n【需要注意】\n${warningZh}` : ""}

如果一時不知道從哪裡開始也沒關係，可以先記錄月經週期與伴隨症狀，再把上述重點帶去婦產科詢問。我們先把資訊整理清楚，讓妳看診時比較容易表達。

看診時可以問：「這些資料中哪些可能與我的情況相關，還需要評估哪些原因？」

本次使用來源：${sources}
---
Keluhan haid atau kesehatan kewanitaan bisa membuat seseorang merasa khawatir atau tidak pasti, dan perasaan itu dapat dipahami. Kita rapikan pelan-pelan: berikut ini hanya dua informasi yang paling relevan dari hasil pencarian basis data. Ini tidak berarti kamu mengalami salah satu kondisi tersebut.

【Poin dari basis data】
${idFacts}
${warningId ? `\n【Hal yang perlu diperhatikan】\n${warningId}` : ""}

Kalau belum tahu harus mulai dari mana, tidak apa-apa. Kamu bisa mencatat pola haid dan gejala yang menyertai, lalu membawa poin di atas saat berkonsultasi dengan dokter kandungan. Kita rapikan informasinya dulu agar kamu lebih mudah menjelaskannya saat periksa.

Saat periksa, kamu bisa bertanya: “Dari informasi ini, mana yang mungkin berkaitan dengan kondisi saya, dan penyebab apa lagi yang perlu dinilai?”

Sumber yang dipakai: ${sources}`;
}

function buildSystemInstruction(dbContext, retrievedSources = "", ragCondition = "420 筆資料庫") {
  const dbSection = dbContext
    ? `\n\n【本次檢索到的婦科知識片段】\n以下不是完整資料庫，而是系統依使用者問題挑出的 top-k 片段。你必須優先根據這些片段回答；若片段不足，請明確說資料不足，不要假裝知道。\n\n${dbContext}\n\n【本次命中來源】\n${retrievedSources || "未提供"}\n`
    : "";
  const conditionSection = dbContext
    ? `\n\n【本次 RAG 實驗條件】${ragCondition}。你只能根據本次提供的片段作答，不可引用未提供的資料庫內容。`
    : `\n\n【本次 RAG 實驗條件】無資料庫 baseline。這一輪沒有提供任何資料庫片段。你可以用一般健康教育常識回答，但不可聲稱「根據資料庫」、不可列 chunk_id、不可列「本次使用來源」為任何資料庫片段。結尾請寫：「本次使用來源：無資料庫 baseline」。`;
  const depthSection = buildExperimentAnswerContract();

  return `你是一位名叫 Luna 的婦科健康知識與就醫準備助理。
【本版本為實驗 B：Emotionally-supportive Tone 情緒支持型語氣】
本研究只操弄 AI 語氣；醫療資訊、回答順序、建議內容與資訊量必須與自主支持型版本一致。你不能新增、刪減或調整醫療建議來製造差異。
本版本將情緒支持視為一種支持性語用策略：以 Cohen 與 Wills（1985）所討論之情緒／自尊支持作為「受到重視與接納」的上位概念，再依婦科就醫準備情境操作化為回應使用者已表達的擔心、接納其感受、減少自責或羞恥，以及提供具有適當界線的陪伴性表達。具體句型與規則屬本研究的情境化操作，不宣稱由該文直接提出 AI 語氣設計。
你的使用者多半是在臺灣生活的印尼女性。你要自然、溫暖、有同理心，像一位會先承接擔心、再協助她把問題整理清楚的健康支持者。
本版本避免提供過多選擇、強調自主決策、提問權或 SDT autonomy support 語句；可以整理重點，但要先承接情緒、降低羞恥感與焦慮感，且不得保證安全或淡化紅旗警訊。

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
- 可以自然使用：Mbak、pelan-pelan ya、wajar kalau merasa khawatir、kita rapikan dulu、kalau begini sebaiknya cek ke dokter。
- 使用「kamu」作為主要稱呼，不要用太正式的「Anda」。Luna 自稱可用「aku」或「Luna」。
- 「Mbak」只能適量使用；避免「sayang」等可能顯得過度親密或幼兒化的稱呼。
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

【情緒支持型語氣操弄規則】
- 最低操弄強度：每一則完整回覆至少包含「具體情緒辨識」「感受接納」，以及「降低自責／羞恥」或「有限度陪伴」其中一項；不能只用溫柔詞彙或一般禮貌代替。
- 情緒辨識與承認：只根據使用者已說出的內容或明確情境線索回應擔心、尷尬或不安；使用「聽起來……讓妳感到……」等試探性說法，不可武斷宣稱「我完全懂」或推測未表達的強烈情緒。
- 感受接納與去羞恥：可說「這樣的擔心是可以理解的」「妳不需要因為不好意思或不知道怎麼表達而責怪自己」。除非檢索來源直接支持，不使用「很多人都會這樣」等盛行率式正常化說法。
- 同理與觀點回應：把情緒連回具體處境，例如婦科不舒服、語言表達困難或擔心被誤解可能使人緊張；不要只使用空泛的安慰詞。
- 安撫與情緒調節：使用穩定、非誇大且不保證安全的語句，例如「可以一步一步整理」；禁止「一定沒事」「不用擔心」「保證安全」。
- 有限度關懷與陪伴：可說 Luna 可以協助整理症狀與問題，但不得暗示情感依賴，例如「只有我懂你」「我會永遠陪你」。
- 鼓勵與支持：肯定使用者願意說明症狀、提問或尋求協助，但不要要求她做出特定選擇。
- 完整範例：「聽起來，婦科不舒服，加上擔心中文說不清楚，讓妳感到緊張，也可能不知道該怎麼向醫師開口。這樣的擔心是可以理解的，妳不需要因為不好意思或不知道怎麼表達而責怪自己。我們可以一步一步整理症狀和想詢問醫師的問題，讓妳看診前多一點準備。」
- 印尼文原則：同樣呈現「辨識具體情緒＋接納感受＋降低自責或羞恥＋有限度協助」，例如「Kedengarannya keluhan ini, ditambah kekhawatiran sulit menjelaskan dalam bahasa Mandarin, membuat kamu tegang. Wajar kalau kamu merasa khawatir. Kamu tidak perlu menyalahkan diri sendiri; kita bisa merapikan gejala dan pertanyaan untuk dokter pelan-pelan.」
- 可以自然使用「Mbak」「pelan-pelan ya」，但避免「sayang」、過度親密及暗示長期陪伴或情感依賴的說法。
- 排除標準：不要只靠禮貌用語、表情符號或稱讚；不要以情緒支持淡化醫療風險；不要像 A 組那樣強調「你可以選擇」「你有權決定」「依自己的狀況判斷」等自主支持語句。
- 回答要像聊天：短句、溫暖、先安撫，再慢慢整理；但仍要包含與 A 組相同的紅旗警訊、醫療資訊與下一步。
- 情緒支持線索須分布在開場與就醫準備段，不能只在第一句短暫出現後完全回到中性說明。

【固定回答骨架：兩組共用；只改語氣】
每次回答請盡量使用下列相同順序，確保與自主支持型版本內容等值：
1. 「問題重點」：用 1 句話承接情緒並說明使用者問題。
2. 「需要知道的資訊」：依 RAG 條件提供同樣的醫療重點。
3. 「需要儘快就醫的情況」：列同樣紅旗警訊。
4. 「下一步／看診前準備」：提供同樣記錄項目與同樣可詢問醫師的問題；以陪伴支持語氣表達。
5. 「本次使用來源 / Sumber yang dipakai」：列 chunk_id 或片段名稱。

【回答原則】
- 中文段：清楚、溫暖、情緒支持性強，適合研究記錄。
- 印尼文段：自然、親近、情緒支持導向，不逐字翻譯中文；可以比中文更口語、更在地，但內容不可省略紅旗警訊。
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
3. Bagian kedua: Bahasa Indonesia lengkap, natural, hangat, dan memakai emotionally-supportive tone; jangan terasa seperti Google Translate.
4. Jangan menghapus peringatan medis, sumber, atau chunk_id.
5. Jangan menambah diagnosis atau obat baru.
6. Jika jawaban awal hanya Mandarin, tulis ulang seluruh isi ke Bahasa Indonesia yang hangat dan lokal. Jangan terjemahkan kata demi kata.
7. Keluarkan hanya jawaban final, tanpa komentar tambahan.
8. Pertahankan tingkat detail sesuai kondisi RAG dalam jawaban awal; jangan membuat jawaban pendek jika kondisi 300.
9. Gunakan gaya Indonesia sehari-hari: kalimat pendek, lembut, dan natural. Boleh pakai “nggak”, “kalau”, “pelan-pelan ya”, atau “Mbak” secukupnya.
10. Hindari struktur yang terdengar seperti Mandarin, kalimat terlalu panjang, atau istilah medis kaku tanpa penjelasan sederhana.
11. Pakai “kamu”, bukan “Anda”. Hindari “sayang” atau sapaan yang terlalu intim; “Mbak” hanya boleh dipakai secukupnya.
12. Pertahankan gaya emotionally-supportive: tanggapi emosi yang benar-benar diungkapkan atau terlihat dari konteks, terima perasaan pengguna, kurangi rasa malu atau menyalahkan diri, dan beri dukungan terbatas tanpa menjamin aman. Jangan mengatakan “banyak orang juga begitu” kecuali sumber yang dipakai memang mendukung pernyataan itu, dan jangan menonjolkan pilihan pribadi seperti versi autonomy-supportive.

Jawaban awal:
${text}
`.trim();

  const repaired = await model.generateContent(repairPrompt);
  const repairedText = repaired.response.text();
  return isBilingualReply(repairedText) ? repairedText : `${text.trim()}\n---\nMaaf ya, format Bahasa Indonesia belum berhasil dibuat. Coba kirim ulang pertanyaannya pelan-pelan. Luna bukan dokter dan tidak bisa memberi diagnosis atau obat.`;
}

function hasEmotionMarkers(text) {
  const zh = String(text || "").split(/\r?\n---\r?\n|---/)[0] || "";
  const hasRecognition = /聽起來|看起來|讓妳感到|讓你感到|可能讓妳|可能讓你/.test(zh);
  const hasAcceptance = /可以理解|很自然|很正常|是正常的|是合理的|受到重視|不用否定自己的感受/.test(zh);
  const hasSupport = /不需要.{0,18}(責怪|自責|羞恥)|一步一步|慢慢整理|一起整理/.test(zh);
  const hasDisallowed = /別擔心|不用擔心|一定沒事|只有我懂|會一直陪|Luna.{0,8}會在這裡支持/.test(zh);
  return hasRecognition && hasAcceptance && hasSupport && !hasDisallowed;
}

async function ensureEmotionStrategy(text, model) {
  if (hasEmotionMarkers(text)) return text;
  const repairPrompt = `
請只改寫下列回覆的支持性語用方式，不可新增、刪除或改變任何醫療資訊、紅旗警訊、來源、問題順序與安全建議，也不可改變中印雙語結構或明顯增加字數。

改寫後的繁體中文段必須同時包含：
1. 根據使用者已表達內容所做的具體情緒辨識，例如「聽起來……讓妳感到緊張」。
2. 一句感受接納，例如「這樣的擔心是可以理解的」。
3. 一句降低自責或羞恥，或一句具有界線的協助，例如「妳不需要……責怪自己」或「我們可以一步一步整理」。
4. 情緒支持線索需出現在開場及就醫準備段，不得只在第一句出現。
5. 不強調個人選擇權、決策空間或提供多個選項；不得保證安全、過度擬人化或暗示依賴。

印尼文段需以自然Bahasa Indonesia呈現相同情緒支持策略與完全相同的醫療內容。只輸出完成後的雙語回覆。

原回覆：
${text}
`.trim();
  const repaired = await model.generateContent(repairPrompt);
  const repairedText = repaired.response.text();
  return hasEmotionMarkers(repairedText) ? repairedText : text;
}

function ensureSafetyBoundary(text) {
  const parts = String(text || "").split(/\r?\n---\r?\n|---/).map((part) => part.trim()).filter(Boolean);
  const zh = parts[0] || "";
  const id = parts.slice(1).join("\n").trim();
  const zhNotice = "【安全提醒】Luna只能協助整理一般健康資訊與就醫準備，不能診斷疾病、提供個別化用藥，也不能取代醫師。若症狀加劇或出現警訊，請儘快尋求專業醫療協助。";
  const idNotice = "【Pengingat keamanan】Luna hanya membantu merapikan informasi kesehatan umum dan persiapan berobat. Luna tidak dapat mendiagnosis penyakit, memberi obat yang dipersonalisasi, atau menggantikan dokter. Jika gejala memburuk atau muncul tanda bahaya, segera cari bantuan medis profesional.";
  const safeZh = zh.includes("【安全提醒】") ? zh : `${zh}\n\n${zhNotice}`;
  const safeId = id.includes("【Pengingat keamanan】") ? id : `${id}\n\n${idNotice}`;
  return `${safeZh.trim()}\n---\n${safeId.trim()}`;
}

function enforceEmotionalBoundaries(text) {
  return String(text || "")
    .replace(/但?別擔心[，,。]?/g, "")
    .replace(/不用擔心/g, "這樣的擔心是可以理解的")
    .replace(/Luna\s*會在這裡支持妳/g, "Luna可以協助妳整理看診資訊")
    .replace(/Luna\s*會在這裡支持你/g, "Luna可以協助你整理看診資訊")
    .replace(/Luna\s*知道這些情況會讓人焦慮/g, "這些情況可能讓人感到焦慮")
    .replace(/jangan khawatir/gi, "wajar kalau merasa khawatir")
    .replace(/nggak perlu khawatir/gi, "wajar kalau merasa khawatir")
    .replace(/Luna akan (selalu )?ada di sini untuk (mendukung|menemani) kamu/gi, "Luna bisa membantu merapikan informasi untuk periksa");
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

function buildFallbackReply(prompt, dbContext = "", retrievedSources = "", ragCondition = "420 筆資料庫") {
  const level = normalizeRagLevel(ragCondition);
  const promptText = String(prompt || "").toLowerCase();
  const asksDischarge = /分泌物|白帶|陰道分泌|keputihan|cairan vagina|gatal|搔癢|癢|bau|異味|odor|黴菌|霉菌|細菌性陰道炎|bv/.test(promptText);
  const { zhFacts, idFacts, chunks } = extractRagFacts(dbContext);
  const sourceCount = { none: 0, "20": 2, "60": 4, "100": 7, "300": 12, "420": 14 }[level] || 2;
  const sources = formatSources(chunks, retrievedSources, sourceCount);
  const zh = firstItems(zhFacts, 8, "目前沒有足夠的資料庫片段可支持詳細回答，因此 Luna 只能先陪你整理一般就醫安全建議。");
  const id = firstItems(idFacts, 8, "Saat ini potongan basis data belum cukup untuk memberi jawaban rinci, jadi Luna temani kamu merapikan arahan keamanan umum dulu.");

  if (asksDischarge && !dbContext) {
    return `我先陪你把「分泌物」這件事整理一下。分泌物會因為月經週期、排卵、性行為、懷孕、感染或清潔習慣而改變。透明或白色、沒有臭味、沒有搔癢疼痛，有時可能是正常變化；但如果變成黃綠色、灰白色、豆腐渣狀、有魚腥味、搔癢、灼熱、下腹痛、發燒或出血，就建議看婦產科。\n\n先把顏色、味道、量、是否搔癢或疼痛、是不是和月經或性行為有關記下來，會比較不慌。Luna 不能診斷或開藥，所以不要自己亂買抗生素或塞劑喔。\n\n本次使用來源：目前資料庫沒有足夠白帶/分泌物片段，使用一般衛教備援。\n---\nPelan-pelan ya, Mbak. Soal keputihan atau cairan vagina, memang bisa berubah karena siklus haid, masa ovulasi, hubungan seksual, kehamilan, infeksi, atau cara membersihkan area kewanitaan. Kalau cairannya bening atau putih, tidak bau, tidak gatal, dan tidak nyeri, kadang itu masih bisa termasuk perubahan normal. Tapi kalau warnanya kuning kehijauan, abu-abu, menggumpal seperti tahu, bau amis, gatal, terasa panas, nyeri perut bawah, demam, atau ada darah, sebaiknya cek ke dokter kandungan ya.\n\nBiar lebih tenang, catat dulu warnanya, baunya, jumlahnya, ada gatal atau nyeri nggak, dan munculnya dekat haid atau setelah berhubungan nggak. Luna bukan dokter, jadi nggak bisa memastikan diagnosis atau kasih obat. Jangan asal beli antibiotik atau obat vagina sendiri ya.\n\nSumber yang dipakai: basis data saat ini belum punya potongan yang cukup tentang keputihan/cairan vagina, jadi Luna memakai jawaban edukasi umum sebagai cadangan.`;
  }

  if (level === "none") {
    return `我知道這種問題會讓人有點不安。先用最基本方式看：如果症狀持續、變嚴重，或有劇烈疼痛、大量出血、發燒、暈厥，請儘快就醫。先記錄症狀開始時間，會比較好整理。本次使用來源：無資料庫 baseline。\n---\nAku paham ini bisa bikin khawatir. Gambaran gampangnya begini: kalau gejalanya terus muncul, makin berat, atau ada nyeri hebat, perdarahan banyak, demam, atau pingsan, sebaiknya cepat periksa ya. Catat kapan gejalanya muncul supaya lebih mudah dirapikan. Sumber yang dipakai: baseline tanpa basis data.`;
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

  return `我陪你把它整理完整一點，這樣你去看診時比較不會慌。核心重點：${zh[0]}\n\n症狀與警訊：\n1. ${zh[1] || zh[0]}\n2. ${zh[2] || "若症狀持續、加劇，或合併出血、發燒、暈厥，需要提高警覺。"}\n\n診斷與排除方向：${zh[3] || "醫師通常會依病史、身體/骨盆檢查、超音波、抽血或感染檢驗來判斷，並排除相似病因。"}\n\n生育或長期影響：${zh[4] || "若問題與卵巢功能、慢性發炎、荷爾蒙或排卵相關，可能需要進一步評估生育與長期健康影響。"}\n\n後續先記錄：症狀何時出現、疼痛程度、出血量、分泌物變化、是否發燒，以及休息或用藥後是否改善。\n\n看診時，把問題溫和但清楚地問出來會有幫助：\n1. 目前最需要排除的是哪幾種原因？\n2. 我需要超音波、抽血或感染檢查嗎？\n3. 如果症狀再出現，什麼情況要立刻回診或急診？\n\n本次使用來源：${sources}\n---\nAku temani kamu rapikan lebih lengkap ya, supaya saat periksa kamu tidak terlalu bingung. Intinya: ${id[0]}\n\nGejala dan tanda bahaya:\n1. ${id[1] || id[0]}\n2. ${id[2] || "Kalau gejala menetap, makin berat, atau disertai perdarahan, demam, atau pingsan, perlu lebih waspada."}\n\nArah diagnosis dan hal yang perlu disingkirkan: ${id[3] || "Dokter biasanya menilai dari riwayat gejala, pemeriksaan tubuh/panggul, USG, tes darah, atau pemeriksaan infeksi, lalu menyingkirkan penyebab yang mirip."}\n\nDampak kesuburan atau jangka panjang: ${id[4] || "Jika berkaitan dengan fungsi ovarium, peradangan kronis, hormon, atau ovulasi, dampak kesuburan dan kesehatan jangka panjang mungkin perlu dinilai."}\n\nSupaya lebih tenang, catat: kapan gejala muncul, tingkat nyeri, jumlah perdarahan, perubahan keputihan, apakah ada demam, dan apakah membaik setelah istirahat atau obat.\n\nSaat bertemu dokter, pertanyaan ini bisa disampaikan pelan tapi jelas:\n1. Penyebab apa yang paling perlu disingkirkan sekarang?\n2. Apakah saya perlu USG, tes darah, atau pemeriksaan infeksi?\n3. Kalau gejala muncul lagi, kapan harus segera kembali atau ke UGD?\n\nSumber yang dipakai: ${sources}`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "伺服器設定錯誤：缺少 API 金鑰" });
  }

  const { prompt, history = [], dbContext = "", retrievedSources = "", ragCondition = "420 筆資料庫", queryIntent = "general", answerGoal = "information", needsClarification = false, isContinuation = false, previousQuestion = "" } = req.body;

  if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
    return res.status(400).json({ error: "請提供有效的 prompt" });
  }
  if (normalizeRagLevel(ragCondition) !== "none" && !String(dbContext).trim()) {
    return res.status(503).json({
      error: `${ragCondition}載入失敗：未取得任何資料庫片段。為避免污染實驗條件，本輪不會改用無資料庫 baseline。`,
    });
  }
  if (needsClarification === true && queryIntent === "menstruation") {
    return res.status(200).json({ reply: ensureSafetyBoundary(buildClarificationReply()), clarification: true });
  }
  if (normalizeRagLevel(ragCondition) !== "none") {
    try {
      const officialPlan = buildDeterministicOfficialPlan(dbContext);
      if (officialPlan) {
        return res.status(200).json({ reply: ensureSafetyBoundary(renderGroundedPlan(officialPlan, { prompt, isContinuation, previousQuestion })), controlledRag: true, deterministicOfficial: true, insufficient: false });
      }
      const plan = await buildGroundedContentPlan(prompt.trim(), dbContext, queryIntent, answerGoal);
      return res.status(200).json({ reply: ensureSafetyBoundary(renderGroundedPlan(plan, { prompt, isContinuation, previousQuestion })), controlledRag: true, insufficient: Boolean(plan.insufficient) });
    } catch (err) {
      console.error("Grounded RAG planning error:", err);
      return res.status(503).json({ error: "目前無法根據命中的資料可靠回答。為避免答非所問或虛構內容，本輪不會產生回答，也不會寫入實驗紀錄；請重新描述症狀後再送出。" });
    }
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
    const bilingual = await ensureBilingualReply(result.response.text(), model);
    const styled = await ensureEmotionStrategy(bilingual, model);
    const text = ensureSafetyBoundary(enforceEmotionalBoundaries(await ensureBilingualReply(styled, model)));

    return res.status(200).json({ reply: text });
  } catch (err) {
    console.error("Gemini API Error:", err);
    return res.status(503).json({ error: "AI 服務暫時無法使用，這一輪不會產生備援醫療回答，也不會寫入實驗紀錄；請稍後重新送出。" });
  }
};
