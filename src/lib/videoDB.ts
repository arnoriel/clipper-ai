// src/lib/videoDB.ts
// Browser IndexedDB storage untuk video blob.
// Semua storage permanen ada di sini — tidak ada file di folder project.

const DB_NAME    = "ai-clipper-video-db";
const DB_VERSION = 1;
const STORE_TEMP    = "temp-videos";
const STORE_EXPORTS = "clip-exports";

interface TempVideoRecord {
  videoId:  string;
  fileName: string;
  blob:     Blob;
  storedAt: number;
}

interface ExportRecord {
  momentId: string;
  fileName: string;
  blob:     Blob;
  storedAt: number;
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

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMP VIDEOS
// ═══════════════════════════════════════════════════════════════════════════════

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
 * Kembalikan objectURL dari blob yang tersimpan.
 * ⚠️ Caller harus revoke URL dengan URL.revokeObjectURL() jika tidak dipakai.
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

/**
 * Kembalikan raw Blob dari video yang tersimpan (dipakai untuk upload ke server saat export).
 */
export async function getTempVideoBlob(videoId: string): Promise<Blob | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_TEMP, "readonly");
  const record = await idbRequest<TempVideoRecord | undefined>(
    tx.objectStore(STORE_TEMP).get(videoId)
  );
  db.close();
  return record?.blob ?? null;
}

export async function getTempVideoFileName(videoId: string): Promise<string | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_TEMP, "readonly");
  const record = await idbRequest<TempVideoRecord | undefined>(
    tx.objectStore(STORE_TEMP).get(videoId)
  );
  db.close();
  return record?.fileName ?? null;
}

export async function deleteTempVideo(videoId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_TEMP, "readwrite");
  await idbRequest(tx.objectStore(STORE_TEMP).delete(videoId));
  db.close();
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTED CLIPS
// ═══════════════════════════════════════════════════════════════════════════════

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
 * Kembalikan { url, fileName } untuk clip yang sudah di-export.
 * ⚠️ Caller harus revoke URL.
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
  return { url: URL.createObjectURL(record.blob), fileName: record.fileName };
}

export async function downloadExportedClip(
  momentId:          string,
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

export async function deleteExportedClip(momentId: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_EXPORTS, "readwrite");
  await idbRequest(tx.objectStore(STORE_EXPORTS).delete(momentId));
  db.close();
}

export async function listStoredExportIds(): Promise<string[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_EXPORTS, "readonly");
  const keys = await idbRequest<IDBValidKey[]>(
    tx.objectStore(STORE_EXPORTS).getAllKeys()
  );
  db.close();
  return keys as string[];
}

// ─── Helpers untuk App.tsx ────────────────────────────────────────────────────

/**
 * Fetch video dari URL (streaming dari server), simpan ke IndexedDB,
 * kembalikan objectURL.
 *
 * Menggantikan fetchAndStoreTempVideo yang lama.
 * Sekarang menerima Response langsung sehingga kita bisa baca header X-File-Name.
 */
export async function readResponseAndStoreTempVideo(
  response:   Response,
  videoId:    string,
  onProgress?: (pct: number) => void
): Promise<{ objectUrl: string; fileName: string }> {
  const fileName     = response.headers.get("X-File-Name") ?? `${videoId}.mp4`;
  const contentLength = Number(response.headers.get("Content-Length") ?? 0);
  const reader        = response.body!.getReader();
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
  return { objectUrl: URL.createObjectURL(blob), fileName };
}

/**
 * Upload video blob ke server untuk di-export, terima hasil streaming,
 * simpan di IndexedDB, kembalikan objectURL.
 */
export async function uploadAndStoreExportedClip(
  serverUrl: string,
  videoBlob: Blob,
  momentId:  string,
  clip:      object,
  edits:     object
): Promise<string> {
  const formData = new FormData();
  formData.append("video",     videoBlob, "source.mp4");
  formData.append("clipJson",  JSON.stringify(clip));
  formData.append("editsJson", JSON.stringify(edits));

  const response = await fetch(serverUrl, { method: "POST", body: formData });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || body.error || "Export failed");
  }

  const fileName = response.headers.get("X-File-Name") ?? `clip_${Date.now()}.mp4`;
  const blob     = await response.blob();

  await storeExportedClip(momentId, fileName, blob);
  return URL.createObjectURL(blob);
}