import { useEffect, useState, useMemo, useRef } from "react";
import toast from "react-hot-toast";
import {
  getAllArchive, getArchiveBySalle, getSalles,
  AttendanceRecord, Salle, formatTimestamp,
} from "../services/attendanceService";
import { buildImageUrl } from "../services/apiService";
import AdminLayout from "../components/AdminLayout";
import ImageZoomModal from "../components/ImageZoomModal";

// ── SheetJS (xlsx) loaded from CDN ─────────────────────────────────────────
// We dynamically load it only when the user clicks Export.
function loadSheetJS(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).XLSX) { resolve(); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load SheetJS"));
    document.head.appendChild(s);
  });
}

export default function AdminArchivePage() {
  const [salles, setSalles]               = useState<Salle[]>([]);
  const [records, setRecords]             = useState<AttendanceRecord[]>([]);
  const [loading, setLoading]             = useState(true);
  const [selectedSalle, setSelectedSalle] = useState<string>("all");
  const [search, setSearch]               = useState("");
  const [selectedDate, setSelectedDate]   = useState<string>("");
  const [expandedId, setExpandedId]       = useState<string | null>(null);
  const [exporting, setExporting]         = useState(false);

  useEffect(() => {
    getSalles().then(setSalles).catch(() => toast.error("Impossible de charger les salles."));
  }, []);

  useEffect(() => {
    setLoading(true);
    const loader = selectedSalle !== "all" ? getArchiveBySalle(selectedSalle) : getAllArchive();
    loader
      .then(setRecords)
      .catch(() => toast.error("Impossible de charger l'archive."))
      .finally(() => setLoading(false));
  }, [selectedSalle]);

  const uniqueDates = useMemo(() => {
    const dates = new Set<string>();
    records.forEach((r) => { if (r.date_label) dates.add(r.date_label); });
    return Array.from(dates).sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  }, [records]);

  const filtered = useMemo(() => {
    let out = [...records];
    if (selectedDate) out = out.filter((r) => r.date_label === selectedDate);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((r) =>
        (r.student_name || "").toLowerCase().includes(q) ||
        (r.apogee_code  || "").toLowerCase().includes(q) ||
        (r.cod_etp      || "").toLowerCase().includes(q) ||
        (r.salle_name   || "").toLowerCase().includes(q) ||
        (r.date_label   || "").toLowerCase().includes(q)
      );
    }
    return out;
  }, [records, selectedDate, search]);

  const totalStudents = useMemo(() => new Set(records.map((r) => r.student_id)).size, [records]);

  // ── Excel Export ───────────────────────────────────────────────────────────
  async function handleExportExcel() {
    if (filtered.length === 0) {
      toast.error("Aucune donnée à exporter.");
      return;
    }
    setExporting(true);
    const toastId = toast.loading("Préparation du fichier Excel…");

    try {
      await loadSheetJS();
      const XLSX = (window as any).XLSX;

      const wb = XLSX.utils.book_new();

      // ── Sheet 1: Detailed records ──────────────────────────────────────
      const detailRows = filtered.map((r, i) => ({
        "#":              i + 1,
        "Nom complet":    r.student_name || "—",
        "Code Apogée":   r.apogee_code || "—",
        "Filière":      r.cod_etp || r.filiere || "—",
        "Salle":          r.salle_name || "—",
        "Date":           r.date_label || "—",
        "Heure de scan":  formatTimestamp(r.scan_time),
        "ID Étudiant":   r.student_id || "—",
        "Session":        r.session_id || "—",
        "Heure d'archive": formatTimestamp(r.archived_at),
      }));

      const ws1 = XLSX.utils.json_to_sheet(detailRows);

      // Column widths
      ws1["!cols"] = [
        { wch: 5  },  // #
        { wch: 28 },  // Nom
        { wch: 14 },  // Apogée
        { wch: 18 },  // Programme
        { wch: 14 },  // Salle
        { wch: 14 },  // Date
        { wch: 18 },  // Heure scan
        { wch: 32 },  // ID
        { wch: 32 },  // Session
        { wch: 20 },  // Archive
      ];

      XLSX.utils.book_append_sheet(wb, ws1, "Présences détaillées");

      // ── Sheet 2: Summary by date × salle ──────────────────────────────
      type SummaryKey = string;
      const summaryMap = new Map<SummaryKey, { date: string; salle: string; count: number; students: string[] }>();

      filtered.forEach((r) => {
        const key = `${r.date_label}___${r.salle_name}`;
        if (!summaryMap.has(key)) {
          summaryMap.set(key, { date: r.date_label || "—", salle: r.salle_name || "—", count: 0, students: [] });
        }
        const entry = summaryMap.get(key)!;
        entry.count++;
        if (r.student_name && !entry.students.includes(r.student_name)) {
          entry.students.push(r.student_name);
        }
      });

      const summaryRows = Array.from(summaryMap.values())
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .map((s) => ({
          "Date":              s.date,
          "Salle":             s.salle,
          "Nb présences":      s.count,
          "Étudiants uniques": s.students.length,
          "Liste étudiants":   s.students.join(", "),
        }));

      const ws2 = XLSX.utils.json_to_sheet(summaryRows);
      ws2["!cols"] = [
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 18 },
        { wch: 80 },
      ];
      XLSX.utils.book_append_sheet(wb, ws2, "Résumé par date & salle");

      // ── Sheet 3: Per-student summary ───────────────────────────────────
      const studentMap = new Map<string, { name: string; apogee: string; prog: string; sessions: string[]; salles: string[] }>();

      filtered.forEach((r) => {
        const key = r.apogee_code || r.student_id || "unknown";
        if (!studentMap.has(key)) {
          studentMap.set(key, { name: r.student_name || "—", apogee: r.apogee_code || "—", prog: r.cod_etp || r.filiere || "—", sessions: [], salles: [] });
        }
        const e = studentMap.get(key)!;
        if (r.date_label && !e.sessions.includes(r.date_label)) e.sessions.push(r.date_label);
        if (r.salle_name && !e.salles.includes(r.salle_name))   e.salles.push(r.salle_name);
      });

      const studentRows = Array.from(studentMap.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s, i) => ({
          "#":            i + 1,
          "Nom":          s.name,
          "Code Apogée": s.apogee,
          "Filière":   s.prog,
          "Nb jours présent": s.sessions.length,
          "Jours":        s.sessions.sort().join(", "),
          "Salles":       s.salles.join(", "),
        }));

      const ws3 = XLSX.utils.json_to_sheet(studentRows);
      ws3["!cols"] = [
        { wch: 5  },
        { wch: 28 },
        { wch: 14 },
        { wch: 18 },
        { wch: 18 },
        { wch: 40 },
        { wch: 30 },
      ];
      XLSX.utils.book_append_sheet(wb, ws3, "Par étudiant");

      // ── Generate filename with filters context ─────────────────────────
      const dateStr = selectedDate || "toutes-dates";
      const salleStr = selectedSalle !== "all"
        ? (salles.find(s => s.id === selectedSalle)?.salle_name || selectedSalle)
        : "toutes-salles";
      const today = new Date().toISOString().slice(0, 10);
      const filename = `archive-presences_${salleStr}_${dateStr}_${today}.xlsx`;

      XLSX.writeFile(wb, filename);
      toast.success(`✓ ${filtered.length} enregistrements exportés`, { id: toastId });
    } catch (err) {
      toast.error("Erreur lors de l'export Excel.", { id: toastId });
      console.error(err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <AdminLayout>
      <div className="space-y-5 fade-in">
        {/* Banner */}
        <div className="bg-purple-50 border border-purple-200 rounded-2xl p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-purple-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-purple-800 font-semibold text-sm">Archive permanente</p>
            <p className="text-purple-700 text-xs mt-0.5">
              Les enregistrements de présence en direct sont supprimés après <strong>2 heures</strong>.
              Chaque scan est archivé ici de façon permanente et n'est jamais supprimé.
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total enregistrements", value: records.length,     color: "purple"  },
            { label: "Étudiants uniques",     value: totalStudents,      color: "blue"    },
            { label: "Jours enregistrés",     value: uniqueDates.length, color: "emerald" },
            { label: "Salles couvertes",      value: new Set(records.map((r) => r.salle_id)).size, color: "amber" },
          ].map(({ label, value, color }) => (
            <div key={label} className="card p-5">
              <div className={`text-3xl font-black text-${color}-500 mb-1`}>{value}</div>
              <div className="text-slate-500 text-sm">{label}</div>
            </div>
          ))}
        </div>

        {/* Filters + Export button */}
        <div className="card p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Salle filter */}
            <select
              value={selectedSalle}
              onChange={(e) => setSelectedSalle(e.target.value)}
              className="input-light flex-1"
            >
              <option value="all">Toutes les salles</option>
              {salles.map((s) => (
                <option key={s.id} value={s.id}>{s.salle_name}</option>
              ))}
            </select>

            {/* Date filter */}
            <select
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="input-light flex-1"
            >
              <option value="">Toutes les dates</option>
              {uniqueDates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>

            {/* Reset */}
            <button
              onClick={() => { setSelectedSalle("all"); setSelectedDate(""); setSearch(""); }}
              className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-semibold rounded-xl transition-colors whitespace-nowrap"
            >
              Réinitialiser
            </button>

            {/* ── Excel Export Button ── */}
            <button
              onClick={handleExportExcel}
              disabled={exporting || filtered.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-200 disabled:text-emerald-400 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-all whitespace-nowrap shadow-sm shadow-emerald-100"
            >
              {exporting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Export…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Exporter Excel ({filtered.length})
                </>
              )}
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par nom, apogée, filière, salle, date…"
              className="input-light pl-10"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-xl">×</button>
            )}
          </div>
        </div>

        {/* Records — unchanged from your original */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="card py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </div>
            <p className="text-slate-500 font-medium">Aucun enregistrement trouvé</p>
            <p className="text-slate-400 text-sm mt-1">
              {search || selectedDate || selectedSalle !== "all"
                ? "Essayez de modifier vos filtres"
                : "Les enregistrements apparaissent ici après les scans"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {(() => {
              const grouped = new Map<string, AttendanceRecord[]>();
              filtered.forEach((r) => {
                const label = r.date_label || "Date inconnue";
                if (!grouped.has(label)) grouped.set(label, []);
                grouped.get(label)!.push(r);
              });

              return Array.from(grouped.entries()).map(([date, recs]) => (
                <div key={date} className="card overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 bg-purple-50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                        <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <span className="text-purple-700 font-bold text-sm">{date}</span>
                    </div>
                    <span className="text-xs text-slate-500 bg-white border border-slate-200 px-3 py-1 rounded-full">
                      {recs.length} enregistrement{recs.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          {["#", "Photo", "Étudiant", "Apogée", "Filière", "Salle", "Heure scan", "Détail"].map((h) => (
                            <th key={h} className="text-left text-xs text-slate-500 font-semibold px-4 py-3">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {recs.map((rec, i) => (
                          <>
                            <tr
                              key={rec.id}
                              className="hover:bg-slate-50 transition-colors cursor-pointer"
                              onClick={() => setExpandedId(expandedId === rec.id ? null : rec.id)}
                            >
                              <td className="px-4 py-3 text-slate-400 text-sm">{i + 1}</td>
                              <td className="px-4 py-3">
                                {rec.selfie_path ? (
                                  <ImageZoomModal src={buildImageUrl(rec.selfie_path)} alt={rec.student_name || ""} label={rec.student_name || ""}>
                                    <img
                                      src={buildImageUrl(rec.selfie_path)}
                                      alt={rec.student_name || ""}
                                      className="w-9 h-9 rounded-lg object-cover border border-slate-200 cursor-zoom-in hover:brightness-90 transition-all"
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </ImageZoomModal>
                                ) : (
                                  <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600 text-xs font-bold border border-purple-100">
                                    {(rec.student_name || "?")[0]}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-slate-900 text-sm font-semibold">{rec.student_name ?? "—"}</td>
                              <td className="px-4 py-3 text-slate-500 text-sm font-mono">{rec.apogee_code ?? "—"}</td>
                              <td className="px-4 py-3 text-slate-500 text-sm">{rec.cod_etp || rec.filiere || "—"}</td>
                              <td className="px-4 py-3">
                                <span className="text-xs bg-purple-50 border border-purple-200 text-purple-600 px-2 py-0.5 rounded-full font-semibold whitespace-nowrap">
                                  {rec.salle_name || "—"}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-slate-500 text-sm whitespace-nowrap">{formatTimestamp(rec.scan_time)}</td>
                              <td className="px-4 py-3">
                                <button className="text-slate-400 hover:text-purple-600 transition-colors" onClick={(e) => { e.stopPropagation(); setExpandedId(expandedId === rec.id ? null : rec.id); }}>
                                  <svg
                                    className={`w-4 h-4 transition-transform ${expandedId === rec.id ? "rotate-180" : ""}`}
                                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                                  >
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                  </svg>
                                </button>
                              </td>
                            </tr>

                            {expandedId === rec.id && (
                              <tr key={`${rec.id}-exp`}>
                                <td colSpan={8} className="px-5 py-4 bg-purple-50 border-b border-purple-100">
                                  <div className="flex gap-6 items-start">
                                    {rec.selfie_path && (
                                      <div>
                                        <p className="text-slate-500 text-xs mb-2 font-medium">Photo selfie</p>
                                        <ImageZoomModal src={buildImageUrl(rec.selfie_path)} alt="Selfie" label="Selfie étudiant">
                                          <img
                                            src={buildImageUrl(rec.selfie_path)}
                                            alt="Selfie"
                                            className="w-24 h-24 rounded-xl object-cover border-2 border-purple-200 cursor-zoom-in hover:brightness-90 transition-all"
                                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                          />
                                        </ImageZoomModal>
                                      </div>
                                    )}
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 flex-1">
                                      {[
                                        { label: "ID Étudiant",    value: rec.student_id },
                                        { label: "Code Apogée",    value: rec.apogee_code },
                                        { label: "Filière",      value: rec.cod_etp || rec.filiere },
                                        { label: "Salle",          value: rec.salle_name },
                                        { label: "Session",        value: (rec.session_id || "").slice(0, 20) + "…" },
                                        { label: "Heure d'archive", value: formatTimestamp(rec.archived_at) },
                                      ].map(({ label, value }) => (
                                        <div key={label} className="bg-white rounded-xl p-3 border border-purple-100">
                                          <p className="text-slate-400 text-xs font-medium">{label}</p>
                                          <p className="text-slate-800 text-sm font-semibold mt-0.5 truncate">{value || "—"}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ));
            })()}

            <p className="text-center text-slate-400 text-sm py-2">
              {filtered.length} sur {records.length} enregistrements archivés
            </p>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}