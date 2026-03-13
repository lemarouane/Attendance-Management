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

  const selfieUrl  = profile.selfie_path ? getImageUrl(profile.selfie_path) : "";
  const cinUrl     = profile.cin_path    ? getImageUrl(profile.cin_path)    : "";
  const displayName = `${profile.first_name} ${profile.last_name}`;

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: "qr",       label: "Mon QR Code",  icon: "📱" },
    { id: "presences", label: "Présences",   icon: "📋" },
    { id: "profil",   label: "Profil",       icon: "👤" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md shadow-indigo-200">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <h1 className="font-bold text-slate-900 text-sm leading-none">ENSAT-CHECKING</h1>
              <p className="text-indigo-500 text-xs font-medium">Espace Étudiant</p>
            </div>
          </div>

          {/* Right */}
          <div className="flex items-center gap-3">
            {selfieUrl && (
              <img
                src={selfieUrl}
                alt="Photo"
                className="w-9 h-9 rounded-xl object-cover border-2 border-slate-200"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-red-500 transition-colors font-medium"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6 fade-in">
        {/* Profile banner */}
        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-6 mb-6 flex items-center gap-5 shadow-lg shadow-indigo-200">
          {selfieUrl ? (
            <img
              src={selfieUrl}
              alt="Profil"
              className="w-20 h-20 rounded-2xl object-cover border-4 border-white/30 flex-shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-white/20 border-4 border-white/20 flex items-center justify-center text-3xl font-bold text-white flex-shrink-0">
              {(profile.first_name || "?")[0]}{(profile.last_name || "")[0]}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-bold text-white truncate">{displayName}</h2>
            <p className="text-indigo-100 text-sm mt-0.5">{profile.cod_etp || profile.filiere || "Filière non définie"}</p>
            <p className="text-white/70 text-xs mt-1 font-mono">Apogée : {profile.apogee_code}</p>
          </div>
          <div className="text-right flex-shrink-0 hidden sm:block">
            <div className="text-4xl font-black text-white">{attendance.length}</div>
            <div className="text-indigo-100 text-xs font-medium">séances présent</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl border border-slate-200 p-1.5 mb-6 flex gap-1 shadow-sm">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                activeTab === tab.id
                  ? "bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              }`}
            >
              <span>{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ── QR Tab ──────────────────────────────────────────────────────── */}
        {activeTab === "qr" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 max-w-sm mx-auto">
              <div className="text-center mb-6">
                <h3 className="text-lg font-bold text-slate-900">Votre QR de présence</h3>
                <p className="text-slate-500 text-sm mt-1">Montrez ce code à votre professeur</p>
              </div>
              {firebaseUser && <AnimatedQR uid={firebaseUser.uid} />}
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 max-w-sm mx-auto">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg className="w-4 h-4 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <p className="text-amber-800 text-sm font-semibold">Sécurité</p>
                  <p className="text-amber-700 text-xs mt-0.5">
                    Le QR se renouvelle toutes les 5 secondes. Les captures d'écran sont inutilisables. Ce compte est verrouillé sur votre appareil.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Présences Tab ──────────────────────────────────────────────── */}
        {activeTab === "presences" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900">Historique des présences</h3>
                <p className="text-slate-500 text-sm mt-0.5">{attendance.length} séance{attendance.length !== 1 ? "s" : ""} enregistrée{attendance.length !== 1 ? "s" : ""}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
              </div>
            </div>

            {loadingAtt ? (
              <div className="p-12 flex justify-center">
                <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : attendance.length === 0 ? (
              <div className="p-16 text-center">
                <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <p className="text-slate-500 font-medium">Aucune présence enregistrée</p>
                <p className="text-slate-400 text-sm mt-1">Montrez votre QR code à votre professeur pour marquer votre présence.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {attendance.map((rec, i) => (
                  <div key={rec.id} className="px-6 py-4 flex items-center gap-4 hover:bg-slate-50 transition-colors">
                    <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-sm flex-shrink-0">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-900 text-sm font-semibold">
                        {rec.salle_name || `Séance #${(rec.session_id || "").slice(-6).toUpperCase()}`}
                      </p>
                      <p className="text-slate-400 text-xs mt-0.5">{formatTime(rec.scan_time)}</p>
                    </div>
                    {rec.salle_name && (
                      <span className="text-xs bg-indigo-50 border border-indigo-200 text-indigo-600 px-2.5 py-1 rounded-full font-medium">
                        {rec.salle_name}
                      </span>
                    )}
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="text-emerald-700 text-xs font-semibold">Présent</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Profil Tab ─────────────────────────────────────────────────── */}
        {activeTab === "profil" && (
          <div className="space-y-5">
            {/* Photos */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <h3 className="font-bold text-slate-900 mb-4">Photos d'identité</h3>
              <div className="flex flex-wrap gap-6 justify-center sm:justify-start">
                {selfieUrl && (
                  <ImageZoomModal
                    src={selfieUrl}
                    alt="Selfie"
                    label="Photo selfie"
                    className="w-32"
                  >
                    <div>
                      <img
                        src={selfieUrl}
                        alt="Selfie"
                        className="w-32 h-32 rounded-xl object-cover border-2 border-slate-200 cursor-zoom-in hover:brightness-90 transition-all"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                      <p className="text-center text-xs text-slate-500 mt-1.5 font-medium">Selfie</p>
                    </div>
                  </ImageZoomModal>
                )}
                {cinUrl && (
                  <ImageZoomModal
                    src={cinUrl}
                    alt="Carte Nationale"
                    label="Carte Nationale (CIN)"
                    className="w-48"
                  >
                    <div>
                      <img
                        src={cinUrl}
                        alt="CIN"
                        className="w-48 h-32 rounded-xl object-cover border-2 border-slate-200 cursor-zoom-in hover:brightness-90 transition-all"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                      <p className="text-center text-xs text-slate-500 mt-1.5 font-medium">Carte Nationale (CIN)</p>
                    </div>
                  </ImageZoomModal>
                )}
                {!selfieUrl && !cinUrl && (
                  <div className="w-24 h-24 rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-3xl font-bold text-slate-400">
                    {(profile.first_name || "?")[0]}{(profile.last_name || "")[0]}
                  </div>
                )}
              </div>
            </div>

            {/* Info */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
              <h3 className="font-bold text-slate-900 mb-4">Informations personnelles</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  { label: "Prénom",          value: profile.first_name },
                  { label: "Nom de famille",  value: profile.last_name },
                  { label: "Code Apogée",     value: profile.apogee_code },
                  { label: "CIN",             value: profile.cin },
                  { label: "COD_IND",         value: profile.cod_ind || "—" },
                  { label: "Programme (COD_ETP)", value: profile.cod_etp || profile.filiere || "—" },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <p className="text-slate-400 text-xs mb-1 font-medium">{label}</p>
                    <p className="text-slate-900 font-semibold text-sm font-mono">{value || "—"}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Device lock */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <div>
                  <p className="text-slate-900 font-semibold text-sm">Compte verrouillé sur cet appareil</p>
                  <p className="text-slate-500 text-xs mt-0.5">Votre compte est lié à cet appareil uniquement. Contactez l'administrateur pour changer d'appareil.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
