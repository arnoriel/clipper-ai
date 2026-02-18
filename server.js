// ================================================
// server.js — Local-only storage (no Supabase)
// Videos are served directly from TEMP_DIR / EXPORT_DIR.
// The browser fetches the blobs and stores them in IndexedDB.
// ================================================
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import express from "express";
import cors from "cors";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// ─── Directories ─────────────────────────────────────────────────────────────
const TEMP_DIR   = path.join(__dirname, "temp-videos");
const EXPORT_DIR = path.join(__dirname, "exports");

[TEMP_DIR, EXPORT_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ─── Static serving ──────────────────────────────────────────────────────────
// The frontend fetches these URLs, reads the blob, and stores it in IndexedDB.
// Expose both directories so the browser can download the files directly.
app.use(
  "/temp-videos",
  express.static(TEMP_DIR, {
    setHeaders: (res) => {
      res.setHeader("Content-Type", "video/mp4");
      // Allow byte-range requests so <video> can seek
      res.setHeader("Accept-Ranges", "bytes");
    },
  })
);

app.use(
  "/exports",
  express.static(EXPORT_DIR, {
    setHeaders: (res) => {
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Accept-Ranges", "bytes");
    },
  })
);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function sanitizeId(str) {
  return str.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 40);
}

function secondsToFFmpeg(s) {
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(3);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(6, "0")}`;
}

function parseVTT(vtt) {
  const lines  = vtt.split("\n");
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

// ─── GET /api/video-info ──────────────────────────────────────────────────────
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
    } catch (_) {}

    res.json({
      id:          info.id,
      title:       info.title,
      description: (info.description || "").substring(0, 2000),
      duration:    info.duration,
      thumbnail:   info.thumbnail,
      chapters:    info.chapters || [],
      tags:        info.tags    || [],
      transcript,
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Failed to fetch video info", detail: err.message });
  }
});

// ─── POST /api/download ───────────────────────────────────────────────────────
// Downloads the video to TEMP_DIR and returns a local HTTP URL.
// The client will fetch this URL, read the blob, and persist it in IndexedDB.
app.post("/api/download", async (req, res) => {
  const { url, videoId } = req.body;
  if (!url || !videoId) return res.status(400).json({ error: "Missing url or videoId" });

  const safeId     = sanitizeId(videoId);
  const fileName   = `${safeId}.mp4`;
  const outputPath = path.join(TEMP_DIR, fileName);

  // If the file already exists on disk, return it immediately
  if (fs.existsSync(outputPath)) {
    console.log(`✅ File already on disk: ${fileName}`);
    return res.json({
      url:      `http://localhost:${PORT}/temp-videos/${fileName}`,
      fileName,
    });
  }

  try {
    console.log(`📥 Downloading: ${safeId}`);
    await execAsync(
      `yt-dlp -f "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "${outputPath}" --no-playlist "${url}"`,
      { timeout: 300000 }
    );

    res.json({
      url:      `http://localhost:${PORT}/temp-videos/${fileName}`,
      fileName,
    });
  } catch (err) {
    console.error("❌ Download Error:", err.message);
    res.status(500).json({ error: "Download failed", detail: err.message });
  }
});

// ─── POST /api/export-clip ────────────────────────────────────────────────────
// sourceFile = plain filename (e.g. "abc123.mp4"), resolved against TEMP_DIR.
// Returns a local HTTP URL the client can fetch to retrieve the exported blob.
app.post("/api/export-clip", async (req, res) => {
  const { sourceFile, clip, edits } = req.body;
  if (!sourceFile || !clip) return res.status(400).json({ error: "Missing params" });

  // sourceFile is just the filename — never a full URL here
  const resolvedSource = path.join(TEMP_DIR, path.basename(sourceFile));
  if (!fs.existsSync(resolvedSource)) {
    return res.status(404).json({
      error: "Source video not found on server. Please re-download the video.",
    });
  }

  const outName = `clip_${Date.now()}.mp4`;
  const outPath = path.join(EXPORT_DIR, outName);

  try {
    const filters    = buildFFmpegFilters(edits || {});
    const speed      = edits?.speed || 1;
    const startSec   = clip.startTime;
    const durationSec = clip.endTime - clip.startTime;

    const cmd = [
      "ffmpeg -y",
      `-ss ${secondsToFFmpeg(startSec)}`,
      `-i "${resolvedSource}"`,
      `-t ${secondsToFFmpeg(durationSec)}`,
      filters.length ? `-vf "${filters.join(",")}"` : "",
      speed !== 1 ? `-af "atempo=${Math.min(Math.max(speed, 0.5), 2)}"` : "",
      "-c:v libx264 -preset fast -crf 22",
      "-c:a aac -b:a 128k",
      "-movflags +faststart",
      `"${outPath}"`,
    ].filter(Boolean).join(" ");

    console.log(`🎬 Rendering: ${outName}`);
    await execAsync(cmd, { timeout: 120000 });

    res.json({
      url:      `http://localhost:${PORT}/exports/${outName}`,
      fileName: outName,
    });
  } catch (err) {
    console.error("[export error]", err.message);
    res.status(500).json({ error: "Export failed", detail: err.message });
  }
});

function buildFFmpegFilters(edits) {
  const filters = [];

  if (edits.aspectRatio && edits.aspectRatio !== "original") {
    const [rw, rh] = edits.aspectRatio.split(":").map(Number);
    const cropW = `if(gt(iw/ih\\,${rw}/${rh})\\,trunc(ih*${rw}/${rh}/2)*2\\,iw)`;
    const cropH = `if(gt(iw/ih\\,${rw}/${rh})\\,ih\\,trunc(iw*${rh}/${rw}/2)*2)`;
    filters.push(`crop=${cropW}:${cropH}:(iw-out_w)/2:(ih-out_h)/2`);
  }

  const eq = [];
  if (edits.brightness != null && edits.brightness !== 0) eq.push(`brightness=${edits.brightness}`);
  if (edits.contrast   != null && edits.contrast   !== 0) eq.push(`contrast=${(1 + edits.contrast).toFixed(4)}`);
  if (edits.saturation != null && edits.saturation !== 0) eq.push(`saturation=${(1 + edits.saturation).toFixed(4)}`);
  if (eq.length) filters.push(`eq=${eq.join(":")}`);

  if (edits.speed && edits.speed !== 1) {
    filters.push(`setpts=${(1 / edits.speed).toFixed(6)}*PTS`);
  }

  if (edits.textOverlays?.length) {
    for (const t of edits.textOverlays) {
      const color    = (t.color || "#FFFFFF").replace("#", "0x");
      const size     = t.fontSize || 36;
      const x        = t.x   != null ? `w*${t.x}` : "(w-text_w)/2";
      const y        = t.y   != null ? `h*${t.y}` : "h*0.85";
      const enable   = t.startSec != null && t.endSec != null
        ? `:enable='between(t,${t.startSec},${t.endSec})'` : "";
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

// ─── Health ───────────────────────────────────────────────────────────────────
app.get("/api/health", (_, res) =>
  res.json({ ok: true, storage: "Local filesystem + browser IndexedDB" })
);

// ─── Auto Cleanup (every 30 min) ─────────────────────────────────────────────
// Removes local files older than 2 hours.
// The browser's IndexedDB is unaffected — user controls that storage.
cron.schedule("*/30 * * * *", () => {
  console.log("🧹 Running local file cleanup...");
  const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

  [TEMP_DIR, EXPORT_DIR].forEach((dir) => {
    try {
      for (const file of fs.readdirSync(dir)) {
        const fp   = path.join(dir, file);
        const stat = fs.statSync(fp);
        if (Date.now() - stat.mtimeMs > MAX_AGE_MS) {
          fs.unlinkSync(fp);
          console.log(`  🗑️  Deleted ${file}`);
        }
      }
    } catch (e) {
      console.warn("Cleanup error:", e.message);
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 AI Clipper Backend → http://localhost:${PORT}`);
  console.log(`   Videos served from: ${TEMP_DIR}`);
  console.log(`   Exports served from: ${EXPORT_DIR}`);
  console.log(`   Storage: Local disk → browser IndexedDB (no cloud)\n`);
});