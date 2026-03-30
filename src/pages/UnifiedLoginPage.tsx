import { useState, FormEvent, useEffect, useRef, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "../firebase/config";
import { loginUser } from "../services/authService";
import { profLogin } from "../services/apiService";
import { useAuth } from "../context/AuthContext";

const ADMIN_EMAIL = "admin@ensat.ac.ma";

type UserType = "student" | "prof" | "admin" | "unknown";

function detectType(code: string): UserType {
  if (!code) return "unknown";
  if (code.includes("@")) return "admin";
  if (/^\d{4,6}$/.test(code)) return "prof";
  if (/^\d{7,10}$/.test(code)) return "student";
  return "unknown";
}

const TYPE_META: Record<UserType, { label: string; color: string; ring: string; hint: string; icon: ReactElement }> = {
  student: {
    label: "Étudiant",
    color: "text-emerald-600",
    ring: "focus:ring-emerald-400",
    hint: "Code Apogée détecté",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
      </svg>
    ),
  },
  prof: {
    label: "Professeur",
    color: "text-teal-600",
    ring: "focus:ring-teal-400",
    hint: "Code PPR détecté",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  admin: {
    label: "Administrateur",
    color: "text-blue-600",
    ring: "focus:ring-blue-400",
    hint: "Email admin détecté",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
  },
  unknown: {
    label: "",
    color: "text-gray-400",
    ring: "focus:ring-gray-300",
    hint: "",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
};

const ACCENT: Record<UserType, string> = {
  student: "from-emerald-400 to-emerald-600",
  prof:    "from-teal-400 to-teal-600",
  admin:   "from-blue-500 to-blue-700",
  unknown: "from-slate-400 to-slate-600",
};

const BTN_COLOR: Record<UserType, string> = {
  student: "bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-300 shadow-emerald-200",
  prof:    "bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 shadow-teal-200",
  admin:   "bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 shadow-blue-200",
  unknown: "bg-slate-500 hover:bg-slate-600 disabled:bg-slate-300 shadow-slate-200",
};

// ── Confetti colours per role ──────────────────────────────────────────────────
const CONFETTI_COLORS: Record<UserType, string[]> = {
  student: ["#10b981", "#34d399", "#6ee7b7", "#fbbf24", "#ffffff", "#a7f3d0"],
  prof:    ["#0d9488", "#2dd4bf", "#5eead4", "#fbbf24", "#ffffff", "#99f6e4"],
  admin:   ["#2563eb", "#60a5fa", "#93c5fd", "#fbbf24", "#ffffff", "#bfdbfe"],
  unknown: ["#6b7280", "#9ca3af", "#d1d5db", "#fbbf24", "#ffffff"],
};

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  angle: number; spin: number;
  color: string;
  size: number;
  shape: "rect" | "circle" | "strip";
  opacity: number;
}

function createParticles(count: number, colors: string[]): Particle[] {
  return Array.from({ length: count }, () => ({
    x:       Math.random() * window.innerWidth,
    y:       -20 - Math.random() * 100,
    vx:      (Math.random() - 0.5) * 4,
    vy:      2 + Math.random() * 5,
    angle:   Math.random() * 360,
    spin:    (Math.random() - 0.5) * 8,
    color:   colors[Math.floor(Math.random() * colors.length)],
    size:    6 + Math.random() * 8,
    shape:   (["rect", "circle", "strip"] as const)[Math.floor(Math.random() * 3)],
    opacity: 1,
  }));
}

// ── ConfettiCanvas ────────────────────────────────────────────────────────────
function ConfettiCanvas({ active, userType }: { active: boolean; userType: UserType }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const particles = useRef<Particle[]>([]);

  useEffect(() => {
    if (!active) return;

    const colors = CONFETTI_COLORS[userType] ?? CONFETTI_COLORS.unknown;
    particles.current = createParticles(160, colors);

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext("2d")!;
    const startTime = performance.now();

    function draw(now: number) {
      const elapsed = now - startTime;
      ctx.clearRect(0, 0, canvas!.width, canvas!.height);

      particles.current.forEach((p) => {
        p.x     += p.vx;
        p.y     += p.vy;
        p.vy    += 0.08;
        p.vx    *= 0.99;
        p.angle += p.spin;
        if (elapsed > 2500) p.opacity = Math.max(0, p.opacity - 0.018);

        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.rotate((p.angle * Math.PI) / 180);
        ctx.fillStyle = p.color;

        if (p.shape === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === "strip") {
          ctx.fillRect(-p.size / 6, -p.size, p.size / 3, p.size * 1.6);
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        }
        ctx.restore();
      });

      particles.current = particles.current.filter(
        (p) => p.opacity > 0 && p.y < canvas!.height + 40
      );

      if (particles.current.length > 0 && elapsed < 5000) {
        rafRef.current = requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, canvas!.width, canvas!.height);
      }
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, userType]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 9999 }}
    />
  );
}

// ── SuccessOverlay ────────────────────────────────────────────────────────────
function SuccessOverlay({ name, userType }: { name: string; userType: UserType }) {
  const badgeCls: Record<UserType, string> = {
    student: "bg-emerald-100 text-emerald-700",
    prof:    "bg-teal-100 text-teal-700",
    admin:   "bg-blue-100 text-blue-700",
    unknown: "bg-gray-100 text-gray-700",
  };
  const ringCls: Record<UserType, string> = {
    student: "ring-emerald-300 bg-emerald-500",
    prof:    "ring-teal-300 bg-teal-600",
    admin:   "ring-blue-300 bg-blue-600",
    unknown: "ring-gray-300 bg-gray-500",
  };

  return (
    <>
      <style>{`
        @keyframes successPop {
          from { opacity: 0; transform: scale(0.65) translateY(20px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
        @keyframes checkPulse {
          from { transform: scale(0.4); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }
        @keyframes drawCheck {
          to { stroke-dashoffset: 0; }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
      `}</style>
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ zIndex: 9998, background: "rgba(0,0,0,0.40)", backdropFilter: "blur(6px)" }}
      >
        <div
          className="bg-white rounded-3xl shadow-2xl px-10 py-10 flex flex-col items-center gap-5 text-center mx-4"
          style={{ animation: "successPop 0.45s cubic-bezier(0.34,1.56,0.64,1) both" }}
        >
          {/* Animated check */}
          <div
            className={`w-20 h-20 rounded-full flex items-center justify-center ring-4 ${ringCls[userType]}`}
            style={{ animation: "checkPulse 0.45s ease-out 0.15s both" }}
          >
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path
                strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"
                style={{
                  strokeDasharray: 30,
                  strokeDashoffset: 30,
                  animation: "drawCheck 0.38s ease-out 0.38s both",
                }}
              />
            </svg>
          </div>

          {/* Text */}
          <div style={{ animation: "fadeInUp 0.4s ease-out 0.5s both", opacity: 0 }}>
            <p className="text-2xl font-bold text-gray-900">Bienvenue !</p>
            <p className="text-gray-500 text-sm mt-1 max-w-xs">{name}</p>
          </div>

          {/* Role badge */}
          {TYPE_META[userType].label && (
            <div
              className={`text-xs font-semibold px-4 py-1.5 rounded-full ${badgeCls[userType]}`}
              style={{ animation: "fadeInUp 0.4s ease-out 0.65s both", opacity: 0 }}
            >
              {TYPE_META[userType].label}
            </div>
          )}

          {/* Subtle redirect note */}
          <p
            className="text-gray-400 text-xs"
            style={{ animation: "fadeInUp 0.4s ease-out 0.8s both", opacity: 0 }}
          >
            Redirection en cours…
          </p>
        </div>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function UnifiedLoginPage() {
  const navigate = useNavigate();
  const { setRole, setProfile, setProfProfile, firebaseUser } = useAuth();

  const [code, setCode]                 = useState("");
  const [password, setPassword]         = useState("");
  const [loading, setLoading]           = useState(false);
  const [showPass, setShowPass]         = useState(false);
  const [userType, setUserType]         = useState<UserType>("unknown");
  const [badgeVisible, setBadgeVisible] = useState(false);

  // celebration
  const [celebrating, setCelebrating] = useState(false);
  const [successName, setSuccessName] = useState("");
  const [successType, setSuccessType] = useState<UserType>("unknown");

  useEffect(() => {
    const t = detectType(code.trim());
    setUserType(t);
    setBadgeVisible(t !== "unknown");
  }, [code]);

  function celebrate(name: string, type: UserType, go: () => void) {
    setSuccessName(name);
    setSuccessType(type);
    setCelebrating(true);
    setTimeout(() => {
      setCelebrating(false);
      go();
    }, 1900);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) { toast.error("Veuillez entrer votre identifiant."); return; }
    if (!password) { toast.error("Veuillez entrer votre mot de passe."); return; }

    const type = detectType(trimmed);
    if (type === "unknown") {
      toast.error("Format d'identifiant non reconnu. Vérifiez votre saisie.");
      return;
    }

    setLoading(true);
    try {
      if (type === "admin") {
        const result = await loginUser(trimmed, password);
        if (result.role !== "admin") {
          toast.error("Accès refusé. Cet identifiant n'est pas un compte administrateur.");
          return;
        }
        setRole(result.role);
        setProfile(result.profile);
        celebrate("Administrateur", "admin", () => navigate("/admin-scan"));
        return;
      }

      if (type === "prof") {
        const result = await profLogin(trimmed, password);
        if (!result.success || !result.prof) {
          toast.error(result.message || "Code PPR introuvable.");
          return;
        }
        if (firebaseUser) {
          sessionStorage.removeItem("activeRole");
          sessionStorage.removeItem("profProfile");
          try { await signOut(auth); } catch { /* ignore */ }
          await new Promise((r) => setTimeout(r, 300));
        }
        sessionStorage.setItem("activeRole", "prof");
        sessionStorage.setItem("profProfile", JSON.stringify(result.prof));
        try {
          await signInWithEmailAndPassword(auth, ADMIN_EMAIL, password);
        } catch {
          sessionStorage.removeItem("activeRole");
          sessionStorage.removeItem("profProfile");
          toast.error("Mot de passe incorrect.");
          return;
        }
        setProfProfile(result.prof);
        setRole("prof");
        celebrate(
          `${result.prof.prenom} ${result.prof.nom}`,
          "prof",
          () => navigate("/prof/timetable", { replace: true })
        );
        return;
      }

      if (type === "student") {
        const email = `${trimmed.toLowerCase()}@uae.ac.ma`;
        const result = await loginUser(email, password);
        if (result.role === "admin") {
          toast.error("Utilisez la page de connexion administrateur.");
          navigate("/login");
          return;
        }
        setRole(result.role);
        setProfile(result.profile);
        celebrate(
          result.profile?.first_name ?? "Étudiant",
          "student",
          () => navigate("/dashboard")
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Échec de la connexion.";
      if (msg.includes("DEVICE_LOCKED")) {
        toast.error("Compte verrouillé sur un autre appareil. Contactez l'administrateur.", { duration: 6000 });
      } else if (msg.includes("PENDING")) {
        toast.error("Compte en attente de validation par l'administrateur.", { duration: 6000 });
      } else if (msg.includes("invalid-credential") || msg.includes("wrong-password") || msg.includes("user-not-found")) {
        toast.error("Identifiant ou mot de passe incorrect.");
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  const meta = TYPE_META[userType];

  return (
    <>
      <ConfettiCanvas active={celebrating} userType={successType} />
      {celebrating && <SuccessOverlay name={successName} userType={successType} />}

      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-emerald-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-32 -right-32 w-96 h-96 bg-emerald-100 rounded-full opacity-60 blur-3xl" />
          <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-blue-100 rounded-full opacity-60 blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-teal-50 rounded-full opacity-40 blur-3xl" />
        </div>

        <div className="w-full max-w-sm relative z-10">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br ${ACCENT[userType]} shadow-lg mb-4 transition-all duration-500`}>
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">
              ENSAT<span className={`transition-colors duration-500 ${meta.color || "text-slate-500"}`}>-CHECKING</span>
            </h1>
            <p className="text-gray-500 text-sm mt-1">Portail de Connexion</p>
          </div>

          {/* Detected type badge */}
          <div className={`overflow-hidden transition-all duration-300 ${badgeVisible ? "max-h-14 mb-4 opacity-100" : "max-h-0 mb-0 opacity-0"}`}>
            <div className={`flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 border
              ${userType === "student" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : ""}
              ${userType === "prof"    ? "bg-teal-50 border-teal-200 text-teal-700" : ""}
              ${userType === "admin"   ? "bg-blue-50 border-blue-200 text-blue-700" : ""}
            `}>
              {meta.icon}
              <span className="text-sm font-medium">{meta.hint} — {meta.label}</span>
            </div>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/80 border border-gray-100 p-8">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Connexion</h2>
            <p className="text-gray-400 text-sm mb-6">Entrez vos identifiants pour vous connecter</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Identifiant <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <div className={`absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors duration-300 ${meta.color || "text-gray-400"}`}>
                    {meta.icon}
                  </div>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Code"
                    required
                    autoFocus
                    autoComplete="username"
                    className={`w-full border border-gray-200 rounded-xl pl-10 pr-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all bg-gray-50 focus:bg-white ${meta.ring}`}
                  />
                </div>
                {!badgeVisible && (
                  <p className="mt-1.5 text-xs text-gray-400 flex gap-3">
 
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Mot de passe <span className="text-red-400">*</span>
                </label>
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
                    autoComplete="current-password"
                    className={`w-full border border-gray-200 rounded-xl pl-10 pr-11 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all bg-gray-50 focus:bg-white ${meta.ring}`}
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
                className={`w-full text-white font-semibold py-3 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 shadow-md mt-2 ${BTN_COLOR[userType]}`}
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Connexion…
                  </>
                ) : (
                  `Se connecter${meta.label ? ` — ${meta.label}` : ""} →`
                )}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-gray-100">
              <p className="text-center text-gray-400 text-xs">
                Étudiant sans compte ?{" "}
                <a href="/register" className="text-emerald-600 hover:text-emerald-700 font-semibold transition-colors">
                  S'inscrire
                </a>
              </p>
            </div>
          </div>

          <p className="text-center text-gray-400 text-xs mt-6">
            &copy; {new Date().getFullYear()} ENSAT-CHECKING. Tous droits réservés.
          </p>
        </div>
      </div>
    </>
  );
}