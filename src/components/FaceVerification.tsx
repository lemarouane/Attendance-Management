import { useEffect, useRef, useState } from "react";

interface FaceVerificationProps {
  cinImage: string;
  selfieImage: string;
  attemptNumber: number;   // passed from parent — which attempt this is
  maxAttempts: number;     // passed from parent — 5
  onSuccess: () => void;
  onRetake: () => void;    // retake selfie only
  onRetakeCIN: () => void; // retake CIN + selfie
  onContinueAnyway?: () => void; // only passed when attemptNumber >= maxAttempts
}

type VerificationStatus =
  | "loading_script"
  | "loading_models"
  | "extracting"
  | "comparing"
  | "success"
  | "failed"
  | "error";

interface LoadStep {
  label: string;
  done: boolean;
  active: boolean;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    faceapi: any;
  }
}

const MODEL_BASE  = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model";
const FACEAPI_CDN = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
const BASE_THRESHOLD = 0.52;

export default function FaceVerification({
  cinImage,
  selfieImage,
  attemptNumber,
  maxAttempts,
  onSuccess,
  onRetake,
  onRetakeCIN,
  onContinueAnyway,
}: FaceVerificationProps) {
  const [status, setStatus] = useState<VerificationStatus>("loading_script");
  const [steps, setSteps] = useState<LoadStep[]>([
    { label: "Chargement du moteur face-api.js",    done: false, active: true  },
    { label: "Modèle de détection (SSD MobileNet)", done: false, active: false },
    { label: "Modèle de landmarks (68 points)",     done: false, active: false },
    { label: "Modèle de reconnaissance faciale",    done: false, active: false },
    { label: "Extraction descripteur CIN",          done: false, active: false },
    { label: "Extraction descripteur Selfie",       done: false, active: false },
    { label: "Comparaison des visages",             done: false, active: false },
  ]);
  const [similarity, setSimilarity]             = useState<number>(0);
  const [distance, setDistance]                 = useState<number>(0);
  const [usedThreshold, setUsedThreshold]       = useState<number>(BASE_THRESHOLD);
  const [cinConfidence, setCinConfidence]       = useState<number>(0);
  const [selfieConfidence, setSelfieConfidence] = useState<number>(0);
  const [errorMsg, setErrorMsg]                 = useState("");
  const [cinPreviewLandmarks, setCinPreviewLandmarks]       = useState<string | null>(null);
  const [selfiePreviewLandmarks, setSelfiePreviewLandmarks] = useState<string | null>(null);

  const cinCanvasRef    = useRef<HTMLCanvasElement>(null);
  const selfieCanvasRef = useRef<HTMLCanvasElement>(null);
  const ranRef          = useRef(false);

  const attemptsLeft   = Math.max(0, maxAttempts - attemptNumber);
  const showEscapeHatch = !!onContinueAnyway; // parent only passes it when limit reached

  function markStep(index: number, done = true) {
    setSteps((prev) =>
      prev.map((s, i) => ({
        ...s,
        done:   i < index ? true : i === index ? done : s.done,
        active: i === index + 1,
      }))
    );
  }

  function loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.faceapi) { resolve(); return; }
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", reject);
        return;
      }
      const script = document.createElement("script");
      script.src         = src;
      script.crossOrigin = "anonymous";
      script.onload      = () => resolve();
      script.onerror     = () => reject(new Error("Failed to load face-api.js from CDN"));
      document.head.appendChild(script);
    });
  }

  function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = src;
    });
  }

  function preprocessImage(img: HTMLImageElement): HTMLCanvasElement {
    const canvas  = document.createElement("canvas");
    const scale   = Math.min(1, 640 / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    canvas.width  = (img.naturalWidth  || img.width)  * scale;
    canvas.height = (img.naturalHeight || img.height) * scale;
    const ctx     = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data      = imageData.data;
    let min = 255, max = 0;
    for (let i = 0; i < data.length; i += 4) {
      const brightness = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (brightness < min) min = brightness;
      if (brightness > max) max = brightness;
    }
    const range = max - min || 1;
    if (range < 180) {
      for (let i = 0; i < data.length; i += 4) {
        data[i]     = Math.min(255, ((data[i]     - min) / range) * 255);
        data[i + 1] = Math.min(255, ((data[i + 1] - min) / range) * 255);
        data[i + 2] = Math.min(255, ((data[i + 2] - min) / range) * 255);
      }
      ctx.putImageData(imageData, 0, 0);
    }
    return canvas;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function detectWithFallback(source: HTMLImageElement | HTMLCanvasElement): Promise<any | null> {
    const faceapi        = window.faceapi;
    const confidenceLevels = [0.5, 0.4, 0.3, 0.2];
    for (const minConfidence of confidenceLevels) {
      const opts = new faceapi.SsdMobilenetv1Options({ minConfidence });
      const det  = await faceapi
        .detectSingleFace(source, opts)
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (det) return det;
    }
    return null;
  }

  function computeAdaptiveThreshold(cinScore: number, selfieScore: number): number {
    const avgScore = (cinScore + selfieScore) / 2;
    if (avgScore >= 0.85) return 0.50;
    if (avgScore >= 0.70) return 0.55;
    if (avgScore >= 0.55) return 0.60;
    return 0.65;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function drawLandmarksPreview(img: HTMLImageElement | HTMLCanvasElement, detection: any): string {
    const canvas  = document.createElement("canvas");
    const srcW    = "naturalWidth"  in img ? (img.naturalWidth  || img.width)  : img.width;
    const srcH    = "naturalHeight" in img ? (img.naturalHeight || img.height) : img.height;
    canvas.width  = srcW;
    canvas.height = srcH;
    const ctx     = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);

    const box   = detection.detection.box;
    const score = detection.detection.score;

    ctx.strokeStyle = "rgba(16,185,129,0.9)";
    ctx.lineWidth   = Math.max(2, canvas.width * 0.003);
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    const badgeText = `${Math.round(score * 100)}% det.`;
    ctx.fillStyle   = score >= 0.7 ? "rgba(16,185,129,0.85)" : "rgba(245,158,11,0.85)";
    ctx.fillRect(box.x, box.y - 22, box.width, 22);
    ctx.fillStyle   = "#fff";
    ctx.font        = `bold ${Math.max(11, canvas.width * 0.018)}px monospace`;
    ctx.textAlign   = "center";
    ctx.fillText(badgeText, box.x + box.width / 2, box.y - 6);
    ctx.textAlign   = "left";

    const positions = detection.landmarks.positions;
    ctx.strokeStyle = "rgba(16,185,129,0.5)";
    ctx.lineWidth   = Math.max(1, canvas.width * 0.002);

    for (let i = 0;  i < 16; i++) { ctx.beginPath(); ctx.moveTo(positions[i].x, positions[i].y); ctx.lineTo(positions[i+1].x, positions[i+1].y); ctx.stroke(); }
    for (let i = 17; i < 21; i++) { ctx.beginPath(); ctx.moveTo(positions[i].x, positions[i].y); ctx.lineTo(positions[i+1].x, positions[i+1].y); ctx.stroke(); }
    for (let i = 22; i < 26; i++) { ctx.beginPath(); ctx.moveTo(positions[i].x, positions[i].y); ctx.lineTo(positions[i+1].x, positions[i+1].y); ctx.stroke(); }
    for (let i = 27; i < 30; i++) { ctx.beginPath(); ctx.moveTo(positions[i].x, positions[i].y); ctx.lineTo(positions[i+1].x, positions[i+1].y); ctx.stroke(); }
    for (let i = 36; i < 41; i++) { ctx.beginPath(); ctx.moveTo(positions[i].x, positions[i].y); ctx.lineTo(positions[i+1].x, positions[i+1].y); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(positions[41].x, positions[41].y); ctx.lineTo(positions[36].x, positions[36].y); ctx.stroke();
    for (let i = 42; i < 47; i++) { ctx.beginPath(); ctx.moveTo(positions[i].x, positions[i].y); ctx.lineTo(positions[i+1].x, positions[i+1].y); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(positions[47].x, positions[47].y); ctx.lineTo(positions[42].x, positions[42].y); ctx.stroke();
    for (let i = 48; i < 59; i++) { ctx.beginPath(); ctx.moveTo(positions[i].x, positions[i].y); ctx.lineTo(positions[i+1].x, positions[i+1].y); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(positions[59].x, positions[59].y); ctx.lineTo(positions[48].x, positions[48].y); ctx.stroke();

    positions.forEach((pt: { x: number; y: number }, i: number) => {
      const isKey = [30, 33, 36, 39, 42, 45, 48, 54].includes(i);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isKey ? Math.max(3, canvas.width * 0.004) : Math.max(2, canvas.width * 0.003), 0, Math.PI * 2);
      ctx.fillStyle = isKey ? "rgba(16,185,129,1)" : "rgba(110,231,183,0.9)";
      ctx.fill();
    });

    return canvas.toDataURL("image/jpeg", 0.92);
  }

  async function runVerification() {
    if (ranRef.current) return;
    ranRef.current = true;

    try {
      setStatus("loading_script");
      await loadScript(FACEAPI_CDN);
      markStep(0);

      const faceapi = window.faceapi;
      if (!faceapi) throw new Error("face-api.js failed to initialize");

      setStatus("loading_models");
      await faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_BASE);    markStep(1);
      await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_BASE); markStep(2);
      await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_BASE); markStep(3);

      setStatus("extracting");
      markStep(4, false);

      const cinImg       = await loadImage(cinImage);
      const cinCanvas    = preprocessImage(cinImg);
      const cinDetection = await detectWithFallback(cinCanvas);

      if (!cinDetection) {
        setStatus("error");
        setErrorMsg(
          "Aucun visage détecté sur la photo de la CIN. " +
          "Assurez-vous que la carte est bien à plat, bien éclairée, et que la photo du visage est nette et visible."
        );
        return;
      }

      setCinConfidence(Math.round(cinDetection.detection.score * 100));
      setCinPreviewLandmarks(drawLandmarksPreview(cinCanvas, cinDetection));
      markStep(4);

      markStep(5, false);
      const selfieImg       = await loadImage(selfieImage);
      const selfieCanvas    = preprocessImage(selfieImg);
      const selfieDetection = await detectWithFallback(selfieCanvas);

      if (!selfieDetection) {
        setStatus("error");
        setErrorMsg(
          "Aucun visage détecté sur le selfie. " +
          "Assurez-vous d'être bien éclairé(e), face à la caméra, sans lunettes de soleil."
        );
        return;
      }

      setSelfieConfidence(Math.round(selfieDetection.detection.score * 100));
      setSelfiePreviewLandmarks(drawLandmarksPreview(selfieCanvas, selfieDetection));
      markStep(5);

      setStatus("comparing");
      markStep(6, false);

      const dist      = faceapi.euclideanDistance(cinDetection.descriptor, selfieDetection.descriptor);
      const threshold = computeAdaptiveThreshold(cinDetection.detection.score, selfieDetection.detection.score);
      const sim       = Math.max(0, Math.min(100, (1 - dist) * 100));

      setDistance(dist);
      setSimilarity(Math.round(sim));
      setUsedThreshold(threshold);
      markStep(6);

      setStatus(dist < threshold ? "success" : "failed");

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus("error");
      setErrorMsg(msg);
    }
  }

  useEffect(() => {
    runVerification();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLoading = ["loading_script", "loading_models", "extracting", "comparing"].includes(status);

  function StepList() {
    return (
      <div className="space-y-2 w-full">
        {steps.map((s, i) => (
          <div key={i} className={`flex items-center gap-3 px-3 py-2 rounded-xl transition-all ${
            s.done ? "bg-emerald-50" : s.active ? "bg-blue-50" : "bg-gray-50"
          }`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
              s.done ? "bg-emerald-500" : s.active ? "bg-blue-500" : "bg-gray-200"
            }`}>
              {s.done ? (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : s.active ? (
                <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
              ) : (
                <div className="w-2 h-2 bg-gray-400 rounded-full" />
              )}
            </div>
            <span className={`text-sm ${
              s.done   ? "text-emerald-700 font-medium" :
              s.active ? "text-blue-700 font-medium"    :
                         "text-gray-400"
            }`}>{s.label}</span>
            {s.active && (
              <div className="ml-auto w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        ))}
      </div>
    );
  }

  function ConfidencePill({ value, label }: { value: number; label: string }) {
    const color = value >= 70 ? "text-emerald-600 bg-emerald-50 border-emerald-200"
                : value >= 50 ? "text-amber-600 bg-amber-50 border-amber-200"
                :               "text-red-600 bg-red-50 border-red-200";
    return (
      <div className={`flex flex-col items-center px-3 py-1.5 rounded-lg border text-xs font-medium ${color}`}>
        <span className="font-mono font-bold text-sm">{value}%</span>
        <span className="text-[10px] opacity-70">{label}</span>
      </div>
    );
  }

  function SimilarityBar({ pct, threshold }: { pct: number; threshold: number }) {
    const thresholdPct = Math.round((1 - threshold) * 100);
    const color        = pct >= thresholdPct ? "bg-emerald-500" : pct >= thresholdPct - 10 ? "bg-amber-500" : "bg-red-500";
    return (
      <div className="w-full">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>0%</span>
          <span className="font-semibold text-gray-700">{pct}% similarité</span>
          <span>100%</span>
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all duration-1000 ${color}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="relative h-4 mt-0.5">
          <div className="absolute top-0 h-4 w-0.5 bg-gray-400" style={{ left: `${thresholdPct}%`, transform: "translateX(-50%)" }} />
          <div className="absolute top-0 text-[10px] text-gray-400 whitespace-nowrap" style={{ left: `${thresholdPct}%`, transform: "translateX(-50%)" }}>
            <span style={{ display: "block", marginTop: "4px" }}>seuil {thresholdPct}%</span>
          </div>
        </div>
        <p className="text-center text-xs text-gray-400 mt-2">
          Seuil adaptatif : distance &lt; {threshold.toFixed(2)}
        </p>
      </div>
    );
  }

  // Dots showing how many full capture cycles they've used
  function AttemptTracker() {
    if (attemptNumber === 0) return null;
    return (
      <div className="flex flex-col items-center gap-2 py-1">
        <div className="flex items-center gap-1.5">
 
        </div>
 
      </div>
    );
  }

  function EscapeHatch({ context }: { context: "failed" | "error" }) {
    if (!showEscapeHatch) return null;
    return (
      <div className="border border-dashed border-amber-300 bg-amber-50 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <svg className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-amber-700 text-xs leading-relaxed">

            {" "}<strong>Un administrateur examinera vos photos</strong> avant d'activer votre compte.
          </p>
        </div>
        <button
          onClick={onContinueAnyway}
          className="w-full bg-amber-100 hover:bg-amber-200 text-amber-800 font-semibold py-2.5 rounded-xl transition-all text-sm border border-amber-300"
        >
          Continuer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Title + attempt badge */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 mb-3">
          <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-gray-900">Vérification biométrique</h2>
        <p className="text-gray-500 text-sm mt-1">
          Comparaison de votre visage avec la photo sur votre CIN
        </p>
 
      </div>

      {isLoading && <StepList />}

      {(cinPreviewLandmarks || selfiePreviewLandmarks) && (
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col items-center gap-2">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Photo CIN</div>
            {cinPreviewLandmarks ? (
              <>
                <img src={cinPreviewLandmarks} alt="CIN landmarks" className="w-full rounded-xl border-2 border-emerald-200 object-cover" style={{ maxHeight: 140, objectFit: "cover" }} />
                {cinConfidence > 0 && <ConfidencePill value={cinConfidence} label="détection" />}
              </>
            ) : (
              <div className="w-full h-32 rounded-xl bg-gray-100 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Selfie</div>
            {selfiePreviewLandmarks ? (
              <>
                <img src={selfiePreviewLandmarks} alt="Selfie landmarks" className="w-full rounded-xl border-2 border-emerald-200 object-cover" style={{ maxHeight: 140, objectFit: "cover" }} />
                {selfieConfidence > 0 && <ConfidencePill value={selfieConfidence} label="détection" />}
              </>
            ) : (
              <div className="w-full h-32 rounded-xl bg-gray-100 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>
        </div>
      )}

      {(cinConfidence > 0 || selfieConfidence > 0) &&
       (cinConfidence < 60 || selfieConfidence < 60) &&
       (status === "success" || status === "failed") && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex gap-2 items-start">
          <span className="text-amber-500 text-base flex-shrink-0">⚠️</span>
          <p className="text-amber-700 text-xs leading-relaxed">
            {cinConfidence < 60 && selfieConfidence < 60
              ? "La qualité des deux images est faible. Le seuil a été ajusté automatiquement."
              : cinConfidence < 60
              ? "La qualité de la photo CIN est faible. Le seuil a été ajusté."
              : "La qualité du selfie est faible. Essayez dans une pièce mieux éclairée."}
          </p>
        </div>
      )}

      <canvas ref={cinCanvasRef}    className="hidden" />
      <canvas ref={selfieCanvasRef} className="hidden" />

      {/* ── SUCCESS ── */}
      {status === "success" && (
        <div className="space-y-4">
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center space-y-3">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100">
              <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-emerald-700 font-semibold text-base">Visage correspondant ✓</p>
              <p className="text-emerald-600 text-sm mt-1">
                Distance : <span className="font-mono font-bold">{distance.toFixed(4)}</span>
                {" "}— Seuil : <span className="font-mono">{usedThreshold.toFixed(2)}</span>
              </p>
            </div>
            <SimilarityBar pct={similarity} threshold={usedThreshold} />
          </div>
          <button
            onClick={onSuccess}
            className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-3 rounded-xl transition-all shadow-md shadow-emerald-100"
          >
            Continuer vers l'étape suivante →
          </button>
        </div>
      )}

      {/* ── FAILED ── */}
      {status === "failed" && (
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-center space-y-3">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-100">
              <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <p className="text-red-700 font-semibold text-base">Visage non correspondant</p>
              <p className="text-red-600 text-sm mt-1">
                Le visage du selfie ne correspond pas à la photo sur votre CIN.
              </p>
              <p className="text-gray-500 text-xs mt-2">
                Distance : <span className="font-mono font-bold">{distance.toFixed(4)}</span>
                {" "}— Seuil adaptatif : <span className="font-mono">{usedThreshold.toFixed(2)}</span>
              </p>
            </div>
            <SimilarityBar pct={similarity} threshold={usedThreshold} />
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-amber-800 text-sm font-medium mb-2">💡 Conseils pour améliorer :</p>
            <ul className="text-amber-700 text-xs space-y-1 list-disc list-inside">
              {selfieConfidence < 70 && <li>Selfie peu clair — essayez près d'une fenêtre ou avec plus de lumière</li>}
              {cinConfidence < 70    && <li>Photo CIN peu claire — recadrez, évitez les reflets</li>}
              <li>Retirez vos lunettes pour le selfie si vous n'en portez pas sur la CIN</li>
              <li>Regardez directement vers la caméra, expression neutre</li>
              <li>Vérifiez que c'est bien la face avant de la CIN avec votre photo</li>
            </ul>
          </div>

          <div className="space-y-3">
            {/* Two retake options — selfie only, or full redo */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={onRetake}
                disabled={attemptsLeft === 0}
                className="bg-red-500 hover:bg-red-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all text-sm"
              >
                ↩ Nouveau selfie
              </button>
              <button
                onClick={onRetakeCIN}
                disabled={attemptsLeft === 0}
                className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all text-sm"
              >
                ↩ Reprendre CIN
              </button>
            </div>
            <AttemptTracker />
          </div>

          <EscapeHatch context="failed" />
        </div>
      )}

      {/* ── ERROR ── */}
      {status === "error" && (
        <div className="space-y-4">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-5 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-red-700 font-semibold text-sm">Erreur de détection</p>
                <p className="text-red-600 text-xs mt-1 leading-relaxed">{errorMsg}</p>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <p className="text-blue-800 text-sm font-medium mb-2">📋 Instructions pour la photo CIN :</p>
            <ul className="text-blue-700 text-xs space-y-1 list-disc list-inside">
              <li>Posez la carte à plat sur une surface sombre et unie</li>
              <li>Éclairage uniforme — évitez les reflets et ombres</li>
              <li>La photo du visage doit être visible, nette, non couverte</li>
              <li>Cadrez la carte en entier — occupez 70% du cadre minimum</li>
            </ul>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={onRetake}
                disabled={attemptsLeft === 0}
                className="bg-gray-100 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed text-gray-700 font-semibold py-3 rounded-xl transition-all text-sm"
              >
                ↩ Nouveau selfie
              </button>
              <button
                onClick={onRetakeCIN}
                disabled={attemptsLeft === 0}
                className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all text-sm"
              >
                ↩ Reprendre CIN
              </button>
            </div>
            <AttemptTracker />
          </div>

          <EscapeHatch context="error" />
        </div>
      )}
    </div>
  );
}