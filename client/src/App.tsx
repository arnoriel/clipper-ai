// src/App.tsx
import { useState, useEffect, useRef } from "react";
import {
  Youtube, Zap, Film, Download, ChevronRight, Loader2,
  CheckCircle2, AlertCircle, Sparkles, ArrowLeft,
} from "lucide-react";
import YouTubeInput from "./components/YoutubeInput";
import MomentsList  from "./components/MomentsList";
import VideoEditor  from "./components/VideoEditor";
import ExportPanel  from "./components/ExportPanel";
import { detectViralMoments, formatTime, type ViralMoment } from "./lib/AI";
import {
  saveProject, defaultEdits, generateId, getApiKey,
  type Project, type ProjectClip, type ClipEdits,
} from "./lib/storage";
import {
  getTempVideoUrl,
  getTempVideoBlob,
  readResponseAndStoreTempVideo,
  uploadAndStoreExportedClip,
  listStoredExportIds,
  getExportedClip,
} from "./lib/videoDB";

const API_BASE = "http://localhost:3001";

type Step = "input" | "analyzing" | "moments";

function ProgressToast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-[#1a1a2e] border border-violet-500/30 rounded-2xl shadow-xl shadow-violet-500/10 text-sm text-zinc-300 whitespace-nowrap">
      <Loader2 size={14} className="animate-spin text-violet-400 shrink-0" />
      {message}
    </div>
  );
}

export default function App() {
  const [step, setStep]                   = useState<Step>("input");
  const [project, setProject]             = useState<Project | null>(null);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [editingMoment, setEditingMoment] = useState<ViralMoment | null>(null);
  const [clipEdits, setClipEdits]         = useState<Record<string, ClipEdits>>({});
  const [exportedUrls, setExportedUrls]   = useState<Record<string, string>>({});

  const [isLoading, setIsLoading]         = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadPct, setDownloadPct]     = useState(0);
  const [isExporting, setIsExporting]     = useState(false);
  const [exportingId, setExportingId]     = useState<string | null>(null);
  const [progressMsg, setProgressMsg]     = useState("");
  const [error, setError]                 = useState("");
  const [activePanel, setActivePanel]     = useState<"moments" | "export">("moments");

  const videoObjectUrlRef = useRef<string | null>(null);

  // ─── Pulihkan objectURL video dari IndexedDB saat project dimuat ──────────
  useEffect(() => {
    if (!project?.videoId) return;
    if (project.localVideoUrl) return;

    (async () => {
      const url = await getTempVideoUrl(project.videoId);
      if (url) {
        if (videoObjectUrlRef.current) URL.revokeObjectURL(videoObjectUrlRef.current);
        videoObjectUrlRef.current = url;
        setProject((p) => p ? { ...p, localVideoUrl: url } : p);
      }
    })();
  }, [project?.videoId]);

  // ─── Pulihkan exported clip objectURLs dari IndexedDB ─────────────────────
  useEffect(() => {
    if (!project) return;
    (async () => {
      const storedIds  = await listStoredExportIds();
      if (storedIds.length === 0) return;
      const momentIds  = project.analysisResult.moments.map((m) => m.id);
      const relevant   = storedIds.filter((id) => momentIds.includes(id));
      if (relevant.length === 0) return;

      const entries = await Promise.all(
        relevant.map(async (momentId) => {
          const result = await getExportedClip(momentId);
          return result ? ([momentId, result.url] as [string, string]) : null;
        })
      );

      const restored: Record<string, string> = {};
      for (const entry of entries) {
        if (entry) restored[entry[0]] = entry[1];
      }
      if (Object.keys(restored).length > 0) {
        setExportedUrls((prev) => ({ ...restored, ...prev }));
      }
    })();
  }, [project?.id]);

  // ─── Revoke objectURLs saat unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      if (videoObjectUrlRef.current) URL.revokeObjectURL(videoObjectUrlRef.current);
      Object.values(exportedUrls).forEach((url) => {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      });
    };
  }, []);

  // ─── STEP 1: Analisis video ───────────────────────────────────────────────
  async function handleAnalyze(url: string) {
    const apiKey = getApiKey();
    if (!apiKey) {
      setError("API key tidak ditemukan. Tambahkan VITE_OPENROUTER_API_KEY ke .env.local");
      return;
    }

    setIsLoading(true);
    setError("");
    setProgressMsg("Mengambil info video…");
    setStep("analyzing");

    try {
      const infoRes = await fetch(`${API_BASE}/api/video-info?url=${encodeURIComponent(url)}`);
      if (!infoRes.ok) {
        const body = await infoRes.json().catch(() => ({}));
        throw new Error(body.detail || body.error || "Gagal mengambil info video");
      }
      const videoInfo = await infoRes.json();

      const result = await detectViralMoments(videoInfo, apiKey, (msg) => setProgressMsg(msg));

      const proj: Project = {
        id:                generateId(),
        videoUrl:          url,
        videoId:           videoInfo.id,
        videoTitle:        videoInfo.title,
        videoThumbnail:    videoInfo.thumbnail,
        videoDuration:     videoInfo.duration,
        localVideoUrl:     undefined,
        localVideoFileName: undefined,
        analysisResult:    result,
        selectedClips:     [],
        createdAt:         Date.now(),
        updatedAt:         Date.now(),
      };

      saveProject(proj);
      setProject(proj);
      setSelectedClipIds([]);
      setClipEdits({});
      setExportedUrls({});
      setActivePanel("moments");
      setStep("moments");
    } catch (err: any) {
      setError(err.message || "Terjadi kesalahan");
      setStep("input");
    } finally {
      setIsLoading(false);
      setProgressMsg("");
    }
  }

  // ─── Download video → langsung ke IndexedDB (tanpa simpan di folder project) ─
  //
  // Alur:
  //   POST /api/download  →  server stream video (dari yt-dlp + OS temp)
  //                       →  browser baca stream sebagai Blob
  //                       →  simpan Blob di IndexedDB
  //                       →  buat objectURL untuk preview
  //
  // Tidak ada file yang tersimpan di folder project sama sekali.
  async function handleDownloadVideo() {
    if (!project || project.localVideoUrl) return;

    setIsDownloading(true);
    setDownloadPct(0);
    setProgressMsg("Meminta server mengunduh video…");

    try {
      const res = await fetch(`${API_BASE}/api/download`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ url: project.videoUrl, videoId: project.videoId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.error || "Download gagal");
      }

      setProgressMsg("Menyimpan video ke browser IndexedDB…");

      // Baca stream → IndexedDB (dengan progress)
      const { objectUrl, fileName } = await readResponseAndStoreTempVideo(
        res,
        project.videoId,
        (pct) => {
          setDownloadPct(pct);
          setProgressMsg(`Menyimpan ke IndexedDB… ${pct}%`);
        }
      );

      // Revoke objectURL lama jika ada
      if (videoObjectUrlRef.current) URL.revokeObjectURL(videoObjectUrlRef.current);
      videoObjectUrlRef.current = objectUrl;

      const updated: Project = {
        ...project,
        localVideoUrl:      objectUrl,
        localVideoFileName: fileName,
        updatedAt:          Date.now(),
      };
      setProject(updated);
      saveProject(updated);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsDownloading(false);
      setDownloadPct(0);
      setProgressMsg("");
    }
  }

  // ─── Toggle pilihan clip ──────────────────────────────────────────────────
  function handleToggleSelect(moment: ViralMoment) {
    const isSelected = selectedClipIds.includes(moment.id);
    setSelectedClipIds((prev) =>
      isSelected ? prev.filter((id) => id !== moment.id) : [...prev, moment.id]
    );
    if (!isSelected && !clipEdits[moment.id]) {
      setClipEdits((prev) => ({ ...prev, [moment.id]: defaultEdits() }));
    }
  }

  // ─── Buka editor ─────────────────────────────────────────────────────────
  function handleEditMoment(moment: ViralMoment) {
    if (!clipEdits[moment.id]) {
      setClipEdits((prev) => ({ ...prev, [moment.id]: defaultEdits() }));
    }
    setEditingMoment(moment);
  }

  function handleUpdateEdits(edits: ClipEdits) {
    if (!editingMoment) return;
    setClipEdits((prev) => ({ ...prev, [editingMoment.id]: edits }));
  }

  // ─── Export clip → langsung ke IndexedDB (tanpa simpan di folder project) ─
  //
  // Alur:
  //   Ambil Blob video dari IndexedDB
  //   → upload ke POST /api/export-clip (multipart FormData)
  //   → server jalankan ffmpeg, stream hasilnya (Fragmented MP4)
  //   → browser terima Blob
  //   → simpan di IndexedDB
  //   → buat objectURL untuk download
  //
  // Tidak ada file export yang tersimpan di folder project sama sekali.
  async function handleExportClip(moment: ViralMoment, edits: ClipEdits) {
    if (!project?.videoId) {
      setError("Silakan download video terlebih dahulu sebelum export.");
      return;
    }

    // Ambil blob dari IndexedDB
    const videoBlob = await getTempVideoBlob(project.videoId);
    if (!videoBlob) {
      setError("Video belum ada di IndexedDB. Silakan download video terlebih dahulu.");
      return;
    }

    setIsExporting(true);
    setExportingId(moment.id);
    setProgressMsg("Mengupload video ke server untuk diproses…");

    try {
      const clip = {
        startTime: moment.startTime + edits.trimStart,
        endTime:   moment.endTime   + edits.trimEnd,
        label:     moment.label,
      };

      const editsForServer = {
        ...edits,
        textOverlays: edits.textOverlays.map(
          ({ text, x, y, fontSize, color, startSec, endSec }) => ({
            text, x, y, fontSize, color, startSec, endSec,
          })
        ),
      };

      setProgressMsg("Server memproses clip, harap tunggu…");

      // Upload blob + terima hasil streaming → simpan ke IndexedDB
      const objectUrl = await uploadAndStoreExportedClip(
        `${API_BASE}/api/export-clip`,
        videoBlob,
        moment.id,
        clip,
        editsForServer
      );

      setExportedUrls((prev) => ({ ...prev, [moment.id]: objectUrl }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsExporting(false);
      setExportingId(null);
      setProgressMsg("");
    }
  }

  // ─── Derived clips untuk ExportPanel ─────────────────────────────────────
  const selectedClips: ProjectClip[] = selectedClipIds
    .map((id) => {
      const moment = project?.analysisResult.moments.find((m) => m.id === id);
      if (!moment) return null;
      return { momentId: id, moment, edits: clipEdits[id] || defaultEdits() };
    })
    .filter(Boolean) as ProjectClip[];

  // ─── Render: Input / Analyzing ────────────────────────────────────────────
  if (step === "input" || step === "analyzing") {
    return (
      <>
        <YouTubeInput onAnalyze={handleAnalyze} isLoading={isLoading} error={error} />
        {progressMsg && <ProgressToast message={progressMsg} />}
      </>
    );
  }

  if (!project) return null;

  // ─── Render: Main workspace ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
      <div className="h-px bg-gradient-to-r from-transparent via-violet-500 to-transparent" />

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-white/[0.05] shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              setStep("input");
              setProject(null);
              setSelectedClipIds([]);
              setClipEdits({});
              setExportedUrls({});
              setError("");
            }}
            className="p-2 rounded-xl hover:bg-white/[0.05] text-zinc-500 hover:text-white transition-colors"
            title="Kembali ke home"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center">
              <Zap size={12} className="text-white fill-white" />
            </div>
            <span className="text-sm font-bold" style={{ fontFamily: "'Syne', sans-serif" }}>
              AI Clipper
            </span>
          </div>
        </div>

        <div className="flex-1 max-w-md mx-8 hidden md:block min-w-0">
          <div className="flex items-center gap-2 text-xs text-zinc-600 truncate">
            <Youtube size={12} className="text-red-500 shrink-0" />
            <span className="truncate">{project.videoTitle}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {!project.localVideoUrl ? (
            <button
              onClick={handleDownloadVideo}
              disabled={isDownloading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08] text-xs hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              {isDownloading ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  {downloadPct > 0 ? `Menyimpan… ${downloadPct}%` : "Mengunduh…"}
                </>
              ) : (
                <><Download size={12} /> Download Video</>
              )}
            </button>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-green-400">
              <CheckCircle2 size={12} />
              Video siap
            </div>
          )}

          {selectedClipIds.length > 0 && (
            <button
              onClick={() => setActivePanel("export")}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-600 text-xs font-semibold hover:from-violet-500 hover:to-cyan-500 transition-all shadow-lg shadow-violet-500/20"
            >
              <Film size={12} />
              Export {selectedClipIds.length} Clip{selectedClipIds.length > 1 ? "s" : ""}
              <ChevronRight size={12} />
            </button>
          )}
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="mx-6 mt-4 flex items-center gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
          <AlertCircle size={14} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")} className="text-red-400 hover:text-white ml-2">✕</button>
        </div>
      )}

      {/* Main layout */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left sidebar */}
        <aside className="w-72 border-r border-white/[0.05] overflow-y-auto p-5 hidden lg:flex flex-col shrink-0">
          <img
            src={project.videoThumbnail}
            alt=""
            className="w-full aspect-video object-cover rounded-xl mb-4"
          />
          <h2 className="text-sm font-semibold text-white leading-snug mb-2">
            {project.videoTitle}
          </h2>
          <div className="flex items-center gap-2 text-xs text-zinc-500 mb-6">
            <span className="font-mono">{formatTime(project.videoDuration)}</span>
            <span>·</span>
            <span>{project.analysisResult.moments.length} viral moments terdeteksi</span>
          </div>

          <div className="space-y-2">
            {[
              { label: "Analisis Video",     done: true },
              { label: "Pilih Moments",      done: selectedClipIds.length > 0 },
              { label: "Edit Clips",         done: Object.values(clipEdits).some(
                (e) => e.aspectRatio !== "original" || e.textOverlays.length > 0 ||
                       e.trimStart !== 0 || e.trimEnd !== 0 || e.speed !== 1
              )},
              { label: "Export & Download",  done: Object.keys(exportedUrls).length > 0 },
            ].map((s, i) => (
              <div key={i} className="flex items-center gap-2.5 text-xs">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center border text-[10px] font-bold shrink-0 ${
                  s.done
                    ? "bg-violet-500/20 border-violet-500/40 text-violet-400"
                    : "bg-white/[0.03] border-white/10 text-zinc-600"
                }`}>
                  {s.done ? "✓" : i + 1}
                </div>
                <span className={s.done ? "text-zinc-300" : "text-zinc-600"}>{s.label}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-5 border-t border-white/[0.05]">
            <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-2 font-mono">AI Summary</p>
            <p className="text-xs text-zinc-500 leading-relaxed">{project.analysisResult.summary}</p>
          </div>
        </aside>

        {/* Main panel */}
        <main className="flex-1 overflow-y-auto min-w-0">
          <div className="sticky top-0 z-10 flex items-center gap-1 px-6 py-3 bg-[#0a0a0f]/90 backdrop-blur border-b border-white/[0.04]">
            <button
              onClick={() => setActivePanel("moments")}
              className={`px-4 py-2 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 ${
                activePanel === "moments" ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Sparkles size={12} />
              Viral Moments ({project.analysisResult.moments.length})
            </button>
            <button
              onClick={() => setActivePanel("export")}
              className={`px-4 py-2 rounded-xl text-xs font-medium transition-colors flex items-center gap-2 ${
                activePanel === "export" ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              <Film size={12} />
              Clips Dipilih ({selectedClipIds.length})
            </button>
          </div>

          <div className="p-6">
            {activePanel === "moments" && (
              <MomentsList
                result={project.analysisResult}
                selectedIds={selectedClipIds}
                onToggleSelect={handleToggleSelect}
                onEditClip={handleEditMoment}
                videoThumbnail={project.videoThumbnail}
              />
            )}
            {activePanel === "export" && (
              <ExportPanel
                clips={selectedClips}
                exportedUrls={exportedUrls}
                exportingId={exportingId}
                onExportClip={(clip) => handleExportClip(clip.moment, clip.edits)}
                onEditClip={(clip) => handleEditMoment(clip.moment)}
                onRemoveClip={(id) => setSelectedClipIds((prev) => prev.filter((x) => x !== id))}
              />
            )}
          </div>
        </main>
      </div>

      {progressMsg && <ProgressToast message={progressMsg} />}

      {editingMoment && (
        <VideoEditor
          moment={editingMoment}
          edits={clipEdits[editingMoment.id] || defaultEdits()}
          videoSrc={project.localVideoUrl || ""}
          onUpdateEdits={handleUpdateEdits}
          onExport={handleExportClip}
          onClose={() => setEditingMoment(null)}
          isExporting={isExporting && exportingId === editingMoment.id}
        />
      )}
    </div>
  );
}