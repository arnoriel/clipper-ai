// src/lib/storage.ts
// All local storage interactions (project metadata in localStorage)
// Video blobs are stored separately in IndexedDB via src/lib/videoDB.ts

import type { ViralMoment, VideoAnalysisResult } from "./AI";

export interface TextOverlay {
  id: string;
  text: string;
  x: number;       // 0-1 normalized
  y: number;       // 0-1 normalized
  fontSize: number;
  color: string;
  startSec: number | null;
  endSec: number | null;
  bold: boolean;
}

export interface ClipEdits {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  aspectRatio: "9:16" | "16:9" | "1:1" | "4:3" | "original";
  textOverlays: TextOverlay[];
  brightness: number;   // -1 to 1
  contrast: number;     // -1 to 1
  saturation: number;   // -1 to 1
  speed: number;        // 0.5 | 1 | 1.5 | 2
  trimStart: number;    // offset from moment.startTime
  trimEnd: number;      // offset from moment.endTime (negative)
}

export interface ProjectClip {
  momentId: string;
  moment: ViralMoment;
  edits: ClipEdits;
  generatedContent?: {
    titles: string[];
    captions: string[];
    hashtags: string[];
  };
  exportedUrl?: string;
}

export interface Project {
  id: string;
  videoUrl: string;
  videoId: string;
  videoTitle: string;
  videoThumbnail: string;
  videoDuration: number;

  /**
   * Ephemeral blob: URL (created from IndexedDB, valid for current tab session).
   * NOT persisted in localStorage — reconstructed from IndexedDB on app load.
   */
  localVideoUrl?: string;

  /**
   * The filename used by the local server (e.g. "dQw4w9WgXcQ.mp4").
   * Persisted in localStorage so the export endpoint can locate the file.
   * Also serves as the IndexedDB lookup key alongside videoId.
   */
  localVideoFileName?: string;

  analysisResult: VideoAnalysisResult;
  selectedClips: ProjectClip[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "ai_clipper_projects";

// ─── API Key — read from Vite env, never stored in localStorage ───────────────
export function getApiKey(): string {
  return import.meta.env.VITE_OPENROUTER_API_KEY ?? "";
}

export function isApiKeyConfigured(): boolean {
  const key = getApiKey();
  return key.startsWith("sk-or-") && key.length > 20;
}

// ─── Projects ─────────────────────────────────────────────────────────────────
export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const projects: Project[] = JSON.parse(raw);
    // localVideoUrl is ephemeral — never restore it from localStorage
    return projects.map((p) => ({ ...p, localVideoUrl: undefined }));
  } catch {
    return [];
  }
}

export function saveProject(project: Project) {
  const projects = loadProjects();
  const idx = projects.findIndex((p) => p.id === project.id);

  // Strip the ephemeral objectURL before persisting
  const toSave: Project = { ...project, localVideoUrl: undefined };

  if (idx >= 0) projects[idx] = toSave;
  else projects.unshift(toSave);

  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects.slice(0, 20)));
}

export function deleteProject(id: string) {
  const projects = loadProjects().filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

export function getProject(id: string): Project | null {
  return loadProjects().find((p) => p.id === id) || null;
}

// ─── Default edits ────────────────────────────────────────────────────────────
export function defaultEdits(): ClipEdits {
  return {
    cropX: 0,
    cropY: 0,
    cropW: 1,
    cropH: 1,
    aspectRatio: "original",
    textOverlays: [],
    brightness: 0,
    contrast: 0,
    saturation: 0,
    speed: 1,
    trimStart: 0,
    trimEnd: 0,
  };
}

export function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}