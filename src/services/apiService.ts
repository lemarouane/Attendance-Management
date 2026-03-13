// API service — communicates with local Express backend on port 3001

// Always use the same hostname as the browser, port 3001
const API_BASE = `${window.location.protocol}//${window.location.hostname}:3001/api`;

// ─── Helper: build full image URL ─────────────────────────────────────────────
export function buildImageUrl(relativePath: string): string {
  if (!relativePath) return "";
  if (relativePath.startsWith("http")) return relativePath;
  // e.g. /uploads/students/12345/selfie.png → http://192.168.x.x:3001/uploads/...
  return `${window.location.protocol}//${window.location.hostname}:3001${relativePath}`;
}

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface ApogeeStudent {
  COD_IND: string;
  LIB_NOM_PAT_IND: string;
  LIB_PR1_IND: string;
  CIN_IND: string;
  COD_ETP: string;
}

export interface ApogeeValidationResult {
  valid: boolean;
  dbOffline?: boolean;
  message?: string;
  student?: ApogeeStudent;
}

export interface DbStatus {
  connected: boolean;
  apo: { connected: boolean; error: string | null };
  pgi: { connected: boolean; error: string | null };
  host: string;
  port: string;
  user: string;
}

export interface ServerHealth {
  online: boolean;
  db_apo: "connected" | "disconnected" | "unknown";
  db_pgi: "connected" | "disconnected" | "unknown";
  error?: string;
}

export interface MySQLSalle {
  id: string;
  salle_name: string;
  salle_type: string;
}

// ─── Helper: fetch with timeout ───────────────────────────────────────────────
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Check backend health ──────────────────────────────────────────────────────
export async function checkServerHealth(): Promise<ServerHealth> {
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/health`, {}, 4000);
    if (!resp.ok) return { online: true, db_apo: "unknown", db_pgi: "unknown" };
    const data = await resp.json() as { status: string; db_apo: string; db_pgi: string };
    return {
      online: true,
      db_apo: data.db_apo === "connected" ? "connected" : "disconnected",
      db_pgi: data.db_pgi === "connected" ? "connected" : "disconnected",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Network error";
    return {
      online: false,
      db_apo: "unknown",
      db_pgi: "unknown",
      error: msg.includes("abort")
        ? "Server timeout — is it running?"
        : "Cannot reach server on port 3001",
    };
  }
}

// ─── Get detailed DB status ───────────────────────────────────────────────────
export async function getDbStatus(): Promise<DbStatus | null> {
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/db-status`, {}, 4000);
    if (!resp.ok) return null;
    return await resp.json() as DbStatus;
  } catch {
    return null;
  }
}

// ─── Retry DB connection ──────────────────────────────────────────────────────
export async function retryDbConnection(): Promise<{ connected: boolean; error: string | null }> {
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/db-reconnect`, { method: "POST" }, 10000);
    if (!resp.ok) return { connected: false, error: "Server error" };
    const data = await resp.json() as { connected: boolean; apo: { error: string | null }; pgi: { error: string | null } };
    return {
      connected: data.connected,
      error: data.apo?.error || data.pgi?.error || null,
    };
  } catch {
    return { connected: false, error: "Cannot reach server" };
  }
}

// ─── Validate apogee code ─────────────────────────────────────────────────────
export async function validateApogee(code: string): Promise<ApogeeValidationResult> {
  try {
    const resp = await fetchWithTimeout(
      `${API_BASE}/validate-apogee/${encodeURIComponent(code.trim())}`,
      {},
      10000
    );

    const data = await resp.json() as ApogeeValidationResult;

    if (!resp.ok) {
      return {
        valid: false,
        dbOffline: data.dbOffline,
        message: data.message || `Server error (${resp.status})`,
      };
    }

    return data;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg.includes("abort") || msg.includes("timeout")) {
      return { valid: false, message: "Request timed out. Is the backend running?" };
    }
    return {
      valid: false,
      message: "Cannot reach backend server. Run: cd server && node index.js",
    };
  }
}

// ─── Upload base64 image ──────────────────────────────────────────────────────
export async function uploadBase64Image(
  apogee: string,
  type: "cin" | "selfie",
  imageData: string
): Promise<{ success: boolean; path: string; message?: string }> {
  if (!imageData || imageData.length < 100) {
    return { success: false, path: "", message: "No image data to upload." };
  }

  try {
    const resp = await fetchWithTimeout(
      `${API_BASE}/upload-base64/${encodeURIComponent(apogee)}/${type}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData }),
      },
      20000   // 20s timeout for image upload
    );

    const data = await resp.json() as { success: boolean; path: string; message?: string };

    if (!resp.ok) {
      return { success: false, path: "", message: data.message || "Upload failed." };
    }

    console.log(`✅ ${type} uploaded → ${data.path}`);
    return data;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return {
      success: false,
      path: "",
      message: msg.includes("abort") ? "Upload timed out." : "Cannot reach backend server.",
    };
  }
}

// ─── Get salles from MySQL (via backend) ─────────────────────────────────────
export async function getMySQLSalles(): Promise<MySQLSalle[]> {
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/salles`, {}, 6000);
    if (!resp.ok) return [];
    const data = await resp.json() as { salles: MySQLSalle[]; offline: boolean };
    return data.salles || [];
  } catch {
    return [];
  }
}

// ─── Check if student images exist on server ──────────────────────────────────
export async function checkStudentImages(
  apogee: string
): Promise<{ cin: { exists: boolean; url: string }; selfie: { exists: boolean; url: string } }> {
  try {
    const resp = await fetchWithTimeout(
      `${API_BASE}/student-images/${encodeURIComponent(apogee)}`,
      {},
      5000
    );
    if (!resp.ok) return { cin: { exists: false, url: "" }, selfie: { exists: false, url: "" } };
    return await resp.json() as { cin: { exists: boolean; url: string }; selfie: { exists: boolean; url: string } };
  } catch {
    return { cin: { exists: false, url: "" }, selfie: { exists: false, url: "" } };
  }
}
