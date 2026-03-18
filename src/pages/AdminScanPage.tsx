import { useEffect, useRef, useState, useCallback } from "react";
import toast from "react-hot-toast";
import {
  processQRScan, AttendanceRecord, getSalleAttendance,
  getSalles, Salle, formatTimestamp,
} from "../services/attendanceService";
import { StudentProfile } from "../services/authService";
import { buildImageUrl, uploadScanFace } from "../services/apiService";
import AdminLayout from "../components/AdminLayout";
import ImageZoomModal from "../components/ImageZoomModal";
import DualZoneScanner from "../components/DualZoneScanner";

interface ScanEntry {
  student: StudentProfile; scanTime: string; success: boolean;
  message: string; scanFaceData?: string; scanFacePath?: string; hadFace: boolean;
}

const SESSION_ID = `session_${new Date().toISOString().split("T")[0]}_${Math.random().toString(36).slice(2, 8)}`;
const POLL_INTERVAL_MS = 5000;

export default function AdminScanPage() {
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [salles, setSalles] = useState<Salle[]>([]);
  const [selectedSalle, setSelectedSalle] = useState<Salle | null>(null);
  const [loadingSalles, setLoadingSalles] = useState(true);
  const [scannerActive, setScannerActive] = useState(false);
  const [lastScan, setLastScan] = useState<ScanEntry | null>(null);
  const [sessionAttendance, setSessionAttendance] = useState<AttendanceRecord[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [activeTab, setActiveTab] = useState<"scanner" | "liste">("scanner");
  const [salleSearch, setSalleSearch] = useState("");
  const [salleTypeFilter, setSalleTypeFilter] = useState<string>("all");
  const [exporting, setExporting] = useState(false);
  const [uploadingFace, setUploadingFace] = useState(false);

  useEffect(() => {
    getSalles().then(setSalles).catch(() => toast.error("Impossible de charger les salles.")).finally(() => setLoadingSalles(false));
  }, []);

  const fetchAttendance = useCallback(async (salleId: string) => {
    try {
      const records = await getSalleAttendance(salleId);
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      setSessionAttendance(records.filter((r) => {
        const t = r.scan_time as any;
        const ms = t?.toDate ? t.toDate().getTime() : new Date(t).getTime();
        return ms > twoHoursAgo;
      }));
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => {
    if (!selectedSalle) { setSessionAttendance([]); if (pollRef.current) clearInterval(pollRef.current); return; }
    setLoadingAttendance(true);
    fetchAttendance(selectedSalle.id).finally(() => setLoadingAttendance(false));
    pollRef.current = setInterval(() => fetchAttendance(selectedSalle.id), POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedSalle, fetchAttendance]);

  const refreshNow = useCallback(() => { if (selectedSalle) fetchAttendance(selectedSalle.id); }, [selectedSalle, fetchAttendance]);
  const getImageUrl = (p: string) => p ? buildImageUrl(p) : "";

  const handleScanWithFace = useCallback(async (qrData: string, faceImageData: string) => {
    if (!selectedSalle) return;
    const result = await processQRScan(qrData, SESSION_ID, selectedSalle.id, selectedSalle.salle_name, "");
    setLastScan({ student: result.student ?? ({} as StudentProfile), scanTime: new Date().toLocaleTimeString("fr-MA"), success: result.success, message: result.message, scanFaceData: faceImageData, hadFace: true });
    if (result.success && result.student) {
      toast.success(`✓ ${result.student.first_name} ${result.student.last_name} — Présent !`);
      if (result.student.apogee_code) {
        setUploadingFace(true);
        uploadScanFace(result.student.apogee_code, faceImageData)
          .then((up) => { if (up.success) setLastScan((p) => p ? { ...p, scanFacePath: up.path } : p); })
          .catch(console.error).finally(() => setUploadingFace(false));
      }
    } else { toast.error(result.message, { duration: 4000 }); }
    refreshNow();
  }, [selectedSalle, refreshNow]);

  const handleScanNoFace = useCallback(async (qrData: string) => {
    if (!selectedSalle) return;
    const result = await processQRScan(qrData, SESSION_ID, selectedSalle.id, selectedSalle.salle_name, "");
    setLastScan({ student: result.student ?? ({} as StudentProfile), scanTime: new Date().toLocaleTimeString("fr-MA"), success: result.success, message: result.message, hadFace: false });
    if (result.success && result.student) {
      toast.success(`✓ ${result.student.first_name} ${result.student.last_name} — Présent !`, { icon: "⚠️" });
      toast("Aucun visage détecté — vérifier manuellement.", { icon: "👤", duration: 5000, style: { background: "#fef3c7", color: "#92400e" } });
    } else { toast.error(result.message, { duration: 4000 }); }
    refreshNow();
  }, [selectedSalle, refreshNow]);

  async function handleExportExcel() {
    if (!sessionAttendance.length) { toast.error("Aucune donnée à exporter."); return; }
    setExporting(true);
    const toastId = toast.loading("Génération du fichier Excel…");
    try {
      await new Promise<void>((res, rej) => {
        if ((window as any).XLSX) { res(); return; }
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
        s.onload = () => res(); s.onerror = rej; document.head.appendChild(s);
      });
      const XLSX = (window as any).XLSX;
      const fetchB64 = async (url: string): Promise<string | null> => {
        try {
          const r = await fetch(url, { mode: "cors" }); if (!r.ok) return null;
          const blob = await r.blob();
          return new Promise((res2) => { const fr = new FileReader(); fr.onloadend = () => res2((fr.result as string).split(",")[1] ?? null); fr.readAsDataURL(blob); });
        } catch { return null; }
      };
      const selfies: (string|null)[] = new Array(sessionAttendance.length).fill(null);
      const faces: (string|null)[] = new Array(sessionAttendance.length).fill(null);
      for (let i = 0; i < sessionAttendance.length; i += 5) {
        const batch = sessionAttendance.slice(i, i+5);
        const [sr, fr] = await Promise.all([
          Promise.all(batch.map(r => r.selfie_path ? fetchB64(getImageUrl(r.selfie_path)) : Promise.resolve(null))),
          Promise.all(batch.map(r => r.scan_face_path ? fetchB64(getImageUrl(r.scan_face_path)) : Promise.resolve(null))),
        ]);
        sr.forEach((v,j) => { selfies[i+j]=v; }); fr.forEach((v,j) => { faces[i+j]=v; });
      }
      const wb = XLSX.utils.book_new();
      const wsData: any[][] = [["#","Photo inscription","Photo scan","Nom","Apogée","Programme","Salle","Heure"]];
      sessionAttendance.forEach((r,i) => wsData.push([i+1,"","",r.student_name||"—",r.apogee_code||"—",r.cod_etp||r.filiere||"—",r.salle_name||"—",formatTimestamp(r.scan_time)]));
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws["!cols"] = [{wch:5},{wch:14},{wch:14},{wch:28},{wch:14},{wch:18},{wch:12},{wch:22}];
      ws["!rows"] = [{hpt:20},...sessionAttendance.map(()=>({hpt:60}))];
      if (!ws["!images"]) ws["!images"]=[];
      selfies.forEach((b64,i) => { if(!b64)return; ws["!images"].push({name:`s${i}.jpg`,data:b64,opts:{base64:true},position:{type:"twoCellAnchor",attrs:{editAs:"oneCell"},from:{col:1,row:i+1,colOff:5760,rowOff:5760},to:{col:2,row:i+2,colOff:0,rowOff:0}}}); });
      faces.forEach((b64,i) => { if(!b64)return; ws["!images"].push({name:`f${i}.jpg`,data:b64,opts:{base64:true},position:{type:"twoCellAnchor",attrs:{editAs:"oneCell"},from:{col:2,row:i+1,colOff:5760,rowOff:5760},to:{col:3,row:i+2,colOff:0,rowOff:0}}}); });
      XLSX.utils.book_append_sheet(wb, ws, "Présences");
      XLSX.writeFile(wb, `presences_${selectedSalle?.salle_name.replace(/\s+/g,"-")||"salle"}_${new Date().toISOString().slice(0,10)}.xlsx`);
      toast.success(`✓ ${sessionAttendance.length} étudiants exportés`, { id: toastId });
    } catch { toast.error("Erreur export.", { id: toastId }); }
    finally { setExporting(false); }
  }

  const salleTypes = ["all", ...Array.from(new Set(salles.map(s => s.salle_type || "Cours")))];
  const filteredSalles = salles.filter(s => {
    return s.salle_name.toLowerCase().includes(salleSearch.toLowerCase()) &&
      (salleTypeFilter === "all" || (s.salle_type || "Cours") === salleTypeFilter);
  });

  if (!selectedSalle) {
    return (
      <AdminLayout>
        <div className="fade-in space-y-5">
          <div className="card p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200">
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Sélectionner une salle</h2>
                <p className="text-slate-500 text-sm mt-0.5">{loadingSalles ? "Chargement…" : `${salles.length} salles disponibles`}</p>
              </div>
            </div>
            {!loadingSalles && salles.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  <input type="text" value={salleSearch} onChange={e => setSalleSearch(e.target.value)} placeholder="Rechercher une salle…" className="w-full border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-slate-50 focus:bg-white transition-all" />
                  {salleSearch && <button onClick={() => setSalleSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-lg">×</button>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {salleTypes.map(type => (
                    <button key={type} onClick={() => setSalleTypeFilter(type)} className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all ${salleTypeFilter===type?"bg-indigo-500 text-white":"bg-slate-100 text-slate-500 hover:bg-slate-200"}`}>
                      {type==="all"?"Toutes":type}
                      {type!=="all" && <span className={`ml-1.5 text-[10px] ${salleTypeFilter===type?"text-indigo-200":"text-slate-400"}`}>({salles.filter(s=>(s.salle_type||"Cours")===type).length})</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {loadingSalles ? <div className="card flex justify-center py-20"><div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"/></div>
          : filteredSalles.length === 0 ? <div className="card py-16 text-center"><p className="text-slate-500">Aucune salle trouvée</p><button onClick={() => { setSalleSearch(""); setSalleTypeFilter("all"); }} className="mt-4 text-indigo-500 text-sm underline">Réinitialiser</button></div>
          : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filteredSalles.map(salle => {
                const tc = salle.salle_type==="TP" ? {bg:"bg-blue-50",border:"border-blue-200",text:"text-blue-600",hb:"hover:border-blue-400",icon:"text-blue-500",badge:"bg-blue-100 text-blue-700 border-blue-200"}
                  : salle.salle_type==="TD" ? {bg:"bg-violet-50",border:"border-violet-200",text:"text-violet-600",hb:"hover:border-violet-400",icon:"text-violet-500",badge:"bg-violet-100 text-violet-700 border-violet-200"}
                  : salle.salle_type==="Amphi" ? {bg:"bg-amber-50",border:"border-amber-200",text:"text-amber-600",hb:"hover:border-amber-400",icon:"text-amber-500",badge:"bg-amber-100 text-amber-700 border-amber-200"}
                  : {bg:"bg-emerald-50",border:"border-emerald-200",text:"text-emerald-600",hb:"hover:border-emerald-400",icon:"text-emerald-500",badge:"bg-emerald-100 text-emerald-700 border-emerald-200"};
                return (
                  <button key={salle.id} onClick={() => setSelectedSalle(salle)} className={`group relative p-4 ${tc.bg} border-2 ${tc.border} ${tc.hb} rounded-2xl text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5`}>
                    <span className={`absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full border ${tc.badge}`}>{salle.salle_type||"Cours"}</span>
                    <div className={`w-10 h-10 rounded-xl bg-white border ${tc.border} flex items-center justify-center mb-3 group-hover:scale-110 transition-all`}>
                      <svg className={`w-5 h-5 ${tc.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
                    </div>
                    <p className={`font-bold text-sm ${tc.text} leading-tight pr-8`}>{salle.salle_name}</p>
                    <p className="text-slate-400 text-xs mt-1">Appuyer pour sélectionner</p>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-4 fade-in">
        {/* Salle bar */}
        <div className="flex items-center justify-between card px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium">Salle sélectionnée</p>
              <p className="text-slate-900 font-bold">{selectedSalle.salle_name}
                <span className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded-full ${selectedSalle.salle_type==="TP"?"bg-blue-50 text-blue-600":selectedSalle.salle_type==="TD"?"bg-violet-50 text-violet-600":selectedSalle.salle_type==="Amphi"?"bg-amber-50 text-amber-600":"bg-emerald-50 text-emerald-600"}`}>{selectedSalle.salle_type}</span>
              </p>
            </div>
          </div>
          <button onClick={() => { setScannerActive(false); setSelectedSalle(null); setLastScan(null); setSessionAttendance([]); setSalleSearch(""); setSalleTypeFilter("all"); }} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-medium rounded-xl transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
            Changer de salle
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            {label:"Présents (2h)",value:loadingAttendance?"…":sessionAttendance.length,color:"emerald",sub:"dans cette salle"},
            {label:"Dernier scan",value:lastScan?.success?"✓":lastScan?"✗":"—",color:lastScan?.success?"emerald":lastScan?"red":"slate",sub:lastScan?.student?.first_name??"En attente"},
            {label:"Mise à jour",value:"5s",color:"indigo",sub:"intervalle polling"},
          ].map(({label,value,color,sub}) => (
            <div key={label} className="card p-4 text-center">
              <div className={`text-3xl font-black text-${color}-500`}>{value}</div>
              <div className="text-slate-600 text-xs font-semibold mt-1">{label}</div>
              <div className="text-slate-400 text-xs mt-0.5">{sub}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-2xl border border-slate-200 p-1.5 flex gap-1 shadow-sm">
          {[{id:"scanner" as const,label:"📷 Scanner QR"},{id:"liste" as const,label:`📋 Liste (${sessionAttendance.length})`}].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${activeTab===tab.id?"bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-md":"text-slate-500 hover:text-slate-800 hover:bg-slate-50"}`}>{tab.label}</button>
          ))}
        </div>

        {activeTab === "scanner" && (
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            <div className="xl:col-span-3">
              <DualZoneScanner active={scannerActive} onStart={() => setScannerActive(true)} onStop={() => setScannerActive(false)} onScanWithFace={handleScanWithFace} onScanNoFace={handleScanNoFace} salleeName={selectedSalle.salle_name} />
            </div>
            <div className="xl:col-span-2 card overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div><h3 className="font-bold text-slate-900">Dernier scan</h3><p className="text-slate-500 text-sm mt-0.5">Résultat de la dernière vérification</p></div>
                {uploadingFace && <div className="flex items-center gap-1.5 text-xs text-indigo-500"><div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"/>Upload…</div>}
              </div>
              {!lastScan ? (
                <div className="flex-1 p-10 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                    <svg className="w-7 h-7 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/></svg>
                  </div>
                  <p className="text-slate-500 font-medium">En attente du premier scan…</p>
                  <p className="text-slate-400 text-sm">Visage à gauche · QR à droite</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  <div className={`rounded-xl p-3 flex items-center gap-3 ${lastScan.success?"bg-emerald-50 border border-emerald-200":"bg-red-50 border border-red-200"}`}>
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${lastScan.success?"bg-emerald-100":"bg-red-100"}`}>
                      {lastScan.success ? <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
                        : <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/></svg>}
                    </div>
                    <p className={`text-sm font-semibold ${lastScan.success?"text-emerald-700":"text-red-700"}`}>{lastScan.message}</p>
                  </div>
                  {lastScan.success && !lastScan.hadFace && (
                    <div className="rounded-xl p-3 bg-amber-50 border border-amber-200 flex items-center gap-2">
                      <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      <p className="text-amber-700 text-xs font-medium">Aucun visage détecté — vérification manuelle recommandée</p>
                    </div>
                  )}
                  {lastScan.student?.uid && (
                    <>
                      <div className="flex gap-3">
                        <div className="flex flex-col items-center gap-1 flex-1">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Inscription</p>
                          {(lastScan.student.selfie_path||lastScan.student.photo_url) ? (
                            <ImageZoomModal src={getImageUrl(lastScan.student.selfie_path||lastScan.student.photo_url||"")} alt={lastScan.student.first_name} label="Photo inscription">
                              <img src={getImageUrl(lastScan.student.selfie_path||lastScan.student.photo_url||"")} alt="" className={`w-20 h-20 rounded-2xl object-cover border-4 cursor-zoom-in ${lastScan.success?"border-emerald-300":"border-red-300"}`} onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>
                            </ImageZoomModal>
                          ) : (
                            <div className={`w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold border-4 ${lastScan.success?"bg-emerald-50 border-emerald-300 text-emerald-600":"bg-red-50 border-red-300 text-red-600"}`}>{lastScan.student.first_name?.[0]}{lastScan.student.last_name?.[0]}</div>
                          )}
                        </div>
                        <div className="flex flex-col items-center gap-1 flex-1">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1">Au scan {uploadingFace&&<span className="w-2.5 h-2.5 border border-indigo-400 border-t-transparent rounded-full animate-spin inline-block"/>}</p>
                          {lastScan.scanFaceData ? (
                            <div className="relative">
                              <img src={lastScan.scanFaceData} alt="Scan face" className="w-20 h-20 rounded-2xl object-cover border-4 border-indigo-300"/>
                              {lastScan.scanFacePath && <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center"><svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg></div>}
                            </div>
                          ) : (
                            <div className="w-20 h-20 rounded-2xl bg-amber-50 border-4 border-amber-200 flex flex-col items-center justify-center gap-1">
                              <svg className="w-7 h-7 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                              <span className="text-amber-400 text-[9px] font-bold px-1">Non capturé</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {[{label:"Nom",value:`${lastScan.student.first_name} ${lastScan.student.last_name}`},{label:"Apogée",value:lastScan.student.apogee_code},{label:"CIN",value:lastScan.student.cin},{label:"Programme",value:lastScan.student.cod_etp||lastScan.student.filiere},{label:"Salle",value:selectedSalle.salle_name},{label:"Heure",value:lastScan.scanTime}].map(({label,value}) => (
                          <div key={label} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
                            <span className="text-slate-500 text-sm">{label}</span>
                            <span className="text-slate-900 text-sm font-semibold">{value||"—"}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "liste" && (
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="font-bold text-slate-900">Présences — {selectedSalle.salle_name}</h3>
                <p className="text-slate-500 text-sm mt-0.5">{loadingAttendance?"Chargement…":`${sessionAttendance.length} étudiant${sessionAttendance.length!==1?"s":""} · 2h · 5s`}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => fetchAttendance(selectedSalle.id)} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold rounded-xl transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                  Actualiser
                </button>
                <button onClick={handleExportExcel} disabled={exporting||!sessionAttendance.length} className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-200 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl transition-all shadow-sm">
                  {exporting?<div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"/>:<svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>}
                  {exporting?"Export…":`Excel (${sessionAttendance.length})`}
                </button>
              </div>
            </div>
            {loadingAttendance ? <div className="flex justify-center py-16"><div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"/></div>
            : !sessionAttendance.length ? <div className="p-12 text-center"><p className="text-slate-500 font-medium">Aucun étudiant scanné pour l'instant.</p><p className="text-slate-400 text-sm mt-1">Les scans apparaissent ici en temps réel.</p></div>
            : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="border-b border-slate-100 bg-slate-50">{["#","Selfie","Photo scan","Étudiant","Apogée","Programme","Heure"].map(h=><th key={h} className="text-left text-xs text-slate-500 font-semibold px-4 py-3">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {sessionAttendance.map((rec,i) => (
                      <tr key={rec.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-slate-400 text-sm">{i+1}</td>
                        <td className="px-4 py-3">
                          {rec.selfie_path ? <ImageZoomModal src={buildImageUrl(rec.selfie_path)} alt={rec.student_name||""} label={rec.student_name||""}><img src={buildImageUrl(rec.selfie_path)} alt="" className="w-10 h-10 rounded-xl object-cover border border-slate-200 cursor-zoom-in" onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/></ImageZoomModal>
                            : <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 text-xs font-bold border border-indigo-100">{(rec.student_name||"?")[0]}</div>}
                        </td>
                        <td className="px-4 py-3">
                          {rec.scan_face_path ? <ImageZoomModal src={buildImageUrl(rec.scan_face_path)} alt="Photo scan" label="Photo au scan"><div className="relative inline-block"><img src={buildImageUrl(rec.scan_face_path)} alt="" className="w-10 h-10 rounded-xl object-cover border-2 border-emerald-300 cursor-zoom-in" onError={e=>{(e.target as HTMLImageElement).style.display="none";}}/>  <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center"><svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg></div></div></ImageZoomModal>
                            : <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center border border-amber-200"><svg className="w-4 h-4 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/></svg></div>}
                        </td>
                        <td className="px-4 py-3 text-slate-900 text-sm font-semibold">{rec.student_name??"—"}</td>
                        <td className="px-4 py-3 text-slate-500 text-sm font-mono">{rec.apogee_code??"—"}</td>
                        <td className="px-4 py-3 text-slate-500 text-sm">{rec.cod_etp||rec.filiere||"—"}</td>
                        <td className="px-4 py-3 text-slate-500 text-sm whitespace-nowrap">{formatTimestamp(rec.scan_time)}</td>
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