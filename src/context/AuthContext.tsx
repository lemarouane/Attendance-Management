import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase/config";
import { StudentProfile } from "../services/authService";
import { EdtProf } from "../services/apiService";

interface AuthState {
  firebaseUser: User | null;
  role: string | null;         // "admin" | "student" | "prof"
  profile: StudentProfile | null;
  profProfile: EdtProf | null;
  loading: boolean;
}

interface AuthContextType extends AuthState {
  setProfile: (p: StudentProfile | null) => void;
  setRole: (r: string | null) => void;
  setProfProfile: (p: EdtProf | null) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    firebaseUser: null,
    role: null,
    profile: null,
    profProfile: null,
    loading: true,
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        // Clear everything on sign out
        sessionStorage.removeItem("activeRole");
        sessionStorage.removeItem("profProfile");
        setState({ firebaseUser: null, role: null, profile: null, profProfile: null, loading: false });
        return;
      }

      // Check if there's an active prof session
      const storedRole = sessionStorage.getItem("activeRole");
      const storedProf = sessionStorage.getItem("profProfile");

      if (storedRole === "prof" && storedProf) {
        // Prof session active — don't query Firestore for role
        let profProfile: EdtProf | null = null;
        try {
          profProfile = JSON.parse(storedProf) as EdtProf;
        } catch { /* ignore */ }

        setState({
          firebaseUser: user,
          role: "prof",
          profile: null,
          profProfile,
          loading: false,
        });
        return;
      }

      // Normal flow: get role from Firestore
      let role = "student";
      try {
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (userDoc.exists()) {
          role = userDoc.data().role || "student";
        }
      } catch {
        role = "student";
      }

      let profile: StudentProfile | null = null;
      if (role === "student") {
        try {
          const studentDoc = await getDoc(doc(db, "students", user.uid));
          if (studentDoc.exists()) {
            profile = studentDoc.data() as StudentProfile;
          }
        } catch { /* ignore */ }
      }

      setState({
        firebaseUser: user,
        role,
        profile,
        profProfile: null,
        loading: false,
      });
    });

    return () => unsub();
  }, []);

  const setProfile = (p: StudentProfile | null) =>
    setState((prev) => ({ ...prev, profile: p }));

  const setRole = (r: string | null) => {
    if (r) {
      sessionStorage.setItem("activeRole", r);
    } else {
      sessionStorage.removeItem("activeRole");
    }
    setState((prev) => ({ ...prev, role: r }));
  };

  const setProfProfile = (p: EdtProf | null) => {
    if (p) {
      sessionStorage.setItem("profProfile", JSON.stringify(p));
    } else {
      sessionStorage.removeItem("profProfile");
    }
    setState((prev) => ({ ...prev, profProfile: p }));
  };

  return (
    <AuthContext.Provider value={{ ...state, setProfile, setRole, setProfProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}