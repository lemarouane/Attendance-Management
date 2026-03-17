import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  UserCredential,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "../firebase/config";
import {
  generateDeviceFingerprint,
  storeFingerprint,
  clearFingerprint,
} from "../utils/deviceFingerprint";

export const ADMIN_UID = "fkrpPGYj6kh52zjk1zwzE3TGZqj1";

export interface StudentProfile {
  uid: string;
  first_name: string;
  last_name: string;
  email: string;
  apogee_code: string;
  cin: string;
  cod_ind: string;
  cod_etp: string;
  niveau: string;
  filiere: string;
  photo_url: string;
  cin_path: string;
  selfie_path: string;
  deviceFingerprint: string;
  role: string;
  created_at: unknown;
}

function parseFirebaseError(code: string): string {
  const map: Record<string, string> = {
    "auth/email-already-in-use": "This apogee code is already registered. Please login.",
    "auth/invalid-email": "Invalid email address.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/user-not-found": "No account found with this apogee code.",
    "auth/wrong-password": "Incorrect password.",
    "auth/too-many-requests": "Too many attempts. Please wait and try again.",
    "auth/network-request-failed": "Network error. Check your connection.",
    "auth/invalid-credential": "Invalid apogee code or password.",
    "storage/unauthorized": "Storage access denied. Contact administrator.",
    "storage/canceled": "Upload was canceled.",
    "storage/unknown": "Storage error. Upload failed.",
  };
  return map[code] || `Error: ${code}`;
}

// ─── Admin validate student ───────────────────────────────────────────────────
export async function validateStudent(studentUid: string): Promise<void> {
  await updateDoc(doc(db, "students", studentUid), {
    status: "validated",
    validated_at: serverTimestamp(),
  });
}

export async function rejectStudent(studentUid: string): Promise<void> {
  await updateDoc(doc(db, "students", studentUid), {
    status: "rejected",
  });
}

// ─── Register student ─────────────────────────────────────────────────────────
export async function registerStudent(data: {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  apogee_code: string;
  cin: string;
  cod_ind: string;
  cod_etp: string;
  cin_path: string;
  selfie_path: string;
  photo_url: string;
  status?: "pending" | "validated";   
}): Promise<void> {
  // Email is auto-generated from apogee — validate domain
  if (!data.email.endsWith("@uae.ac.ma")) {
    throw new Error("Email must be from @uae.ac.ma domain.");
  }

  let credential: UserCredential;
  try {
    credential = await createUserWithEmailAndPassword(auth, data.email, data.password);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || "";
    throw new Error(parseFirebaseError(code) || (err as Error).message);
  }

  const uid = credential.user.uid;
  const fingerprint = generateDeviceFingerprint();
  storeFingerprint(fingerprint);

  try {
    // Main student document
    await setDoc(doc(db, "students", uid), {
      uid,
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email,
      apogee_code: data.apogee_code,
      cin: data.cin,
      cod_ind: data.cod_ind,
      cod_etp: data.cod_etp,
      niveau: "",        
      filiere: data.cod_etp || "",
      photo_url: data.photo_url,
      cin_path: data.cin_path,
      selfie_path: data.selfie_path,
      deviceFingerprint: fingerprint,
      role: "student",
      status: data.status ?? "pending",
      validated_at: data.status === "validated" ? serverTimestamp() : null,
      face_verified: data.status === "validated",
      created_at: serverTimestamp(),
    });

    
    await setDoc(doc(db, "users", uid), {
      uid,
      role: "student",
      email: data.email,
    });
  } catch (err: unknown) {
    await signOut(auth).catch(() => {});
    const code = (err as { code?: string })?.code || "";
    throw new Error(parseFirebaseError(code) || "Failed to save profile. Please try again.");
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────
export async function loginUser(
  email: string,
  password: string
): Promise<{ role: string; profile: StudentProfile | null }> {
  let credential: UserCredential;
  try {
    credential = await signInWithEmailAndPassword(auth, email, password);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || "";
    throw new Error(parseFirebaseError(code) || (err as Error).message);
  }

  const uid = credential.user.uid;

  // Get role
  let role = "student";
  try {
    const userDoc = await getDoc(doc(db, "users", uid));
    if (userDoc.exists()) {
      role = userDoc.data().role || "student";
    }
  } catch {
    role = "student";
  }

  if (role === "admin") {
    return { role: "admin", profile: null };
  }

  // Student — device fingerprint check
  let studentData: StudentProfile;
  try {
    const studentDoc = await getDoc(doc(db, "students", uid));
    if (!studentDoc.exists()) {
      await signOut(auth);
      throw new Error("Student profile not found. Please register first.");
    }
    studentData = studentDoc.data() as StudentProfile;
  } catch (err: unknown) {
    if ((err as Error).message.includes("Student profile")) throw err;
    await signOut(auth);
    throw new Error("Failed to load profile. Check your connection.");
  }

  // Check validation status
  const status = (studentData as unknown as { status?: string }).status;
  if (status === "pending" || !status) {
    await signOut(auth);
    throw new Error("PENDING: Your account is awaiting admin validation. Please wait.");
  }
  if (status === "rejected") {
    await signOut(auth);
    throw new Error("Your registration was rejected. Contact administrator.");
  }

  const currentFingerprint = generateDeviceFingerprint();
  const storedFingerprint = studentData.deviceFingerprint;

  if (storedFingerprint && storedFingerprint !== currentFingerprint) {
    await signOut(auth);
    throw new Error(
      "DEVICE_LOCKED: Your account is locked to another device. Contact administrator."
    );
  }

  if (!storedFingerprint) {
    try {
      await updateDoc(doc(db, "students", uid), {
        deviceFingerprint: currentFingerprint,
      });
    } catch {
      // Non-critical
    }
  }

  storeFingerprint(currentFingerprint);
  return { role: "student", profile: studentData };
}

// ─── Logout ───────────────────────────────────────────────────────────────────
export async function logoutUser(): Promise<void> {
  clearFingerprint();
  await signOut(auth);
}

// ─── Get student profile ──────────────────────────────────────────────────────
export async function getStudentProfile(uid: string): Promise<StudentProfile | null> {
  try {
    const snap = await getDoc(doc(db, "students", uid));
    if (!snap.exists()) return null;
    return snap.data() as StudentProfile;
  } catch {
    return null;
  }
}

// ─── Reset device lock (admin only) ──────────────────────────────────────────
export async function resetDeviceLock(studentUid: string): Promise<void> {
  await updateDoc(doc(db, "students", studentUid), {
    deviceFingerprint: "",
  });
}
