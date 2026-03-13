import { useEffect, useRef, useState, useCallback } from "react";
import toast from "react-hot-toast";
import { Html5Qrcode } from "html5-qrcode";
import {
  processQRScan,
  AttendanceRecord,
  getSessionSalleAttendance,
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

const SESSION_ID = `session_${new Date().toISOString().split("T")[0]}_${Math.random().toString(36).slice(2, 8)}`;

export default function AdminScanPage() {
  const scannerRef   = useRef<Html5Qrcode | null>(null);
  const scannerDivId = "qr-scanner-region";
  const processingRef = useRef(false);

  const [salles, setSalles]           = useState<Salle[]>([]);
  const [selectedSalle, setSelectedSalle] = useState<Salle | null>(null);
  const [loadingSalles, setLoadingSalles] = useState(true);
  const [scanning, setScanning]       = useState(false);
  const [lastScan, setLastScan]       = useState<ScanEntry | null>(null);
  const [scannedList, setScannedList] = useState<ScanEntry[]>([]);
  const [sessionAttendance, setSessionAttendance] = useState<AttendanceRecord[]>([]);
  const [activeTab, setActiveTab]     = useState<"scanner" | "liste">("scanner");
  const [cameraError, setCameraError] = useState("");

  useEffect(() => {
    getSalles()
      .then(setSalles)
      .catch(() => toast.error("Impossible de charger les salles."))
      .finally(() => setLoadingSalles(false));
  }, []);

  useEffect(() => {
    if (!selectedSalle) return;
    getSessionSalleAttendance(SESSION_ID, selectedSalle.id)
      .then(setSessionAttendance)
      .catch(console.error);
  }, [scannedList, selectedSalle]);

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
            const result = await processQRScan(decodedText, SESSION_ID, selectedSalle.id, selectedSalle.salle_name);
            const entry: ScanEntry = {
              student: result.student ?? ({} as StudentProfile),
              scanTime: new Date().toLocaleTimeString("fr-MA"),
              success: result.success,
              message: result.message,
            };
            setLastScan(entry);
            if (result.success && result.student) {
              setScannedList((prev) => [entry, ...prev]);
              toast.success(`✓ ${result.student.first_name} ${result.student.last_name} — Présent !`);
            } else {
              toast.error(result.message, { duration: 4000 });
            }
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
  }, [stopScanner, selectedSalle]);

  useEffect(() => { return () => { stopScanner(); }; }, [stopScanner]);

  function getImageUrl(path: string): string {
    if (!path) return "";
    return buildImageUrl(path);
  }

  // ── Salle selection screen ────────────────────────────────────────────────
  if (!selectedSalle) {
    return (
      <AdminLayout>
        <div className="max-w-2xl mx-auto fade-in">
          <div className="card p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center">
                <svg className="w-6 h-6 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">Sélectionner une salle</h2>
                <p className="text-slate-500 text-sm">Choisissez la salle avant de commencer le scan</p>
              </div>
            </div>

            {loadingSalles ? (
              <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {salles.map((salle) => (
                  <button
                    key={salle.id}
                    onClick={() => setSelectedSalle(salle)}
                    className="group p-4 bg-slate-50 hover:bg-indigo-50 border-2 border-slate-200 hover:border-indigo-400 rounded-xl text-left transition-all duration-200 card-hover"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 group-hover:border-indigo-300 flex items-center justify-center transition-all">
                        <svg className="w-4 h-4 text-slate-500 group-hover:text-indigo-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      </div>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        salle.salle_type === "TP"
                          ? "bg-blue-50 text-blue-600 border border-blue-200"
                          : "bg-amber-50 text-amber-600 border border-amber-200"
                      }`}>
                        {salle.salle_type || "Cours"}
                      </span>
                    </div>
                    <p className="text-slate-900 font-bold text-sm">{salle.salle_name}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
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
              <p className="text-slate-900 font-bold">{selectedSalle.salle_name}
                <span className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded-full ${
                  selectedSalle.salle_type === "TP"
                    ? "bg-blue-50 text-blue-600"
                    : "bg-amber-50 text-amber-600"
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
              onClick={() => { stopScanner(); setSelectedSalle(null); setLastScan(null); setScannedList([]); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-xl transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Changer de salle
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Scannés",   value: scannedList.filter((s) => s.success).length, color: "emerald" },
            { label: "Total séance", value: sessionAttendance.length,               color: "indigo"  },
            { label: "Erreurs",   value: scannedList.filter((s) => !s.success).length, color: "red"    },
          ].map(({ label, value, color }) => (
            <div key={label} className={`card p-4 text-center`}>
              <div className={`text-3xl font-black text-${color}-500`}>{value}</div>
              <div className="text-slate-500 text-xs mt-1">{label}</div>
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
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
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
                  {/* Status banner */}
                  <div className={`rounded-xl p-3 mb-5 flex items-center gap-3 ${
                    lastScan.success
                      ? "bg-emerald-50 border border-emerald-200"
                      : "bg-red-50 border border-red-200"
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
                      {/* Student photo with zoom */}
                      {(lastScan.student.selfie_path || lastScan.student.photo_url) ? (
                        <ImageZoomModal
                          src={getImageUrl(lastScan.student.selfie_path || lastScan.student.photo_url || "")}
                          alt={`${lastScan.student.first_name}`}
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
                          lastScan.success
                            ? "bg-emerald-50 border-emerald-300 text-emerald-600"
                            : "bg-red-50 border-red-300 text-red-600"
                        }`}>
                          {lastScan.student.first_name?.[0]}{lastScan.student.last_name?.[0]}
                        </div>
                      )}

                      <div className="w-full space-y-1.5">
                        {[
                          { label: "Nom complet",  value: `${lastScan.student.first_name} ${lastScan.student.last_name}` },
                          { label: "Code Apogée",  value: lastScan.student.apogee_code },
                          { label: "CIN",          value: lastScan.student.cin },
                          { label: "Programme",    value: lastScan.student.cod_etp || lastScan.student.filiere },
                          { label: "Salle",        value: selectedSalle.salle_name },
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
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900">Présences de la séance</h3>
                <p className="text-slate-500 text-sm mt-0.5">{sessionAttendance.length} étudiant{sessionAttendance.length !== 1 ? "s" : ""} • {selectedSalle.salle_name}</p>
              </div>
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-full">
                {new Date().toLocaleDateString("fr-MA", { dateStyle: "full" })}
              </div>
            </div>

            {sessionAttendance.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-slate-500">Aucun étudiant scanné pour l'instant.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50">
                      <th className="text-left text-xs text-slate-500 font-semibold px-5 py-3">#</th>
                      <th className="text-left text-xs text-slate-500 font-semibold px-5 py-3">Photo</th>
                      <th className="text-left text-xs text-slate-500 font-semibold px-5 py-3">Étudiant</th>
                      <th className="text-left text-xs text-slate-500 font-semibold px-5 py-3">Apogée</th>
                      <th className="text-left text-xs text-slate-500 font-semibold px-5 py-3">Programme</th>
                      <th className="text-left text-xs text-slate-500 font-semibold px-5 py-3">Heure</th>
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
                                className="w-9 h-9 rounded-lg object-cover border border-slate-200 cursor-zoom-in hover:brightness-90 transition-all"
                                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                              />
                            </ImageZoomModal>
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 text-xs font-bold border border-indigo-100">
                              {(rec.student_name || "?")[0]}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-900 text-sm font-semibold">{rec.student_name ?? "—"}</td>
                        <td className="px-5 py-3 text-slate-500 text-sm font-mono">{rec.apogee_code ?? "—"}</td>
                        <td className="px-5 py-3 text-slate-500 text-sm">{rec.cod_etp || rec.filiere || "—"}</td>
                        <td className="px-5 py-3 text-slate-500 text-sm">{formatTimestamp(rec.scan_time)}</td>
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
