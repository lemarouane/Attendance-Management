import { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/config";
import { StudentProfile, validateStudent, rejectStudent, resetDeviceLock } from "../services/authService";
import { buildImageUrl } from "../services/apiService";
import AdminLayout from "../components/AdminLayout";
import ImageZoomModal from "../components/ImageZoomModal";
import toast from "react-hot-toast";

type StatusFilter = "all" | "pending" | "validated" | "rejected";

export default function AdminStudentsPage() {
  const [students, setStudents]   = useState<StudentProfile[]>([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selected, setSelected]   = useState<StudentProfile | null>(null);
  const [validating, setValidating] = useState(false);

  useEffect(() => { fetchStudents(); }, []);

  async function fetchStudents() {
    setLoading(true);
    try {
      const q    = query(collection(db, "students"), orderBy("created_at", "desc"));
      const snap = await getDocs(q);
      setStudents(snap.docs.map((d) => d.data() as StudentProfile));
    } catch (err) {
      console.error(err);
      toast.error("Impossible de charger les étudiants.");
    } finally {
      setLoading(false);
    }
  }

  async function handleValidate(uid: string) {
    setValidating(true);
    try {
      await validateStudent(uid);
      toast.success("Étudiant validé avec succès !");
      setStudents((prev) =>
        prev.map((s) => s.uid === uid ? { ...s, status: "validated" } as StudentProfile : s)
      );
      if (selected?.uid === uid) setSelected((s) => s ? { ...s, status: "validated" } as StudentProfile : null);
    } catch {
      toast.error("Erreur lors de la validation.");
    } finally {
      setValidating(false);
    }
  }

  async function handleReject(uid: string) {
    setValidating(true);
    try {
      await rejectStudent(uid);
      toast.success("Étudiant rejeté.");
      setStudents((prev) =>
        prev.map((s) => s.uid === uid ? { ...s, status: "rejected" } as StudentProfile : s)
      );
      if (selected?.uid === uid) setSelected((s) => s ? { ...s, status: "rejected" } as StudentProfile : null);
    } catch {
      toast.error("Erreur lors du rejet.");
    } finally {
      setValidating(false);
    }
  }

  async function handleResetDevice(uid: string) {
    try {
      await resetDeviceLock(uid);
      toast.success("Verrou appareil réinitialisé.");
      setStudents((prev) =>
        prev.map((s) => s.uid === uid ? { ...s, deviceFingerprint: "" } : s)
      );
    } catch {
      toast.error("Erreur lors de la réinitialisation.");
    }
  }

  const filtered = students.filter((s) => {
    const matchStatus = statusFilter === "all" || (s as unknown as { status?: string }).status === statusFilter;
    if (!matchStatus) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (s.first_name  || "").toLowerCase().includes(q) ||
      (s.last_name   || "").toLowerCase().includes(q) ||
      (s.apogee_code || "").toLowerCase().includes(q) ||
      (s.cin         || "").toLowerCase().includes(q) ||
      (s.cod_etp     || "").toLowerCase().includes(q)
    );
  });

  const counts = {
    all:       students.length,
    pending:   students.filter((s) => (s as unknown as { status?: string }).status === "pending"  || !(s as unknown as { status?: string }).status).length,
    validated: students.filter((s) => (s as unknown as { status?: string }).status === "validated").length,
    rejected:  students.filter((s) => (s as unknown as { status?: string }).status === "rejected" ).length,
  };

  function getStatus(s: StudentProfile): string {
    return (s as unknown as { status?: string }).status || "pending";
  }

  function StatusBadge({ status }: { status: string }) {
    const map: Record<string, { label: string; cls: string }> = {
      pending:   { label: "En attente",  cls: "badge-pending"   },
      validated: { label: "Validé",      cls: "badge-validated" },
      rejected:  { label: "Rejeté",      cls: "badge-rejected"  },
    };
    const cfg = map[status] || map["pending"];
    return <span className={`badge ${cfg.cls}`}>{cfg.label}</span>;
  }

  return (
    <AdminLayout>
      <div className="space-y-5 fade-in">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { key: "all",       label: "Total",       color: "blue",    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
            { key: "validated", label: "Validés",     color: "emerald", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
            { key: "pending",   label: "En attente",  color: "amber",   icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
            { key: "rejected",  label: "Rejetés",     color: "red",     icon: "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" },
          ].map(({ key, label, color, icon }) => (
            <button
              key={key}
              onClick={() => setStatusFilter(key as StatusFilter)}
              className={`card p-5 text-left transition-all card-hover ${statusFilter === key ? "ring-2 ring-indigo-400 ring-offset-2" : ""}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl bg-${color}-50 flex items-center justify-center`}>
                  <svg className={`w-5 h-5 text-${color}-500`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
                  </svg>
                </div>
                {statusFilter === key && <div className="w-2 h-2 rounded-full bg-indigo-500" />}
              </div>
              <div className={`text-3xl font-black text-${color}-600`}>{counts[key as keyof typeof counts]}</div>
              <div className="text-slate-500 text-sm mt-0.5">{label}</div>
            </button>
          ))}
        </div>

        {/* Search + Filter bar */}
        <div className="card p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par nom, apogée, CIN, programme…"
              className="input-light pl-10"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xl">×</button>
            )}
          </div>
          <button
            onClick={fetchStudents}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-sm font-semibold transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualiser
          </button>
        </div>

        {/* Student grid */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="card py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="text-slate-500 font-medium">{search ? `Aucun résultat pour "${search}"` : "Aucun étudiant trouvé."}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((student) => {
              const status = getStatus(student);
              const selfieUrl = student.selfie_path ? buildImageUrl(student.selfie_path) : "";
              return (
                <button
                  key={student.uid}
                  onClick={() => setSelected(student)}
                  className="card card-hover p-4 text-left flex flex-col gap-3 transition-all"
                >
                  <div className="flex items-center gap-3">
                    {selfieUrl ? (
                      <img
                        src={selfieUrl}
                        alt={student.first_name}
                        className="w-14 h-14 rounded-xl object-cover border-2 border-slate-200 flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 text-xl font-bold flex-shrink-0">
                        {(student.first_name || "?")[0]}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-slate-900 font-bold text-sm truncate">{student.first_name} {student.last_name}</p>
                      <p className="text-slate-400 text-xs font-mono">{student.apogee_code}</p>
                    </div>
                  </div>

                  {student.cod_etp && (
                    <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 font-mono truncate">
                      {student.cod_etp}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                    <StatusBadge status={status} />
                    <div className="flex gap-1">
                      <span className={`w-5 h-5 rounded-md flex items-center justify-center text-xs ${student.selfie_path ? "bg-emerald-50 text-emerald-600" : "bg-slate-50 text-slate-300"}`}>
                        👤
                      </span>
                      <span className={`w-5 h-5 rounded-md flex items-center justify-center text-xs ${student.cin_path ? "bg-blue-50 text-blue-600" : "bg-slate-50 text-slate-300"}`}>
                        🪪
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {filtered.length > 0 && !loading && (
          <p className="text-center text-slate-400 text-sm">
            {filtered.length} étudiant{filtered.length !== 1 ? "s" : ""} affiché{filtered.length !== 1 ? "s" : ""} sur {students.length}
          </p>
        )}
      </div>

      {/* ── Student Detail Modal ─────────────────────────────────────────── */}
      {selected && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <div>
                <h2 className="font-bold text-slate-900 text-lg">{selected.first_name} {selected.last_name}</h2>
                <p className="text-slate-500 text-sm">{selected.apogee_code}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 text-xl transition-colors"
              >×</button>
            </div>

            <div className="p-6 space-y-5">
              {/* Status + validation */}
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <p className="text-xs text-slate-500 mb-1">Statut du compte</p>
                  <StatusBadge status={getStatus(selected)} />
                </div>
                <div className="flex gap-2">
                  {getStatus(selected) !== "validated" && (
                    <button
                      onClick={() => handleValidate(selected.uid)}
                      disabled={validating}
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors flex items-center gap-1.5"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      Valider
                    </button>
                  )}
                  {getStatus(selected) !== "rejected" && (
                    <button
                      onClick={() => handleReject(selected.uid)}
                      disabled={validating}
                      className="px-4 py-2 bg-red-50 hover:bg-red-100 disabled:opacity-60 text-red-600 text-sm font-semibold rounded-xl transition-colors border border-red-200"
                    >
                      Rejeter
                    </button>
                  )}
                </div>
              </div>

              {/* Photos with zoom */}
              <div>
                <p className="text-sm font-semibold text-slate-700 mb-3">Photos d'identité</p>
                <div className="flex gap-4 flex-wrap">
                  {selected.selfie_path && (
                    <ImageZoomModal
                      src={buildImageUrl(selected.selfie_path)}
                      alt="Selfie"
                      label="Selfie"
                      className="flex flex-col items-center"
                    >
                      <div className="flex flex-col items-center">
                        <img
                          src={buildImageUrl(selected.selfie_path)}
                          alt="Selfie"
                          className="w-28 h-28 rounded-xl object-cover border-2 border-slate-200 cursor-zoom-in hover:brightness-90 transition-all"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <span className="text-xs text-slate-500 mt-1.5 font-medium">Selfie</span>
                      </div>
                    </ImageZoomModal>
                  )}
                  {selected.cin_path && (
                    <ImageZoomModal
                      src={buildImageUrl(selected.cin_path)}
                      alt="CIN"
                      label="Carte Nationale (CIN)"
                      className="flex flex-col items-center"
                    >
                      <div className="flex flex-col items-center">
                        <img
                          src={buildImageUrl(selected.cin_path)}
                          alt="CIN"
                          className="w-44 h-28 rounded-xl object-cover border-2 border-slate-200 cursor-zoom-in hover:brightness-90 transition-all"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <span className="text-xs text-slate-500 mt-1.5 font-medium">Carte Nationale (CIN)</span>
                      </div>
                    </ImageZoomModal>
                  )}
                  {!selected.selfie_path && !selected.cin_path && (
                    <div className="w-24 h-24 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 text-sm">
                      Aucune photo
                    </div>
                  )}
                </div>
              </div>

              {/* Info grid */}
              <div>
                <p className="text-sm font-semibold text-slate-700 mb-3">Informations</p>
                <div className="space-y-2">
                  {[
                    { label: "Nom complet",    value: `${selected.first_name} ${selected.last_name}` },
                    { label: "Code Apogée",    value: selected.apogee_code },
                    { label: "CIN",            value: selected.cin },
                    { label: "COD_IND",        value: selected.cod_ind || "—" },
                    { label: "Programme",      value: selected.cod_etp || selected.filiere || "—" },
                    { label: "Email",          value: selected.email },
                    { label: "Appareil",       value: selected.deviceFingerprint ? "🔒 Verrouillé" : "🔓 Libre" },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between items-center py-2 border-b border-slate-100 last:border-0">
                      <span className="text-slate-500 text-sm">{label}</span>
                      <span className="text-slate-900 text-sm font-semibold text-right max-w-[220px] truncate">{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Reset device */}
              {selected.deviceFingerprint && (
                <button
                  onClick={() => handleResetDevice(selected.uid)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 bg-orange-50 hover:bg-orange-100 text-orange-600 border border-orange-200 rounded-xl text-sm font-semibold transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                  </svg>
                  Réinitialiser le verrou appareil
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
