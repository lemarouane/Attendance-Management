import { useState, FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import toast from "react-hot-toast";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "../firebase/config";
import { useAuth } from "../context/AuthContext";
import { profLogin } from "../services/apiService";

// ⚠️ CHANGE THIS to your actual Firebase admin email
const ADMIN_EMAIL = "admin@ensat.ac.ma";

export default function ProfLoginPage() {
  const navigate = useNavigate();
  const { setRole, setProfProfile, firebaseUser } = useAuth();

  const [ppr, setPpr]           = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [showPass, setShowPass] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!ppr.trim()) { toast.error("Veuillez entrer votre code PPR."); return; }
    if (!password)    { toast.error("Veuillez entrer le mot de passe."); return; }

    setLoading(true);
    try {
      // Step 1: Verify PPR in EDT database
      const result = await profLogin(ppr.trim(), password);
      if (!result.success || !result.prof) {
        toast.error(result.message || "Code PPR introuvable.");
        setLoading(false);
        return;
      }

      // Step 2: Sign out any existing session
      if (firebaseUser) {
        sessionStorage.removeItem("activeRole");
        sessionStorage.removeItem("profProfile");
        try { await signOut(auth); } catch { /* ignore */ }
        // Wait for auth state to clear
        await new Promise((r) => setTimeout(r, 300));
      }

      // Step 3: Set prof data in sessionStorage BEFORE Firebase login
      // This way when onAuthStateChanged fires, it picks up the prof role
      sessionStorage.setItem("activeRole", "prof");
      sessionStorage.setItem("profProfile", JSON.stringify(result.prof));

      // Step 4: Firebase login with admin credentials
      try {
        await signInWithEmailAndPassword(auth, ADMIN_EMAIL, password);
      } catch (authErr) {
        console.error("Firebase auth error:", authErr);
        sessionStorage.removeItem("activeRole");
        sessionStorage.removeItem("profProfile");
        toast.error("Mot de passe incorrect.");
        setLoading(false);
        return;
      }

      // Step 5: Update context (onAuthStateChanged will also do this, but be explicit)
      setProfProfile(result.prof);
      setRole("prof");

      toast.success(`Bienvenue, ${result.prof.prenom} ${result.prof.nom} !`);

      // Step 6: Navigate after a small delay for state to settle
      setTimeout(() => {
        navigate("/prof/timetable", { replace: true });
      }, 200);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Échec de la connexion.";
      toast.error(msg);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-teal-50 to-emerald-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-teal-100 rounded-full opacity-70 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-emerald-100 rounded-full opacity-60 blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative z-10 fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-700 shadow-lg shadow-teal-200 mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            ENSAT<span className="text-teal-600">-CHECKING</span>
          </h1>
          <p className="text-gray-500 text-sm mt-1">Espace Professeur</p>
        </div>

        <div className="flex items-center justify-center gap-2 mb-5 bg-teal-50 border border-teal-200 rounded-xl px-4 py-2.5">
          <div className="w-2 h-2 rounded-full bg-teal-500" />
          <p className="text-teal-700 text-sm font-medium">Accès Professeur — Code PPR</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/80 border border-gray-100 p-8">
          <h2 className="text-lg font-bold text-gray-900 mb-1">Connexion Professeur</h2>
          <p className="text-gray-500 text-sm mb-6">Utilisez votre code PPR et le mot de passe</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Code PPR (Identifiant)</label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                  </svg>
                </div>
                <input
                  type="text"
                  value={ppr}
                  onChange={(e) => setPpr(e.target.value)}
                  placeholder="Ex: 97257"
                  required
                  autoFocus
                  className="w-full border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all bg-gray-50 focus:bg-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Mot de passe</label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full border border-gray-200 rounded-xl pl-10 pr-11 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all bg-gray-50 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPass ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-semibold py-3 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-md shadow-teal-200 mt-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Connexion…
                </>
              ) : (
                <>Se connecter →</>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-gray-100 space-y-2">
            <p className="text-center text-gray-400 text-xs">
              Étudiant ?{" "}
              <Link to="/login" className="text-emerald-500 hover:text-emerald-600 transition-colors">
                Connexion étudiant →
              </Link>
            </p>
            <p className="text-center text-gray-400 text-xs">
              Administrateur ?{" "}
              <Link to="/admin-login" className="text-blue-500 hover:text-blue-600 transition-colors">
                Connexion admin →
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-gray-400 text-xs mt-6">
          ENSAT-CHECKING © 2025
        </p>
      </div>
    </div>
  );
}