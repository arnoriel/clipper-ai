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
  if (!content) throw new Error("Empty response from AI");
  return content;
}

// ─── Parse AI JSON safely ─────────────────────────────────────────────────────
function parseJSON<T>(text: string): T {
  // Strip markdown code fences if present
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Try to extract first JSON object/array
    const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
    if (match) return JSON.parse(match[0]) as T;
    throw new Error("Could not parse AI response as JSON");
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
  onProgress?.("Analyzing video metadata...");

  const chaptersText =
    videoInfo.chapters.length > 0
      ? videoInfo.chapters
          .map((c) => `- ${c.title} at ${formatTime(c.start_time)}`)
          .join("\n")
      : "No chapters available";

  const transcriptSnippet = videoInfo.transcript
    ? videoInfo.transcript.substring(0, 3000)
    : "No transcript available";

  onProgress?.("Sending to AI for viral moment detection...");

  const systemPrompt = `You are an expert viral content analyst and social media strategist. 
Your job is to identify the most shareable, engaging "viral moments" from a video based on its metadata and transcript.
Analyze what makes content go viral: emotional peaks, surprising revelations, funny moments, satisfying conclusions, relatable experiences, shocking content, educational gems, and drama.
Always respond in valid JSON only.`;

  const userPrompt = `Analyze this YouTube video and identify the TOP 5-8 viral moments that would make great short clips for social media (TikTok, Instagram Reels, YouTube Shorts).

VIDEO METADATA:
Title: ${videoInfo.title}
Duration: ${videoInfo.duration} seconds (${formatTime(videoInfo.duration)})
Tags: ${videoInfo.tags.slice(0, 15).join(", ")}

DESCRIPTION:
${videoInfo.description.substring(0, 800)}

CHAPTERS:
${chaptersText}

TRANSCRIPT EXCERPT:
${transcriptSnippet}

Return ONLY valid JSON in this exact format:
{
  "summary": "Brief 2-sentence analysis of the video's viral potential",
  "totalViralPotential": 7,
  "moments": [
    {
      "id": "moment_1",
      "label": "Short catchy label for this clip",
      "startTime": 45,
      "endTime": 90,
      "reason": "Why this moment is viral (1-2 sentences)",
      "viralScore": 9,
      "category": "funny"
    }
  ]
}

Rules:
- startTime and endTime must be in SECONDS (integers)
- Each clip should be 15-90 seconds long for optimal social media performance
- viralScore must be 1-10
- category must be one of: funny, emotional, educational, shocking, satisfying, drama, highlight
- Distribute clips across the video's duration
- If no transcript/chapters, estimate timestamps based on typical video structure
- Never return timestamps beyond the video duration (${videoInfo.duration}s)`;

  const rawResponse = await callAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    apiKey,
    { maxTokens: 2500, temperature: 0.3 }
  );

  onProgress?.("Processing AI response...");

  const parsed = parseJSON<VideoAnalysisResult>(rawResponse);

  // Validate and fix timestamps
  const moments: ViralMoment[] = (parsed.moments || [])
    .filter((m) => m.startTime >= 0 && m.endTime <= videoInfo.duration && m.startTime < m.endTime)
    .map((m, i) => ({
      ...m,
      id: m.id || `moment_${i + 1}`,
      viralScore: Math.min(10, Math.max(1, m.viralScore || 5)),
      startTime: Math.round(m.startTime),
      endTime: Math.min(Math.round(m.endTime), videoInfo.duration),
    }))
    .sort((a, b) => b.viralScore - a.viralScore);

  return {
    moments,
    summary: parsed.summary || "Analysis complete.",
    totalViralPotential: parsed.totalViralPotential || 5,
  };
}

// ─── Generate clip title & caption suggestions ────────────────────────────────
export async function generateClipContent(
  moment: ViralMoment,
  videoTitle: string,
  apiKey: string
): Promise<{ titles: string[]; captions: string[]; hashtags: string[] }> {
  const prompt = `You are a social media content creator. Generate catchy content for this clip.

Original Video: "${videoTitle}"
Clip: "${moment.label}" (${formatTime(moment.startTime)} - ${formatTime(moment.endTime)})
Category: ${moment.category}
Why it's viral: ${moment.reason}

Return ONLY valid JSON:
{
  "titles": ["Title option 1", "Title option 2", "Title option 3"],
  "captions": ["Caption option 1", "Caption option 2"],
  "hashtags": ["#hashtag1", "#hashtag2", "#hashtag3", "#hashtag4", "#hashtag5"]
}`;

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
  const prompt = `You are a video editor. Suggest the best edit for this viral clip.

Clip: "${moment.label}"
Category: ${moment.category}
Duration: ${moment.endTime - moment.startTime} seconds

Return ONLY valid JSON:
{
  "suggestion": "Brief editing suggestion (1 sentence)",
  "textOverlay": "Optional bold text to overlay on the video (or null)",
  "aspectRatio": "9:16"
}
aspectRatio must be one of: "9:16", "16:9", "1:1", "4:3"`;

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
    content: `You are an AI video editing assistant. You help users understand and edit their video clips.
Video context: ${videoContext}
Be concise, helpful, and creative.`,
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