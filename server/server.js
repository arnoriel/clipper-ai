// ================================================
// server.js — Stream-first, no project-folder storage
//
// Download : yt-dlp → /tmp → stream ke browser → hapus
// Export   : browser upload blob → /tmp → ffmpeg → stream → hapus
//
// Tidak ada file yang disimpan di dalam folder project.
// Semua storage permanen ada di browser IndexedDB.
// ================================================
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import express    from "express";
import cors       from "cors";
import { exec, spawn } from "child_process";
import { promisify }   from "util";
import fs              from "fs";
import path            from "path";
import os              from "os";
import { fileURLToPath } from "url";
import multer            from "multer";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app  = express();
const PORT = 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

// ─── System temp dir (BUKAN di dalam folder project) ─────────────────────────
// Semua file sementara disimpan di OS temp dir, dan langsung dihapus setelah
// streaming selesai. Folder project tetap bersih.
const SYS_TEMP = path.join(os.tmpdir(), "clipper-ai");
if (!fs.existsSync(SYS_TEMP)) fs.mkdirSync(SYS_TEMP, { recursive: true });

// ─── Multer — simpan upload browser ke SYS_TEMP, bukan project folder ────────
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, SYS_TEMP),
    filename:    (_req, _file, cb) => cb(null, `upload_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`),
  }),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // max 4 GB
});

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

/** Hapus file dengan aman (tidak throw jika tidak ada) */
function safeDelete(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); }
  catch (e) { console.warn("⚠️  Could not delete temp file:", filePath, e.message); }
}

// ─── GET /api/video-info ──────────────────────────────────────────────────────
app.get("/api/video-info", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Missing url param" });

  // VTT subtitle disimpan sementara di SYS_TEMP, langsung dihapus
  let vttFile = null;

  try {
    const { stdout } = await execAsync(
      `yt-dlp --dump-json --no-playlist "${url}"`,
      { timeout: 30000 }
    );
    const info = JSON.parse(stdout);

    let transcript = "";
    try {
      await execAsync(
        `yt-dlp --write-auto-sub --sub-format vtt --skip-download --no-playlist -o "${SYS_TEMP}/%(id)s.%(ext)s" "${url}"`,
        { timeout: 30000 }
      );
      vttFile = path.join(SYS_TEMP, `${info.id}.en.vtt`);
      if (fs.existsSync(vttFile)) {
        const raw = fs.readFileSync(vttFile, "utf-8");
        transcript = parseVTT(raw);
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
  } finally {
    safeDelete(vttFile);
  }
});

// ─── POST /api/download ───────────────────────────────────────────────────────
// Alur baru:
//   1. yt-dlp download ke SYS_TEMP (OS temp, bukan project folder)
//   2. Stream file ke browser sebagai video/mp4
//   3. Hapus file dari SYS_TEMP
//   4. Browser terima blob → simpan di IndexedDB
//
// Header X-File-Name dikirim agar client tahu nama file yang disarankan.
app.post("/api/download", async (req, res) => {
  const { url, videoId } = req.body;
  if (!url || !videoId) return res.status(400).json({ error: "Missing url or videoId" });

  const safeId    = sanitizeId(videoId);
  const fileName  = `${safeId}.mp4`;
  const tempPath  = path.join(SYS_TEMP, `dl_${Date.now()}_${fileName}`);

  try {
    console.log(`📥 Downloading (to system temp): ${safeId}`);
    await execAsync(
      `yt-dlp -f "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best" \
       --merge-output-format mp4 \
       -o "${tempPath}" \
       --no-playlist "${url}"`,
      { timeout: 300_000 }
    );

    if (!fs.existsSync(tempPath)) {
      throw new Error("yt-dlp selesai tapi file tidak ditemukan di temp dir");
    }

    const stat = fs.statSync(tempPath);
    console.log(`✅ Download selesai (${(stat.size / 1_048_576).toFixed(1)} MB), streaming ke browser…`);

    // Kirim nama file sebagai header agar client bisa simpan di IndexedDB dengan nama benar
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("X-File-Name", fileName);
    res.setHeader("Access-Control-Expose-Headers", "X-File-Name");

    const readStream = fs.createReadStream(tempPath);
    readStream.pipe(res);

    // Hapus file setelah stream selesai
    readStream.on("close", () => {
      safeDelete(tempPath);
      console.log(`🗑️  Temp file dihapus: ${path.basename(tempPath)}`);
    });
    res.on("error", () => safeDelete(tempPath));

  } catch (err) {
    safeDelete(tempPath);
    console.error("❌ Download Error:", err.message);
    res.status(500).json({ error: "Download failed", detail: err.message });
  }
});

// ─── POST /api/export-clip ────────────────────────────────────────────────────
// Alur baru:
//   1. Browser upload video blob sebagai multipart/form-data (field: "video")
//   2. Terima edits sebagai JSON di field "editsJson"
//   3. ffmpeg proses dari file upload → output fragmented MP4 ke stdout
//   4. Stream stdout ke browser
//   5. Hapus file upload dari SYS_TEMP
//   6. Browser terima blob → simpan di IndexedDB
//
// Catatan: outputnya adalah Fragmented MP4 agar bisa di-stream tanpa
//          perlu menulis file output ke disk.
app.post(
  "/api/export-clip",
  upload.single("video"),
  async (req, res) => {
    const uploadedPath = req.file?.path;

    try {
      if (!req.file) {
        return res.status(400).json({ error: "Field 'video' tidak ditemukan dalam upload" });
      }

      // edits dan clip dikirim sebagai JSON string di field terpisah
      const editsJson = req.body.editsJson;
      const clipJson  = req.body.clipJson;
      if (!editsJson || !clipJson) {
        return res.status(400).json({ error: "Field 'editsJson' dan 'clipJson' diperlukan" });
      }

      const edits = JSON.parse(editsJson);
      const clip  = JSON.parse(clipJson);

      const startSec    = clip.startTime;
      const durationSec = clip.endTime - clip.startTime;
      const filters     = buildFFmpegFilters(edits);
      const speed       = edits?.speed || 1;

      // ffmpeg: baca dari file upload, output fragmented MP4 ke stdout (pipe:1)
      // Fragmented MP4 (frag_keyframe + empty_moov) tidak perlu seekable output,
      // sehingga bisa di-pipe langsung ke HTTP response.
      const ffmpegArgs = [
        "-y",
        "-ss", secondsToFFmpeg(startSec),
        "-i",  uploadedPath,
        "-t",  secondsToFFmpeg(durationSec),
        ...(filters.length ? ["-vf", filters.join(",")] : []),
        ...(speed !== 1    ? ["-af", `atempo=${Math.min(Math.max(speed, 0.5), 2)}`] : []),
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "22",
        "-c:a", "aac",
        "-b:a", "128k",
        // Fragmented MP4 untuk streaming ke stdout
        "-f", "mp4",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "pipe:1",
      ];

      console.log(`🎬 Exporting clip via ffmpeg (streaming ke browser)…`);

      const ffmpeg = spawn("ffmpeg", ffmpegArgs);

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("X-File-Name", `clip_${Date.now()}.mp4`);
      res.setHeader("Access-Control-Expose-Headers", "X-File-Name");
      res.setHeader("Transfer-Encoding", "chunked");

      ffmpeg.stdout.pipe(res);

      let stderrBuf = "";
      ffmpeg.stderr.on("data", (d) => { stderrBuf += d.toString(); });

      ffmpeg.on("close", (code) => {
        safeDelete(uploadedPath);
        if (code !== 0) {
          console.error("[ffmpeg error]", stderrBuf.slice(-500));
          // Response mungkin sudah sebagian terkirim, tidak bisa kirim JSON error
          // — cukup tutup koneksi
          if (!res.headersSent) {
            res.status(500).json({ error: "ffmpeg failed", detail: stderrBuf.slice(-300) });
          } else {
            res.end();
          }
        } else {
          console.log(`✅ Export selesai, temp upload dihapus`);
        }
      });

      ffmpeg.on("error", (err) => {
        safeDelete(uploadedPath);
        console.error("[ffmpeg spawn error]", err.message);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to start ffmpeg", detail: err.message });
        } else {
          res.end();
        }
      });

      res.on("close", () => {
        // Jika client disconnect sebelum selesai, kill ffmpeg
        if (!ffmpeg.killed) ffmpeg.kill("SIGKILL");
        safeDelete(uploadedPath);
      });

    } catch (err) {
      safeDelete(uploadedPath);
      console.error("[export error]", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Export failed", detail: err.message });
      }
    }
  }
);

// ─── buildFFmpegFilters (sama seperti sebelumnya) ─────────────────────────────
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
app.get("/api/health", (_req, res) =>
  res.json({
    ok:      true,
    storage: "Stream-only — tidak ada file yang disimpan di folder project",
    tmpDir:  SYS_TEMP,
  })
);

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 AI Clipper Backend → http://localhost:${PORT}`);
  console.log(`   OS Temp dir  : ${SYS_TEMP}`);
  console.log(`   Storage mode : Stream ke browser → IndexedDB (folder project tetap bersih)\n`);
});