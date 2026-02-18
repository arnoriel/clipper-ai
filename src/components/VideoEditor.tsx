// src/components/VideoEditor.tsx
import { useState, useRef, useEffect } from "react";
import {
  X, Play, Pause, SkipBack, SkipForward, Type, Crop,
  Sliders, Zap, Download, Loader2, Plus, Trash2, Clock, RefreshCw,
} from "lucide-react";
import type { ViralMoment } from "../lib/AI";
import { formatTime } from "../lib/AI";
import type { ClipEdits, TextOverlay } from "../lib/storage";
import { generateId } from "../lib/storage";

interface Props {
  moment: ViralMoment;
  edits: ClipEdits;
  videoSrc: string;
  onUpdateEdits: (edits: ClipEdits) => void;
  onExport: (moment: ViralMoment, edits: ClipEdits) => void;
  onClose: () => void;
  isExporting: boolean;
}

type Tab = "trim" | "crop" | "text" | "color" | "speed";

const ASPECT_RATIOS: { label: string; value: ClipEdits["aspectRatio"]; desc: string }[] = [
  { label: "Original",      value: "original", desc: "Keep source dimensions" },
  { label: "9:16 Vertical", value: "9:16",     desc: "TikTok / Reels / Shorts" },
  { label: "16:9 Wide",     value: "16:9",     desc: "YouTube / Landscape" },
  { label: "1:1 Square",    value: "1:1",      desc: "Instagram feed" },
  { label: "4:3 Classic",   value: "4:3",      desc: "Classic TV ratio" },
];

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export default function VideoEditor({
  moment, edits, videoSrc, onUpdateEdits, onExport, onClose, isExporting,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeTab, setActiveTab]     = useState<Tab>("trim");
  const [newText, setNewText]         = useState("");

  const clipStart    = moment.startTime + edits.trimStart;
  const clipEnd      = moment.endTime   + edits.trimEnd;
  const clipDuration = clipEnd - clipStart;

  // ─────────────────────────────────────────────────────────────────────────────
  // IMPORTANT: This effect must ONLY depend on [videoSrc, clipStart, clipEnd].
  // DO NOT add edits.aspectRatio or any other edit field here.
  //
  // Bug that was fixed:
  //   Previously there were two separate <video> JSX branches — one for "original"
  //   and one for "cropped". When aspectRatio changed, React would unmount the
  //   first <video> and mount the second, resetting currentTime to 0.
  //   Now there is ONE <video> element always in the same DOM position; only
  //   its container CSS changes. So aspectRatio changes never remount the video,
  //   and this effect correctly only re-seeks when the clip boundaries change.
  // ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoSrc) return;

    // Seek to clip start whenever clip boundaries or source changes
    v.currentTime = clipStart;
    setCurrentTime(clipStart);

    const onTime = () => {
      setCurrentTime(v.currentTime);
      if (v.currentTime >= clipEnd) {
        v.pause();
        v.currentTime = clipStart;
        setIsPlaying(false);
      }
    };

    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [videoSrc, clipStart, clipEnd]); // ← aspectRatio intentionally NOT here

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.pause();
      setIsPlaying(false);
    } else {
      if (v.currentTime >= clipEnd) v.currentTime = clipStart;
      v.play();
      setIsPlaying(true);
    }
  }

  function seek(delta: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(Math.max(v.currentTime + delta, clipStart), clipEnd);
  }

  function updateEdits(partial: Partial<ClipEdits>) {
    onUpdateEdits({ ...edits, ...partial });
  }

  function addTextOverlay() {
    if (!newText.trim()) return;
    const overlay: TextOverlay = {
      id: generateId(),
      text: newText.trim(),
      x: 0.5, y: 0.85,
      fontSize: 36,
      color: "#FFFFFF",
      startSec: null,
      endSec: null,
      bold: true,
    };
    updateEdits({ textOverlays: [...edits.textOverlays, overlay] });
    setNewText("");
  }

  function updateTextOverlay(id: string, changes: Partial<TextOverlay>) {
    updateEdits({
      textOverlays: edits.textOverlays.map((t) =>
        t.id === id ? { ...t, ...changes } : t
      ),
    });
  }

  function removeTextOverlay(id: string) {
    updateEdits({ textOverlays: edits.textOverlays.filter((t) => t.id !== id) });
  }

  const progressPct =
    clipDuration > 0 ? ((currentTime - clipStart) / clipDuration) * 100 : 0;

  // Derive crop CSS from selected aspect ratio
  // isCropped = true  → container gets fixed aspect-ratio + overflow:hidden
  //                      video gets object-fit:cover (mirrors ffmpeg center-crop)
  // isCropped = false → video gets object-contain, fills available space
  const isCropped = edits.aspectRatio !== "original";
  const [arW, arH] = isCropped
    ? edits.aspectRatio.split(":").map(Number)
    : [16, 9];
  const cssAspectRatio = `${arW} / ${arH}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#111118] border border-white/10 rounded-3xl w-full max-w-5xl max-h-[95vh] overflow-hidden flex flex-col shadow-2xl">

        {/* ─── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between p-5 border-b border-white/[0.06]">
          <div>
            <h2 className="text-base font-bold text-white">{moment.label}</h2>
            <p className="text-xs text-zinc-500 mt-0.5 font-mono">
              {formatTime(clipStart)} → {formatTime(clipEnd)} · {Math.round(clipDuration)}s
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">

          {/* ─── Video Preview ─────────────────────────────────────────────── */}
          <div className="flex-1 flex flex-col bg-black min-w-0">
            <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
              {videoSrc ? (
                <div className="relative w-full h-full flex items-center justify-center">

                  {/*
                    ┌─ FIX EXPLANATION ──────────────────────────────────────────┐
                    │  We keep ONE <video> element in ONE fixed DOM position.     │
                    │  The wrapper div's CSS changes (aspect-ratio, overflow,      │
                    │  sizing) to produce the crop preview, but the <video> node  │
                    │  itself is never unmounted/remounted. This means:           │
                    │  • currentTime is preserved across aspect ratio changes      │
                    │  • The trim position is never lost                          │
                    │  • useEffect only re-runs when actual clip boundaries change │
                    └────────────────────────────────────────────────────────────┘
                  */}

                  {/* Wrapper: aspect-ratio crop when isCropped, full-size otherwise */}
                  <div
                    className="relative overflow-hidden"
                    style={
                      isCropped
                        ? { aspectRatio: cssAspectRatio, maxHeight: "100%", maxWidth: "100%", boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)" }
                        : { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }
                    }
                  >
                    {/* ── Single video element — never remounted ── */}
                    <video
                      ref={videoRef}
                      src={videoSrc}
                      className={isCropped ? "w-full h-full" : "max-h-full max-w-full"}
                      style={{
                        objectFit: isCropped ? "cover" : "contain",
                        filter: `brightness(${1 + edits.brightness}) contrast(${1 + edits.contrast}) saturate(${1 + edits.saturation})`,
                      }}
                      onPlay={() => setIsPlaying(true)}
                      onPause={() => setIsPlaying(false)}
                    />

                    {/* Text overlays — always rendered in same container */}
                    {edits.textOverlays.map((t) => (
                      <div
                        key={t.id}
                        className="absolute pointer-events-none"
                        style={{
                          left: `${t.x * 100}%`,
                          top:  `${t.y * 100}%`,
                          transform: "translate(-50%, -50%)",
                          fontSize: isCropped ? `${t.fontSize * 0.5}px` : `${t.fontSize}px`,
                          color: t.color,
                          fontWeight: t.bold ? "bold" : "normal",
                          textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {t.text}
                      </div>
                    ))}

                    {/* Aspect ratio badge (only in cropped mode) */}
                    {isCropped && (
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-cyan-400 text-[10px] font-mono border border-cyan-500/30 pointer-events-none">
                        {edits.aspectRatio}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center text-zinc-600 p-8">
                  <p className="text-sm">Video not downloaded yet.</p>
                  <p className="text-xs mt-1">Download the video from the main panel first.</p>
                </div>
              )}
            </div>

            {/* ─── Playback Controls ──────────────────────────────────────── */}
            <div className="p-4 bg-black/60 border-t border-white/[0.05] shrink-0">
              {/* Progress bar — click to seek */}
              <div
                className="h-1.5 bg-white/10 rounded-full mb-4 cursor-pointer relative overflow-hidden"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct  = (e.clientX - rect.left) / rect.width;
                  const t    = clipStart + pct * clipDuration;
                  if (videoRef.current) videoRef.current.currentTime = t;
                }}
              >
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-violet-500 to-cyan-500 rounded-full transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => seek(-5)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-zinc-400 hover:text-white"
                  >
                    <SkipBack size={16} />
                  </button>
                  <button
                    onClick={togglePlay}
                    className="p-3 bg-white rounded-xl hover:bg-white/90 transition-colors text-black"
                  >
                    {isPlaying ? <Pause size={18} /> : <Play size={18} fill="black" />}
                  </button>
                  <button
                    onClick={() => seek(5)}
                    className="p-2 hover:bg-white/10 rounded-lg transition-colors text-zinc-400 hover:text-white"
                  >
                    <SkipForward size={16} />
                  </button>
                </div>

                <span className="text-xs font-mono text-zinc-500">
                  {formatTime(Math.max(0, currentTime - clipStart))} / {formatTime(clipDuration)}
                </span>
              </div>
            </div>
          </div>

          {/* ─── Edit Panel ────────────────────────────────────────────────── */}
          <div className="w-72 border-l border-white/[0.06] flex flex-col overflow-hidden shrink-0">

            {/* Tabs */}
            <div className="flex overflow-x-auto border-b border-white/[0.06] bg-black/20 shrink-0">
              {([
                { id: "trim",  icon: Clock,   label: "Trim"  },
                { id: "crop",  icon: Crop,    label: "Crop"  },
                { id: "text",  icon: Type,    label: "Text"  },
                { id: "color", icon: Sliders, label: "Color" },
                { id: "speed", icon: Zap,     label: "Speed" },
              ] as const).map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id as Tab)}
                  className={`flex-1 flex flex-col items-center gap-1 py-3 px-2 text-[10px] font-medium transition-colors border-b-2 ${
                    activeTab === id
                      ? "text-violet-400 border-violet-500"
                      : "text-zinc-600 border-transparent hover:text-zinc-400"
                  }`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">

              {/* ── TRIM ──────────────────────────────────────────────────── */}
              {activeTab === "trim" && (
                <>
                  <SliderField
                    label="Trim Start"
                    value={edits.trimStart}
                    min={0}
                    max={Math.max(0, Math.floor((moment.endTime - moment.startTime) * 0.8))}
                    step={1}
                    format={(v) => `+${v}s`}
                    onChange={(v) => updateEdits({ trimStart: v })}
                  />
                  <SliderField
                    label="Trim End"
                    value={edits.trimEnd}
                    min={-Math.max(0, Math.floor((moment.endTime - moment.startTime) * 0.8))}
                    max={0}
                    step={1}
                    format={(v) => `${v}s`}
                    onChange={(v) => updateEdits({ trimEnd: v })}
                  />
                  <div className="bg-white/[0.03] rounded-xl p-3 text-xs text-zinc-500 space-y-1.5">
                    <div className="flex justify-between">
                      <span>New Start</span>
                      <span className="font-mono text-white">{formatTime(clipStart)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>New End</span>
                      <span className="font-mono text-white">{formatTime(clipEnd)}</span>
                    </div>
                    <div className="flex justify-between border-t border-white/[0.06] pt-1.5">
                      <span>Duration</span>
                      <span className="font-mono text-cyan-400">{Math.round(clipDuration)}s</span>
                    </div>
                  </div>
                </>
              )}

              {/* ── CROP ──────────────────────────────────────────────────── */}
              {activeTab === "crop" && (
                <>
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <label className="text-xs text-zinc-400 font-medium">Aspect Ratio</label>
                      <span className="text-[10px] text-zinc-600">· center crop, no stretch</span>
                    </div>
                    <div className="space-y-1.5">
                      {ASPECT_RATIOS.map((ar) => (
                        <button
                          key={ar.value}
                          onClick={() => updateEdits({ aspectRatio: ar.value })}
                          className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium text-left transition-all flex items-center justify-between ${
                            edits.aspectRatio === ar.value
                              ? "bg-violet-600/20 border border-violet-500/40 text-violet-300"
                              : "bg-white/[0.03] border border-white/[0.06] text-zinc-400 hover:text-white hover:border-white/10"
                          }`}
                        >
                          <span>{ar.label}</span>
                          <span className={`text-[10px] ${
                            edits.aspectRatio === ar.value ? "text-violet-400/70" : "text-zinc-600"
                          }`}>
                            {ar.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-3 space-y-1">
                    <p className="text-[10px] text-cyan-400 font-medium">How it works</p>
                    <p className="text-[10px] text-zinc-500 leading-relaxed">
                      Crops from the <strong className="text-zinc-400">center</strong> of the frame — no stretching.
                      Preview above updates instantly. Exported clip matches exactly what you see.
                    </p>
                  </div>
                </>
              )}

              {/* ── TEXT ──────────────────────────────────────────────────── */}
              {activeTab === "text" && (
                <>
                  <div className="flex gap-2">
                    <input
                      value={newText}
                      onChange={(e) => setNewText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && addTextOverlay()}
                      placeholder="Add text overlay..."
                      className="flex-1 bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500/40"
                    />
                    <button
                      onClick={addTextOverlay}
                      className="p-2 bg-violet-600/20 border border-violet-500/30 rounded-xl text-violet-400 hover:bg-violet-600/30 transition-colors"
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  <div className="space-y-3">
                    {edits.textOverlays.length === 0 && (
                      <p className="text-xs text-zinc-600 text-center py-4">No text overlays yet</p>
                    )}
                    {edits.textOverlays.map((t) => (
                      <div
                        key={t.id}
                        className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-white font-medium truncate flex-1">{t.text}</span>
                          <button
                            onClick={() => removeTextOverlay(t.id)}
                            className="ml-2 text-zinc-600 hover:text-red-400 transition-colors"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-zinc-600 mb-1">Size</label>
                            <input
                              type="range" min={16} max={80} value={t.fontSize}
                              onChange={(e) => updateTextOverlay(t.id, { fontSize: +e.target.value })}
                              className="w-full accent-violet-500"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-zinc-600 mb-1">Color</label>
                            <input
                              type="color" value={t.color}
                              onChange={(e) => updateTextOverlay(t.id, { color: e.target.value })}
                              className="w-full h-8 rounded cursor-pointer bg-transparent border border-white/10"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] text-zinc-600 mb-1">
                              X <span className="text-zinc-700">({Math.round(t.x * 100)}%)</span>
                            </label>
                            <input
                              type="range" min={0} max={1} step={0.01} value={t.x}
                              onChange={(e) => updateTextOverlay(t.id, { x: +e.target.value })}
                              className="w-full accent-violet-500"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] text-zinc-600 mb-1">
                              Y <span className="text-zinc-700">({Math.round(t.y * 100)}%)</span>
                            </label>
                            <input
                              type="range" min={0} max={1} step={0.01} value={t.y}
                              onChange={(e) => updateTextOverlay(t.id, { y: +e.target.value })}
                              className="w-full accent-violet-500"
                            />
                          </div>
                        </div>
                        <button
                          onClick={() => updateTextOverlay(t.id, { bold: !t.bold })}
                          className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-colors border ${
                            t.bold
                              ? "bg-violet-600/20 border-violet-500/40 text-violet-300"
                              : "bg-white/[0.03] border-white/[0.06] text-zinc-500"
                          }`}
                        >
                          Bold
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ── COLOR ──────────────────────────────────────────────────── */}
              {activeTab === "color" && (
                <>
                  <SliderField
                    label="Brightness"
                    value={edits.brightness} min={-1} max={1} step={0.05}
                    format={(v) => (v > 0 ? `+${(v * 100).toFixed(0)}%` : `${(v * 100).toFixed(0)}%`)}
                    onChange={(v) => updateEdits({ brightness: v })}
                  />
                  <SliderField
                    label="Contrast"
                    value={edits.contrast} min={-1} max={1} step={0.05}
                    format={(v) => (v > 0 ? `+${(v * 100).toFixed(0)}%` : `${(v * 100).toFixed(0)}%`)}
                    onChange={(v) => updateEdits({ contrast: v })}
                  />
                  <SliderField
                    label="Saturation"
                    value={edits.saturation} min={-1} max={1} step={0.05}
                    format={(v) => (v > 0 ? `+${(v * 100).toFixed(0)}%` : `${(v * 100).toFixed(0)}%`)}
                    onChange={(v) => updateEdits({ saturation: v })}
                  />
                  <button
                    onClick={() => updateEdits({ brightness: 0, contrast: 0, saturation: 0 })}
                    className="w-full py-2 rounded-xl text-xs text-zinc-500 hover:text-white border border-white/[0.06] hover:border-white/10 transition-colors flex items-center justify-center gap-2"
                  >
                    <RefreshCw size={12} /> Reset Colors
                  </button>
                </>
              )}

              {/* ── SPEED ──────────────────────────────────────────────────── */}
              {activeTab === "speed" && (
                <div>
                  <label className="block text-xs text-zinc-400 mb-3">Playback Speed</label>
                  <div className="grid grid-cols-3 gap-2">
                    {SPEED_OPTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => updateEdits({ speed: s })}
                        className={`py-2.5 rounded-xl text-xs font-bold transition-colors ${
                          edits.speed === s
                            ? "bg-violet-600/30 border border-violet-500/50 text-violet-300"
                            : "bg-white/[0.03] border border-white/[0.06] text-zinc-500 hover:text-white"
                        }`}
                      >
                        {s}×
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-zinc-600 mt-3 leading-relaxed">
                    {edits.speed < 1  && "🐢 Slow motion effect"}
                    {edits.speed === 1 && "▶ Normal speed"}
                    {edits.speed > 1  && "⚡ Timelapse / fast-forward"}
                  </p>
                  <div className="mt-3 bg-white/[0.02] rounded-xl p-3 text-[10px] text-zinc-600 leading-relaxed">
                    Audio pitch is preserved automatically (atempo filter).
                  </div>
                </div>
              )}
            </div>

            {/* Export button */}
            <div className="p-4 border-t border-white/[0.06] shrink-0">
              <button
                onClick={() => onExport(moment, edits)}
                disabled={isExporting || !videoSrc}
                className="w-full py-3.5 rounded-2xl font-bold text-sm bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:from-violet-500 hover:to-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-violet-500/20"
              >
                {isExporting ? (
                  <><Loader2 size={16} className="animate-spin" /> Exporting...</>
                ) : (
                  <><Download size={16} /> Export Clip</>
                )}
              </button>
              {!videoSrc && (
                <p className="text-[10px] text-zinc-600 text-center mt-2">
                  Download the video first to enable export
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Slider helper ────────────────────────────────────────────────────────────
function SliderField({
  label, value, min, max, step, format, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between mb-2">
        <label className="text-xs text-zinc-400">{label}</label>
        <span className="text-xs font-mono text-violet-400">{format(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-violet-500"
      />
    </div>
  );
}