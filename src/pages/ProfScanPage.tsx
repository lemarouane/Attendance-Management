import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  processQRScan,
  updateScanFacePath,
  AttendanceRecord,
  getSalleAttendance,
  getSalles,
  Salle,
  formatTimestamp,
} from "../services/attendanceService";
import { StudentProfile } from "../services/authService";
import { buildImageUrl, uploadScanFace } from "../services/apiService";
import ProfLayout from "../components/ProfLayout";
import ImageZoomModal from "../components/ImageZoomModal";
import DualZoneScanner from "../components/DualZoneScanner";
import ensaLogo from "../components/logo/logo-ENT2.png";

interface ScanEntry {
  student: StudentProfile;
  scanTime: string;
  success: boolean;
  message: string;
  scanFaceData?: string;
  scanFacePath?: string;
  hadFace: boolean;
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

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [salles, setSalles] = useState<Salle[]>([]);
  const [selectedSalle, setSelectedSalle] = useState<Salle | null>(null);
  const [loadingSalles, setLoadingSalles] = useState(true);
  const [scannerActive, setScannerActive] = useState(false);
  const [lastScan, setLastScan] = useState<ScanEntry | null>(null);
  const [sessionAttendance, setSessionAttendance] = useState<AttendanceRecord[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [activeTab, setActiveTab] = useState<"scanner" | "liste">("scanner");
  const [exporting, setExporting] = useState(false);
  const [scanAccess, setScanAccess] = useState<ScanAccess>("allowed");
  const [accessMessage, setAccessMessage] = useState("");
  const [uploadingFace, setUploadingFace] = useState(false);

  // ── Time validation ───────────────────────────────────────────────────────
  useEffect(() => {
    function checkTime() {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

      if (sessionDate && sessionDate !== todayStr) {
        const sessionD = new Date(sessionDate);
        const todayD = new Date(todayStr);
        if (sessionD < todayD) {
          setScanAccess("past_day");
          setAccessMessage("Séance passée — consultation uniquement");
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
          setAccessMessage("Séance terminée (scan toujours possible)");
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

  const canScan = scanAccess === "allowed" || scanAccess === "past";
  const isPastSession = scanAccess === "past" || scanAccess === "past_day";

  useEffect(() => {
    if (!preSelectedSalle && !seance) {
      toast.error("Accédez au scanner depuis votre emploi du temps.");
      navigate("/prof/timetable", { replace: true });
    }
  }, [preSelectedSalle, seance, navigate]);

  useEffect(() => {
    getSalles()
      .then(setSalles)
      .catch(() => toast.error("Impossible de charger les salles."))
      .finally(() => setLoadingSalles(false));
  }, []);

  useEffect(() => {
    if (preSelectedSalle && salles.length > 0 && !selectedSalle) {
      console.log("Looking for salle:", preSelectedSalle);
      console.log("Available salles:", salles.map(s => s.salle_name));

      let match = salles.find(
        (s) => s.salle_name.toLowerCase().trim() === preSelectedSalle.toLowerCase().trim()
      );

      if (!match) {
        const cleanName = preSelectedSalle.replace(/^salle\s+/i, "").trim();
        match = salles.find(
          (s) => s.salle_name.toLowerCase().trim() === cleanName.toLowerCase()
        );
      }

      if (!match) {
        match = salles.find(
          (s) => s.salle_name.toLowerCase().includes(preSelectedSalle.toLowerCase()) ||
                 preSelectedSalle.toLowerCase().includes(s.salle_name.toLowerCase())
        );
      }

      if (match) {
        console.log("Matched salle:", match);
        setSelectedSalle(match);
      } else {
        console.warn("No match found, creating virtual salle");
        const virtualSalle: Salle = {
          id: `virtual_${preSelectedSalle.replace(/\s+/g, "_").toLowerCase()}`,
          salle_name: preSelectedSalle,
          salle_type: "Cours"
        };
        setSelectedSalle(virtualSalle);
      }
    }
  }, [preSelectedSalle, salles, selectedSalle]);

  const fetchAttendance = useCallback(async (salleId: string) => {
    try {
      if (isPastSession) {
        const { getArchiveBySalle } = await import("../services/attendanceService");
        const records = await getArchiveBySalle(salleId);

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

    if (canScan) {
      pollRef.current = setInterval(() => fetchAttendance(selectedSalle.id), POLL_INTERVAL_MS);
    }

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selectedSalle, fetchAttendance, canScan]);

  const refreshNow = useCallback(() => {
    if (selectedSalle) fetchAttendance(selectedSalle.id);
  }, [selectedSalle, fetchAttendance]);

  // ════════════════════════════════════════════════════════════════════════════
  //  FIXED: handleScanWithFace — robust face upload + Firestore patching
  // ════════════════════════════════════════════════════════════════════════════
  const handleScanWithFace = useCallback(async (qrData: string, faceImageData: string) => {
    if (!selectedSalle) return;

    // ── Validate QR ─────────────────────────────────────────────────────────
    let parsedPayload: any = null;
    try {
      parsedPayload = JSON.parse(qrData);
    } catch {
      toast.error("QR code invalide.");
      return;
    }

    const { validateQRPayload } = await import("../utils/qrToken");
    if (!validateQRPayload(parsedPayload, 30)) {
      toast.error("QR code expiré. Demandez à l'étudiant de rafraîchir.");
      setLastScan({
        student: {} as StudentProfile,
        scanTime: new Date().toLocaleTimeString("fr-MA"),
        success: false,
        message: "QR code expiré.",
        hadFace: true,
      });
      return;
    }

    // ── Get student info for the upload folder name ─────────────────────────
    const { getStudentProfile } = await import("../services/authService");
    const studentPreview = await getStudentProfile(parsedPayload.uid);
    const apogeeForUpload = studentPreview?.apogee_code || "unknown";

    // ── Step 1: Upload face photo to disk BEFORE Firestore write ────────────
    let resolvedFacePath = "";
    const hasFaceData = !!(faceImageData && faceImageData.length > 200);

    console.log(`📸 [handleScanWithFace] hasFaceData=${hasFaceData}, dataLen=${faceImageData?.length || 0}, apogee=${apogeeForUpload}`);

    if (hasFaceData) {
      setUploadingFace(true);
      try {
        const uploadResult = await uploadScanFace(apogeeForUpload, faceImageData, {
          date:   sessionDate || new Date().toISOString().slice(0, 10),
          seance: seance      || undefined,
          salle:  selectedSalle.salle_name,
        });

        console.log(`📸 [handleScanWithFace] Upload result:`, uploadResult);

        if (uploadResult.success && uploadResult.path) {
          resolvedFacePath = uploadResult.path;
          console.log("✅ Face uploaded BEFORE Firestore write:", resolvedFacePath);
        } else {
          console.warn("⚠️ Face upload returned failure:", uploadResult.message);
        }
      } catch (err) {
        console.error("❌ Face upload threw error:", err);
      } finally {
        setUploadingFace(false);
      }
    } else {
      console.warn("⚠️ No valid face data to upload. faceImageData length:", faceImageData?.length || 0);
    }

    // ── Step 2: Write attendance to Firestore (with face path if available) ─
    console.log(`📝 [handleScanWithFace] Writing to Firestore with scan_face_path="${resolvedFacePath}"`);

    const result = await processQRScan(
      qrData,
      SESSION_ID,
      selectedSalle.id,
      selectedSalle.salle_name,
      resolvedFacePath  // pass the resolved path (may be "" if upload failed)
    );

    // ── Step 3: If face upload failed initially but we have data, retry ─────
    if (result.success && hasFaceData && !resolvedFacePath && result.liveDocId && result.archiveDocId) {
      console.log("🔄 Face upload failed before Firestore write — retrying now...");
      setUploadingFace(true);
      try {
        const retryResult = await uploadScanFace(apogeeForUpload, faceImageData, {
          date:   sessionDate || new Date().toISOString().slice(0, 10),
          seance: seance      || undefined,
          salle:  selectedSalle.salle_name,
        });

        if (retryResult.success && retryResult.path) {
          resolvedFacePath = retryResult.path;
          console.log("✅ Face uploaded on RETRY:", resolvedFacePath);

          // Patch Firestore documents with the face path
          await updateScanFacePath(result.liveDocId, result.archiveDocId, resolvedFacePath);
          console.log("✅ Firestore patched with scan_face_path after retry");
        } else {
          console.warn("⚠️ Retry also failed:", retryResult.message);
          toast("Photo de scan non sauvegardée — présence quand même enregistrée.", {
            icon: "⚠️", duration: 4000,
            style: { background: "#fef3c7", color: "#92400e" }
          });
        }
      } catch (err) {
        console.error("❌ Retry face upload threw error:", err);
        toast("Photo de scan non sauvegardée — présence quand même enregistrée.", {
          icon: "⚠️", duration: 4000,
          style: { background: "#fef3c7", color: "#92400e" }
        });
      } finally {
        setUploadingFace(false);
      }
    }

    // ── Step 4: Update UI ───────────────────────────────────────────────────
    setLastScan({
      student:      result.student ?? ({} as StudentProfile),
      scanTime:     new Date().toLocaleTimeString("fr-MA"),
      success:      result.success,
      message:      result.message,
      scanFaceData: faceImageData,
      scanFacePath: resolvedFacePath,
      hadFace:      true,
    });

    if (result.success && result.student) {
      toast.success(`✓ ${result.student.first_name} ${result.student.last_name} — Présent !`);
      if (resolvedFacePath) {
        console.log(`✅ COMPLETE: Attendance + face photo saved for ${result.student.first_name} → ${resolvedFacePath}`);
      } else {
        console.warn(`⚠️ Attendance saved but NO face photo for ${result.student.first_name}`);
      }
    } else {
      toast.error(result.message, { duration: 4000 });
    }

    refreshNow();
  }, [selectedSalle, refreshNow, sessionDate, seance]);

  const handleScanNoFace = useCallback(async (qrData: string) => {
    if (!selectedSalle) return;
    const result = await processQRScan(qrData, SESSION_ID, selectedSalle.id, selectedSalle.salle_name, "");
    setLastScan({
      student: result.student ?? ({} as StudentProfile),
      scanTime: new Date().toLocaleTimeString("fr-MA"),
      success: result.success,
      message: result.message,
      hadFace: false
    });
    if (result.success && result.student) {
      toast.success(`✓ ${result.student.first_name} ${result.student.last_name} — Présent !`, { icon: "⚠️" });
      toast("Aucun visage détecté — vérification manuelle requise.", {
        icon: "👤",
        duration: 5000,
        style: { background: "#fef3c7", color: "#92400e" }
      });
    } else {
      toast.error(result.message, { duration: 4000 });
    }
    refreshNow();
  }, [selectedSalle, refreshNow]);

  function getImageUrl(path: string): string {
    return path ? buildImageUrl(path) : "";
  }

async function handleExportPDF() {
  if (sessionAttendance.length === 0) {
    toast.error("Aucune donnée à exporter.");
    return;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  async function loadImageAsBase64(src: string): Promise<string | null> {
    try {
      const res = await fetch(src);
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () =>
          resolve((reader.result as string).split(",")[1] ?? null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  setExporting(true);
  const toastId = toast.loading("Génération du PV PDF…");

  try {
    // ── Load jsPDF ────────────────────────────────────────────────────────
    await new Promise<void>((resolve, reject) => {
      if ((window as any).jspdf) { resolve(); return; }
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("jsPDF failed"));
      document.head.appendChild(s);
    });

    await new Promise<void>((resolve, reject) => {
      if ((window as any).jsPDFAutoTable) { resolve(); return; }
      const s = document.createElement("script");
      s.src =
        "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("AutoTable failed"));
      document.head.appendChild(s);
    });

    const { jsPDF } = (window as any).jspdf;
    const doc = new jsPDF("portrait", "pt", "a4");

    const pageW   = doc.internal.pageSize.getWidth();   // 595.28 pt
    const pageH   = doc.internal.pageSize.getHeight();  // 841.89 pt
    const margin  = 36;
    const contentW = pageW - margin * 2;                // 523.28 pt

    // ── ENSA Tanger brand palette ─────────────────────────────────────────
const C = {
  // ── Primary — soft powder blue, never electric ────────────────────────
  navy:        [100, 130, 200] as [number, number, number],  // soft cornflower blue
  navyDark:    [80,  108, 175] as [number, number, number],  // slightly deeper, still light
  navyText:    [75,  105, 170] as [number, number, number],  // coloured text on white bg

  // ── Neutrals — warm not cold ──────────────────────────────────────────
  charcoal:    [60,  65,  75 ] as [number, number, number],  // warm dark grey, not black
  slate500:    [130, 142, 158] as [number, number, number],  // medium grey labels
  slate300:    [215, 220, 230] as [number, number, number],  // hairline borders
  slate100:    [246, 247, 250] as [number, number, number],  // near-white surface

  // ── ENSA tints — airy, washed out, very light ─────────────────────────
  skyBlue:     [195, 218, 240] as [number, number, number],  // very pale sky
  lavender:    [228, 235, 250] as [number, number, number],  // barely-there periwinkle
  lilac:       [244, 242, 252] as [number, number, number],  // whisper violet
  headerAccent:[210, 225, 248] as [number, number, number],  // subtitle / dividers on dark bg

  // ── Whites ────────────────────────────────────────────────────────────
  white:       [255, 255, 255] as [number, number, number],
  offWhite:    [251, 252, 255] as [number, number, number],  // alt-row bg

  // ── Status — pastel, not neon ─────────────────────────────────────────
  emerald:     [80,  185, 145] as [number, number, number],  // minty green
  emeraldLight:[220, 245, 235] as [number, number, number],  // badge bg
  amber:       [220, 165,  60] as [number, number, number],  // warm honey
  amberLight:  [253, 245, 218] as [number, number, number],  // placeholder bg
};

    // ── Load local logo ───────────────────────────────────────────────────
    const logoBase64 = await loadImageAsBase64(ensaLogo);

    // ════════════════════════════════════════════════════════════════════
    //  HEADER  (height = 80 pt)
    // ════════════════════════════════════════════════════════════════════
    const HDR_H = 80;

    // Navy background
    doc.setFillColor(...C.navy);
    doc.rect(0, 0, pageW, HDR_H, "F");

    // Subtle right-side geometric accent
    doc.setFillColor(...C.navyDark);
    doc.rect(pageW - 120, 0, 120, HDR_H, "F");
    doc.setFillColor(0, 46, 254); // reset
    doc.setDrawColor(...C.skyBlue);
    doc.setLineWidth(0.6);
    doc.circle(pageW - 18, -10, 60, "S");
    doc.circle(pageW + 10, 60,  40, "S");

    // Logo — left-aligned, vertically centred
    const LOGO_W = 88;
    const LOGO_H = 44;
    const logoX  = margin;
    const logoY  = (HDR_H - LOGO_H) / 2;

    if (logoBase64) {
      try {
        doc.addImage(
          `data:image/png;base64,${logoBase64}`,
          "PNG", logoX, logoY, LOGO_W, LOGO_H,
          undefined, "FAST"
        );
      } catch (e) { console.warn("Logo render failed", e); }
    }

    // Thin vertical divider between logo and text
    doc.setDrawColor(...C.skyBlue);
    doc.setLineWidth(0.8);
    doc.line(logoX + LOGO_W + 12, 16, logoX + LOGO_W + 12, HDR_H - 16);

    // Title text block
    const txtX = logoX + LOGO_W + 22;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(19);
    doc.setTextColor(...C.white);
    doc.text("PV PRÉSENCES", txtX, 38);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...C.skyBlue);
    doc.text(
      `Généré le ${new Date().toLocaleDateString("fr-FR", {
        day: "2-digit", month: "long", year: "numeric",
      })} à ${new Date().toLocaleTimeString("fr-FR", {
        hour: "2-digit", minute: "2-digit",
      })}`,
      txtX, 54
    );

    // ════════════════════════════════════════════════════════════════════
    //  INFO CARDS  (4 columns below header)
    // ════════════════════════════════════════════════════════════════════
    const CARD_Y   = HDR_H + 14;
    const CARD_H   = 56;
    const CARD_GAP = 8;
    const CARD_W   = (contentW - CARD_GAP * 3) / 4;

    const cards = [
      { label: "Matière",         value: matiere || "—" },
      { label: "Salle",           value: selectedSalle?.salle_name || "—" },
      {
        label: "Horaire",
        value: sessionStartTime && sessionEndTime
          ? `${sessionStartTime} – ${sessionEndTime}`
          : "—",
      },
      {
        label: "Date de séance",
        value: sessionDate
          ? new Date(sessionDate + "T00:00:00").toLocaleDateString("fr-FR", {
              day: "numeric", month: "long", year: "numeric",
            })
          : "—",
      },
    ];

    cards.forEach((card, i) => {
      const cx = margin + i * (CARD_W + CARD_GAP);

      // Card background
      doc.setFillColor(...C.lilac);
      doc.setDrawColor(...C.lavender);
      doc.setLineWidth(0.5);
      doc.roundedRect(cx, CARD_Y, CARD_W, CARD_H, 5, 5, "FD");

      // Navy left accent bar
      doc.setFillColor(...C.navy);
      doc.roundedRect(cx, CARD_Y, 3, CARD_H, 1.5, 1.5, "F");

      // Label
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.setTextColor(...C.slate500);
      doc.text(card.label.toUpperCase(), cx + 10, CARD_Y + 15);

      // Value
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...C.charcoal);
      const lines = doc.splitTextToSize(card.value, CARD_W - 16) as string[];
      doc.text(lines.slice(0, 2), cx + 10, CARD_Y + 30);
    });

    // ════════════════════════════════════════════════════════════════════
    //  STATS BAR
    // ════════════════════════════════════════════════════════════════════
    const STATS_Y = CARD_Y + CARD_H + 10;
    const STATS_H = 36;

    doc.setFillColor(...C.navy);
    doc.roundedRect(margin, STATS_Y, contentW, STATS_H, 7, 7, "F");

    const withPhoto    = sessionAttendance.filter(r => r.scan_face_path).length;
    const withoutPhoto = sessionAttendance.length - withPhoto;

    const stats = [
      { label: "Total présents",     value: String(sessionAttendance.length) },
      { label: "Avec photo de scan", value: String(withPhoto)                },
      { label: "Sans photo",         value: String(withoutPhoto)             },
      { label: "Séance",             value: seance ? `#${seance}` : "—"     },
    ];

    const STAT_W = contentW / stats.length;
    stats.forEach((s, i) => {
      const sx = margin + i * STAT_W + STAT_W / 2;

      // Divider
      if (i < stats.length - 1) {
        doc.setDrawColor(...C.skyBlue);
        doc.setLineWidth(0.5);
        doc.line(
          margin + (i + 1) * STAT_W, STATS_Y + 8,
          margin + (i + 1) * STAT_W, STATS_Y + STATS_H - 8
        );
      }

      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(...C.white);
      doc.text(s.value, sx, STATS_Y + 20, { align: "center" });

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(...C.skyBlue);
      doc.text(s.label.toUpperCase(), sx, STATS_Y + 30, { align: "center" });
    });

    // ════════════════════════════════════════════════════════════════════
    //  SECTION TITLE
    // ════════════════════════════════════════════════════════════════════
    const SEC_Y = STATS_Y + STATS_H + 14;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...C.charcoal);
    doc.text("LISTE DES ÉTUDIANTS PRÉSENTS", margin, SEC_Y);

    doc.setDrawColor(...C.navy);
    doc.setLineWidth(2);
    doc.line(margin, SEC_Y + 4, margin + 170, SEC_Y + 4);

    doc.setDrawColor(...C.slate300);
    doc.setLineWidth(0.5);
    doc.line(margin + 172, SEC_Y + 4, margin + contentW, SEC_Y + 4);

    // ════════════════════════════════════════════════════════════════════
    //  FETCH STUDENT IMAGES
    // ════════════════════════════════════════════════════════════════════
    toast.loading(`Chargement des photos (${sessionAttendance.length})…`, { id: toastId });

    const selfieImages:   (string | null)[] = new Array(sessionAttendance.length).fill(null);
    const scanFaceImages: (string | null)[] = new Array(sessionAttendance.length).fill(null);

    for (let i = 0; i < sessionAttendance.length; i += 5) {
      const batch = sessionAttendance.slice(i, i + 5);
      const [selfieRes, scanRes] = await Promise.all([
        Promise.all(batch.map(r =>
          r.selfie_path
            ? loadImageAsBase64(getImageUrl(r.selfie_path))
            : Promise.resolve(null)
        )),
        Promise.all(batch.map(r =>
          r.scan_face_path
            ? loadImageAsBase64(getImageUrl(r.scan_face_path))
            : Promise.resolve(null)
        )),
      ]);
      selfieRes.forEach((v, j) => { selfieImages[i + j]   = v; });
      scanRes.forEach((v, j)   => { scanFaceImages[i + j] = v; });
    }

    // ════════════════════════════════════════════════════════════════════
    //  TABLE
    //  Columns: # | Photo Inscription | Photo Scan | Nom & Prénom | Apogée | Filière | Heure
    //  Total inner width = contentW = 523.28 pt
    //  Col widths must sum to exactly contentW
    // ════════════════════════════════════════════════════════════════════
    const IMG_SIZE = 30; // image square in pt
    const ROW_H    = IMG_SIZE + 12;

    //  Fixed widths (pt)
    const COL = {
      num:     26,
      selfie:  44,
      scan:    44,
      name:   145,
      apogee:  66,
      prog:    88,
      heure:   // fill remaining space
        contentW - (26 + 44 + 44 + 145 + 66 + 88), // = 110.28 → ~110
    };

    (doc as any).autoTable({
      startY: SEC_Y + 14,
      margin: { left: margin, right: margin },
      tableWidth: contentW,

      head: [[
        { content: "#",                  styles: { halign: "center" as const } },
        { content: "Photo\nInscription", styles: { halign: "center" as const } },
        { content: "Photo\nScan",        styles: { halign: "center" as const } },
        { content: "Nom & Prénom",       styles: { halign: "left"   as const } },
        { content: "N° Apogée",          styles: { halign: "center" as const } },
        { content: "Filière",            styles: { halign: "left"   as const } },
        { content: "Heure de scan",      styles: { halign: "center" as const } },
      ]],

      body: sessionAttendance.map((rec, i) => [
        i + 1,
        "",   // drawn in didDrawCell
        "",   // drawn in didDrawCell
        rec.student_name || "—",
        rec.apogee_code  || "—",
        rec.cod_etp || rec.filiere || "—",
        formatTimestamp(rec.scan_time),
      ]),

      theme: "grid",

      styles: {
        fontSize:       8,
        cellPadding:    { top: 4, right: 5, bottom: 4, left: 5 },
        textColor:      C.charcoal,
        lineColor:      C.lavender,
        lineWidth:      0.5,
        minCellHeight:  ROW_H,
        valign:         "middle" as const,
        overflow:       "linebreak" as const,
      },

      headStyles: {
        fillColor:   C.navy,
        textColor:   C.white,
        fontStyle:   "bold"   as const,
        fontSize:    7.5,
        cellPadding: { top: 6, right: 5, bottom: 6, left: 5 },
        halign:      "center" as const,
        lineWidth:   0,
        minCellHeight: 28,
      },

      alternateRowStyles: {
        fillColor: C.lilac,
      },

      columnStyles: {
        0: { cellWidth: COL.num,    halign: "center" as const, fontStyle: "bold" as const, textColor: C.slate500, fontSize: 8 },
        1: { cellWidth: COL.selfie, halign: "center" as const },
        2: { cellWidth: COL.scan,   halign: "center" as const },
        3: { cellWidth: COL.name,   halign: "left"   as const, fontStyle: "bold" as const, textColor: C.charcoal },
        4: { cellWidth: COL.apogee, halign: "center" as const, fontSize: 7.5 },
        5: { cellWidth: COL.prog,   halign: "left"   as const, fontSize: 7.5 },
        6: { cellWidth: COL.heure,  halign: "center" as const, fontSize: 7.5 },
      },

      // ── Draw images & badges inside cells ──────────────────────────
      didDrawCell: (data: any) => {
        const ri = data.row.index;
        if (ri < 0 || data.section !== "body") return;

        const cx   = data.cell.x;
        const cy   = data.cell.y;
        const cw   = data.cell.width;
        const ch   = data.cell.height;
        const imgX = cx + (cw - IMG_SIZE) / 2;   // horizontally centred
        const imgY = cy + (ch - IMG_SIZE) / 2;   // vertically centred

        // ── Col 1 — Profile photo ──────────────────────────────────
        if (data.column.index === 1) {
          const b64 = selfieImages[ri];
          if (b64) {
            try {
              doc.addImage(
                `data:image/jpeg;base64,${b64}`, "JPEG",
                imgX, imgY, IMG_SIZE, IMG_SIZE, undefined, "FAST"
              );
              doc.setDrawColor(...C.navy);
              doc.setLineWidth(1.2);
              doc.roundedRect(imgX, imgY, IMG_SIZE, IMG_SIZE, 3, 3, "S");
            } catch { /* skip */ }
          } else {
            // initials avatar
            doc.setFillColor(...C.lavender);
            doc.setDrawColor(...C.navy);
            doc.setLineWidth(0.8);
            doc.roundedRect(imgX, imgY, IMG_SIZE, IMG_SIZE, 3, 3, "FD");
            const initials = (sessionAttendance[ri]?.student_name || "?")
              .split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
            doc.setFont("helvetica", "bold");
            doc.setFontSize(11);
            doc.setTextColor(...C.navy);
            doc.text(
              initials,
              imgX + IMG_SIZE / 2,
              imgY + IMG_SIZE / 2 + 4,
              { align: "center" }
            );
          }
        }

        // ── Col 2 — Scan face photo ────────────────────────────────
        if (data.column.index === 2) {
          const b64 = scanFaceImages[ri];
          if (b64) {
            try {
              doc.addImage(
                `data:image/jpeg;base64,${b64}`, "JPEG",
                imgX, imgY, IMG_SIZE, IMG_SIZE, undefined, "FAST"
              );
              doc.setDrawColor(...C.emerald);
              doc.setLineWidth(1.2);
              doc.roundedRect(imgX, imgY, IMG_SIZE, IMG_SIZE, 3, 3, "S");

              // ✓ corner badge
              const bx = imgX + IMG_SIZE - 2;
              const by = imgY + IMG_SIZE - 2;
              doc.setFillColor(...C.emerald);
              doc.circle(bx, by, 5, "F");
              doc.setFont("helvetica", "bold");
              doc.setFontSize(5.5);
              doc.setTextColor(...C.white);
              doc.text("✓", bx, by + 2, { align: "center" });
            } catch { /* skip */ }
          } else {
            // no photo placeholder
            doc.setFillColor(...C.amberLight);
            doc.setDrawColor(...C.amber);
            doc.setLineWidth(0.8);
            doc.roundedRect(imgX, imgY, IMG_SIZE, IMG_SIZE, 3, 3, "FD");
            doc.setFont("helvetica", "bold");
            doc.setFontSize(13);
            doc.setTextColor(...C.amber);
            doc.text("?", imgX + IMG_SIZE / 2, imgY + IMG_SIZE / 2 + 5, { align: "center" });
          }
        }
      },

      // ── Compact header on continuation pages ──────────────────────
      didDrawPage: (_data: any) => {
        const pageNum: number = (doc as any).internal.getCurrentPageInfo().pageNumber;
        if (pageNum === 1) return;

        const CH = 28;
        doc.setFillColor(...C.navy);
        doc.rect(0, 0, pageW, CH, "F");

        // mini logo
        if (logoBase64) {
          try {
            doc.addImage(
              `data:image/png;base64,${logoBase64}`, "PNG",
              margin, 3, 50, 22, undefined, "FAST"
            );
          } catch { /* skip */ }
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(...C.white);
        doc.text("PV PRÉSENCES (suite)", margin + 56, 18);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(...C.skyBlue);
        doc.text(
          `${matiere || ""} · ${selectedSalle?.salle_name || ""} · ${
            sessionDate
              ? new Date(sessionDate + "T00:00:00").toLocaleDateString("fr-FR", {
                  day: "numeric", month: "long", year: "numeric",
                })
              : ""
          }`,
          pageW - margin, 18, { align: "right" }
        );
      },
    });

    // ════════════════════════════════════════════════════════════════════
    //  FOOTER — every page
    // ════════════════════════════════════════════════════════════════════
    const totalPages: number = (doc as any).internal.getNumberOfPages();

    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);

      const FY = pageH - 26;

      doc.setDrawColor(...C.lavender);
      doc.setLineWidth(0.6);
      doc.line(margin, FY, pageW - margin, FY);

      // Left — document identity
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...C.slate500);
      doc.text(
        `PV Présences · ${matiere || "—"} · ${selectedSalle?.salle_name || "—"} · ${
          sessionDate
            ? new Date(sessionDate + "T00:00:00").toLocaleDateString("fr-FR")
            : new Date().toLocaleDateString("fr-FR")
        }`,
        margin, FY + 11
      );

      // Centre — confidentiality
      doc.setFont("helvetica", "italic");
      doc.setFontSize(6.5);
      doc.setTextColor(...C.slate500);
      doc.text("Document officiel — usage interne", pageW / 2, FY + 11, { align: "center" });

      // Right — page number
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...C.navy);
      doc.text(`Page ${p} / ${totalPages}`, pageW - margin, FY + 11, { align: "right" });

      // Navy bottom bar
      doc.setFillColor(...C.navy);
      doc.rect(0, pageH - 5, pageW, 5, "F");
    }

    // ════════════════════════════════════════════════════════════════════
    //  SAVE
    // ════════════════════════════════════════════════════════════════════
    const fileName = [
      "PV",
      (matiere || "matiere").replace(/\s+/g, "-").toUpperCase(),
      (selectedSalle?.salle_name || "salle").replace(/\s+/g, "-"),
      sessionDate || new Date().toISOString().slice(0, 10),
    ].join("_") + ".pdf";

    doc.save(fileName);

    toast.success(
      `✓ PV exporté — ${sessionAttendance.length} étudiant${sessionAttendance.length !== 1 ? "s" : ""}`,
      { id: toastId, duration: 4000 }
    );

  } catch (err) {
    console.error(err);
    toast.error("Erreur lors de la génération du PDF.", { id: toastId });
  } finally {
    setExporting(false);
  }
}

  if (loadingSalles) {
    return (
      <ProfLayout title="Scanner QR" subtitle="Chargement…">
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </ProfLayout>
    );
  }

  if (!selectedSalle) {
    return (
      <ProfLayout title="Scanner QR" subtitle="Erreur">
        <div className="max-w-2xl mx-auto py-20">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-red-900 mb-2">Salle introuvable</h3>
            <p className="text-red-700 text-sm mb-4">
              La salle "{preSelectedSalle}" n'a pas pu être trouvée dans le système.
            </p>
            <button
              onClick={() => navigate("/prof/timetable")}
              className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-colors"
            >
              ← Retour à l'emploi du temps
            </button>
          </div>
        </div>
      </ProfLayout>
    );
  }

  const statusBanner = (() => {
    switch (scanAccess) {
      case "past_day":
      case "past":
        return {
          bg: "bg-slate-50 border-slate-200",
          icon: "text-slate-400",
          text: "text-slate-600",
          iconPath: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
        };
      case "future_day":
        return {
          bg: "bg-blue-50 border-blue-200",
          icon: "text-blue-400",
          text: "text-blue-600",
          iconPath: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
        };
      case "early":
        return {
          bg: "bg-amber-50 border-amber-200",
          icon: "text-amber-500",
          text: "text-amber-700",
          iconPath: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
        };
      default:
        return null;
    }
  })();

  const showScannerTab = canScan;

  return (
    <ProfLayout
      title={matiere ? `${isPastSession ? "Consulter" : "Scanner"} — ${matiere}` : "Scanner QR"}
      subtitle={`Salle: ${selectedSalle.salle_name}`}
    >
      <div className="w-full px-4 space-y-5 fade-in">
        {(matiere || seance) && (
          <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-teal-800">
                {matiere} — {selectedSalle.salle_name}
              </p>
              <p className="text-xs text-teal-600">
                {sessionDate &&
                  new Date(sessionDate).toLocaleDateString("fr-FR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                {sessionStartTime && ` · ${sessionStartTime} - ${sessionEndTime}`}
                {seance && ` · Séance #${seance}`}
              </p>
            </div>
            <button
              onClick={() => navigate("/prof/timetable")}
              className="px-3 py-1.5 bg-teal-100 hover:bg-teal-200 text-teal-700 text-xs font-semibold rounded-lg transition-colors"
            >
              ← EDT
            </button>
          </div>
        )}

        {statusBanner && (
          <div className={`${statusBanner.bg} border rounded-xl p-4 flex items-center gap-3`}>
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isPastSession ? "bg-slate-100" : scanAccess === "early" ? "bg-amber-100" : "bg-blue-100"
              }`}
            >
              <svg className={`w-5 h-5 ${statusBanner.icon}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={statusBanner.iconPath} />
              </svg>
            </div>
            <div className="flex-1">
              <p className={`text-sm font-semibold ${statusBanner.text}`}>{accessMessage}</p>
              {isPastSession && sessionAttendance.length > 0 && (
                <p className="text-xs text-slate-500 mt-0.5">
                  {sessionAttendance.length} étudiant{sessionAttendance.length !== 1 ? "s" : ""} présent
                  {sessionAttendance.length !== 1 ? "s" : ""} enregistré{sessionAttendance.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>
        )}

        <div className={`grid ${showScannerTab ? "grid-cols-3" : "grid-cols-2"} gap-4`}>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 text-center">
            <div className="text-3xl font-black text-emerald-500">
              {loadingAttendance ? "…" : sessionAttendance.length}
            </div>
            <div className="text-slate-600 text-xs font-semibold mt-1">Présents</div>
          </div>
          {showScannerTab && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 text-center">
              <div
                className={`text-3xl font-black ${
                  lastScan?.success ? "text-emerald-500" : lastScan ? "text-red-500" : "text-slate-300"
                }`}
              >
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

        {showScannerTab ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-1.5 flex gap-1 shadow-sm">
            <button
              onClick={() => setActiveTab("scanner")}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                activeTab === "scanner"
                  ? "bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-md"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              📷 Scanner
            </button>
            <button
              onClick={() => setActiveTab("liste")}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                activeTab === "liste"
                  ? "bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-md"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              📋 PV ({sessionAttendance.length})
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 p-1.5 shadow-sm">
            <div className="py-2.5 rounded-xl text-sm font-semibold text-center bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-md">
              📋 PV de présences ({sessionAttendance.length})
            </div>
          </div>
        )}

        {showScannerTab && activeTab === "scanner" && (
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            <div className="xl:col-span-3">
              <DualZoneScanner
                active={scannerActive}
                onStart={() => setScannerActive(true)}
                onStop={() => setScannerActive(false)}
                onScanWithFace={handleScanWithFace}
                onScanNoFace={handleScanNoFace}
                salleeName={selectedSalle.salle_name}
              />
            </div>

            <div className="xl:col-span-2 card overflow-hidden flex flex-col">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-900">Dernier scan</h3>
                  <p className="text-slate-500 text-sm mt-0.5">Résultat de la dernière vérification</p>
                </div>
                {uploadingFace && (
                  <div className="flex items-center gap-1.5 text-xs text-indigo-500">
                    <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    Upload…
                  </div>
                )}
              </div>

              {!lastScan ? (
                <div className="flex-1 p-10 flex flex-col items-center justify-center gap-3 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center">
                    <svg className="w-7 h-7 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                      />
                    </svg>
                  </div>
                  <p className="text-slate-500 font-medium">En attente du premier scan…</p>
                  <p className="text-slate-400 text-sm">Visage à gauche · QR à droite</p>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  <div
                    className={`rounded-xl p-3 flex items-center gap-3 ${
                      lastScan.success ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        lastScan.success ? "bg-emerald-100" : "bg-red-100"
                      }`}
                    >
                      {lastScan.success ? (
                        <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      )}
                    </div>
                    <p className={`text-sm font-semibold ${lastScan.success ? "text-emerald-700" : "text-red-700"}`}>
                      {lastScan.message}
                    </p>
                  </div>

                  {lastScan.success && !lastScan.hadFace && (
                    <div className="rounded-xl p-3 bg-amber-50 border border-amber-200 flex items-center gap-2">
                      <svg
                        className="w-4 h-4 text-amber-500 flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                      <p className="text-amber-700 text-xs font-medium">
                        Aucun visage détecté — vérification manuelle recommandée
                      </p>
                    </div>
                  )}

                  {lastScan.student?.uid && (
                    <>
                      <div className="flex gap-3">
                        <div className="flex flex-col items-center gap-1 flex-1">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Inscription</p>
                          {lastScan.student.selfie_path || lastScan.student.photo_url ? (
                            <ImageZoomModal
                              src={getImageUrl(lastScan.student.selfie_path || lastScan.student.photo_url || "")}
                              alt={lastScan.student.first_name}
                              label="Photo inscription"
                            >
                              <img
                                src={getImageUrl(lastScan.student.selfie_path || lastScan.student.photo_url || "")}
                                alt=""
                                className={`w-20 h-20 rounded-2xl object-cover border-4 cursor-zoom-in ${
                                  lastScan.success ? "border-emerald-300" : "border-red-300"
                                }`}
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            </ImageZoomModal>
                          ) : (
                            <div
                              className={`w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold border-4 ${
                                lastScan.success
                                  ? "bg-emerald-50 border-emerald-300 text-emerald-600"
                                  : "bg-red-50 border-red-300 text-red-600"
                              }`}
                            >
                              {lastScan.student.first_name?.[0]}
                              {lastScan.student.last_name?.[0]}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-col items-center gap-1 flex-1">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1">
                            Au scan{" "}
                            {uploadingFace && (
                              <span className="w-2.5 h-2.5 border border-indigo-400 border-t-transparent rounded-full animate-spin inline-block" />
                            )}
                          </p>
                          {lastScan.scanFaceData ? (
                            <div className="relative">
                              <img
                                src={lastScan.scanFaceData}
                                alt="Scan face"
                                className="w-20 h-20 rounded-2xl object-cover border-4 border-indigo-300"
                              />
                              {lastScan.scanFacePath && (
                                <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center">
                                  <svg
                                    className="w-3 h-3 text-white"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={3}
                                      d="M5 13l4 4L19 7"
                                    />
                                  </svg>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="w-20 h-20 rounded-2xl bg-amber-50 border-4 border-amber-200 flex flex-col items-center justify-center gap-1">
                              <svg
                                className="w-7 h-7 text-amber-300"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={1.5}
                                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                                />
                              </svg>
                              <span className="text-amber-400 text-[9px] font-bold px-1">Non capturé</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        {[
                          { label: "Nom", value: `${lastScan.student.first_name} ${lastScan.student.last_name}` },
                          { label: "Apogée", value: lastScan.student.apogee_code },
                          { label: "CIN", value: lastScan.student.cin },
                          { label: "Filière", value: lastScan.student.filiere },
                          { label: "Salle", value: selectedSalle.salle_name },
                          { label: "Heure", value: lastScan.scanTime },
                        ].map(({ label, value }) => (
                          <div
                            key={label}
                            className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0"
                          >
                            <span className="text-slate-500 text-sm">{label}</span>
                            <span className="text-slate-900 text-sm font-semibold">{value || "—"}</span>
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

        {(activeTab === "liste" || !showScannerTab) && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
              <div>
                <h3 className="font-bold text-slate-900">
                  {isPastSession ? "Historique" : "PV"} — {selectedSalle.salle_name}
                </h3>
                <p className="text-slate-500 text-sm">
                  {loadingAttendance
                    ? "Chargement…"
                    : `${sessionAttendance.length} présent${sessionAttendance.length !== 1 ? "s" : ""}`}
                  {isPastSession && sessionDate && (
                    <span className="ml-1">
                      · {new Date(sessionDate).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchAttendance(selectedSalle.id)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold rounded-xl transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Actualiser
                </button>
                <button
                  onClick={handleExportPDF}
                  disabled={exporting || sessionAttendance.length === 0}
                  className="flex items-center gap-1.5 px-3 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-teal-200 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-xl transition-all shadow-sm"
                >
                  {exporting ? (
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
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
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                    />
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
                      {["#", "Photo Profil", "Photo Scan", "Étudiant", "Apogée", "Filière", "Heure"].map((h) => (
                        <th key={h} className="text-left text-xs text-slate-500 font-semibold px-5 py-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sessionAttendance.map((rec, i) => (
                      <tr key={rec.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3 text-slate-400 text-sm">{i + 1}</td>
                        <td className="px-5 py-3">
                          {rec.selfie_path ? (
                            <ImageZoomModal
                              src={buildImageUrl(rec.selfie_path)}
                              alt={rec.student_name || ""}
                              label="Photo profil"
                            >
                              <img
                                src={buildImageUrl(rec.selfie_path)}
                                alt=""
                                className="w-10 h-10 rounded-xl object-cover border border-slate-200 cursor-zoom-in hover:brightness-90 transition-all"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            </ImageZoomModal>
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center text-teal-600 text-xs font-bold border border-teal-100">
                              {(rec.student_name || "?")[0]}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {rec.scan_face_path ? (
                            <ImageZoomModal
                              src={buildImageUrl(rec.scan_face_path)}
                              alt="Photo scan"
                              label="Photo au scan"
                            >
                              <div className="relative inline-block">
                                <img
                                  src={buildImageUrl(rec.scan_face_path)}
                                  alt=""
                                  className="w-10 h-10 rounded-xl object-cover border-2 border-emerald-300 cursor-zoom-in hover:brightness-90 transition-all"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                  }}
                                />
                                <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
                                  <svg
                                    className="w-2.5 h-2.5 text-white"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                  >
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={3}
                                      d="M5 13l4 4L19 7"
                                    />
                                  </svg>
                                </div>
                              </div>
                            </ImageZoomModal>
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center border border-amber-200">
                              <svg
                                className="w-4 h-4 text-amber-300"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                                />
                              </svg>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-slate-900 text-sm font-semibold">{rec.student_name ?? "—"}</td>
                        <td className="px-5 py-3 text-slate-500 text-sm font-mono">{rec.apogee_code ?? "—"}</td>
                        <td className="px-5 py-3 text-slate-500 text-sm">{rec.cod_etp || rec.filiere || "—"}</td>
                        <td className="px-5 py-3 text-slate-500 text-sm whitespace-nowrap">
                          {formatTimestamp(rec.scan_time)}
                        </td>
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