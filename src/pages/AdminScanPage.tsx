import { useEffect, useRef, useState, useCallback } from "react";
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
import AdminLayout from "../components/AdminLayout";
import ImageZoomModal from "../components/ImageZoomModal";

interface ScanEntry {
  student: StudentProfile;
  scanTime: string;
  success: boolean;
  message: string;
}

// SESSION_ID still used for writing — just not for reading the list
const SESSION_ID = `session_${new Date().toISOString().split("T")[0]}_${Math.random().toString(36).slice(2, 8)}`;
const POLL_INTERVAL_MS = 5000; // refresh attendance list every 5s

export default function AdminScanPage() {
  const scannerRef    = useRef<Html5Qrcode | null>(null);
  const scannerDivId  = "qr-scanner-region";
  const processingRef = useRef(false);
  const pollRef       = useRef<ReturnType<typeof setInterval> | null>(null);

  const [salles, setSalles]               = useState<Salle[]>([]);
  const [selectedSalle, setSelectedSalle] = useState<Salle | null>(null);
  const [loadingSalles, setLoadingSalles] = useState(true);
  const [scanning, setScanning]           = useState(false);
  const [lastScan, setLastScan]           = useState<ScanEntry | null>(null);
  const [sessionAttendance, setSessionAttendance] = useState<AttendanceRecord[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [activeTab, setActiveTab]         = useState<"scanner" | "liste">("scanner");
  const [cameraError, setCameraError]     = useState("");
  const [salleSearch, setSalleSearch]     = useState("");
  const [salleTypeFilter, setSalleTypeFilter] = useState<string>("all");
  const [exporting, setExporting]         = useState(false);

  // ── Load salles ───────────────────────────────────────────────────────────
  useEffect(() => {
    getSalles()
      .then(setSalles)
      .catch(() => toast.error("Impossible de charger les salles."))
      .finally(() => setLoadingSalles(false));
  }, []);

  // ── Fetch attendance for selected salle (by salle_id, not session) ────────
  const fetchAttendance = useCallback(async (salleId: string) => {
    try {
      const records = await getSalleAttendance(salleId);
      // Only show records from the last 2 hours (matching the live cleanup window)
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      const recent = records.filter((r) => {
        const t = r.scan_time as any;
        const ms = t?.toDate ? t.toDate().getTime() : new Date(t).getTime();
        return ms > twoHoursAgo;
      });
      setSessionAttendance(recent);
    } catch (err) {
      console.error("Failed to fetch attendance:", err);
    }
  }, []);

  // ── Start polling when salle is selected ──────────────────────────────────
  useEffect(() => {
    if (!selectedSalle) {
      setSessionAttendance([]);
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    // Immediate fetch
    setLoadingAttendance(true);
    fetchAttendance(selectedSalle.id).finally(() => setLoadingAttendance(false));

    // Poll every 5s
    pollRef.current = setInterval(() => {
      fetchAttendance(selectedSalle.id);
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [selectedSalle, fetchAttendance]);

  // ── Also re-fetch immediately after each scan attempt ─────────────────────
  const refreshNow = useCallback(() => {
    if (selectedSalle) fetchAttendance(selectedSalle.id);
  }, [selectedSalle, fetchAttendance]);

  // ── Scanner ───────────────────────────────────────────────────────────────
  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch { /* already stopped */ }
      try { scannerRef.current.clear(); } catch { /* ignore */ }
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

  const startScanner = useCallback(async () => {
    if (!selectedSalle) { toast.error("Veuillez sélectionner une salle."); return; }
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
            const result = await processQRScan(
              decodedText,
              SESSION_ID,
              selectedSalle.id,
              selectedSalle.salle_name
            );
            const entry: ScanEntry = {
              student:  result.student ?? ({} as StudentProfile),
              scanTime: new Date().toLocaleTimeString("fr-MA"),
              success:  result.success,
              message:  result.message,
            };
            setLastScan(entry);

            if (result.success && result.student) {
              toast.success(`✓ ${result.student.first_name} ${result.student.last_name} — Présent !`);
            } else {
              toast.error(result.message, { duration: 4000 });
            }

            // Always refresh the list after a scan attempt
            refreshNow();
          } finally {
            setTimeout(() => { processingRef.current = false; }, 3000);
          }
        },
        () => { /* ignore decode errors */ }
      );
      setScanning(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur caméra.";
      setCameraError(msg.includes("Permission") ? "Permission caméra refusée." : `Erreur: ${msg}`);
    }
  }, [stopScanner, selectedSalle, refreshNow]);

  useEffect(() => { return () => { stopScanner(); }; }, [stopScanner]);

  function getImageUrl(path: string): string {
    if (!path) return "";
    return buildImageUrl(path);
  }

  // ── Excel export with embedded selfie images ──────────────────────────────
  async function handleExportExcel() {
    if (sessionAttendance.length === 0) {
      toast.error("Aucune donnée à exporter.");
      return;
    }
    setExporting(true);
    const toastId = toast.loading("Génération du fichier Excel…");

    try {
      // Load SheetJS
      await new Promise<void>((resolve, reject) => {
        if ((window as any).XLSX) { resolve(); return; }
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Failed to load SheetJS"));
        document.head.appendChild(s);
      });
      const XLSX = (window as any).XLSX;

      // ── Convert selfie URL to base64 ──────────────────────────────────────
      async function fetchImageAsBase64(url: string): Promise<string | null> {
        try {
          const res = await fetch(url, { mode: "cors" });
          if (!res.ok) return null;
          const blob = await res.blob();
          return await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              // Strip the data:image/...;base64, prefix
              resolve(result.split(",")[1] ?? null);
            };
            reader.readAsDataURL(blob);
          });
        } catch {
          return null;
        }
      }

      toast.loading(`Téléchargement des photos (${sessionAttendance.length})…`, { id: toastId });

      // Fetch all selfies in parallel (with concurrency limit)
      const CONCURRENCY = 5;
      const base64Images: (string | null)[] = new Array(sessionAttendance.length).fill(null);

      for (let i = 0; i < sessionAttendance.length; i += CONCURRENCY) {
        const batch = sessionAttendance.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map((rec) =>
            rec.selfie_path ? fetchImageAsBase64(getImageUrl(rec.selfie_path)) : Promise.resolve(null)
          )
        );
        results.forEach((r, j) => { base64Images[i + j] = r; });
      }

      toast.loading("Construction du fichier Excel…", { id: toastId });

      // ── Build workbook ────────────────────────────────────────────────────
      const wb = XLSX.utils.book_new();

      // Row height for photo rows (in points — ~80px)
      const PHOTO_ROW_HEIGHT = 60;

      // Sheet 1: Attendance with embedded photos
      const wsData: any[][] = [
        ["#", "Photo", "Nom complet", "Code Apogée", "CIN (si dispo)", "Programme", "Salle", "Heure de scan"],
      ];

      sessionAttendance.forEach((rec, i) => {
        wsData.push([
          i + 1,
          "", // placeholder — image will be placed here
          rec.student_name || "—",
          rec.apogee_code  || "—",
          "—",
          rec.cod_etp || rec.filiere || "—",
          rec.salle_name   || "—",
          formatTimestamp(rec.scan_time),
        ]);
      });

      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Column widths
      ws["!cols"] = [
        { wch: 5  },  // #
        { wch: 14 },  // Photo
        { wch: 28 },  // Nom
        { wch: 14 },  // Apogée
        { wch: 14 },  // CIN
        { wch: 18 },  // Programme
        { wch: 12 },  // Salle
        { wch: 22 },  // Heure
      ];

      // Row heights — header + each data row
      ws["!rows"] = [
        { hpt: 20 }, // header
        ...sessionAttendance.map(() => ({ hpt: PHOTO_ROW_HEIGHT })),
      ];

      // Embed images into column B (index 1)
      if (!ws["!images"]) ws["!images"] = [];

      base64Images.forEach((b64, i) => {
        if (!b64) return;
        ws["!images"].push({
          name:      `selfie_${i}.jpg`,
          data:      b64,
          opts:      { base64: true },
          // row i+1 (0-indexed, row 0 = header), col 1 = column B
          position: {
            type: "twoCellAnchor",
            attrs: { editAs: "oneCell" },
            from: { col: 1, row: i + 1, colOff: 5760, rowOff: 5760 },
            to:   { col: 2, row: i + 2, colOff: 0,    rowOff: 0    },
          },
        });
      });

      XLSX.utils.book_append_sheet(wb, ws, "Présences");

      // Sheet 2: Summary
      const summaryData = [
        ["Salle",         selectedSalle?.salle_name ?? "—"],
        ["Date export",   new Date().toLocaleDateString("fr-MA", { dateStyle: "full" })],
        ["Total présents", sessionAttendance.length],
        ["", ""],
        ["Programmes représentés", ""],
        ...Array.from(
          new Set(sessionAttendance.map((r) => r.cod_etp || r.filiere || "—"))
        ).map((prog) => [
          prog,
          sessionAttendance.filter((r) => (r.cod_etp || r.filiere || "—") === prog).length,
        ]),
      ];
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      wsSummary["!cols"] = [{ wch: 28 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, wsSummary, "Résumé");

      // ── Download ──────────────────────────────────────────────────────────
      const today    = new Date().toISOString().slice(0, 10);
      const salleName = selectedSalle?.salle_name.replace(/\s+/g, "-") ?? "salle";
      XLSX.writeFile(wb, `presences_${salleName}_${today}.xlsx`);

      toast.success(
        `✓ ${sessionAttendance.length} étudiant${sessionAttendance.length !== 1 ? "s" : ""} exporté${sessionAttendance.length !== 1 ? "s" : ""}`,
        { id: toastId }
      );
    } catch (err) {
      console.error(err);
      toast.error("Erreur lors de l'export.", { id: toastId });
    } finally {
      setExporting(false);
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const salleTypes    = ["all", ...Array.from(new Set(salles.map((s) => s.salle_type || "Cours")))];
  const filteredSalles = salles.filter((s) => {
    const matchesSearch = s.salle_name.toLowerCase().includes(salleSearch.toLowerCase());
    const matchesType   = salleTypeFilter === "all" || (s.salle_type || "Cours") === salleTypeFilter;
    return matchesSearch && matchesType;
  });

  const successCount = sessionAttendance.length;
  const errorCount   = lastScan && !lastScan.success ? 1 : 0; // just last error indicator

  // ── Salle selection screen ────────────────────────────────────────────────
  if (!selectedSalle) {
    return (
      <AdminLayout>
        <div className="fade-in space-y-5">
          <div className="card p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200">
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Sélectionner une salle</h2>
                <p className="text-slate-500 text-sm mt-0.5">
                  {loadingSalles ? "Chargement…" : `${salles.length} salle${salles.length !== 1 ? "s" : ""} disponible${salles.length !== 1 ? "s" : ""}`}
                </p>
              </div>
            </div>

            {!loadingSalles && salles.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={salleSearch}
                    onChange={(e) => setSalleSearch(e.target.value)}
                    placeholder="Rechercher une salle…"
                    className="w-full border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm bg-slate-50 focus:bg-white transition-all"
                  />
                  {salleSearch && (
                    <button onClick={() => setSalleSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-lg">×</button>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {salleTypes.map((type) => (
                    <button
                      key={type}
                      onClick={() => setSalleTypeFilter(type)}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
                        salleTypeFilter === type
                          ? "bg-indigo-500 text-white shadow-sm shadow-indigo-200"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      }`}
                    >
                      {type === "all" ? "Toutes" : type}
                      {type !== "all" && (
                        <span className={`ml-1.5 text-[10px] ${salleTypeFilter === type ? "text-indigo-200" : "text-slate-400"}`}>
                          ({salles.filter((s) => (s.salle_type || "Cours") === type).length})
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {loadingSalles ? (
            <div className="card flex justify-center py-20">
              <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filteredSalles.length === 0 ? (
            <div className="card py-16 text-center">
              <p className="text-slate-500 font-medium">Aucune salle trouvée</p>
              <button onClick={() => { setSalleSearch(""); setSalleTypeFilter("all"); }} className="mt-4 text-indigo-500 text-sm underline">
                Réinitialiser les filtres
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filteredSalles.map((salle) => {
                const typeColor =
                  salle.salle_type === "TP"    ? { bg: "bg-blue-50",    border: "border-blue-200",    text: "text-blue-600",    hoverBorder: "hover:border-blue-400",    icon: "text-blue-500",    badge: "bg-blue-100 text-blue-700 border-blue-200"    } :
                  salle.salle_type === "TD"    ? { bg: "bg-violet-50",  border: "border-violet-200",  text: "text-violet-600",  hoverBorder: "hover:border-violet-400",  icon: "text-violet-500",  badge: "bg-violet-100 text-violet-700 border-violet-200" } :
                  salle.salle_type === "Amphi" ? { bg: "bg-amber-50",   border: "border-amber-200",   text: "text-amber-600",   hoverBorder: "hover:border-amber-400",   icon: "text-amber-500",   badge: "bg-amber-100 text-amber-700 border-amber-200"   } :
                                                 { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-600", hoverBorder: "hover:border-emerald-400", icon: "text-emerald-500", badge: "bg-emerald-100 text-emerald-700 border-emerald-200" };
                return (
                  <button
                    key={salle.id}
                    onClick={() => setSelectedSalle(salle)}
                    className={`group relative p-4 ${typeColor.bg} border-2 ${typeColor.border} ${typeColor.hoverBorder} rounded-2xl text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:translate-y-0`}
                  >
                    <span className={`absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full border ${typeColor.badge}`}>
                      {salle.salle_type || "Cours"}
                    </span>
                    <div className={`w-10 h-10 rounded-xl bg-white border ${typeColor.border} flex items-center justify-center mb-3 transition-all group-hover:scale-110`}>
                      <svg className={`w-5 h-5 ${typeColor.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>
                    <p className={`font-bold text-sm ${typeColor.text} leading-tight pr-8`}>{salle.salle_name}</p>
                    <p className="text-slate-400 text-xs mt-1">Appuyer pour sélectionner</p>
                    <div className={`absolute bottom-3 right-3 w-6 h-6 rounded-full ${typeColor.bg} border ${typeColor.border} flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0`}>
                      <svg className={`w-3 h-3 ${typeColor.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </AdminLayout>
    );
  }

  // ── Main scanner interface ────────────────────────────────────────────────
  return (
    <AdminLayout>
      <div className="space-y-5 fade-in">

        {/* Salle indicator + change */}
        <div className="flex items-center justify-between card px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Salle sélectionnée</p>
              <p className="text-slate-900 font-bold">
                {selectedSalle.salle_name}
                <span className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded-full ${
                  selectedSalle.salle_type === "TP"    ? "bg-blue-50 text-blue-600"    :
                  selectedSalle.salle_type === "TD"    ? "bg-violet-50 text-violet-600" :
                  selectedSalle.salle_type === "Amphi" ? "bg-amber-50 text-amber-600"  :
                                                         "bg-emerald-50 text-emerald-600"
                }`}>{selectedSalle.salle_type}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {scanning && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-full">
                <div className="w-2 h-2 rounded-full bg-emerald-500 pulse-dot" />
                <span className="text-emerald-700 text-xs font-semibold">Scanner actif</span>
              </div>
            )}
            <button
              onClick={() => {
                stopScanner();
                setSelectedSalle(null);
                setLastScan(null);
                setSessionAttendance([]);
                setSalleSearch("");
                setSalleTypeFilter("all");
              }}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Changer de salle
            </button>
          </div>
        </div>

        {/* Stats — now all driven by sessionAttendance from Firestore */}
        <div className="grid grid-cols-3 gap-4">
          {[
            {
              label: "Présents (2h)",
              value: loadingAttendance ? "…" : sessionAttendance.length,
              color: "emerald",
              sub: "dans cette salle",
            },
            {
              label: "Dernier scan",
              value: lastScan?.success ? "✓" : lastScan ? "✗" : "—",
              color: lastScan?.success ? "emerald" : lastScan ? "red" : "slate",
              sub: lastScan?.student?.first_name ?? "En attente",
            },
            {
              label: "Mise à jour",
              value: "5s",
              color: "indigo",
              sub: "intervalle polling",
            },
          ].map(({ label, value, color, sub }) => (
            <div key={label} className="card p-4 text-center">
              <div className={`text-3xl font-black text-${color}-500`}>{value}</div>
              <div className="text-slate-600 text-xs font-semibold mt-1">{label}</div>
              <div className="text-slate-400 text-xs mt-0.5">{sub}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl border border-slate-200 p-1.5 flex gap-1 shadow-sm">
          {[
            { id: "scanner" as const, label: "📷 Scanner QR" },
            { id: "liste"   as const, label: `📋 Liste (${sessionAttendance.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                activeTab === tab.id
                  ? "bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── Scanner Tab ── */}
        {activeTab === "scanner" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Camera card */}
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900">Caméra de scan</h3>
                  <p className="text-slate-500 text-sm mt-0.5">{selectedSalle.salle_name}</p>
                </div>
                <div className={`w-3 h-3 rounded-full ${scanning ? "bg-emerald-500 pulse-dot" : "bg-slate-300"}`} />
              </div>

              <div className="relative bg-slate-900" style={{ minHeight: "300px" }}>
                <div id={scannerDivId} className="w-full" />
                {!scanning && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                    <div className="w-20 h-20 rounded-2xl border-2 border-dashed border-slate-600 flex items-center justify-center">
                      <svg className="w-10 h-10 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                          d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      </svg>
                    </div>
                    {cameraError ? (
                      <p className="text-red-400 text-sm text-center px-6">{cameraError}</p>
                    ) : (
                      <p className="text-slate-500 text-sm">Caméra désactivée</p>
                    )}
                  </div>
                )}
              </div>

              <div className="p-4">
                {!scanning ? (
                  <button
                    onClick={startScanner}
                    className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-200"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Démarrer le scanner
                  </button>
                ) : (
                  <button
                    onClick={stopScanner}
                    className="w-full bg-red-50 hover:bg-red-100 text-red-600 font-bold py-3 rounded-xl transition-all border-2 border-red-200 flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                    </svg>
                    Arrêter le scanner
                  </button>
                )}
              </div>
            </div>

            {/* Last scan result */}
            <div className="card overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="font-bold text-slate-900">Dernier scan</h3>
                <p className="text-slate-500 text-sm mt-0.5">Résultat de la dernière vérification QR</p>
              </div>

              {!lastScan ? (
                <div className="p-12 flex flex-col items-center gap-3 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                    <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                    </svg>
                  </div>
                  <p className="text-slate-500 font-medium">En attente du premier scan…</p>
                  <p className="text-slate-400 text-sm">Démarrez le scanner et pointez vers le QR d'un étudiant</p>
                </div>
              ) : (
                <div className="p-5">
                  <div className={`rounded-xl p-3 mb-5 flex items-center gap-3 ${
                    lastScan.success ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"
                  }`}>
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${lastScan.success ? "bg-emerald-100" : "bg-red-100"}`}>
                      {lastScan.success ? (
                        <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </div>
                    <p className={`text-sm font-semibold ${lastScan.success ? "text-emerald-700" : "text-red-700"}`}>
                      {lastScan.message}
                    </p>
                  </div>

                  {lastScan.student?.uid && (
                    <div className="flex flex-col items-center gap-4">
                      {(lastScan.student.selfie_path || lastScan.student.photo_url) ? (
                        <ImageZoomModal
                          src={getImageUrl(lastScan.student.selfie_path || lastScan.student.photo_url || "")}
                          alt={lastScan.student.first_name}
                          label="Photo étudiant"
                        >
                          <img
                            src={getImageUrl(lastScan.student.selfie_path || lastScan.student.photo_url || "")}
                            alt="Étudiant"
                            className={`w-24 h-24 rounded-2xl object-cover border-4 cursor-zoom-in hover:brightness-90 transition-all ${
                              lastScan.success ? "border-emerald-300" : "border-red-300"
                            }`}
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        </ImageZoomModal>
                      ) : (
                        <div className={`w-24 h-24 rounded-2xl flex items-center justify-center text-3xl font-bold border-4 ${
                          lastScan.success ? "bg-emerald-50 border-emerald-300 text-emerald-600" : "bg-red-50 border-red-300 text-red-600"
                        }`}>
                          {lastScan.student.first_name?.[0]}{lastScan.student.last_name?.[0]}
                        </div>
                      )}
                      <div className="w-full space-y-1.5">
                        {[
                          { label: "Nom complet",   value: `${lastScan.student.first_name} ${lastScan.student.last_name}` },
                          { label: "Code Apogée",   value: lastScan.student.apogee_code },
                          { label: "CIN",           value: lastScan.student.cin },
                          { label: "Programme",     value: lastScan.student.cod_etp || lastScan.student.filiere },
                          { label: "Salle",         value: selectedSalle.salle_name },
                          { label: "Heure de scan", value: lastScan.scanTime },
                        ].map(({ label, value }) => (
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

        {/* ── Liste Tab ── */}
        {activeTab === "liste" && (
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="font-bold text-slate-900">Présences — {selectedSalle.salle_name}</h3>
                <p className="text-slate-500 text-sm mt-0.5">
                  {loadingAttendance
                    ? "Chargement…"
                    : `${sessionAttendance.length} étudiant${sessionAttendance.length !== 1 ? "s" : ""} · dernières 2 heures · mise à jour toutes les 5s`
                  }
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Manual refresh */}
                <button
                  onClick={() => fetchAttendance(selectedSalle.id)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold rounded-xl transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Actualiser
                </button>

                {/* Excel export */}
                <button
                  onClick={handleExportExcel}
                  disabled={exporting || sessionAttendance.length === 0}
                  className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-200 disabled:text-emerald-400 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl transition-all shadow-sm"
                >
                  {exporting ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                  {exporting ? "Export…" : `Excel (${sessionAttendance.length})`}
                </button>

                <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-full hidden sm:block">
                  {new Date().toLocaleDateString("fr-MA", { dateStyle: "full" })}
                </div>
              </div>
            </div>

            {loadingAttendance ? (
              <div className="flex justify-center py-16">
                <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : sessionAttendance.length === 0 ? (
              <div className="p-12 text-center">
                <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p className="text-slate-500 font-medium">Aucun étudiant scanné pour l'instant.</p>
                <p className="text-slate-400 text-sm mt-1">Les scans apparaissent ici en temps réel.</p>
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
                      <tr key={rec.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 text-slate-400 text-sm">{i + 1}</td>
                        <td className="px-5 py-3">
                          {rec.selfie_path ? (
                            <ImageZoomModal src={buildImageUrl(rec.selfie_path)} alt={rec.student_name || ""} label={rec.student_name || ""}>
                              <img
                                src={buildImageUrl(rec.selfie_path)}
                                alt=""
                                className="w-10 h-10 rounded-xl object-cover border border-slate-200 cursor-zoom-in hover:brightness-90 transition-all"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                              />
                            </ImageZoomModal>
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 text-xs font-bold border border-indigo-100">
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
    </AdminLayout>
  );
}