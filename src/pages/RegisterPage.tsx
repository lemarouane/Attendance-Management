import { useState, useEffect, FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import toast from "react-hot-toast";
import { registerStudent } from "../services/authService";
import {
  validateApogee,
  uploadBase64Image,
  checkServerHealth,
  getDbStatus,
  retryDbConnection,
  type ApogeeStudent,
  type ServerHealth,
  type DbStatus,
} from "../services/apiService";
import CameraCapture from "../components/CameraCapture";
import FaceDetectionCamera from "../components/FaceDetectionCamera";
import FaceVerification from "../components/FaceVerification";

// Steps: 1=Apogee, 2=CIN, 3=Selfie, 3.5=FaceVerif, 4=Password, 5=Confirm
type Step = 1 | 2 | 3 | 3.5 | 4 | 5;

export default function RegisterPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(1);

  // Server / DB status
  const [serverHealth, setServerHealth] = useState<ServerHealth | null>(null);
  const [dbStatus, setDbStatus]         = useState<DbStatus | null>(null);
  const [checkingServer, setCheckingServer] = useState(true);
  const [retrying, setRetrying]         = useState(false);

  // Step 1 — Apogee
  const [apogeeCode, setApogeeCode] = useState("");
  const [apogeeInfo, setApogeeInfo] = useState<ApogeeStudent | null>(null);
  const [validating, setValidating] = useState(false);

  // Step 2 — CIN
  const [cinImage, setCinImage] = useState<string | null>(null);

  // Step 3 — Selfie
  const [selfieImage, setSelfieImage] = useState<string | null>(null);

  // Step 4 — Password
  const [password, setPassword]               = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Loading
  const [loading, setLoading]       = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");

  // Face verification result
  const [faceVerified, setFaceVerified] = useState(false);

  useEffect(() => { checkStatus(); }, []);

  async function checkStatus() {
    setCheckingServer(true);
    const health = await checkServerHealth();
    setServerHealth(health);
    if (health.online) {
      const db = await getDbStatus();
      setDbStatus(db);
    }
    setCheckingServer(false);
  }

  async function handleRetryDb() {
    setRetrying(true);
    toast.loading("Reconnexion à la base de données…", { id: "db-retry" });
    const result = await retryDbConnection();
    if (result.connected) {
      toast.success("Base de données connectée !", { id: "db-retry" });
    } else {
      toast.error(`Toujours en échec : ${result.error}`, { id: "db-retry" });
    }
    await checkStatus();
    setRetrying(false);
  }

  // Step 1: Validate apogee
  async function handleValidateApogee(e: FormEvent) {
    e.preventDefault();
    if (!apogeeCode.trim()) { toast.error("Veuillez saisir votre code apogée."); return; }

    if (!serverHealth?.online) {
      toast.error("Serveur backend hors ligne. Exécutez : cd server && node index.js");
      return;
    }
    if (dbStatus && !dbStatus.connected) {
      toast.error("Base de données non connectée. Vérifiez les identifiants MySQL.");
      return;
    }

    setValidating(true);
    const result = await validateApogee(apogeeCode.trim());
    setValidating(false);

    if (!result.valid) {
      if (result.dbOffline) {
        toast.error("Base de données hors ligne : " + result.message, { duration: 5000 });
        await checkStatus();
      } else {
        toast.error(result.message || "Code apogée introuvable.");
      }
      return;
    }

    if (result.student) {
      setApogeeInfo(result.student);
      toast.success(`✓ Vérifié : ${result.student.LIB_PR1_IND} ${result.student.LIB_NOM_PAT_IND}`);
      setStep(2);
    }
  }

  function handleCinNext() {
    if (!cinImage) { toast.error("Veuillez capturer votre carte CIN."); return; }
    setStep(3);
  }

  function handleSelfieNext() {
    if (!selfieImage) { toast.error("Veuillez capturer votre selfie."); return; }
    setStep(3.5);
  }

  function handleFaceVerifSuccess() {
    setFaceVerified(true);
    setStep(4);
  }

  function handleFaceVerifRetake() {
    setFaceVerified(false);
    setSelfieImage(null);
    setStep(3);
  }

  function handlePasswordNext(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) { toast.error("Le mot de passe doit contenir au moins 6 caractères."); return; }
    if (password !== confirmPassword) { toast.error("Les mots de passe ne correspondent pas."); return; }
    setStep(5);
  }

  async function handleSubmit() {
    if (!apogeeInfo || !cinImage || !selfieImage) {
      toast.error("Informations manquantes. Veuillez recommencer.");
      return;
    }

    setLoading(true);
    let cinPath    = "";
    let selfiePath = "";

    try {
      // Upload CIN
      setLoadingMsg("Envoi de la photo CIN au serveur…");
      const cinResult = await uploadBase64Image(apogeeCode, "cin", cinImage);
      if (!cinResult.success) {
        toast.error("Échec de l'envoi CIN : " + cinResult.message);
        setLoading(false);
        return;
      }
      cinPath = cinResult.path;
      toast.success("Photo CIN enregistrée ✓");

      // Upload Selfie
      setLoadingMsg("Envoi du selfie au serveur…");
      const selfieResult = await uploadBase64Image(apogeeCode, "selfie", selfieImage);
      if (!selfieResult.success) {
        toast.error("Échec de l'envoi selfie : " + selfieResult.message);
        setLoading(false);
        return;
      }
      selfiePath = selfieResult.path;
      toast.success("Selfie enregistré ✓");

      // Create Firebase account
      setLoadingMsg("Création du compte Firebase…");
      const email = `${apogeeCode.toLowerCase()}@uae.ac.ma`;

      const registrationStatus = faceVerified ? "validated" : "pending";

      await registerStudent({
        first_name:  apogeeInfo.LIB_PR1_IND,
        last_name:   apogeeInfo.LIB_NOM_PAT_IND,
        email,
        password,
        apogee_code: apogeeCode,
        cin:         apogeeInfo.CIN_IND,
        cod_ind:     apogeeInfo.COD_IND,
        cod_etp:     apogeeInfo.COD_ETP,
        cin_path:    cinPath,
        selfie_path: selfiePath,
        photo_url:   selfiePath,
        status:      registrationStatus,
      });

      if (faceVerified) {
        toast.success("🎉 Identité vérifiée ! Votre compte est actif, vous pouvez vous connecter.");
        navigate("/login");
      } else {
        toast.success("📋 Inscription soumise. En attente de validation par l'administrateur.");
        navigate("/pending");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Inscription échouée.";
      if (msg.includes("email-already-in-use") || msg.includes("already registered")) {
        toast.error("Ce code apogée est déjà enregistré. Veuillez vous connecter.");
        navigate("/login");
      } else {
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  // Step indicator
  const stepIndicators = [
    { num: 1,   label: "Apogée" },
    { num: 2,   label: "CIN" },
    { num: 3,   label: "Selfie" },
    { num: 3.5, label: "Vérif." },
    { num: 4,   label: "Mot de passe" },
    { num: 5,   label: "Confirmer" },
  ];

  function stepPassed(s: number) { return step > s; }
  function stepActive(s: number) { return step === s; }

  function ServerStatusBanner() {
    if (checkingServer) {
      return (
        <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-gray-50 text-gray-400 border border-gray-100">
          <div className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
          Vérification du serveur…
        </div>
      );
    }

    if (!serverHealth?.online) {
      return (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-red-600 text-sm font-semibold">Serveur backend hors ligne</span>
          </div>
          <p className="text-gray-500 text-xs leading-relaxed">
            Lancez le serveur Express pour valider les codes apogée et sauvegarder les photos.
          </p>
          <div className="bg-gray-100 rounded-lg px-3 py-2 font-mono text-xs text-amber-700">
            cd server && node index.js
          </div>
          <button onClick={checkStatus} className="text-xs text-emerald-600 hover:text-emerald-700 underline">
            Vérifier à nouveau ↺
          </button>
        </div>
      );
    }

    if (dbStatus && !dbStatus.connected) {
      const apoErr = dbStatus.apo?.error;
      const pgiErr = dbStatus.pgi?.error;
      return (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-amber-700 text-sm font-semibold">MySQL non connecté</span>
          </div>
          {(apoErr || pgiErr) && (
            <div className="bg-gray-100 rounded-lg px-3 py-2 text-xs text-red-600 font-mono break-all">
              {apoErr || pgiErr}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleRetryDb}
              disabled={retrying}
              className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-700 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
            >
              {retrying ? "Reconnexion…" : "↺ Réessayer"}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-600">
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        Serveur connecté
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-emerald-50 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-emerald-100 rounded-full opacity-60 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-blue-100 rounded-full opacity-60 blur-3xl" />
      </div>

      <div className="w-full max-w-lg relative z-10">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-100 border border-emerald-200 mb-3">
            <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            ENSAT<span className="text-emerald-500">-CHECKING</span>
          </h1>
          <p className="text-gray-500 text-sm mt-1">Inscription Étudiant</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0.5 mb-6 justify-center flex-wrap">
          {stepIndicators.map((s, idx) => (
            <div key={s.num} className="flex items-center gap-0.5">
              <div className="flex flex-col items-center gap-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                  stepPassed(s.num) ? "bg-emerald-500 text-white" :
                  stepActive(s.num) ? "bg-emerald-100 border-2 border-emerald-500 text-emerald-600" :
                  "bg-gray-100 text-gray-400"
                }`}>
                  {stepPassed(s.num) ? "✓" : idx + 1}
                </div>
                <span className={`text-xs transition-all whitespace-nowrap ${
                  stepActive(s.num) ? "text-emerald-600 font-medium" :
                  stepPassed(s.num) ? "text-emerald-500" :
                  "text-gray-400"
                }`}>
                  {s.label}
                </span>
              </div>
              {idx < stepIndicators.length - 1 && (
                <div className={`w-5 h-0.5 mb-4 transition-all ${stepPassed(s.num) ? "bg-emerald-500" : "bg-gray-200"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-gray-200/80 border border-gray-100 p-8">

          {/* STEP 1 — Apogée */}
          {step === 1 && (
            <form onSubmit={handleValidateApogee} className="space-y-5">
              <ServerStatusBanner />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Code Apogée</label>
                <input
                  type="text"
                  value={apogeeCode}
                  onChange={(e) => setApogeeCode(e.target.value.trim())}
                  placeholder="ex. 22001234"
                  required
                  maxLength={20}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all text-center text-lg tracking-widest font-mono bg-gray-50 focus:bg-white"
                />
              </div>
              <button
                type="submit"
                disabled={
                  validating ||
                  !apogeeCode.trim() ||
                  !serverHealth?.online ||
                  (dbStatus !== null && !dbStatus.connected)
                }
                className="w-full bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-200 disabled:text-emerald-400 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-md shadow-emerald-100"
              >
                {validating ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Validation en cours…
                  </>
                ) : (
                  "Valider le code →"
                )}
              </button>
            </form>
          )}

          {/* STEP 2 — CIN */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Photo Carte Nationale (CIN)</h2>
                <p className="text-gray-500 text-sm">Capturez votre carte nationale d'identité</p>
              </div>

              {apogeeInfo && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                  <p className="text-emerald-700 text-sm font-medium">
                    ✓ {apogeeInfo.LIB_PR1_IND} {apogeeInfo.LIB_NOM_PAT_IND}
                  </p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    CIN : {apogeeInfo.CIN_IND} · Filière : {apogeeInfo.COD_ETP || "N/A"}
                  </p>
                </div>
              )}

              <CameraCapture
                title="Carte CIN"
                subtitle="Tenez votre CIN à plat devant la caméra"
                facingMode="environment"
                onCapture={setCinImage}
                onRetake={() => setCinImage(null)}
                capturedImage={cinImage}
                icon={<span></span>}
              />

              <div className="flex gap-3">
                <button
                  onClick={() => { setStep(1); setCinImage(null); }}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-xl transition-all"
                >
                  ← Retour
                </button>
                <button
                  onClick={handleCinNext}
                  disabled={!cinImage}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-200 disabled:text-emerald-400 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all"
                >
                  Continuer →
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — Selfie */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Selfie biométrique</h2>
                <p className="text-gray-500 text-sm">Le système détectera votre visage avant de capturer</p>
              </div>

              <FaceDetectionCamera
                onCapture={setSelfieImage}
                onRetake={() => setSelfieImage(null)}
                capturedImage={selfieImage}
              />

              <div className="flex gap-3">
                <button
                  onClick={() => { setStep(2); setSelfieImage(null); }}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-xl transition-all"
                >
                  ← Retour
                </button>
                <button
                  onClick={handleSelfieNext}
                  disabled={!selfieImage}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-200 disabled:text-emerald-400 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all"
                >
                  Continuer →
                </button>
              </div>
            </div>
          )}

{/* STEP 3.5 — Face Verification */}
{step === 3.5 && cinImage && selfieImage && (
  <FaceVerification
    cinImage={cinImage}
    selfieImage={selfieImage}
    onSuccess={handleFaceVerifSuccess}
    onRetake={handleFaceVerifRetake}
    onContinueAnyway={() => {
      setFaceVerified(false);
      setStep(4);
    }}
  />
)}

          {/* STEP 4 — Password */}
          {step === 4 && (
            <form onSubmit={handlePasswordNext} className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Créer un mot de passe</h2>
                <p className="text-gray-500 text-sm">
                  La connexion utilisera le code apogée :{" "}
                  <span className="text-emerald-600 font-mono text-xs font-semibold">
                    {apogeeCode}
                  </span>
                </p>
              </div>

              {/* Dynamic badge based on face verification result */}
              {faceVerified ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-2">
                  <svg className="w-4 h-4 text-emerald-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-emerald-700 text-sm font-medium">
                    Vérification biométrique réussie — Votre compte sera activé automatiquement ✓
                  </p>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2">
                  <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-amber-700 text-sm font-medium">
                    Vérification non concluante — Votre compte sera examiné par un administrateur
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Mot de passe</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 6 caractères"
                  required
                  minLength={6}
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all bg-gray-50 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Confirmer le mot de passe</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Répétez le mot de passe"
                  required
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all bg-gray-50 focus:bg-white"
                />
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(3.5)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-3 rounded-xl transition-all"
                >
                  ← Retour
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-3 rounded-xl transition-all shadow-md shadow-emerald-100"
                >
                  Continuer →
                </button>
              </div>
            </form>
          )}

          {/* STEP 5 — Confirm */}
          {step === 5 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Vérification finale</h2>
                <p className="text-gray-500 text-sm">Confirmez vos informations avant de créer votre compte</p>
              </div>

              <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5 space-y-4">
                {/* Photo previews */}
                <div className="flex gap-4 justify-center">
                  {cinImage && (
                    <div className="flex flex-col items-center gap-1">
                      <img src={cinImage} alt="CIN" className="w-28 h-20 rounded-xl object-cover border-2 border-gray-200" />
                      <span className="text-gray-500 text-xs">Carte CIN</span>
                    </div>
                  )}
                  {selfieImage && (
                    <div className="flex flex-col items-center gap-1">
                      <img src={selfieImage} alt="Selfie" className="w-20 h-20 rounded-xl object-cover border-2 border-emerald-200" />
                      <span className="text-gray-500 text-xs">Selfie</span>
                    </div>
                  )}
                </div>

                {apogeeInfo && (
                  <div className="space-y-2 border-t border-gray-100 pt-4">
                    {[
                      { label: "Nom complet",   value: `${apogeeInfo.LIB_PR1_IND} ${apogeeInfo.LIB_NOM_PAT_IND}` },
                      { label: "Code Apogée",   value: apogeeCode },
                      { label: "CIN",           value: apogeeInfo.CIN_IND },
                      { label: "Filière",       value: apogeeInfo.COD_ETP || "N/A" },
                      { label: "Identifiant",   value: `${apogeeCode.toLowerCase()}@uae.ac.ma` },
                      {
                        label: "Vérif. visage",
                        value: faceVerified ? "✓ Correspondance confirmée — activation auto" : "⚠ Non concluant — validation admin requise",
                      },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex justify-between items-center gap-4">
                        <span className="text-gray-500 text-sm flex-shrink-0">{label}</span>
                        <span className={`text-sm font-medium text-right ${
                          label === "Vérif. visage"
                            ? faceVerified ? "text-emerald-600" : "text-amber-600"
                            : "text-gray-900"
                        }`}>{value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Status info box */}
              {faceVerified ? (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-2">
                  <svg className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  <p className="text-emerald-700 text-xs leading-relaxed">
                    Votre identité a été vérifiée biométriquement. Votre compte sera <strong>activé immédiatement</strong> après la création — vous pourrez vous connecter directement.
                  </p>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                  <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-amber-700 text-xs leading-relaxed">
                    La vérification automatique n'a pas pu confirmer votre identité. Votre dossier sera examiné manuellement par un administrateur avant activation.
                  </p>
                </div>
              )}

              {loading && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
                  <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <div>
                    <p className="text-emerald-700 text-sm font-medium">{loadingMsg}</p>
                    <p className="text-gray-500 text-xs mt-0.5">Ne fermez pas la page</p>
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(4)}
                  disabled={loading}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-700 font-semibold py-3 rounded-xl transition-all"
                >
                  ← Retour
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-200 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Création…
                    </>
                  ) : (
                    "✓ Créer le compte"
                  )}
                </button>
              </div>
            </div>
          )}

          <p className="text-center text-gray-500 text-sm mt-6">
            Déjà inscrit ?{" "}
            <Link to="/login" className="text-emerald-600 hover:text-emerald-700 font-medium transition-colors">
              Se connecter
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}