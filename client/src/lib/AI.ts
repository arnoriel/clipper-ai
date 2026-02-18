// src/lib/AI.ts
// All AI interactions with OpenRouter using model: arcee-ai/trinity-large-preview:free

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const MODEL = "arcee-ai/trinity-large-preview:free";

export interface ViralMoment {
  id: string;
  label: string;
  startTime: number; // seconds
  endTime: number;   // seconds
  reason: string;    // why this moment is viral
  viralScore: number; // 1-10
  category: "funny" | "emotional" | "educational" | "shocking" | "satisfying" | "drama" | "highlight";
}

export interface VideoAnalysisResult {
  moments: ViralMoment[];
  summary: string;
  totalViralPotential: number;
}

export interface AIMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────
async function callAI(
  messages: AIMessage[],
  apiKey: string,
  options: { maxTokens?: number; temperature?: number } = {}
): Promise<string> {
  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:5173",
      "X-Title": "AI Viral Clipper",
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: options.maxTokens ?? 2000,
      temperature: options.temperature ?? 0.4,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter API Error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Respons AI kosong");
  return content;
}

// ─── Parse AI JSON safely ─────────────────────────────────────────────────────
function parseJSON<T>(text: string): T {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error("Gagal memproses respons AI sebagai JSON");
  }
}

// ─── Main: Detect viral moments ───────────────────────────────────────────────
export async function detectViralMoments(
  videoInfo: {
    title: string;
    description: string;
    duration: number;
    chapters: { title: string; start_time: number }[];
    tags: string[];
    transcript: string;
  },
  apiKey: string,
  onProgress?: (msg: string) => void
): Promise<VideoAnalysisResult> {
  onProgress?.("Menganalisis metadata video...");

  const chaptersText =
    videoInfo.chapters.length > 0
      ? videoInfo.chapters
          .map((c) => `- ${c.title} pada ${formatTime(c.start_time)} (${c.start_time}s)`)
          .join("\n")
      : "Tidak ada chapter tersedia";

  // Gunakan lebih banyak transcript untuk akurasi lebih tinggi
  const transcriptSnippet = videoInfo.transcript
    ? videoInfo.transcript.substring(0, 5000)
    : "Tidak ada transcript tersedia";

  onProgress?.("Mengirim ke AI untuk deteksi momen viral...");

  const systemPrompt = `Kamu adalah seorang analis konten viral profesional dan strategi media sosial berpengalaman yang SELALU merespons dalam Bahasa Indonesia.

Keahlianmu:
- Mengidentifikasi momen yang memiliki daya tarik emosional tinggi (tawa, haru, kagum, syok, inspirasi)
- Memahami pola konten yang viral di TikTok, Instagram Reels, dan YouTube Shorts
- Membaca transcript/subtitles untuk menemukan momen percakapan yang kuat
- Menentukan timestamp yang presisi berdasarkan alur konten
- Menilai potensi viral berdasarkan hook, retensi, dan shareability

Prinsip analisismu:
1. AKURASI TIMESTAMP: Gunakan transcript dan chapter untuk menentukan timestamp yang tepat
2. DURASI OPTIMAL: Prioritaskan klip 20-60 detik (sweet spot untuk Reels/Shorts)
3. HOOK KUAT: Setiap klip harus dimulai dengan momen yang langsung menarik perhatian dalam 3 detik pertama
4. KELENGKAPAN NARASI: Klip harus punya awal, tengah, dan akhir yang jelas
5. KEBERAGAMAN: Pilih momen dari bagian video yang berbeda-beda, jangan menumpuk di satu area

Selalu respons dalam Bahasa Indonesia yang natural dan informatif. Hanya keluarkan JSON yang valid.`;

  const userPrompt = `Analisis video YouTube ini secara mendalam dan identifikasi 5-8 momen viral terbaik yang cocok dijadikan klip pendek untuk media sosial (TikTok, Instagram Reels, YouTube Shorts).

═══ METADATA VIDEO ═══
Judul: ${videoInfo.title}
Durasi Total: ${videoInfo.duration} detik (${formatTime(videoInfo.duration)})
Tags: ${videoInfo.tags.slice(0, 20).join(", ")}

═══ DESKRIPSI ═══
${videoInfo.description.substring(0, 1000)}

═══ CHAPTER / SEGMEN ═══
${chaptersText}

═══ TRANSCRIPT (${videoInfo.transcript ? "tersedia" : "tidak tersedia"}) ═══
${transcriptSnippet}

═══ PANDUAN ANALISIS ═══
Saat memilih momen viral, pertimbangkan faktor-faktor ini secara berurutan:

1. HOOK SCORE (0-10): Seberapa kuat momen ini menarik perhatian di 3 detik pertama?
2. EMOTIONAL PEAK: Apakah ada puncak emosi (tertawa, terkejut, haru, kagum)?
3. STANDALONE VALUE: Apakah klip ini bisa dipahami tanpa konteks video penuh?
4. SHAREABILITY: Apakah penonton akan menekan share setelah menontonnya?
5. REWATCH VALUE: Apakah penonton akan menontonnya lebih dari sekali?

Kategori yang tersedia:
- "funny": Momen lucu, humor, atau menggelikan
- "emotional": Momen mengharukan, inspiratif, atau menyentuh hati
- "educational": Fakta menarik, tutorial, atau insight berharga
- "shocking": Revelasi mengejutkan, twist, atau konten yang membuat syok
- "satisfying": Momen memuaskan, hasil kerja keras, atau kesimpulan yang epik
- "drama": Konflik, ketegangan, atau situasi dramatis
- "highlight": Momen puncak, pencapaian, atau adegan terbaik

PENTING:
- startTime dan endTime HARUS dalam detik (bilangan bulat)
- Durasi ideal tiap klip: 15-90 detik (MAKS 120 detik)
- viralScore 1-10 berdasarkan potensi viral nyata
- Timestamp TIDAK BOLEH melebihi durasi video (${videoInfo.duration} detik)
- Distribusikan momen ke berbagai bagian video agar variatif
- Jika ada transcript, gunakan isi percakapan untuk menentukan timestamp yang tepat

Kembalikan HANYA JSON valid dalam format ini:
{
  "summary": "Analisis 2-3 kalimat tentang potensi viral video ini dalam Bahasa Indonesia",
  "totalViralPotential": 7,
  "moments": [
    {
      "id": "moment_1",
      "label": "Label singkat dan menarik untuk klip ini (maks 8 kata)",
      "startTime": 45,
      "endTime": 90,
      "reason": "Penjelasan 2-3 kalimat mengapa momen ini berpotensi viral dalam Bahasa Indonesia, termasuk elemen apa yang membuatnya menarik",
      "viralScore": 9,
      "category": "funny"
    }
  ]
}`;

  const rawResponse = await callAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    apiKey,
    { maxTokens: 3000, temperature: 0.3 }
  );

  onProgress?.("Memproses respons AI...");

  const parsed = parseJSON<VideoAnalysisResult>(rawResponse);

  // Validasi dan perbaiki timestamp
  const moments: ViralMoment[] = (parsed.moments || [])
    .filter((m) => {
      const validStart = m.startTime >= 0;
      const validEnd   = m.endTime <= videoInfo.duration;
      const validOrder = m.startTime < m.endTime;
      const minDuration = (m.endTime - m.startTime) >= 10; // minimal 10 detik
      return validStart && validEnd && validOrder && minDuration;
    })
    .map((m, i) => ({
      ...m,
      id:         m.id || `moment_${i + 1}`,
      viralScore: Math.min(10, Math.max(1, m.viralScore || 5)),
      startTime:  Math.round(m.startTime),
      endTime:    Math.min(Math.round(m.endTime), videoInfo.duration),
    }))
    // Urutkan berdasarkan viralScore tertinggi
    .sort((a, b) => b.viralScore - a.viralScore);

  return {
    moments,
    summary:             parsed.summary || "Analisis selesai.",
    totalViralPotential: parsed.totalViralPotential || 5,
  };
}

// ─── Generate clip title & caption suggestions ────────────────────────────────
export async function generateClipContent(
  moment: ViralMoment,
  videoTitle: string,
  apiKey: string
): Promise<{ titles: string[]; captions: string[]; hashtags: string[] }> {
  const prompt = `Kamu adalah content creator media sosial yang kreatif. Buat konten yang menarik untuk klip ini dalam Bahasa Indonesia.

Video Asli: "${videoTitle}"
Klip: "${moment.label}" (${formatTime(moment.startTime)} - ${formatTime(moment.endTime)})
Kategori: ${moment.category}
Mengapa viral: ${moment.reason}

Kembalikan HANYA JSON valid:
{
  "titles": ["Judul opsi 1", "Judul opsi 2", "Judul opsi 3"],
  "captions": ["Caption opsi 1 (dengan emoji yang relevan)", "Caption opsi 2 (lebih singkat)"],
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"]
}

Panduan:
- Judul harus memancing rasa ingin tahu (clickbait positif)
- Caption harus engaging dan mendorong interaksi
- Hashtag campuran antara Indonesia dan internasional yang relevan`;

  const raw = await callAI(
    [{ role: "user", content: prompt }],
    apiKey,
    { maxTokens: 800, temperature: 0.7 }
  );

  return parseJSON(raw);
}

// ─── Suggest edit actions for a clip ─────────────────────────────────────────
export async function suggestEdits(
  moment: ViralMoment,
  apiKey: string
): Promise<{ suggestion: string; textOverlay?: string; aspectRatio?: string }> {
  const prompt = `Kamu adalah editor video profesional. Sarankan edit terbaik untuk klip viral ini dalam Bahasa Indonesia.

Klip: "${moment.label}"
Kategori: ${moment.category}
Durasi: ${moment.endTime - moment.startTime} detik
Alasan viral: ${moment.reason}

Kembalikan HANYA JSON valid:
{
  "suggestion": "Saran editing singkat dalam 1-2 kalimat Bahasa Indonesia",
  "textOverlay": "Teks bold yang disarankan untuk overlay di video (atau null jika tidak perlu)",
  "aspectRatio": "9:16"
}
aspectRatio harus salah satu dari: "9:16", "16:9", "1:1", "4:3"
Untuk konten TikTok/Reels selalu gunakan "9:16".`;

  const raw = await callAI(
    [{ role: "user", content: prompt }],
    apiKey,
    { maxTokens: 300, temperature: 0.5 }
  );

  return parseJSON(raw);
}

// ─── Chat with AI about the video ────────────────────────────────────────────
export async function chatAboutVideo(
  messages: AIMessage[],
  videoContext: string,
  apiKey: string
): Promise<string> {
  const system: AIMessage = {
    role: "system",
    content: `Kamu adalah asisten AI untuk editing video yang selalu berkomunikasi dalam Bahasa Indonesia.
Kamu membantu pengguna memahami dan mengedit klip video mereka.
Konteks video: ${videoContext}
Berikan respons yang ringkas, membantu, dan kreatif dalam Bahasa Indonesia.`,
  };

  return callAI([system, ...messages], apiKey, { maxTokens: 500, temperature: 0.6 });
}

// ─── Utility ──────────────────────────────────────────────────────────────────
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function validateApiKey(key: string): boolean {
  return key.startsWith("sk-or-") && key.length > 20;
}