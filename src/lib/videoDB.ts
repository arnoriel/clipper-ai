// src/lib/videoDB.ts
// Browser IndexedDB storage for video blobs
// Replaces Supabase cloud storage — no size limits, fully offline

const DB_NAME = "ai-clipper-video-db";
const DB_VERSION = 1;
const STORE_TEMP    = "temp-videos";   // downloaded source videos
const STORE_EXPORTS = "clip-exports";  // exported/rendered clips

// ─── Internal record shapes ───────────────────────────────────────────────────
interface TempVideoRecord {
  videoId:   string;   // YouTube video ID (key)
  fileName:  string;   // e.g. "abc123.mp4"
  blob:      Blob;
  storedAt:  number;   // Date.now()
}

interface ExportRecord {
  momentId:  string;   // moment.id (key)
  fileName:  string;   // e.g. "clip_1714000000000.mp4"
  blob:      Blob;
  storedAt:  number;
}

// ─── Open / init DB ───────────────────────────────────────────────────────────
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_TEMP)) {
        db.createObjectStore(STORE_TEMP, { keyPath: "videoId" });
      }
      if (!db.objectStoreNames.contains(STORE_EXPORTS)) {
        db.createObjectStore(STORE_EXPORTS, { keyPath: "momentId" });
      }
    };

    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror   = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}

// ─── Helper: wrap IDBRequest in a Promise ─────────────────────────────────────
function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMP VIDEOS  (source videos downloaded from YouTube)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Store a video blob. If one already exists for this videoId it is overwritten.
 * @param videoId  YouTube video ID used as the DB key
 * @param fileName Filename on the local server (e.g. "abc123.mp4")
 * @param blob     Raw MP4 blob fetched from the server
 */
export async function storeTempVideo(
  videoId:  string,
  fileName: string,
  blob:     Blob
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_TEMP, "readwrite");
  await idbRequest(
    tx.objectStore(STORE_TEMP).put({
      videoId,
      fileName,
      blob,
      storedAt: Date.now(),
    } satisfies TempVideoRecord)
  );
  db.close();
}

/**
 * Retrieve the blob for a stored video and return a fresh objectURL.
 * Returns null if nothing is stored for this videoId.
 *
 * ⚠️  Caller is responsible for revoking the URL with URL.revokeObjectURL()
 *     when it is no longer needed (e.g. on component unmount).
 */
export async function getTempVideoUrl(videoId: string): Promise<string | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_TEMP, "readonly");
  const record = await idbRequest<TempVideoRecord | undefined>(
    tx.objectStore(STORE_TEMP).get(videoId)
  );
  db.close();
  if (!record) return null;
  return URL.createObjectURL(record.blob);
}

/** Get the stored filename for a video (needed to send to the export endpoint). */
export async function getTempVideoFileName(videoId: string): Promise<string | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_TEMP, "readonly");
  const record = await idbRequest<TempVideoRecord | undefined>(
    tx.objectStore(STORE_TEMP).get(videoId)
  );
  db.close();
  return record?.fileName ?? null;
}

/** Delete a stored source video. */
export async function deleteTempVideo(videoId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_TEMP, "readwrite");
  await idbRequest(tx.objectStore(STORE_TEMP).delete(videoId));
  db.close();
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTED CLIPS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Store a rendered clip blob keyed by momentId.
 * @param momentId Viral moment ID used as the DB key
 * @param fileName Suggested download filename (e.g. "clip_1714000000000.mp4")
 * @param blob     Raw MP4 blob fetched from the server
 */
export async function storeExportedClip(
  momentId: string,
  fileName: string,
  blob:     Blob
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_EXPORTS, "readwrite");
  await idbRequest(
    tx.objectStore(STORE_EXPORTS).put({
      momentId,
      fileName,
      blob,
      storedAt: Date.now(),
    } satisfies ExportRecord)
  );
  db.close();
}

/**
 * Returns a { url, fileName } pair for a stored exported clip, or null.
 * ⚠️  Caller must revoke the objectURL when done.
 */
export async function getExportedClip(
  momentId: string
): Promise<{ url: string; fileName: string } | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_EXPORTS, "readonly");
  const record = await idbRequest<ExportRecord | undefined>(
    tx.objectStore(STORE_EXPORTS).get(momentId)
  );
  db.close();
  if (!record) return null;
  return {
    url:      URL.createObjectURL(record.blob),
    fileName: record.fileName,
  };
}

/**
 * Trigger a browser download for a stored exported clip.
 * Creates and immediately revokes a temporary objectURL.
 */
export async function downloadExportedClip(
  momentId:         string,
  suggestedFileName: string
): Promise<boolean> {
  const result = await getExportedClip(momentId);
  if (!result) return false;

  const a = document.createElement("a");
  a.href     = result.url;
  a.download = suggestedFileName || result.fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(result.url);
  return true;
}

/** Delete a stored exported clip. */
export async function deleteExportedClip(momentId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_EXPORTS, "readwrite");
  await idbRequest(tx.objectStore(STORE_EXPORTS).delete(momentId));
  db.close();
}

/**
 * Returns a Set of momentIds that have been exported and stored in IndexedDB.
 * Useful for re-hydrating exportedUrls after a page reload.
 */
export async function listStoredExportIds(): Promise<string[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_EXPORTS, "readonly");
  const keys = await idbRequest<IDBValidKey[]>(
    tx.objectStore(STORE_EXPORTS).getAllKeys()
  );
  db.close();
  return keys as string[];
}

/**
 * Fetch a video blob from a local server URL and store it in IndexedDB.
 * Shows progress via an optional callback (bytes received / total).
 */
export async function fetchAndStoreTempVideo(
  serverUrl:        string,
  videoId:          string,
  fileName:         string,
  onProgress?:      (pct: number) => void
): Promise<string> {
  const response = await fetch(serverUrl);
  if (!response.ok) throw new Error(`Failed to fetch video: ${response.statusText}`);

  const contentLength = Number(response.headers.get("Content-Length") ?? 0);
  const reader  = response.body!.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress && contentLength > 0) {
      onProgress(Math.round((received / contentLength) * 100));
    }
  }

  const blob = new Blob(chunks, { type: "video/mp4" });
  await storeTempVideo(videoId, fileName, blob);
  return URL.createObjectURL(blob);
}

/**
 * Fetch an exported clip blob from a local server URL and store it in IndexedDB.
 */
export async function fetchAndStoreExportedClip(
  serverUrl: string,
  momentId:  string,
  fileName:  string
): Promise<string> {
  const response = await fetch(serverUrl);
  if (!response.ok) throw new Error(`Failed to fetch export: ${response.statusText}`);
  const blob = await response.blob();
  await storeExportedClip(momentId, fileName, blob);
  return URL.createObjectURL(blob);
}