import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Html5Qrcode } from "html5-qrcode";
import {
  processQRScan,
  AttendanceRecord,
  getSalleAttendance,
  getSalles,
  Salle,
  formatTimestamp,
} from "../services/attendanceService";
import { StudentProfile } from "../services/authService";
import { buildImageUrl } from "../services/apiService";
import ProfLayout from "../components/ProfLayout";
import ImageZoomModal from "../components/ImageZoomModal";

interface ScanEntry {
  student: StudentProfile;
  scanTime: string;
  success: boolean;
  message: string;
}

const SESSION_ID = `prof_session_${new Date().toISOString().split("T")[0]}_${Math.random().toString(36).slice(2, 8)}`;
const POLL_INTERVAL_MS = 5000;

type ScanAccess = "allowed" | "early" | "past" | "future_day" | "past_day";

export default function ProfScanPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const preSelectedSalle = searchParams.get("salle") || "";
  const matiere = searchParams.get("matiere") || "";
  const seance = searchParams.get("seance") || "";
  const sessionStartTime = searchParams.get("startTime") || "";
  const sessionEndTime = searchParams.get("endTime") || "";
  const sessionDate = searchParams.get("date") || "";

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerDivId = "prof-qr-scanner-region";
  const processingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [salles, setSalles] = useState<Salle[]>([]);
  const [selectedSalle, setSelectedSalle] = useState<Salle | null>(null);
  const [loadingSalles, setLoadingSalles] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<ScanEntry | null>(null);
  const [sessionAttendance, setSessionAttendance] = useState<AttendanceRecord[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [activeTab, setActiveTab] = useState<"scanner" | "liste">("scanner");
  const [cameraError, setCameraError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [scanAccess, setScanAccess] = useState<ScanAccess>("allowed");
  const [accessMessage, setAccessMessage] = useState("");

  // ── Time validation ───────────────────────────────────────────────────────
  useEffect(() => {
    function checkTime() {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

      // Not today — past or future
      if (sessionDate && sessionDate !== todayStr) {
        const sessionD = new Date(sessionDate);
        const todayD = new Date(todayStr);
        if (sessionD < todayD) {
          setScanAccess("past_day");
          setAccessMessage("Séance passée — consultation uniquement");
          // For past sessions, show the list tab by default
          setActiveTab("liste");
        } else {
          setScanAccess("future_day");
          setAccessMessage("Séance à venir — scanner non disponible");
          setActiveTab("liste");
        }
        return;
      }

      if (sessionStartTime && sessionEndTime) {
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const [sh, sm] = sessionStartTime.split(":").map(Number);
        const [eh, em] = sessionEndTime.split(":").map(Number);
        const startMin = sh * 60 + sm;
        const endMin = eh * 60 + em;
        const scanAllowed = startMin - 15;

        if (nowMinutes >= endMin) {
          setScanAccess("past");
          setAccessMessage("Séance terminée — consultation uniquement");
          setActiveTab("liste");
          return;
        }

        if (nowMinutes < scanAllowed) {
          const wait = scanAllowed - nowMinutes;
          const wH = Math.floor(wait / 60);
          const wM = wait % 60;
          setScanAccess("early");
          setAccessMessage(`Scanner disponible dans ${wH > 0 ? wH + "h" : ""}${String(wM).padStart(2, "0")} min (à ${String(Math.floor(scanAllowed / 60)).padStart(2, "0")}:${String(scanAllowed % 60).padStart(2, "0")})`);
          return;
        }
      }

      setScanAccess("allowed");
      setAccessMessage("");
    }

    checkTime();
    const timer = setInterval(checkTime, 30000);
    return () => clearInterval(timer);
  }, [sessionDate, sessionStartTime, sessionEndTime]);

  const canScan = scanAccess === "allowed";
  const canViewList = true; // Always can view list
  const isPastSession = scanAccess === "past" || scanAccess === "past_day";

  // ── No direct access — must come from timetable ───────────────────────────
  useEffect(() => {
    if (!preSelectedSalle && !seance) {
      toast.error("Accédez au scanner depuis votre emploi du temps.");
      navigate("/prof/timetable", { replace: true });
    }
  }, [preSelectedSalle, seance, navigate]);

  // ── Load salles ───────────────────────────────────────────────────────────
  useEffect(() => {
    getSalles()
      .then(setSalles)
      .catch(() => toast.error("Impossible de charger les salles."))
      .finally(() => setLoadingSalles(false));
  }, []);

  // ── Auto-select salle ────────────────────────────────────────────────────
  useEffect(() => {
    if (preSelectedSalle && salles.length > 0 && !selectedSalle) {
      const match = salles.find(
        (s) => s.salle_name.toLowerCase().trim() === preSelectedSalle.toLowerCase().trim()
      );
      if (match) setSelectedSalle(match);
    }
  }, [preSelectedSalle, salles, selectedSalle]);

  // ── Fetch attendance ──────────────────────────────────────────────────────
const fetchAttendance = useCallback(async (salleId: string) => {
  try {
    // For past sessions, query the archive (permanent records)
    if (isPastSession) {
      const { getArchiveBySalle } = await import("../services/attendanceService");
      const records = await getArchiveBySalle(salleId);
      
      // Filter by session date if we have one
      if (sessionDate) {
        const filtered = records.filter((r) => {
          const ms = r.scan_time as any;
          const d = ms?.toDate ? ms.toDate() : new Date(ms);
          const recDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          return recDate === sessionDate;
        });
        setSessionAttendance(filtered);
      } else {
        setSessionAttendance(records);
      }
    } else {
      // Active/future session — use live collection, NO time filter
      const records = await getSalleAttendance(salleId);
      setSessionAttendance(records);
    }
  } catch (err) {
    console.error("Failed to fetch attendance:", err);
  }
}, [isPastSession, sessionDate]);

  useEffect(() => {
    if (!selectedSalle) {
      setSessionAttendance([]);
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    setLoadingAttendance(true);
    fetchAttendance(selectedSalle.id).finally(() => setLoadingAttendance(false));

    // Only poll if session is active (not past)
    if (canScan) {
      pollRef.current = setInterval(() => fetchAttendance(selectedSalle.id), POLL_INTERVAL_MS);
    }

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedSalle, fetchAttendance, canScan]);

  const refreshNow = useCallback(() => {
    if (selectedSalle) fetchAttendance(selectedSalle.id);
  }, [selectedSalle, fetchAttendance]);

  // ── Scanner ───────────────────────────────────────────────────────────────
  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      try { scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

  const startScanner = useCallback(async () => {
    if (!canScan) { toast.error(accessMessage || "Scanner non disponible."); return; }
    if (!selectedSalle) { toast.error("Aucune salle sélectionnée."); return; }
    setCameraError("");
    try {
      const devices = await Html5Qrcode.getCameras();
      if (!devices || devices.length === 0) { setCameraError("Aucune caméra trouvée."); return; }
      if (scannerRef.current) await stopScanner();

      const scanner = new Html5Qrcode(scannerDivId);
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        async (decodedText) => {
          if (processingRef.current) return;
          processingRef.current = true;
          try {
            const result = await processQRScan(decodedText, SESSION_ID, selectedSalle.id, selectedSalle.salle_name);
            const entry: ScanEntry = {
              student: result.student ?? ({} as StudentProfile),
              scanTime: new Date().toLocaleTimeString("fr-MA"),
              success: result.success,
              message: result.message,
            };
            setLastScan(entry);
            if (result.success && result.student) {
              toast.success(`✓ ${result.student.first_name} ${result.student.last_name} — Présent !`);
            } else {
              toast.error(result.message, { duration: 4000 });
            }
            refreshNow();
          } finally {
            setTimeout(() => { processingRef.current = false; }, 3000);
          }
        },
        () => {}
      );
      setScanning(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur caméra.";
      setCameraError(msg.includes("Permission") ? "Permission caméra refusée." : `Erreur: ${msg}`);
    }
  }, [stopScanner, selectedSalle, refreshNow, canScan, accessMessage]);

  useEffect(() => { return () => { stopScanner(); }; }, [stopScanner]);

  function getImageUrl(path: string): string {
    return path ? buildImageUrl(path) : "";
  }

  // ── Excel export ──────────────────────────────────────────────────────────
  async function handleExportExcel() {
    if (sessionAttendance.length === 0) { toast.error("Aucune donnée à exporter."); return; }
    setExporting(true);
    const toastId = toast.loading("Génération du PV Excel…");
    try {
      await new Promise<void>((resolve, reject) => {
        if ((window as any).XLSX) { resolve(); return; }
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load SheetJS"));
        document.head.appendChild(s);
      });
      const XLSX = (window as any).XLSX;

      async function fetchImageAsBase64(url: string): Promise<string | null> {
        try {
          const res = await fetch(url, { mode: "cors" });
          if (!res.ok) return null;
          const blob = await res.blob();
          return await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve((reader.result as string).split(",")[1] ?? null);
            reader.readAsDataURL(blob);
          });
        } catch { return null; }
      }

      toast.loading(`Photos (${sessionAttendance.length})…`, { id: toastId });
      const base64Images: (string | null)[] = new Array(sessionAttendance.length).fill(null);
      for (let i = 0; i < sessionAttendance.length; i += 5) {
        const batch = sessionAttendance.slice(i, i + 5);
        const results = await Promise.all(batch.map((r) => r.selfie_path ? fetchImageAsBase64(getImageUrl(r.selfie_path)) : Promise.resolve(null)));
        results.forEach((r, j) => { base64Images[i + j] = r; });
      }

      const wb = XLSX.utils.book_new();
      const wsData: any[][] = [["#", "Photo", "Nom complet", "Code Apogée", "Programme", "Salle", "Heure"]];
      sessionAttendance.forEach((rec, i) => {
        wsData.push([i + 1, "", rec.student_name || "—", rec.apogee_code || "—", rec.cod_etp || rec.filiere || "—", rec.salle_name || "—", formatTimestamp(rec.scan_time)]);
      });
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws["!cols"] = [{ wch: 5 }, { wch: 14 }, { wch: 28 }, { wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 22 }];
      ws["!rows"] = [{ hpt: 20 }, ...sessionAttendance.map(() => ({ hpt: 60 }))];
      if (!ws["!images"]) ws["!images"] = [];
      base64Images.forEach((b64, i) => {
        if (!b64) return;
        ws["!images"].push({ name: `s${i}.jpg`, data: b64, opts: { base64: true }, position: { type: "twoCellAnchor", attrs: { editAs: "oneCell" }, from: { col: 1, row: i + 1, colOff: 5760, rowOff: 5760 }, to: { col: 2, row: i + 2, colOff: 0, rowOff: 0 } } });
      });
      XLSX.utils.book_append_sheet(wb, ws, "PV Présences");

      const summary = [
        ["Matière", matiere || "—"],
        ["Salle", selectedSalle?.salle_name ?? "—"],
        ["Horaire", `${sessionStartTime} - ${sessionEndTime}`],
        ["Date séance", sessionDate || "—"],
        ["Date export", new Date().toLocaleDateString("fr-MA", { dateStyle: "full" })],
        ["Total présents", sessionAttendance.length],
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(summary);
      ws2["!cols"] = [{ wch: 20 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Résumé");

      XLSX.writeFile(wb, `PV_${(selectedSalle?.salle_name || "salle").replace(/\s+/g, "-")}_${sessionDate || new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`✓ PV exporté — ${sessionAttendance.length} étudiant${sessionAttendance.length !== 1 ? "s" : ""}`, { id: toastId });
    } catch (err) {
      console.error(err);
      toast.error("Erreur export.", { id: toastId });
    } finally {
      setExporting(false);
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loadingSalles || !selectedSalle) {
    return (
      <ProfLayout title="Scanner QR" subtitle="Chargement…">
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </ProfLayout>
    );
  }

  // ── Status banner color + icon ────────────────────────────────────────────
  const statusBanner = (() => {
    switch (scanAccess) {
      case "past_day":
      case "past":
        return { bg: "bg-slate-50 border-slate-200", icon: "text-slate-400", text: "text-slate-600", iconPath: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" };
      case "future_day":
        return { bg: "bg-blue-50 border-blue-200", icon: "text-blue-400", text: "text-blue-600", iconPath: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" };
      case "early":
        return { bg: "bg-amber-50 border-amber-200", icon: "text-amber-500", text: "text-amber-700", iconPath: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" };
      default:
        return null;
    }
  })();

  // ── Determine available tabs ──────────────────────────────────────────────
  const showScannerTab = canScan;

  return (
    <ProfLayout title={matiere ? `${isPastSession ? "Consulter" : "Scanner"} — ${matiere}` : "Scanner QR"} subtitle={`Salle: ${selectedSalle.salle_name}`}>
      <div className="max-w-5xl mx-auto space-y-5 fade-in">

        {/* Session info banner */}
        {(matiere || seance) && (
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-teal-800">
                {matiere} — {selectedSalle.salle_name}
              </p>
              <p className="text-xs text-teal-600">
                {sessionDate && new Date(sessionDate).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                {sessionStartTime && ` · ${sessionStartTime} - ${sessionEndTime}`}
                {seance && ` · Séance #${seance}`}
              </p>
            </div>
            <button onClick={() => navigate("/prof/timetable")} className="px-3 py-1.5 bg-teal-100 hover:bg-teal-200 text-teal-700 text-xs font-semibold rounded-lg transition-colors">
              ← EDT
            </button>
          </div>
        )}

        {/* Access status banner (when not allowed to scan) */}
        {statusBanner && (
          <div className={`${statusBanner.bg} border rounded-xl p-4 flex items-center gap-3`}>
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isPastSession ? "bg-slate-100" : scanAccess === "early" ? "bg-amber-100" : "bg-blue-100"}`}>
              <svg className={`w-5 h-5 ${statusBanner.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={statusBanner.iconPath} />
              </svg>
            </div>
            <div className="flex-1">
              <p className={`text-sm font-semibold ${statusBanner.text}`}>{accessMessage}</p>
              {isPastSession && sessionAttendance.length > 0 && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {sessionAttendance.length} étudiant{sessionAttendance.length !== 1 ? "s" : ""} présent{sessionAttendance.length !== 1 ? "s" : ""} enregistré{sessionAttendance.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className={`grid ${showScannerTab ? "grid-cols-3" : "grid-cols-2"} gap-4`}>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 text-center">
            <div className="text-3xl font-black text-emerald-500">{loadingAttendance ? "…" : sessionAttendance.length}</div>
            <div className="text-slate-600 text-xs font-semibold mt-1">Présents</div>
          </div>
          {showScannerTab && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 text-center">
              <div className={`text-3xl font-black ${lastScan?.success ? "text-emerald-500" : lastScan ? "text-red-500" : "text-slate-300"}`}>
                {lastScan?.success ? "✓" : lastScan ? "✗" : "—"}
              </div>
              <div className="text-slate-600 text-xs font-semibold mt-1">Dernier scan</div>
            </div>
          )}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 text-center">
            <div className="text-3xl font-black text-teal-500">
              {isPastSession ? "📋" : scanAccess === "early" ? "⏳" : "5s"}
            </div>
            <div className="text-slate-600 text-xs font-semibold mt-1">
              {isPastSession ? "Consultation" : scanAccess === "early" ? "En attente" : "Actualisation"}
            </div>
          </div>
        </div>

        {/* Tabs — only show scanner tab if scanning is allowed */}
        {showScannerTab ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-1.5 flex gap-1 shadow-sm">
            <button onClick={() => setActiveTab("scanner")} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === "scanner" ? "bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50"}`}>
              📷 Scanner
            </button>
            <button onClick={() => setActiveTab("liste")} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab === "liste" ? "bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-md" : "text-slate-500 hover:bg-slate-50"}`}>
              📋 PV ({sessionAttendance.length})
            </button>
          </div>
        ) : (
          /* For past/future/early sessions — no tab switcher, just a header */
          <div className="bg-white rounded-2xl border border-slate-200 p-1.5 shadow-sm">
            <div className="py-2.5 rounded-xl text-sm font-semibold text-center bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-md">
              📋 PV de présences ({sessionAttendance.length})
            </div>
          </div>
        )}

        {/* ── Scanner Tab (only when canScan) ── */}
        {showScannerTab && activeTab === "scanner" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900">Caméra</h3>
                  <p className="text-slate-500 text-sm">{selectedSalle.salle_name}</p>
                </div>
                <div className={`w-3 h-3 rounded-full ${scanning ? "bg-emerald-500 pulse-dot" : "bg-slate-300"}`} />
              </div>
              <div className="relative bg-slate-900" style={{ minHeight: "300px" }}>
                <div id={scannerDivId} className="w-full" />
                {!scanning && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                    <div className="w-20 h-20 rounded-2xl border-2 border-dashed border-slate-600 flex items-center justify-center">
                      <svg className="w-10 h-10 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      </svg>
                    </div>
                    {cameraError ? <p className="text-red-400 text-sm text-center px-6">{cameraError}</p> : <p className="text-slate-500 text-sm">Caméra désactivée</p>}
                  </div>
                )}
              </div>
              <div className="p-4">
                {!scanning ? (
                  <button onClick={startScanner} className="w-full bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-600 hover:to-emerald-700 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-md shadow-teal-200">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    Démarrer le scanner
                  </button>
                ) : (
                  <button onClick={stopScanner} className="w-full bg-red-50 hover:bg-red-100 text-red-600 font-bold py-3 rounded-xl border-2 border-red-200 flex items-center justify-center gap-2">
                    Arrêter le scanner
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100"><h3 className="font-bold text-slate-900">Dernier scan</h3></div>
              {!lastScan ? (
                <div className="p-12 flex flex-col items-center gap-3 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                    <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" /></svg>
                  </div>
                  <p className="text-slate-500 font-medium">En attente…</p>
                </div>
              ) : (
                <div className="p-5">
                  <div className={`rounded-xl p-3 mb-5 flex items-center gap-3 ${lastScan.success ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"}`}>
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${lastScan.success ? "bg-emerald-100" : "bg-red-100"}`}>
                      {lastScan.success
                        ? <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                        : <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                      }
                    </div>
                    <p className={`text-sm font-semibold ${lastScan.success ? "text-emerald-700" : "text-red-700"}`}>{lastScan.message}</p>
                  </div>
                  {lastScan.student?.uid && (
                    <div className="flex flex-col items-center gap-4">
                      {(lastScan.student.selfie_path || lastScan.student.photo_url) ? (
                        <ImageZoomModal src={getImageUrl(lastScan.student.selfie_path || lastScan.student.photo_url || "")} alt={lastScan.student.first_name} label="Photo">
                          <img src={getImageUrl(lastScan.student.selfie_path || lastScan.student.photo_url || "")} alt="" className={`w-24 h-24 rounded-2xl object-cover border-4 cursor-zoom-in ${lastScan.success ? "border-emerald-300" : "border-red-300"}`} onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        </ImageZoomModal>
                      ) : (
                        <div className={`w-24 h-24 rounded-2xl flex items-center justify-center text-3xl font-bold border-4 ${lastScan.success ? "bg-emerald-50 border-emerald-300 text-emerald-600" : "bg-red-50 border-red-300 text-red-600"}`}>
                          {lastScan.student.first_name?.[0]}{lastScan.student.last_name?.[0]}
                        </div>
                      )}
                      <div className="w-full space-y-1.5">
                        {[{ label: "Nom", value: `${lastScan.student.first_name} ${lastScan.student.last_name}` }, { label: "Apogée", value: lastScan.student.apogee_code }, { label: "Programme", value: lastScan.student.cod_etp || lastScan.student.filiere }, { label: "Heure", value: lastScan.scanTime }].map(({ label, value }) => (
                          <div key={label} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
                            <span className="text-slate-500 text-sm">{label}</span>
                            <span className="text-slate-900 text-sm font-semibold">{value || "—"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Liste / PV Tab (always available) ── */}
        {(activeTab === "liste" || !showScannerTab) && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="font-bold text-slate-900">
                  {isPastSession ? "Historique" : "PV"} — {selectedSalle.salle_name}
                </h3>
                <p className="text-slate-500 text-sm">
                  {loadingAttendance ? "Chargement…" : `${sessionAttendance.length} présent${sessionAttendance.length !== 1 ? "s" : ""}`}
                  {isPastSession && sessionDate && (
                    <span className="ml-1">
                      · {new Date(sessionDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => fetchAttendance(selectedSalle.id)} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold rounded-xl transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Actualiser
                </button>
                <button
                  onClick={handleExportExcel}
                  disabled={exporting || sessionAttendance.length === 0}
                  className="flex items-center gap-1.5 px-3 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-200 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl transition-all shadow-sm"
                >
                  {exporting ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                  {exporting ? "Export…" : `Exporter PV (${sessionAttendance.length})`}
                </button>
              </div>
            </div>

            {loadingAttendance ? (
              <div className="flex justify-center py-16">
                <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : sessionAttendance.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p className="text-slate-500 font-medium">
                  {isPastSession ? "Aucune présence enregistrée pour cette séance." : "Aucun étudiant scanné."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      {["#", "Photo", "Étudiant", "Apogée", "Programme", "Heure"].map((h) => (
                        <th key={h} className="text-left text-xs text-slate-500 font-semibold px-5 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sessionAttendance.map((rec, i) => (
                      <tr key={rec.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3 text-slate-400 text-sm">{i + 1}</td>
                        <td className="px-5 py-3">
                          {rec.selfie_path ? (
                            <ImageZoomModal src={buildImageUrl(rec.selfie_path)} alt={rec.student_name || ""} label={rec.student_name || ""}>
                              <img src={buildImageUrl(rec.selfie_path)} alt="" className="w-10 h-10 rounded-xl object-cover border border-slate-200 cursor-zoom-in hover:brightness-90 transition-all" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            </ImageZoomModal>
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center text-teal-600 text-xs font-bold border border-teal-100">
                              {(rec.student_name || "?")[0]}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-900 text-sm font-semibold">{rec.student_name ?? "—"}</td>
                        <td className="px-5 py-3 text-slate-500 text-sm font-mono">{rec.apogee_code ?? "—"}</td>
                        <td className="px-5 py-3 text-slate-500 text-sm">{rec.cod_etp || rec.filiere || "—"}</td>
                        <td className="px-5 py-3 text-slate-500 text-sm whitespace-nowrap">{formatTimestamp(rec.scan_time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </ProfLayout>
  );
}