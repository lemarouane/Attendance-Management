import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext";
import { logoutUser } from "../services/authService";
import { getStudentAttendance, AttendanceRecord } from "../services/attendanceService";
import AnimatedQR from "../components/AnimatedQR";
import ImageZoomModal from "../components/ImageZoomModal";
import { Timestamp } from "firebase/firestore";

function formatTime(ts: unknown): string {
  if (!ts) return "—";
  try {
    return (ts as Timestamp).toDate().toLocaleString("fr-MA", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch { return "—"; }
}

function formatDateShort(ts: unknown): string {
  if (!ts) return "—";
  try {
    return (ts as Timestamp).toDate().toLocaleDateString("fr-MA", {
      day: "numeric",
      month: "short",
    });
  } catch { return "—"; }
}

function formatTimeOnly(ts: unknown): string {
  if (!ts) return "—";
  try {
    return (ts as Timestamp).toDate().toLocaleTimeString("fr-MA", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch { return "—"; }
}

function getImageUrl(path: string): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${window.location.protocol}//${window.location.hostname}:3001${path}`;
}

type Tab = "qr" | "presences" | "profil";

export default function DashboardPage() {
  const navigate = useNavigate();
  const { firebaseUser, profile } = useAuth();
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loadingAtt, setLoadingAtt] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("qr");

  useEffect(() => {
    if (firebaseUser) {
      getStudentAttendance(firebaseUser.uid)
        .then(setAttendance)
        .catch(() => toast.error("Impossible de charger les présences."))
        .finally(() => setLoadingAtt(false));
    }
  }, [firebaseUser]);

  async function handleLogout() {
    await logoutUser();
    toast.success("Déconnexion réussie.");
    navigate("/login");
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const selfieUrl   = profile.selfie_path ? getImageUrl(profile.selfie_path) : "";
  const cinUrl      = profile.cin_path    ? getImageUrl(profile.cin_path)    : "";
  const displayName = `${profile.first_name} ${profile.last_name}`;
  const initials    = `${(profile.first_name || "?")[0]}${(profile.last_name || "")[0]}`;

  // Group attendance by date for presences tab
  const groupedAttendance = attendance.reduce<Record<string, AttendanceRecord[]>>((acc, rec) => {
    const label = formatDateShort(rec.scan_time);
    if (!acc[label]) acc[label] = [];
    acc[label].push(rec);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-slate-100">

      {/* ── Top header bar ─────────────────────────────────────────────── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="px-4 h-14 flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <span className="font-bold text-slate-900 text-sm tracking-tight">
              ENSAT<span className="text-indigo-600">-CHECKING</span>
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-red-500 hover:bg-red-50 transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Déconnexion
          </button>
        </div>
      </header>

      <div className="max-w-lg mx-auto">

        {/* ── Hero profile card ───────────────────────────────────────────── */}
        <div className="bg-indigo-600 px-5 pt-6 pb-16">
          <div className="flex items-center gap-4">
            {selfieUrl ? (
              <img
                src={selfieUrl}
                alt="Profil"
                className="w-16 h-16 rounded-2xl object-cover border-2 border-indigo-400 flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-indigo-500 border-2 border-indigo-400 flex items-center justify-center text-xl font-bold text-white flex-shrink-0">
                {initials}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h2 className="text-white font-bold text-lg leading-tight truncate">{displayName}</h2>
              <p className="text-indigo-200 text-sm mt-0.5 truncate">{profile.cod_etp || profile.filiere || "Filière non définie"}</p>
              <p className="text-indigo-300 text-xs mt-1 font-mono">{profile.apogee_code}</p>
            </div>
            <div className="text-center flex-shrink-0">
              <div className="text-3xl font-black text-white">{attendance.length}</div>
              <div className="text-indigo-200 text-xs font-medium leading-tight">séances<br/>présent</div>
            </div>
          </div>
        </div>

        {/* ── Stats row — overlapping the hero ───────────────────────────── */}
        <div className="px-4 -mt-8 mb-4">
          <div className="bg-white rounded-2xl shadow-lg shadow-slate-200/80 border border-slate-100 grid grid-cols-3 divide-x divide-slate-100">
            {[
              {
                value: attendance.length,
                label: "Présences",
                color: "text-indigo-600",
              },
              {
                value: attendance.length > 0
                  ? formatDateShort(attendance[0].scan_time)
                  : "—",
                label: "Dernier scan",
                color: "text-emerald-600",
              },
              {
                value: new Set(attendance.map((r) => r.salle_name || "?")).size || "—",
                label: "Salles",
                color: "text-amber-600",
              },
            ].map(({ value, label, color }) => (
              <div key={label} className="py-3 px-2 text-center">
                <div className={`text-lg font-black ${color}`}>{value}</div>
                <div className="text-slate-400 text-xs mt-0.5 font-medium">{label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Tab bar ────────────────────────────────────────────────────── */}
        <div className="px-4 mb-4">
          <div className="bg-white rounded-xl border border-slate-200 p-1 flex gap-1">
            {[
              { id: "qr" as Tab,        label: "QR Code",    emoji: "📱" },
              { id: "presences" as Tab, label: "Présences",  emoji: "📋" },
              { id: "profil" as Tab,    label: "Profil",     emoji: "👤" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === tab.id
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="text-sm">{tab.emoji}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab content ────────────────────────────────────────────────── */}
        <div className="px-4 pb-8">

          {/* QR Tab */}
          {activeTab === "qr" && (
            <div className="space-y-3">
              {/* Main QR card */}
              <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <div className="text-center mb-5">
                  <p className="text-slate-900 font-bold text-base">Votre QR de présence</p>
                  <p className="text-slate-400 text-xs mt-1">Se renouvelle toutes les 5 secondes</p>
                </div>
                {firebaseUser && (
                  <div className="flex justify-center">
                    <AnimatedQR uid={firebaseUser.uid} />
                  </div>
                )}
                <div className="mt-5 flex items-center justify-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-emerald-600 text-xs font-semibold">QR actif — prêt à scanner</span>
                </div>
              </div>

              {/* Security notice */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="text-amber-800 text-xs font-semibold mb-0.5">Sécurité anti-fraude</p>
                  <p className="text-amber-700 text-xs leading-relaxed">
                    Les captures d'écran sont inutilisables. Ce QR est lié à votre compte et à cet appareil uniquement.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Présences Tab */}
          {activeTab === "presences" && (
            <div className="space-y-3">
              {loadingAtt ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 flex justify-center">
                  <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : attendance.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
                    <svg className="w-7 h-7 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <p className="text-slate-600 font-semibold text-sm">Aucune présence</p>
                  <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                    Montrez votre QR code à votre professeur pour enregistrer votre présence.
                  </p>
                </div>
              ) : (
                <>
                  {/* Summary pill */}
                  <div className="flex items-center justify-between px-1">
                    <p className="text-slate-500 text-xs font-medium">
                      {attendance.length} présence{attendance.length !== 1 ? "s" : ""} enregistrée{attendance.length !== 1 ? "s" : ""}
                    </p>
                    <span className="text-xs text-indigo-600 font-semibold bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100">
                      {Object.keys(groupedAttendance).length} jour{Object.keys(groupedAttendance).length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Grouped by date */}
                  {Object.entries(groupedAttendance).map(([date, recs]) => (
                    <div key={date} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                      {/* Date header */}
                      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                        <span className="text-slate-700 text-xs font-bold uppercase tracking-wide">{date}</span>
                        <span className="text-slate-400 text-xs">{recs.length} séance{recs.length !== 1 ? "s" : ""}</span>
                      </div>
                      {/* Records */}
                      <div className="divide-y divide-slate-100">
                        {recs.map((rec) => (
                          <div key={rec.id} className="px-4 py-3 flex items-center gap-3">
                            {/* Salle icon */}
                            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0">
                              <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                  d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-slate-900 text-sm font-semibold truncate">
                                {rec.salle_name || "Salle inconnue"}
                              </p>
                              <p className="text-slate-400 text-xs mt-0.5">{formatTimeOnly(rec.scan_time)}</p>
                            </div>
                            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 flex-shrink-0">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              <span className="text-emerald-700 text-xs font-semibold">Présent</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Profil Tab */}
          {activeTab === "profil" && (
            <div className="space-y-3">

              {/* Photos */}
              {(selfieUrl || cinUrl) && (
                <div className="bg-white rounded-2xl border border-slate-200 p-5">
                  <p className="text-slate-700 text-xs font-bold uppercase tracking-wide mb-4">Photos d'identité</p>
                  <div className="flex gap-4">
                    {selfieUrl && (
                      <ImageZoomModal src={selfieUrl} alt="Selfie" label="Photo selfie">
                        <div className="flex flex-col items-center gap-1.5">
                          <img
                            src={selfieUrl}
                            alt="Selfie"
                            className="w-20 h-20 rounded-xl object-cover border-2 border-slate-200 cursor-zoom-in hover:brightness-90 transition-all"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                          <p className="text-slate-400 text-xs font-medium">Selfie</p>
                        </div>
                      </ImageZoomModal>
                    )}
                    {cinUrl && (
                      <ImageZoomModal src={cinUrl} alt="CIN" label="Carte Nationale (CIN)">
                        <div className="flex flex-col items-center gap-1.5">
                          <img
                            src={cinUrl}
                            alt="CIN"
                            className="w-36 h-20 rounded-xl object-cover border-2 border-slate-200 cursor-zoom-in hover:brightness-90 transition-all"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                          <p className="text-slate-400 text-xs font-medium">Carte CIN</p>
                        </div>
                      </ImageZoomModal>
                    )}
                  </div>
                </div>
              )}

              {/* Personal info */}
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                  <p className="text-slate-700 text-xs font-bold uppercase tracking-wide">Informations personnelles</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {[
                    { label: "Prénom",      value: profile.first_name },
                    { label: "Nom",         value: profile.last_name },
                    { label: "Code Apogée", value: profile.apogee_code },
                    { label: "CIN",         value: profile.cin },
                    { label: "Filière",   value: profile.cod_etp || profile.filiere || "—" },
                  ].map(({ label, value }) => (
                    <div key={label} className="px-4 py-3 flex items-center justify-between gap-4">
                      <span className="text-slate-400 text-sm flex-shrink-0">{label}</span>
                      <span className="text-slate-900 text-sm font-semibold font-mono text-right truncate">{value || "—"}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Device lock badge */}
              <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-slate-900 text-sm font-semibold">Compte verrouillé sur cet appareil</p>
                  <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">
                    Contactez l'administrateur pour changer d'appareil.
                  </p>
                </div>
              </div>

              {/* Logout button — bottom of profile */}
              <button
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-red-200 text-red-500 hover:bg-red-50 font-semibold text-sm transition-all"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Se déconnecter
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}