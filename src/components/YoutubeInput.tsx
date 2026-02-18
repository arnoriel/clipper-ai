// src/components/YoutubeInput.tsx
import { useState } from "react";
import { Youtube, Zap, AlertCircle, Loader2 } from "lucide-react";
import { isApiKeyConfigured } from "../lib/storage";

interface Props {
  onAnalyze: (url: string) => void;
  isLoading: boolean;
  error?: string;
}

export default function YouTubeInput({ onAnalyze, isLoading, error }: Props) {
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");

  const apiKeyOk = isApiKeyConfigured();

  function extractYouTubeId(input: string): boolean {
    return /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/.test(input);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setUrlError("");

    if (!extractYouTubeId(url)) {
      return setUrlError("Please enter a valid YouTube URL");
    }

    onAnalyze(url.trim());
  }

  const exampleUrls = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/9bZkp7q19f0",
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />
      {/* Glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-cyan-500/15 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-xl">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-mono mb-6">
            <Zap size={12} className="fill-violet-400 text-violet-400" />
            POWERED BY ARCEE AI · OPENROUTER
          </div>
          <h1
            className="text-5xl font-black text-white tracking-tight mb-3"
            style={{ fontFamily: "'Syne', sans-serif" }}
          >
            AI{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-cyan-400">
              Clipper
            </span>
          </h1>
          <p className="text-zinc-400 text-base">
            Drop a YouTube link. AI detects the viral moments. You edit &amp; export.
          </p>
        </div>

        {/* API key status badge */}
        {/* <div className="mb-6">
          {apiKeyOk ? (
            <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-xs">
              <ShieldCheck size={14} className="shrink-0" />
              <span>
                API key loaded from{" "}
                <code className="font-mono bg-green-500/10 px-1 py-0.5 rounded">
                  .env.local
                </code>{" "}
                — ready to analyze
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-medium">API key not configured</p>
                <p className="text-red-400/70">
                  Create{" "}
                  <code className="font-mono bg-red-500/10 px-1 py-0.5 rounded">
                    .env.local
                  </code>{" "}
                  in your project root and add:
                </p>
                <code className="block mt-1 bg-black/40 px-3 py-2 rounded-lg font-mono text-red-300/80 text-[11px]">
                  VITE_OPENROUTER_API_KEY=sk-or-v1-...
                </code>
                <p className="text-red-400/60 text-[10px] mt-1">
                  Get a free key at{" "}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-violet-400 underline hover:text-violet-300"
                  >
                    openrouter.ai/keys
                  </a>{" "}
                  · Restart the dev server after saving the file.
                </p>
              </div>
            </div>
          )}
        </div> */}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* YouTube URL */}
          <div className="relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-red-400 pointer-events-none">
              <Youtube size={20} />
            </div>
            <input
              type="text"
              value={url}
              onChange={(e) => { setUrl(e.target.value); setUrlError(""); }}
              placeholder="Paste YouTube URL here..."
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-2xl pl-12 pr-4 py-4 text-white placeholder-zinc-600 focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.06] transition-all font-mono text-sm"
            />
          </div>

          {/* Errors */}
          {(error || urlError) && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error || urlError}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading || !url || !apiKeyOk}
            className="w-full py-4 rounded-2xl font-bold text-sm tracking-wider bg-gradient-to-r from-violet-600 to-cyan-600 text-white hover:from-violet-500 hover:to-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-3 shadow-lg shadow-violet-500/20"
          >
            {isLoading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Analyzing Video...
              </>
            ) : (
              <>
                <Zap size={18} />
                Detect Viral Moments
              </>
            )}
          </button>
        </form>

        {/* Example URLs */}
        <div className="mt-8 pt-6 border-t border-white/[0.05]">
          <p className="text-xs text-zinc-600 mb-3 text-center">Try with an example URL:</p>
          <div className="flex flex-col gap-2">
            {exampleUrls.map((u) => (
              <button
                key={u}
                onClick={() => setUrl(u)}
                className="text-xs text-zinc-500 hover:text-zinc-300 font-mono truncate text-left px-3 py-2 rounded-lg hover:bg-white/[0.03] transition-colors"
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}