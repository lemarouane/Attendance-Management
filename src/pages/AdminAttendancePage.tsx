import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  getSalles, getSalleAttendance, getAllAttendance,
  AttendanceRecord, Salle, formatTimestamp,
} from "../services/attendanceService";
import { buildImageUrl } from "../services/apiService";
import AdminLayout from "../components/AdminLayout";
import ImageZoomModal from "../components/ImageZoomModal";

export default function AdminAttendancePage() {
  const [salles, setSalles]               = useState<Salle[]>([]);
  const [selectedSalleId, setSelectedSalleId] = useState<string>("all");
  const [attendance, setAttendance]       = useState<AttendanceRecord[]>([]);
  const [loading, setLoading]             = useState(true);
  const [search, setSearch]               = useState("");

  useEffect(() => {
    getSalles().then(setSalles).catch(() => toast.error("Impossible de charger les salles."));
  }, []);

  useEffect(() => {
    setLoading(true);
    const fn = selectedSalleId === "all" ? getAllAttendance() : getSalleAttendance(selectedSalleId);
    fn.then(setAttendance)
      .catch(() => toast.error("Impossible de charger les présences."))
      .finally(() => setLoading(false));
  }, [selectedSalleId]);

  const filtered = attendance.filter((rec) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (rec.student_name || "").toLowerCase().includes(q) ||
      (rec.apogee_code  || "").toLowerCase().includes(q) ||
      (rec.cod_etp      || "").toLowerCase().includes(q) ||
      (rec.salle_name   || "").toLowerCase().includes(q)
    );
  });

  const salleStats = salles.map((s) => ({
    ...s,
    count: attendance.filter((r) => r.salle_id === s.id).length,
  }));

  return (
    <AdminLayout>
      <div className="space-y-5 fade-in">
        {/* Salle stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <button
            onClick={() => setSelectedSalleId("all")}
            className={`card p-4 text-center transition-all card-hover ${selectedSalleId === "all" ? "ring-2 ring-indigo-400 ring-offset-2" : ""}`}
          >
            <div className={`text-2xl font-black ${selectedSalleId === "all" ? "text-indigo-600" : "text-slate-800"}`}>
              {attendance.length}
            </div>
            <div className="text-slate-500 text-xs mt-1 font-medium">Toutes salles</div>
          </button>
          {salleStats.slice(0, 4).map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedSalleId(s.id)}
              className={`card p-4 text-center transition-all card-hover ${selectedSalleId === s.id ? "ring-2 ring-indigo-400 ring-offset-2" : ""}`}
            >
              <div className={`text-2xl font-black ${selectedSalleId === s.id ? "text-indigo-600" : "text-slate-800"}`}>
                {s.count}
              </div>
              <div className="text-slate-500 text-xs mt-1 truncate">{s.salle_name}</div>
            </button>
          ))}
        </div>

        {/* Main table card */}
        <div className="card overflow-hidden">
          {/* Salle tabs */}
          <div className="flex overflow-x-auto scrollbar-hide border-b border-slate-100">
            {[{ id: "all", salle_name: "Toutes les salles" }, ...salles].map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSalleId(s.id)}
                className={`flex-shrink-0 px-5 py-3.5 text-sm font-semibold transition-all border-b-2 ${
                  selectedSalleId === s.id
                    ? "border-indigo-500 text-indigo-600 bg-indigo-50"
                    : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50"
                }`}
              >
                {s.salle_name}
                {s.id !== "all" && (
                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                    selectedSalleId === s.id ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-500"
                  }`}>
                    {salleStats.find((st) => st.id === s.id)?.count ?? 0}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="p-4 border-b border-slate-100">
            <div className="relative">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher par nom, apogée, Filière…"
                className="input-light pl-10"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xl">×</button>
              )}
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <p className="text-slate-500 font-medium">
                {search ? "Aucun résultat trouvé." : "Aucune présence pour cette salle."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {["#", "Photo", "Nom", "Apogée", "Filière", "Salle", "Heure", "Statut"].map((h) => (
                      <th key={h} className="text-left text-xs text-slate-500 font-semibold px-5 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((rec, i) => (
                    <tr key={rec.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-5 py-3 text-slate-400 text-sm">{i + 1}</td>
                      <td className="px-5 py-3">
                        {rec.selfie_path ? (
                          <ImageZoomModal src={buildImageUrl(rec.selfie_path)} alt={rec.student_name || ""} label={rec.student_name || ""}>
                            <img
                              src={buildImageUrl(rec.selfie_path)}
                              alt={rec.student_name || ""}
                              className="w-10 h-10 rounded-xl object-cover border border-slate-200 cursor-zoom-in hover:brightness-90 transition-all"
                              onError={(e) => {
                                const t = e.target as HTMLImageElement;
                                t.style.display = "none";
                                const fb = t.nextElementSibling as HTMLElement;
                                if (fb) fb.style.display = "flex";
                              }}
                            />
                          </ImageZoomModal>
                        ) : null}
                        <div
                          className="w-10 h-10 rounded-xl bg-indigo-50 items-center justify-center text-indigo-600 text-sm font-bold border border-indigo-100"
                          style={{ display: rec.selfie_path ? "none" : "flex" }}
                        >
                          {(rec.student_name || "?")[0]}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-slate-900 text-sm font-semibold">{rec.student_name ?? "—"}</td>
                      <td className="px-5 py-3 text-slate-500 text-sm font-mono">{rec.apogee_code ?? "—"}</td>
                      <td className="px-5 py-3 text-slate-500 text-sm">{rec.cod_etp || rec.filiere || "—"}</td>
                      <td className="px-5 py-3">
                        <span className="text-xs bg-indigo-50 border border-indigo-200 text-indigo-600 px-2.5 py-1 rounded-full font-semibold">
                          {rec.salle_name || "—"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-500 text-sm whitespace-nowrap">{formatTimestamp(rec.scan_time)}</td>
                      <td className="px-5 py-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Présent
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {filtered.length > 0 && (
            <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
              <span>{filtered.length} enregistrement{filtered.length !== 1 ? "s" : ""} affiché{filtered.length !== 1 ? "s" : ""}</span>
              <span>{new Date().toLocaleDateString("fr-MA", { dateStyle: "full" })}</span>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
