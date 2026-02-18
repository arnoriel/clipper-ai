import express from "express";
import cors from "cors";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());
app.use("/videos", express.static(path.join(__dirname, "temp_videos")));
app.use("/exports", express.static(path.join(__dirname, "exports")));

// ─── Directories ──────────────────────────────────────────────────────────────
const TEMP_DIR = path.join(__dirname, "temp_videos");
const EXPORT_DIR = path.join(__dirname, "exports");
[TEMP_DIR, EXPORT_DIR].forEach((d) => fs.mkdirSync(d, { recursive: true }));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sanitizeId(str) {
  return str.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 40);
}

function secondsToFFmpeg(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(3);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(6, "0")}`;
}

// ─── GET /api/video-info ───────────────────────────────────────────────────────
app.get("/api/video-info", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing url param" });

  try {
    const { stdout } = await execAsync(
      `yt-dlp --dump-json --no-playlist "${url}"`,
      { timeout: 30000 }
    );
    const info = JSON.parse(stdout);

    let transcript = "";
    try {
      await execAsync(
        `yt-dlp --write-auto-sub --sub-format vtt --skip-download --no-playlist -o "${TEMP_DIR}/%(id)s.%(ext)s" "${url}"`,
        { timeout: 30000 }
      );
      const vttFile = path.join(TEMP_DIR, `${info.id}.en.vtt`);
      if (fs.existsSync(vttFile)) {
        const raw = fs.readFileSync(vttFile, "utf-8");
        transcript = parseVTT(raw);
        fs.unlinkSync(vttFile);
      }
    } catch (_) {
      // No subtitles — transcript stays empty
    }

    res.json({
      id: info.id,
      title: info.title,
      description: (info.description || "").substring(0, 2000),
      duration: info.duration,
      thumbnail: info.thumbnail,
      chapters: info.chapters || [],
      tags: info.tags || [],
      transcript,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Failed to fetch video info", detail: err.message });
  }
});

function parseVTT(vtt) {
  const lines = vtt.split("\n");
  const result = [];
  let currentTime = "";
  for (const line of lines) {
    const timeMatch = line.match(/(\d{2}:\d{2}:\d{2}\.\d{3})\s-->\s/);
    if (timeMatch) { currentTime = timeMatch[1]; continue; }
    const text = line.replace(/<[^>]+>/g, "").trim();
    if (text && currentTime && !text.startsWith("WEBVTT") && !text.startsWith("NOTE")) {
      result.push(`[${currentTime}] ${text}`);
      currentTime = "";
    }
  }
  return result.join("\n");
}

// ─── POST /api/download ────────────────────────────────────────────────────────
app.post("/api/download", async (req, res) => {
  const { url, videoId } = req.body;
  if (!url || !videoId) return res.status(400).json({ error: "Missing url or videoId" });

  const safeId = sanitizeId(videoId);
  const outputPath = path.join(TEMP_DIR, `${safeId}.mp4`);

  if (fs.existsSync(outputPath)) {
    return res.json({ filePath: outputPath, fileName: `${safeId}.mp4`, url: `/videos/${safeId}.mp4` });
  }

  try {
    await execAsync(
      `yt-dlp -f "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "${outputPath}" --no-playlist "${url}"`,
      { timeout: 300000 }
    );
    res.json({ filePath: outputPath, fileName: `${safeId}.mp4`, url: `/videos/${safeId}.mp4` });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Download failed", detail: err.message });
  }
});

// ─── POST /api/export-clip ────────────────────────────────────────────────────
app.post("/api/export-clip", async (req, res) => {
  const { sourceFile, clip, edits } = req.body;

  if (!sourceFile || !clip) return res.status(400).json({ error: "Missing params" });

  // Resolve full absolute path — frontend may send filename or "/videos/xxx.mp4"
  const resolvedSource = path.join(TEMP_DIR, path.basename(sourceFile));
  if (!fs.existsSync(resolvedSource)) {
    console.error("[export-clip] File not found:", resolvedSource);
    return res.status(422).json({
      error: "Source file not found. Please download the video first.",
      detail: `Expected at: ${resolvedSource}`,
    });
  }

  const outName = `clip_${Date.now()}.mp4`;
  const outPath = path.join(EXPORT_DIR, outName);

  try {
    const filters = buildFFmpegFilters(edits || {});
    const speed = edits?.speed || 1;
    const startSec = clip.startTime;
    const durationSec = clip.endTime - clip.startTime;

    const cmd = [
      "ffmpeg -y",
      `-ss ${secondsToFFmpeg(startSec)}`,
      `-i "${resolvedSource}"`,
      `-t ${secondsToFFmpeg(durationSec)}`,
      filters.length ? `-vf "${filters.join(",")}"` : "",
      // Audio tempo for speed change (separate from -vf)
      speed !== 1 ? `-af "atempo=${Math.min(Math.max(speed, 0.5), 2)}"` : "",
      "-c:v libx264 -preset fast -crf 22",
      "-c:a aac -b:a 128k",
      "-movflags +faststart",
      `"${outPath}"`,
    ]
      .filter(Boolean)
      .join(" ");

    console.log("[ffmpeg]", cmd);
    await execAsync(cmd, { timeout: 120000 });

    res.json({
      fileName: outName,
      url: `/exports/${outName}`,
      fullPath: outPath,
    });
  } catch (err) {
    console.error("[export error]", err.message);
    res.status(500).json({ error: "Export failed", detail: err.message });
  }
});

// ─── buildFFmpegFilters ────────────────────────────────────────────────────────
//
// ASPECT RATIO STRATEGY — CENTER CROP (no stretch, no distortion)
// ──────────────────────────────────────────────────────────────────
// We use ffmpeg's `crop` filter to cut the frame to the target aspect ratio
// from the center of the original video. This is exactly like how Instagram/
// TikTok crop works — the pixels that fit are kept, the rest is cut off.
//
// Example: 1920×1080 (16:9) → 9:16
//   Target crop width  = 1080 × (9/16) = 607.5 → round to even = 608
//   Target crop height = 1080 (keep full height)
//   X offset (center)  = (1920 − 608) / 2 = 656
//   Y offset           = 0
//
// ffmpeg expressions inside `-vf "..."` use \, to escape commas in if()
// so they're not confused with filter-separator commas.
// In JS strings: \\, → shell sees: \, → ffmpeg parses: , (inside expression)
//
function buildFFmpegFilters(edits) {
  const filters = [];

  // ── 1. ASPECT RATIO — center crop to target ratio (NO scaling/stretching) ──
  if (edits.aspectRatio && edits.aspectRatio !== "original") {
    const [rw, rh] = edits.aspectRatio.split(":").map(Number);

    // Conditional crop: if video is wider than target → crop sides (keep height)
    //                   if video is taller than target → crop top/bottom (keep width)
    // `a` is ffmpeg's built-in alias for `iw/ih` (source aspect ratio)
    // `out_w` and `out_h` are the computed crop dimensions (ffmpeg built-ins)
    //
    // \\, in JS string → \, in shell → , in ffmpeg expression (escaped separator)
    const cropW =
      `if(gt(iw/ih\\,${rw}/${rh})\\,` +      // if source wider than target:
      `trunc(ih*${rw}/${rh}/2)*2\\,` +         //   width  = ih × ratio (even)
      `iw)`;                                    // else: keep full width

    const cropH =
      `if(gt(iw/ih\\,${rw}/${rh})\\,` +       // if source wider than target:
      `ih\\,` +                                 //   height = keep full height
      `trunc(iw*${rh}/${rw}/2)*2)`;            // else: height = iw / ratio (even)

    filters.push(`crop=${cropW}:${cropH}:(iw-out_w)/2:(ih-out_h)/2`);
  }

  // ── 2. COLOR ADJUSTMENTS (eq filter) ──────────────────────────────────────
  const eq = [];
  if (edits.brightness != null && edits.brightness !== 0)
    eq.push(`brightness=${edits.brightness}`);
  if (edits.contrast != null && edits.contrast !== 0)
    eq.push(`contrast=${(1 + edits.contrast).toFixed(4)}`);
  if (edits.saturation != null && edits.saturation !== 0)
    eq.push(`saturation=${(1 + edits.saturation).toFixed(4)}`);
  if (eq.length) filters.push(`eq=${eq.join(":")}`);

  // ── 3. SPEED — video frame timing (audio speed handled via -af) ───────────
  if (edits.speed && edits.speed !== 1) {
    filters.push(`setpts=${(1 / edits.speed).toFixed(6)}*PTS`);
  }

  // ── 4. TEXT OVERLAYS (drawtext) ───────────────────────────────────────────
  if (edits.textOverlays?.length) {
    for (const t of edits.textOverlays) {
      const color = (t.color || "#FFFFFF").replace("#", "0x");
      const size  = t.fontSize || 36;
      const x     = t.x != null ? `w*${t.x}` : "(w-text_w)/2";
      const y     = t.y != null ? `h*${t.y}` : "h*0.85";
      const enable =
        t.startSec != null && t.endSec != null
          ? `:enable='between(t,${t.startSec},${t.endSec})'`
          : "";
      // Escape: \ → \\ , ' → \' , : → \: (required by ffmpeg drawtext)
      const safeText = t.text
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/:/g, "\\:");
      filters.push(
        `drawtext=text='${safeText}':fontsize=${size}:fontcolor=${color}:x=${x}:y=${y}${enable}`
      );
    }
  }

  return filters;
}

// ─── GET /api/export-download/:filename ───────────────────────────────────────
app.get("/api/export-download/:filename", (req, res) => {
  const fp = path.join(EXPORT_DIR, req.params.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: "File not found" });
  res.download(fp);
});

// ─── GET /api/health ──────────────────────────────────────────────────────────
app.get("/api/health", (_, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`\n🚀 AI Clipper Backend  →  http://localhost:${PORT}`);
  console.log(`   Videos  : http://localhost:${PORT}/videos/`);
  console.log(`   Exports : http://localhost:${PORT}/exports/\n`);
});