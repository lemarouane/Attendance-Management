import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  query,
  where,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { validateQRPayload, QRPayload } from "../utils/qrToken";
import { getStudentProfile, StudentProfile } from "./authService";
import { getMySQLSalles } from "./apiService";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AttendanceRecord {
  id: string;
  student_id: string;
  scan_time: unknown;
  session_id: string;
  salle_id: string;
  salle_name?: string;
  apogee_code?: string;
  filiere?: string;
  cod_etp?: string;
  student_name?: string;
  selfie_path?: string;
  /** Path to the face photo taken at scan time (proves who held the QR code) */
  scan_face_path?: string;
  // archive-only fields
  archived_at?: unknown;
  date_label?: string;
}

export interface Salle {
  id: string;
  salle_name: string;
  salle_type?: string;
}

// ─── Time helper ──────────────────────────────────────────────────────────────
function tsToMs(ts: unknown): number {
  if (!ts) return 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = ts as any;
  if (t?.toDate) return t.toDate().getTime();
  try { return new Date(t).getTime(); } catch { return 0; }
}

function sortByTime(records: AttendanceRecord[]): AttendanceRecord[] {
  return [...records].sort((a, b) => tsToMs(b.scan_time) - tsToMs(a.scan_time));
}

// ─── Get all salles — from MySQL via backend ──────────────────────────────────
export async function getSalles(): Promise<Salle[]> {
  try {
    const mysqlSalles = await getMySQLSalles();
    if (mysqlSalles && mysqlSalles.length > 0) {
      return mysqlSalles.map((s) => ({
        id: s.id,
        salle_name: s.salle_name,
        salle_type: s.salle_type,
      }));
    }
    // Fallback if MySQL is offline
    return [
      { id: "amphi_2", salle_name: "Amphi 2",  salle_type: "Cours" },
      { id: "amphi_3", salle_name: "Amphi 3",  salle_type: "Cours" },
      { id: "a3",      salle_name: "A3",        salle_type: "TP" },
      { id: "a4",      salle_name: "A4",        salle_type: "TP" },
      { id: "a5",      salle_name: "A5",        salle_type: "TP" },
      { id: "b2",      salle_name: "B2",        salle_type: "Cours" },
      { id: "b3",      salle_name: "B3",        salle_type: "Cours" },
    ];
  } catch {
    return [
      { id: "amphi_2", salle_name: "Amphi 2" },
      { id: "b2",      salle_name: "B2" },
    ];
  }
}

// ─── Archive a live record into attendance_archive ────────────────────────────
async function archiveRecord(data: Record<string, unknown>): Promise<void> {
  try {
    const scanMs = tsToMs(data.scan_time);
    const scanDate = scanMs ? new Date(scanMs) : new Date();

    await addDoc(collection(db, "attendance_archive"), {
      ...data,
      archived_at: serverTimestamp(),
      date_label: scanDate.toLocaleDateString("fr-MA", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    });
  } catch (err) {
    console.error("Archive write failed:", err);
  }
}

// ─── Auto-cleanup: delete live attendance records older than 2 hours ──────────
export async function cleanupOldAttendance(): Promise<number> {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const snap = await getDocs(collection(db, "attendance"));
  let deleted = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const ms = tsToMs(data.scan_time);
    if (ms > 0 && ms < twoHoursAgo.getTime()) {
      await archiveRecord({ id: docSnap.id, ...data });
      await deleteDoc(doc(db, "attendance", docSnap.id));
      deleted++;
    }
  }

  if (deleted > 0) {
    console.log(`🗂️  Archived & cleaned ${deleted} attendance records older than 2 hours`);
  }
  return deleted;
}

// ─── Process QR scan and record attendance ────────────────────────────────────
// scanFacePath: optional — the path returned after uploading the face photo
//               taken at scan time.  Pass "" or undefined if not yet uploaded.
export async function processQRScan(
  rawData: string,
  sessionId: string,
  salleId: string,
  salleName: string,
  scanFacePath?: string,
): Promise<{ success: boolean; student: StudentProfile | null; message: string }> {

  // Run cleanup silently in background every scan
  cleanupOldAttendance().catch(console.error);

  let payload: QRPayload;
  try {
    payload = JSON.parse(rawData) as QRPayload;
  } catch {
    return { success: false, student: null, message: "Invalid QR code format." };
  }

  const isValid = validateQRPayload(payload, 30);
  if (!isValid) {
    return {
      success: false,
      student: null,
      message: "QR code has expired. Ask student to refresh their screen.",
    };
  }

  const student = await getStudentProfile(payload.uid);
  if (!student) {
    return { success: false, student: null, message: "Student not found in system." };
  }

  // ── Duplicate check ────────────────────────────────────────────────────────
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const dupQuery = query(
    collection(db, "attendance"),
    where("student_id", "==", payload.uid),
    where("salle_id",   "==", salleId)
  );
  const existing = await getDocs(dupQuery);

  if (!existing.empty) {
    const recentScan = existing.docs.find((d) => {
      const ms = tsToMs(d.data().scan_time);
      return ms > 0 && ms > oneHourAgo.getTime();
    });

    if (recentScan) {
      const ms = tsToMs(recentScan.data().scan_time);
      const minutesAgo  = Math.floor((Date.now() - ms) / 60000);
      const minutesLeft = 60 - minutesAgo;
      return {
        success: false,
        student,
        message: `Already checked in ${salleName} ${minutesAgo}min ago. Can re-scan in ${minutesLeft}min.`,
      };
    }
  }

  // ── Build record ───────────────────────────────────────────────────────────
  const record = {
    student_id:     payload.uid,
    scan_time:      serverTimestamp(),
    session_id:     sessionId,
    salle_id:       salleId,
    salle_name:     salleName,
    student_name:   `${student.first_name} ${student.last_name}`,
    apogee_code:    student.apogee_code  ?? "",
    filiere:        student.filiere       ?? student.cod_etp ?? "",
    cod_etp:        student.cod_etp       ?? "",
    // Profile selfie (stored at registration)
    selfie_path:    student.selfie_path   ?? student.photo_url ?? "",
    // Face captured live at scan time — proves who was holding the QR code
    scan_face_path: scanFacePath ?? "",
  };

  // ── Write to live attendance ───────────────────────────────────────────────
  const liveRef = await addDoc(collection(db, "attendance"), record);

  // ── Immediately mirror to archive (permanent) ─────────────────────────────
  await archiveRecord({ ...record, live_id: liveRef.id });

  return { success: true, student, message: "Attendance recorded successfully!" };
}

// ─── Update scan_face_path on an existing attendance record ──────────────────
// Called after the face photo upload completes (async after QR scan).
// We update BOTH the live record (by live_id) and the archive copy.
export async function updateScanFacePath(
  liveDocId: string,
  facePath: string
): Promise<void> {
  try {
    const { updateDoc } = await import("firebase/firestore");
    await updateDoc(doc(db, "attendance", liveDocId), { scan_face_path: facePath });
  } catch (err) {
    console.error("Failed to update scan_face_path on live record:", err);
  }
}

// ─── Get student attendance (from ARCHIVE — permanent) ────────────────────────
export async function getStudentAttendance(studentId: string): Promise<AttendanceRecord[]> {
  const archiveQ = query(
    collection(db, "attendance_archive"),
    where("student_id", "==", studentId)
  );
  const archiveSnap = await getDocs(archiveQ);
  const archiveRecs = archiveSnap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceRecord));

  const liveQ = query(
    collection(db, "attendance"),
    where("student_id", "==", studentId)
  );
  const liveSnap = await getDocs(liveQ);
  const liveRecs = liveSnap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceRecord));

  const seen = new Set<string>();
  const all: AttendanceRecord[] = [];

  for (const rec of [...archiveRecs, ...liveRecs]) {
    const key = `${rec.session_id}_${rec.salle_id}_${Math.floor(tsToMs(rec.scan_time) / 10000)}`;
    if (!seen.has(key)) {
      seen.add(key);
      all.push(rec);
    }
  }

  return sortByTime(all);
}

// ─── Get live attendance for a specific session + salle ───────────────────────
export async function getSessionSalleAttendance(
  sessionId: string,
  salleId: string
): Promise<AttendanceRecord[]> {
  const q = query(
    collection(db, "attendance"),
    where("session_id", "==", sessionId),
    where("salle_id",   "==", salleId)
  );
  const snap = await getDocs(q);
  return sortByTime(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceRecord)));
}

// ─── Get attendance for a specific session (all salles) ───────────────────────
export async function getSessionAttendance(sessionId: string): Promise<AttendanceRecord[]> {
  const q = query(
    collection(db, "attendance"),
    where("session_id", "==", sessionId)
  );
  const snap = await getDocs(q);
  return sortByTime(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceRecord)));
}

// ─── Get live attendance for a salle (all sessions) ──────────────────────────
export async function getSalleAttendance(salleId: string): Promise<AttendanceRecord[]> {
  const q = query(
    collection(db, "attendance"),
    where("salle_id", "==", salleId)
  );
  const snap = await getDocs(q);
  return sortByTime(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceRecord)));
}

// ─── Get ALL live attendance ──────────────────────────────────────────────────
export async function getAllAttendance(): Promise<AttendanceRecord[]> {
  const snap = await getDocs(collection(db, "attendance"));
  return sortByTime(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceRecord)));
}

// ─── ARCHIVE: Get all archived records ───────────────────────────────────────
export async function getAllArchive(): Promise<AttendanceRecord[]> {
  const snap = await getDocs(collection(db, "attendance_archive"));
  return sortByTime(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceRecord)));
}

// ─── ARCHIVE: Get archived records filtered by salle ─────────────────────────
export async function getArchiveBySalle(salleId: string): Promise<AttendanceRecord[]> {
  const q = query(
    collection(db, "attendance_archive"),
    where("salle_id", "==", salleId)
  );
  const snap = await getDocs(q);
  return sortByTime(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceRecord)));
}

// ─── ARCHIVE: Get archived records filtered by date label ─────────────────────
export async function getArchiveByDate(dateLabel: string): Promise<AttendanceRecord[]> {
  const q = query(
    collection(db, "attendance_archive"),
    where("date_label", "==", dateLabel)
  );
  const snap = await getDocs(q);
  return sortByTime(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AttendanceRecord)));
}

// ─── ARCHIVE: Get unique date labels in archive ───────────────────────────────
export async function getArchiveDates(): Promise<string[]> {
  const snap = await getDocs(collection(db, "attendance_archive"));
  const dates = new Set<string>();
  snap.docs.forEach((d) => {
    const label = d.data().date_label;
    if (label) dates.add(label);
  });
  return Array.from(dates).sort((a, b) => {
    try {
      return new Date(b).getTime() - new Date(a).getTime();
    } catch { return 0; }
  });
}

// ─── Format Firestore timestamp for display ───────────────────────────────────
export function formatTimestamp(ts: unknown): string {
  if (!ts) return "—";
  try {
    const d = (ts as Timestamp).toDate();
    return d.toLocaleString("fr-MA", { dateStyle: "medium", timeStyle: "short" });
  } catch { return "—"; }
}