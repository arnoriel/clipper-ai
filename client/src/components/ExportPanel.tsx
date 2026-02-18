// src/components/ExportPanel.tsx
import { Download, CheckCircle2, Loader2, Film, Trash2, Zap } from "lucide-react";
import type { ProjectClip } from "../lib/storage";
import { formatTime } from "../lib/AI";

interface Props {
  clips: ProjectClip[];
  exportedUrls: Record<string, string>; // momentId → download URL
  exportingId: string | null;
  onExportClip: (clip: ProjectClip) => void;
  onEditClip: (clip: ProjectClip) => void;
  onRemoveClip: (momentId: string) => void;
}

// Aspect ratio label → display name map
const AR_LABELS: Record<string, string> = {
  "9:16": "9:16 Vertical",
  "16:9": "16:9 Wide",
  "1:1":  "1:1 Square",
  "4:3":  "4:3 Classic",
};

export default function ExportPanel({
  clips, exportedUrls, exportingId, onExportClip, onEditClip, onRemoveClip,
}: Props) {
  if (clips.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-600">
        <Film size={40} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">No clips selected yet.</p>
        <p className="text-xs mt-1">Go back and select some viral moments.</p>
      </div>
    );
  }

  function downloadFile(url: string, filename: string) {
    const a = document.createElement("a");
    a.href = url;                    // ← FULL Supabase URL, tidak perlu localhost lagi
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  const exportedCount = Object.keys(exportedUrls).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-300">
          {clips.length} Clip{clips.length > 1 ? "s" : ""} Ready
        </h3>
        {exportedCount > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-green-400">
            <CheckCircle2 size={12} />
            {exportedCount} exported
          </span>
        )}
      </div>

      {/* Clip cards */}
      {clips.map((clip) => {
        const isExporting  = exportingId === clip.momentId;
        const exportedUrl  = exportedUrls[clip.momentId];
        const effectiveStart = clip.moment.startTime + clip.edits.trimStart;
        const effectiveEnd   = clip.moment.endTime   + clip.edits.trimEnd;
        const duration       = effectiveEnd - effectiveStart;

        return (
          <div
            key={clip.momentId}
            className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-4 space-y-3"
          >
            {/* Clip info row */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                <Film size={14} className="text-violet-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {clip.moment.label}
                </p>
                <p className="text-xs text-zinc-500 font-mono mt-0.5">
                  {formatTime(effectiveStart)} → {formatTime(effectiveEnd)}
                  <span className="ml-2 text-zinc-600">({Math.round(duration)}s)</span>
                </p>
              </div>
              <button
                onClick={() => onRemoveClip(clip.momentId)}
                className="text-zinc-700 hover:text-red-400 transition-colors p-1 shrink-0"
                title="Remove clip"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {/* Edits applied badges */}
            <div className="flex flex-wrap gap-1.5">
              {clip.edits.aspectRatio !== "original" && (
                <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 text-[10px] border border-cyan-500/20">
                  {AR_LABELS[clip.edits.aspectRatio] ?? clip.edits.aspectRatio}
                </span>
              )}
              {clip.edits.speed !== 1 && (
                <span className="px-2 py-0.5 rounded-md bg-orange-500/10 text-orange-400 text-[10px] border border-orange-500/20">
                  {clip.edits.speed}× speed
                </span>
              )}
              {clip.edits.textOverlays.length > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-400 text-[10px] border border-violet-500/20">
                  {clip.edits.textOverlays.length} text{clip.edits.textOverlays.length > 1 ? "s" : ""}
                </span>
              )}
              {(clip.edits.brightness !== 0 || clip.edits.contrast !== 0 || clip.edits.saturation !== 0) && (
                <span className="px-2 py-0.5 rounded-md bg-yellow-500/10 text-yellow-400 text-[10px] border border-yellow-500/20">
                  color adjusted
                </span>
              )}
              {(clip.edits.trimStart !== 0 || clip.edits.trimEnd !== 0) && (
                <span className="px-2 py-0.5 rounded-md bg-pink-500/10 text-pink-400 text-[10px] border border-pink-500/20">
                  trimmed
                </span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onEditClip(clip)}
                className="flex-1 py-2 rounded-xl text-xs border border-white/[0.08] text-zinc-400 hover:text-white hover:border-white/20 transition-colors"
              >
                Edit
              </button>

              {exportedUrl ? (
                <button
                  onClick={() =>
                    downloadFile(
                      exportedUrl,
                      `${clip.moment.label.replace(/\s+/g, "_")}.mp4`
                    )
                  }
                  className="flex-1 py-2 rounded-xl text-xs bg-green-600/20 border border-green-500/30 text-green-400 hover:bg-green-600/30 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Download size={12} />
                  Download
                </button>
              ) : (
                <button
                  onClick={() => onExportClip(clip)}
                  disabled={isExporting}
                  className="flex-1 py-2 rounded-xl text-xs bg-violet-600/20 border border-violet-500/30 text-violet-300 hover:bg-violet-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
                >
                  {isExporting ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Zap size={12} />
                      Export
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Exported success message */}
            {exportedUrl && (
              <div className="flex items-center gap-2 text-xs text-green-400/70 bg-green-500/5 rounded-lg px-3 py-2">
                <CheckCircle2 size={12} className="shrink-0" />
                <span>Exported — click Download to save to your device</span>
              </div>
            )}
          </div>
        );
      })}

      {/* Batch hint */}
      {clips.length > 1 && exportedCount < clips.length && (
        <p className="text-center text-[10px] text-zinc-700 pb-2">
          Export each clip individually, then download
        </p>
      )}
    </div>
  );
}