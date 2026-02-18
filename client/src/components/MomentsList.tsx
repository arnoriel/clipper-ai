// src/components/MomentsList.tsx
import { useState } from "react";
import {
  Flame, Zap, Heart, Brain, AlertTriangle, Star, Drama,
  CheckCircle2, Circle, Clock, TrendingUp, Play, Sparkles
} from "lucide-react";
import type { ViralMoment, VideoAnalysisResult } from "../lib/AI";
import { formatTime } from "../lib/AI";

interface Props {
  result: VideoAnalysisResult;
  selectedIds: string[];
  onToggleSelect: (moment: ViralMoment) => void;
  onEditClip: (moment: ViralMoment) => void;
  videoThumbnail: string;
}

const CATEGORY_CONFIG = {
  funny:       { icon: Flame,        color: "text-orange-400",  bg: "bg-orange-400/10", border: "border-orange-400/20",  label: "Funny" },
  emotional:   { icon: Heart,        color: "text-pink-400",    bg: "bg-pink-400/10",   border: "border-pink-400/20",    label: "Emotional" },
  educational: { icon: Brain,        color: "text-blue-400",    bg: "bg-blue-400/10",   border: "border-blue-400/20",    label: "Educational" },
  shocking:    { icon: AlertTriangle,color: "text-yellow-400",  bg: "bg-yellow-400/10", border: "border-yellow-400/20",  label: "Shocking" },
  satisfying:  { icon: Star,         color: "text-emerald-400", bg: "bg-emerald-400/10",border: "border-emerald-400/20", label: "Satisfying" },
  drama:       { icon: Drama,        color: "text-red-400",     bg: "bg-red-400/10",    border: "border-red-400/20",     label: "Drama" },
  highlight:   { icon: Zap,          color: "text-violet-400",  bg: "bg-violet-400/10", border: "border-violet-400/20",  label: "Highlight" },
};

export default function MomentsList({ result, selectedIds, onToggleSelect, onEditClip, videoThumbnail }: Props) {
  const [, setHoveredId] = useState<string | null>(null);

  const viralBar = (score: number) => (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 w-3 rounded-full transition-colors ${
              i < score
                ? score >= 8 ? "bg-red-400" : score >= 6 ? "bg-orange-400" : "bg-yellow-400"
                : "bg-white/10"
            }`}
          />
        ))}
      </div>
      <span className="text-xs font-bold text-zinc-400">{score}/10</span>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Summary card */}
      <div className="bg-gradient-to-br from-violet-500/10 to-cyan-500/10 border border-white/10 rounded-2xl p-5">
        <div className="flex items-start gap-4">
          <img src={videoThumbnail} alt="" className="w-20 h-14 object-cover rounded-lg shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={14} className="text-violet-400" />
              <span className="text-xs font-mono text-violet-400 uppercase tracking-wider">AI Analysis</span>
            </div>
            <p className="text-sm text-zinc-300 leading-relaxed">{result.summary}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-6 pt-4 border-t border-white/[0.06]">
          <div className="flex items-center gap-2">
            <TrendingUp size={14} className="text-cyan-400" />
            <span className="text-xs text-zinc-400">Overall Viral Score</span>
            <span className="text-sm font-bold text-white">{result.totalViralPotential}/10</span>
          </div>
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-violet-400" />
            <span className="text-xs text-zinc-400">Moments Found</span>
            <span className="text-sm font-bold text-white">{result.moments.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 size={14} className="text-green-400" />
            <span className="text-xs text-zinc-400">Selected</span>
            <span className="text-sm font-bold text-white">{selectedIds.length}</span>
          </div>
        </div>
      </div>

      {/* Moments grid */}
      <div className="space-y-3">
        {result.moments.map((moment) => {
          const isSelected = selectedIds.includes(moment.id);
          const cfg = CATEGORY_CONFIG[moment.category] || CATEGORY_CONFIG.highlight;
          const Icon = cfg.icon;
          const duration = moment.endTime - moment.startTime;

          return (
            <div
              key={moment.id}
              onMouseEnter={() => setHoveredId(moment.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`group relative rounded-2xl border transition-all duration-200 overflow-hidden cursor-pointer ${
                isSelected
                  ? "bg-violet-500/10 border-violet-500/40 shadow-lg shadow-violet-500/10"
                  : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/10"
              }`}
              onClick={() => onToggleSelect(moment)}
            >
              {/* Viral score bar (top edge) */}
              <div
                className="absolute top-0 left-0 h-0.5 bg-gradient-to-r from-violet-500 to-cyan-500 transition-all duration-300"
                style={{ width: `${moment.viralScore * 10}%` }}
              />

              <div className="p-4">
                <div className="flex items-start gap-3">
                  {/* Select toggle */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleSelect(moment); }}
                    className="mt-0.5 shrink-0"
                  >
                    {isSelected
                      ? <CheckCircle2 size={20} className="text-violet-400" />
                      : <Circle size={20} className="text-zinc-600 group-hover:text-zinc-400" />
                    }
                  </button>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="text-sm font-semibold text-white truncate">{moment.label}</h3>
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.border} ${cfg.color} border`}>
                        <Icon size={10} />
                        {cfg.label}
                      </span>
                    </div>

                    <p className="text-xs text-zinc-500 leading-relaxed mb-3 line-clamp-2">
                      {moment.reason}
                    </p>

                    <div className="flex items-center gap-4 flex-wrap">
                      {/* Time range */}
                      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                        <Clock size={11} />
                        <span className="font-mono">
                          {formatTime(moment.startTime)} → {formatTime(moment.endTime)}
                        </span>
                        <span className="text-zinc-600">({duration}s)</span>
                      </div>

                      {/* Viral score */}
                      {viralBar(moment.viralScore)}
                    </div>
                  </div>

                  {/* Edit button */}
                  {isSelected && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onEditClip(moment); }}
                      className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-600/20 border border-violet-500/30 text-violet-300 text-xs font-medium hover:bg-violet-600/30 transition-colors"
                    >
                      <Play size={12} className="fill-current" />
                      Edit
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {selectedIds.length > 0 && (
        <div className="text-center text-xs text-zinc-600 pb-2">
          {selectedIds.length} clip{selectedIds.length > 1 ? "s" : ""} selected — click "Edit" to customize each clip
        </div>
      )}
    </div>
  );
}