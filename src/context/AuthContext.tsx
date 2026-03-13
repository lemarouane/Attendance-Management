import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase/config";
import { StudentProfile } from "../services/authService";

interface AuthState {
  firebaseUser: User | null;
  role: string | null;
  profile: StudentProfile | null;
  loading: boolean;
}

interface AuthContextType extends AuthState {
  setProfile: (p: StudentProfile | null) => void;
  setRole: (r: string | null) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    firebaseUser: null,
    role: null,
    profile: null,
    loading: true,
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState({ firebaseUser: null, role: null, profile: null, loading: false });
        return;
      }

      const userDoc = await getDoc(doc(db, "users", user.uid));
      const role = userDoc.exists() ? userDoc.data().role : "student";

      let profile: StudentProfile | null = null;
      if (role === "student") {
        const studentDoc = await getDoc(doc(db, "students", user.uid));
        if (studentDoc.exists()) {
          profile = studentDoc.data() as StudentProfile;
        }
      }

      setState({ firebaseUser: user, role, profile, loading: false });
    });

    return () => unsub();
  }, []);

  const setProfile = (p: StudentProfile | null) =>
    setState((prev) => ({ ...prev, profile: p }));

  const setRole = (r: string | null) =>
    setState((prev) => ({ ...prev, role: r }));

  return (
    <AuthContext.Provider value={{ ...state, setProfile, setRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
