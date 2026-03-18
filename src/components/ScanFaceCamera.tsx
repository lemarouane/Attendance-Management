import { useRef, useState, useCallback, useEffect } from "react";

interface ScanFaceCameraProps {
  /** Called when a face is confirmed and photo captured */
  onFaceCaptured: (imageData: string) => void;
  /** Whether the QR was just successfully scanned — triggers auto-capture */
  triggerCapture: boolean;
  /** Reset trigger after capture done */
  onCaptureComplete: () => void;
  /** Whether we're actively scanning (show live feed) */
  active: boolean;
}

// ── Face detection via skin-tone + structure heuristic ────────────────────────
// Runs entirely on-device, no model files needed.
// Uses a two-pass approach: (1) skin pixel ratio in center zone,
// (2) vertical gradient check for forehead/chin contrast.

const LANDMARK_PTS = [
  { x: 0.30, y: 0.34 }, { x: 0.38, y: 0.32 },  // left eye
  { x: 0.62, y: 0.32 }, { x: 0.70, y: 0.34 },  // right eye
  { x: 0.50, y: 0.54 },                           // nose
  { x: 0.35, y: 0.70 }, { x: 0.50, y: 0.73 }, { x: 0.65, y: 0.70 }, // mouth
  { x: 0.50, y: 0.87 },                           // chin
  { x: 0.18, y: 0.42 }, { x: 0.82, y: 0.42 },   // temples
  { x: 0.22, y: 0.59 }, { x: 0.78, y: 0.59 },   // cheeks
  { x: 0.28, y: 0.25 }, { x: 0.50, y: 0.22 }, { x: 0.72, y: 0.25 }, // eyebrows
  { x: 0.50, y: 0.14 }, { x: 0.38, y: 0.15 }, { x: 0.62, y: 0.15 }, // forehead
  { x: 0.30, y: 0.81 }, { x: 0.70, y: 0.81 },   // jaw
];

const CONNECTIONS = [
  [0,1],[2,3],[13,14],[14,15],[5,6],[6,7],
  [9,0],[3,10],[9,11],[10,12],[11,5],[12,7],
  [5,8],[7,8],[16,17],[17,18],[19,20],
];

function isSkinPixel(r: number, g: number, b: number): boolean {
  return (
    r > 60 && g > 40 && b > 20 &&
    r > g && r > b &&
    Math.abs(r - g) > 8 &&
    r - b > 10 &&
    r < 255 && g < 235 &&
    // exclude very dark pixels (shadows / clothing)
    r + g + b > 150
  );
}

export default function ScanFaceCamera({
  onFaceCaptured,
  triggerCapture,
  onCaptureComplete,
  active,
}: ScanFaceCameraProps) {
  const videoRef   = useRef<HTMLVideoElement>(null);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const captureRef = useRef<HTMLCanvasElement>(null);
  const streamRef  = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capturingRef = useRef(false);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [faceDetected, setFaceDetected] = useState(false);
  const [confidence, setConfidence] = useState(0);
  const [flash, setFlash] = useState(false);
  const [captured, setCaptured] = useState(false);

  // ── Start camera ────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setCameraReady(true);
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Permission") || msg.includes("NotAllowed")) {
        setCameraError("Permission caméra refusée.");
      } else if (msg.includes("NotFound")) {
        setCameraError("Aucune caméra trouvée.");
      } else {
        setCameraError("Erreur caméra.");
      }
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
    setCaptured(false);
  }, []);

  useEffect(() => {
    if (active) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => stopCamera();
  }, [active, startCamera, stopCamera]);

  // ── Detection loop ──────────────────────────────────────────────────────────
  const detectFace = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const W = video.videoWidth  || 640;
    const H = video.videoHeight || 480;
    canvas.width  = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw mirrored frame for analysis
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -W, 0, W, H);
    ctx.restore();

    // ── Pass 1: skin pixels in face zone ─────────────────────────────────────
    const zoneX = Math.floor(W * 0.25);
    const zoneY = Math.floor(H * 0.10);
    const zoneW = Math.floor(W * 0.50);
    const zoneH = Math.floor(H * 0.70);

    let skinCount = 0;
    const SAMPLES = 60;

    let imageData: ImageData;
    try {
      imageData = ctx.getImageData(zoneX, zoneY, zoneW, zoneH);
    } catch { return; }

    const step = Math.max(1, Math.floor((imageData.data.length / 4) / SAMPLES));
    for (let i = 0; i < SAMPLES; i++) {
      const idx = i * step * 4;
      if (idx + 2 >= imageData.data.length) break;
      const r = imageData.data[idx];
      const g = imageData.data[idx + 1];
      const b = imageData.data[idx + 2];
      if (isSkinPixel(r, g, b)) skinCount++;
    }

    const skinRatio  = skinCount / SAMPLES;

    // ── Pass 2: vertical brightness gradient (forehead lighter than neck) ────
    let topBrightness = 0, bottomBrightness = 0;
    const topData    = ctx.getImageData(Math.floor(W*0.3), Math.floor(H*0.1), Math.floor(W*0.4), Math.floor(H*0.15));
    const bottomData = ctx.getImageData(Math.floor(W*0.3), Math.floor(H*0.7), Math.floor(W*0.4), Math.floor(H*0.15));

    for (let i = 0; i < topData.data.length; i += 4) {
      topBrightness += (topData.data[i] + topData.data[i+1] + topData.data[i+2]) / 3;
    }
    for (let i = 0; i < bottomData.data.length; i += 4) {
      bottomBrightness += (bottomData.data[i] + bottomData.data[i+1] + bottomData.data[i+2]) / 3;
    }
    topBrightness    /= (topData.data.length / 4);
    bottomBrightness /= (bottomData.data.length / 4);
    const brightnessVariance = Math.abs(topBrightness - bottomBrightness);

    // Combine: skin ratio + some brightness variance = face present
    const faceScore = skinRatio * 0.75 + Math.min(brightnessVariance / 80, 1) * 0.25;
    const detected  = faceScore > 0.20 && skinRatio > 0.12;

    setFaceDetected(detected);
    setConfidence(detected ? Math.min(faceScore * 1.4, 1) : 0);

    // ── Draw overlay ──────────────────────────────────────────────────────────
    ctx.clearRect(0, 0, W, H);

    const bx = 0.25, by = 0.08, bw = 0.50, bh = 0.72;
    const cx = (bx + bw/2) * W;
    const cy = (by + bh/2) * H;
    const rx = bw * W * 0.50;
    const ry = bh * H * 0.52;

    // Dim outside
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.40)";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Oval border
    const color = detected ? "rgba(52,211,153,0.95)" : "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = detected ? 3 : 2;
    ctx.setLineDash(detected ? [] : [10, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (detected) {
      // Landmark points
      const pts = LANDMARK_PTS.map((p) => ({
        x: (bx + p.x * bw) * W,
        y: (by + p.y * bh) * H,
      }));

      // Connection lines
      ctx.strokeStyle = "rgba(52,211,153,0.40)";
      ctx.lineWidth = 1;
      CONNECTIONS.forEach(([a, b]) => {
        if (!pts[a] || !pts[b]) return;
        ctx.beginPath();
        ctx.moveTo(pts[a].x, pts[a].y);
        ctx.lineTo(pts[b].x, pts[b].y);
        ctx.stroke();
      });

      // Dots
      pts.forEach((pt, i) => {
        const key = [4, 0, 2, 5, 7, 8].includes(i);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, key ? 3.5 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = key ? "rgba(52,211,153,1)" : "rgba(110,231,183,0.80)";
        ctx.fill();
        if (key) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(52,211,153,0.18)";
          ctx.fill();
        }
      });
    }

    // Guide text
    ctx.fillStyle = detected ? "rgba(52,211,153,0.95)" : "rgba(255,255,255,0.75)";
    ctx.font = `bold ${Math.floor(W * 0.025)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(
      detected
        ? `✓ Visage détecté — ${Math.round(Math.min(faceScore * 140, 99))}%`
        : "Positionnez votre visage dans l'ovale",
      W / 2,
      (by + bh) * H + H * 0.06
    );
  }, []);

  useEffect(() => {
    if (!cameraReady) return;
    intervalRef.current = setInterval(detectFace, 150);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [cameraReady, detectFace]);

  // ── Auto-capture when QR scan succeeds ──────────────────────────────────────
  useEffect(() => {
    if (!triggerCapture || !cameraReady || capturingRef.current || captured) return;
    if (!faceDetected) {
      // Face not visible — caller should handle the warning
      onCaptureComplete();
      return;
    }

    capturingRef.current = true;

    // Small delay to ensure frame is fresh
    setTimeout(() => {
      const video   = videoRef.current;
      const capture = captureRef.current;
      if (!video || !capture) { capturingRef.current = false; onCaptureComplete(); return; }

      const W = video.videoWidth  || 640;
      const H = video.videoHeight || 480;
      capture.width  = W;
      capture.height = H;

      const ctx = capture.getContext("2d");
      if (!ctx) { capturingRef.current = false; onCaptureComplete(); return; }

      // Mirror like the visible feed
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -W, 0, W, H);
      ctx.restore();

      setFlash(true);
      setTimeout(() => setFlash(false), 350);
      setCaptured(true);

      const imageData = capture.toDataURL("image/jpeg", 0.92);
      onFaceCaptured(imageData);
      capturingRef.current = false;
      onCaptureComplete();
    }, 80);
  }, [triggerCapture, cameraReady, faceDetected, captured, onFaceCaptured, onCaptureComplete]);

  // Reset captured state when trigger is cleared
  useEffect(() => {
    if (!triggerCapture) setCaptured(false);
  }, [triggerCapture]);

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Overlay header */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-sm ${
          faceDetected
            ? "bg-emerald-500/90 text-white"
            : "bg-black/50 text-white/80"
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${faceDetected ? "bg-white animate-pulse" : "bg-white/50"}`} />
          {cameraReady
            ? faceDetected
              ? `Visage détecté`
              : "Aucun visage"
            : "Démarrage…"
          }
        </div>

        {faceDetected && confidence > 0 && (
          <div className="bg-black/50 backdrop-blur-sm text-white/90 text-xs px-2 py-1 rounded-full font-mono">
            {Math.round(Math.min(confidence * 99, 99))}%
          </div>
        )}
      </div>

      {/* Camera view */}
      <div className="relative flex-1 bg-slate-900 overflow-hidden" style={{ minHeight: 220 }}>
        {/* Flash */}
        {flash && (
          <div className="absolute inset-0 bg-white z-30 pointer-events-none rounded-xl animate-pulse" />
        )}

        {cameraError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            </svg>
            <p className="text-red-400 text-xs">{cameraError}</p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              muted
              playsInline
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: "scaleX(-1)",
                display: "block",
              }}
            />
            <canvas
              ref={canvasRef}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                transform: "scaleX(-1)",
                pointerEvents: "none",
              }}
            />
            {/* Hidden capture canvas */}
            <canvas ref={captureRef} style={{ display: "none" }} />

            {!cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-slate-400 text-xs">Démarrage caméra…</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Status bar */}
      <div className="px-3 py-2 bg-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            !cameraReady ? "bg-slate-500" :
            faceDetected ? "bg-emerald-400 animate-pulse" :
            "bg-amber-400 animate-pulse"
          }`} />
          <span className="text-slate-400 text-xs">
            {!cameraReady
              ? "En attente de la caméra"
              : faceDetected
              ? "Prêt à capturer"
              : "Aucun visage détecté"}
          </span>
        </div>
        <span className="text-slate-500 text-xs">Caméra visage</span>
      </div>
    </div>
  );
}