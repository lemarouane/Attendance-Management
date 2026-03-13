import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase/config";
import { StudentProfile, validateStudent, rejectStudent } from "../services/authService";
import { buildImageUrl } from "../services/apiService";
import AdminLayout from "../components/AdminLayout";
import ImageZoomModal from "../components/ImageZoomModal";
import toast from "react-hot-toast";

export default function AdminPendingPage() {
  const [students, setStudents]     = useState<StudentProfile[]>([]);
  const [loading, setLoading]       = useState(true);
  const [validating, setValidating] = useState<string | null>(null);
  const [selected, setSelected]     = useState<StudentProfile | null>(null);

  useEffect(() => { fetchPending(); }, []);

  async function fetchPending() {
    setLoading(true);
    try {
      const q    = query(collection(db, "students"), where("status", "==", "pending"));
      const snap = await getDocs(q);
      const data = snap.docs.map((d) => d.data() as StudentProfile);
      // Also fetch students with no status field
      const q2   = query(collection(db, "students"));
      const snap2 = await getDocs(q2);
      const noStatus = snap2.docs
        .map((d) => d.data() as StudentProfile)
        .filter((s) => !(s as unknown as { status?: string }).status);
      const all = [...data, ...noStatus];
      const unique = Array.from(new Map(all.map((s) => [s.uid, s])).values());
      setStudents(unique);
    } catch (err) {
      console.error(err);
      toast.error("Impossible de charger les étudiants en attente.");
    } finally {
      setLoading(false);
    }
  }

  async function handleValidate(uid: string, name: string) {
    setValidating(uid);
    try {
      await validateStudent(uid);
      toast.success(`${name} validé avec succès !`);
      setStudents((prev) => prev.filter((s) => s.uid !== uid));
      setSelected(null);
    } catch {
      toast.error("Erreur lors de la validation.");
    } finally {
      setValidating(null);
    }
  }

  async function handleReject(uid: string, name: string) {
    setValidating(uid);
    try {
      await rejectStudent(uid);
      toast.success(`${name} rejeté.`);
      setStudents((prev) => prev.filter((s) => s.uid !== uid));
      setSelected(null);
    } catch {
      toast.error("Erreur lors du rejet.");
    } finally {
      setValidating(null);
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-5 fade-in">
        {/* Info banner */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <p className="text-amber-800 font-semibold text-sm">Validation requise</p>
            <p className="text-amber-700 text-xs mt-0.5">
              Ces étudiants ont complété leur inscription et attendent votre validation. Ils ne peuvent pas se connecter tant que leur compte n'est pas validé.
              Vérifiez les photos CIN et selfie avant de valider.
            </p>
          </div>
        </div>

        {/* Count */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center">
              <span className="text-amber-600 font-black text-lg">{students.length}</span>
            </div>
            <div>
              <p className="text-slate-900 font-bold">Demandes en attente</p>
              <p className="text-slate-500 text-sm">Cliquez sur un étudiant pour valider</p>
            </div>
          </div>
          <button
            onClick={fetchPending}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-semibold transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualiser
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : students.length === 0 ? (
          <div className="card py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-slate-700 font-semibold">Aucune demande en attente</p>
            <p className="text-slate-400 text-sm mt-1">Tous les étudiants ont été traités.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {students.map((student) => {
              const selfieUrl = student.selfie_path ? buildImageUrl(student.selfie_path) : "";
              const cinUrl    = student.cin_path    ? buildImageUrl(student.cin_path)    : "";
              const isProcessing = validating === student.uid;

              return (
                <div
                  key={student.uid}
                  className="card p-5 flex flex-col sm:flex-row gap-4 sm:items-center"
                >
                  {/* Photo + Info */}
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <button onClick={() => setSelected(student)} className="flex-shrink-0">
                      {selfieUrl ? (
                        <img
                          src={selfieUrl}
                          alt={student.first_name}
                          className="w-16 h-16 rounded-xl object-cover border-2 border-slate-200 hover:border-indigo-400 transition-all cursor-zoom-in"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-xl bg-amber-50 border-2 border-amber-200 flex items-center justify-center text-amber-600 text-xl font-bold">
                          {(student.first_name || "?")[0]}
                        </div>
                      )}
                    </button>

                    <div className="min-w-0 flex-1">
                      <p className="text-slate-900 font-bold truncate">{student.first_name} {student.last_name}</p>
                      <p className="text-slate-500 text-sm font-mono">{student.apogee_code}</p>
                      {student.cod_etp && (
                        <p className="text-indigo-600 text-xs font-medium mt-0.5">{student.cod_etp}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        {student.cin_path  && <span className="badge badge-validated">✓ CIN</span>}
                        {student.selfie_path && <span className="badge badge-validated">✓ Selfie</span>}
                        {student.cin && <span className="text-xs text-slate-400 font-mono">{student.cin}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Thumbnails */}
                  <div className="flex gap-2 flex-shrink-0">
                    {selfieUrl && (
                      <ImageZoomModal src={selfieUrl} alt="Selfie" label="Selfie">
                        <img
                          src={selfieUrl}
                          alt="selfie"
                          className="w-12 h-12 rounded-lg object-cover border border-slate-200 cursor-zoom-in hover:brightness-90 transition-all"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      </ImageZoomModal>
                    )}
                    {cinUrl && (
                      <ImageZoomModal src={cinUrl} alt="CIN" label="CIN">
                        <img
                          src={cinUrl}
                          alt="CIN"
                          className="w-20 h-12 rounded-lg object-cover border border-slate-200 cursor-zoom-in hover:brightness-90 transition-all"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      </ImageZoomModal>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleValidate(student.uid, `${student.first_name} ${student.last_name}`)}
                      disabled={isProcessing}
                      className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
                    >
                      {isProcessing ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      Valider
                    </button>
                    <button
                      onClick={() => handleReject(student.uid, `${student.first_name} ${student.last_name}`)}
                      disabled={isProcessing}
                      className="flex items-center gap-1.5 px-4 py-2.5 bg-red-50 hover:bg-red-100 disabled:opacity-60 text-red-600 text-sm font-semibold rounded-xl border border-red-200 transition-colors"
                    >
                      Rejeter
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Photo zoom modal */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-900">{selected.first_name} {selected.last_name}</h3>
              <button onClick={() => setSelected(null)} className="w-8 h-8 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center justify-center text-xl">×</button>
            </div>
            <div className="flex flex-col gap-3">
              {selected.selfie_path && (
                <ImageZoomModal src={buildImageUrl(selected.selfie_path)} alt="Selfie" label="Selfie">
                  <div className="cursor-zoom-in">
                    <img src={buildImageUrl(selected.selfie_path)} alt="Selfie" className="w-full h-48 rounded-xl object-cover border border-slate-200 hover:brightness-90 transition-all" />
                    <p className="text-center text-xs text-slate-500 mt-1">Selfie — cliquer pour agrandir</p>
                  </div>
                </ImageZoomModal>
              )}
              {selected.cin_path && (
                <ImageZoomModal src={buildImageUrl(selected.cin_path)} alt="CIN" label="Carte Nationale">
                  <div className="cursor-zoom-in">
                    <img src={buildImageUrl(selected.cin_path)} alt="CIN" className="w-full h-36 rounded-xl object-cover border border-slate-200 hover:brightness-90 transition-all" />
                    <p className="text-center text-xs text-slate-500 mt-1">CIN — cliquer pour agrandir</p>
                  </div>
                </ImageZoomModal>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
