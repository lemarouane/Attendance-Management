import { useRef, useState, useCallback, useEffect } from "react";

declare const jsQR: (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: string }
) => { data: string } | null;

interface DualZoneScannerProps {
  onScanWithFace: (qrData: string, faceImageData: string) => void;
  onScanNoFace: (qrData: string) => void;
  active: boolean;
  onStart: () => void;
  onStop: () => void;
  salleeName?: string;
}

function isSkinPixel(r: number, g: number, b: number): boolean {
  return (
    r > 55 && g > 35 && b > 15 &&
    r > g && r > b &&
    r - b > 12 &&
    Math.abs(r - g) > 6 &&
    r < 252 && g < 230 &&
    r + g + b > 130
  );
}

function detectFaceInRegion(
  imageData: ImageData,
  rx: number, ry: number, rw: number, rh: number,
  fullW: number
): { detected: boolean; score: number } {
  const SAMPLES = 80;
  let skinCount = 0;
  const pixels = imageData.data;

  for (let i = 0; i < SAMPLES; i++) {
    const sx = rx + Math.floor((i % 8) * (rw / 8) + rw / 16);
    const sy = ry + Math.floor(Math.floor(i / 8) * (rh / 10) + rh / 20);
    const idx = (sy * fullW + sx) * 4;
    if (idx + 2 >= pixels.length) continue;
    if (isSkinPixel(pixels[idx], pixels[idx + 1], pixels[idx + 2])) skinCount++;
  }

  const skinRatio = skinCount / SAMPLES;

  let topSum = 0, topN = 0, botSum = 0, botN = 0;
  const sampleStep = Math.max(1, Math.floor(rw / 20));
  for (let x = rx + Math.floor(rw * 0.2); x < rx + Math.floor(rw * 0.8); x += sampleStep) {
    for (let y = ry; y < ry + Math.floor(rh * 0.22); y += sampleStep) {
      const idx = (y * fullW + x) * 4;
      if (idx + 2 < pixels.length) { topSum += (pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3; topN++; }
    }
    for (let y = ry + Math.floor(rh * 0.72); y < ry + rh; y += sampleStep) {
      const idx = (y * fullW + x) * 4;
      if (idx + 2 < pixels.length) { botSum += (pixels[idx] + pixels[idx+1] + pixels[idx+2]) / 3; botN++; }
    }
  }
  const topAvg = topN > 0 ? topSum / topN : 0;
  const botAvg = botN > 0 ? botSum / botN : 0;
  const gradient = Math.abs(topAvg - botAvg) / 255;

  const score = skinRatio * 0.70 + gradient * 0.30;
  return { detected: score > 0.17 && skinRatio > 0.09, score: Math.min(score * 1.6, 1) };
}

const LANDMARKS = [
  { x: 0.30, y: 0.34 }, { x: 0.38, y: 0.32 },
  { x: 0.62, y: 0.32 }, { x: 0.70, y: 0.34 },
  { x: 0.50, y: 0.54 },
  { x: 0.35, y: 0.70 }, { x: 0.50, y: 0.73 }, { x: 0.65, y: 0.70 },
  { x: 0.50, y: 0.87 },
  { x: 0.18, y: 0.42 }, { x: 0.82, y: 0.42 },
  { x: 0.22, y: 0.59 }, { x: 0.78, y: 0.59 },
  { x: 0.28, y: 0.25 }, { x: 0.50, y: 0.22 }, { x: 0.72, y: 0.25 },
  { x: 0.50, y: 0.14 },
  { x: 0.30, y: 0.81 }, { x: 0.70, y: 0.81 },
];
const CONNECTIONS = [
  [0,1],[2,3],[13,14],[14,15],[5,6],[6,7],
  [9,0],[3,10],[9,11],[10,12],[11,5],[12,7],[5,8],[7,8],
];

// Helper: draw text that is readable even when the video underneath is CSS-mirrored.
// We flip the context locally around the text anchor point.
function drawMirroredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  align: CanvasTextAlign = "center"
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(-1, 1);
  ctx.textAlign = align;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

export default function DualZoneScanner({
  onScanWithFace, onScanNoFace,
  active, onStart, onStop, salleeName,
}: DualZoneScannerProps) {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const workerRef     = useRef<HTMLCanvasElement>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const loopRef       = useRef<number>(0);
  const processingRef = useRef(false);
  const jsQrLoadedRef = useRef(false);
  const containerRef  = useRef<HTMLDivElement>(null);

  const [cameraReady, setCameraReady]   = useState(false);
  const [scanning, setScanning]         = useState(false);
  const [cameraError, setCameraError]   = useState("");
  const [faceDetected, setFaceDetected] = useState(false);
  const [lastQrFlash, setLastQrFlash]   = useState(0);

  useEffect(() => {
    if (typeof jsQR !== "undefined") { jsQrLoadedRef.current = true; return; }
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js";
    script.onload = () => { jsQrLoadedRef.current = true; };
    document.head.appendChild(script);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError("");
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play();
        setCameraReady(true);
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setCameraError(
        msg.includes("Permission") || msg.includes("NotAllowed") ? "Permission caméra refusée." :
        msg.includes("NotFound") ? "Aucune caméra trouvée." : `Erreur caméra: ${msg}`
      );
    }
  }, []);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(loopRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCameraReady(false);
    setScanning(false);
    setFaceDetected(false);
  }, []);

  const captureFaceZone = useCallback((
    video: HTMLVideoElement,
    faceZoneX: number,
    faceZoneY: number,
    faceZoneW: number,
    faceZoneH: number,
    videoW: number,
    videoH: number,
  ): string => {
    const pad = Math.floor(Math.min(faceZoneW, faceZoneH) * 0.1);
    const cropX = Math.max(0, faceZoneX - pad);
    const cropY = Math.max(0, faceZoneY - pad);
    const cropW = Math.min(faceZoneW + pad * 2, videoW - cropX);
    const cropH = Math.min(faceZoneH + pad * 2, videoH - cropY);

    const maxOut  = 480;
    const scale   = Math.min(1, maxOut / cropW);
    const outW    = Math.round(cropW * scale);
    const outH    = Math.round(cropH * scale);

    const captureCanvas  = document.createElement("canvas");
    captureCanvas.width  = outW;
    captureCanvas.height = outH;
    const ctx = captureCanvas.getContext("2d")!;

    ctx.drawImage(
      video,
      cropX, cropY, cropW, cropH,
      0, 0, outW, outH
    );

    const dataUrl = captureCanvas.toDataURL("image/jpeg", 0.88);
    console.log(`📸 [DualZone] Face zone captured: ${outW}x${outH}, dataURL length=${dataUrl.length}`);
    return dataUrl;
  }, []);

  const runLoop = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    const worker = workerRef.current;
    if (!video || !canvas || !worker || video.readyState < 2) {
      loopRef.current = requestAnimationFrame(runLoop);
      return;
    }

    const VW = video.videoWidth  || 1280;
    const VH = video.videoHeight || 720;

    if (worker.width !== VW || worker.height !== VH) {
      worker.width  = VW;
      worker.height = VH;
    }

    const wCtx = worker.getContext("2d", { willReadFrequently: true })!;
    wCtx.drawImage(video, 0, 0, VW, VH);

    // ── Zone geometry ──────────────────────────────────────────────────────
    // The video is CSS-mirrored (scaleX(-1)), so what appears on the LEFT of
    // the screen is actually the RIGHT side of the raw video frame.
    // We keep the raw-frame coordinates for detection, and the canvas overlay
    // is drawn in raw-frame space too (no CSS transform on the canvas).
    // Text is drawn with a local flip so it reads correctly over the mirrored video.

    const faceZoneX = Math.floor(VW * 0.03);
    const faceZoneY = Math.floor(VH * 0.07);
    const faceZoneW = Math.floor(VW * 0.40);
    const faceZoneH = Math.floor(VH * 0.80);

    const qrSize  = Math.floor(Math.min(VW * 0.40, VH * 0.70));
    const qrZoneX = Math.floor(VW * 0.56);
    const qrZoneY = Math.floor((VH - qrSize) / 2);
    const qrZoneW = qrSize;
    const qrZoneH = qrSize;

    // ── Face detection ─────────────────────────────────────────────────────
    let faceData: ImageData;
    try {
      faceData = wCtx.getImageData(0, 0, VW, VH);
    } catch {
      loopRef.current = requestAnimationFrame(runLoop);
      return;
    }
    const { detected, score } = detectFaceInRegion(faceData, faceZoneX, faceZoneY, faceZoneW, faceZoneH, VW);
    setFaceDetected(detected);

    // ── QR detection ──────────────────────────────────────────────────────
    if (!processingRef.current && jsQrLoadedRef.current) {
      try {
        const qrImageData = wCtx.getImageData(qrZoneX, qrZoneY, qrZoneW, qrZoneH);
        const code = jsQR(qrImageData.data, qrZoneW, qrZoneH, { inversionAttempts: "dontInvert" });

        if (code && code.data) {
          processingRef.current = true;
          setLastQrFlash(Date.now());

          const qrData  = code.data;
          const hasFace = detected;

          let faceImageData = "";
          if (hasFace) {
            try {
              faceImageData = captureFaceZone(
                video,
                faceZoneX, faceZoneY, faceZoneW, faceZoneH,
                VW, VH
              );
            } catch (err) {
              console.error("❌ [DualZone] Face capture failed:", err);
            }
          }

          console.log(`🔍 [DualZone] QR detected. hasFace=${hasFace}, faceDataLen=${faceImageData.length}`);

          setTimeout(() => {
            if (hasFace && faceImageData.length > 100) {
              onScanWithFace(qrData, faceImageData);
            } else {
              onScanNoFace(qrData);
            }
            setTimeout(() => { processingRef.current = false; }, 3000);
          }, 0);
        }
      } catch { /* ignore QR decode errors */ }
    }

    // ── Draw overlay ──────────────────────────────────────────────────────
    if (canvas.width !== VW || canvas.height !== VH) {
      canvas.width  = VW;
      canvas.height = VH;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, VW, VH);

    // The canvas has NO css transform — it sits in raw-frame space.
    // The video underneath has scaleX(-1), so the canvas overlay aligns
    // correctly with shapes/zones. Only text needs a local flip.

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, 0, VW, VH);

    // ── Face oval cut-out ─────────────────────────────────────────────────
    const faceCX = faceZoneX + faceZoneW / 2;
    const faceCY = faceZoneY + faceZoneH / 2;
    const faceRX = faceZoneW * 0.47;
    const faceRY = faceZoneH * 0.50;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.ellipse(faceCX, faceCY, faceRX, faceRY, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Face oval border
    const faceGreen = detected ? `rgba(52,211,153,${0.75 + score * 0.25})` : "rgba(255,255,255,0.50)";
    ctx.beginPath();
    ctx.ellipse(faceCX, faceCY, faceRX, faceRY, 0, 0, Math.PI * 2);
    ctx.strokeStyle = faceGreen;
    ctx.lineWidth   = detected ? 3 : 2;
    ctx.setLineDash(detected ? [] : [10, 6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Landmark mesh
    if (detected) {
      const pts = LANDMARKS.map(p => ({
        x: faceZoneX + p.x * faceZoneW,
        y: faceZoneY + p.y * faceZoneH,
      }));
      ctx.strokeStyle = "rgba(52,211,153,0.38)";
      ctx.lineWidth = 1;
      CONNECTIONS.forEach(([a, b]) => {
        if (!pts[a] || !pts[b]) return;
        ctx.beginPath(); ctx.moveTo(pts[a].x, pts[a].y); ctx.lineTo(pts[b].x, pts[b].y); ctx.stroke();
      });
      pts.forEach((pt, i) => {
        const key = [4,0,2,5,7,8].includes(i);
        ctx.beginPath(); ctx.arc(pt.x, pt.y, key ? 3.5 : 2.5, 0, Math.PI*2);
        ctx.fillStyle = key ? "rgba(52,211,153,1)" : "rgba(110,231,183,0.80)"; ctx.fill();
        if (key) {
          ctx.beginPath(); ctx.arc(pt.x, pt.y, 7, 0, Math.PI*2);
          ctx.fillStyle = "rgba(52,211,153,0.18)"; ctx.fill();
        }
      });
    }

    // ── QR square cut-out ─────────────────────────────────────────────────
    const qrR = qrZoneW * 0.05;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.roundRect(qrZoneX, qrZoneY, qrZoneW, qrZoneH, qrR);
    ctx.fill();
    ctx.restore();

    // QR flash
    const timeSinceFlash = Date.now() - lastQrFlash;
    if (timeSinceFlash < 400) {
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(99,102,241,${0.4 * (1 - timeSinceFlash / 400)})`;
      ctx.beginPath(); ctx.roundRect(qrZoneX, qrZoneY, qrZoneW, qrZoneH, qrR); ctx.fill();
      ctx.restore();
    }

    // QR border + corners
    ctx.beginPath(); ctx.roundRect(qrZoneX, qrZoneY, qrZoneW, qrZoneH, qrR);
    ctx.strokeStyle = "rgba(99,102,241,0.80)"; ctx.lineWidth = 2.5;
    ctx.setLineDash([12, 5]); ctx.stroke(); ctx.setLineDash([]);

    const bLen = qrZoneW * 0.13;
    ctx.strokeStyle = "rgba(129,140,248,1)"; ctx.lineWidth = 4; ctx.lineCap = "round";
    ([[qrZoneX, qrZoneY, 1, 1],[qrZoneX+qrZoneW, qrZoneY, -1, 1],[qrZoneX, qrZoneY+qrZoneH, 1, -1],[qrZoneX+qrZoneW, qrZoneY+qrZoneH, -1, -1]] as [number,number,number,number][]).forEach(([cx,cy,dx,dy]) => {
      ctx.beginPath(); ctx.moveTo(cx+dx*bLen, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy+dy*bLen); ctx.stroke();
    });

    // ── Labels (all text uses local flip so it reads correctly) ───────────
    const fs = Math.max(11, Math.floor(VW * 0.018));

    // VISAGE pill
    drawPill(ctx, faceCX, faceZoneY - fs * 0.9, "VISAGE", detected ? "#34d399" : "#94a3b8", fs * 0.82);

    // VISAGE status text below oval
    ctx.font = `bold ${fs}px system-ui,-apple-system,sans-serif`;
    ctx.fillStyle = detected ? "rgba(52,211,153,0.95)" : "rgba(255,255,255,0.75)";
    drawMirroredText(
      ctx,
      detected ? `✓ Visage détecté  ${Math.round(score * 99)}%` : "Positionnez votre visage →",
      faceCX,
      faceZoneY + faceZoneH + fs * 1.7
    );

    // CODE QR pill
    drawPill(ctx, qrZoneX + qrZoneW / 2, qrZoneY - fs * 0.9, "CODE QR", "#818cf8", fs * 0.82);

    // QR hint text below box
    ctx.fillStyle = "rgba(165,180,252,0.95)";
    drawMirroredText(
      ctx,
      "← Tenez votre QR ici",
      qrZoneX + qrZoneW / 2,
      qrZoneY + qrZoneH + fs * 1.7
    );

    // Divider
    ctx.beginPath(); ctx.moveTo(VW * 0.5, VH * 0.04); ctx.lineTo(VW * 0.5, VH * 0.96);
    ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 1;
    ctx.setLineDash([5,5]); ctx.stroke(); ctx.setLineDash([]);

    loopRef.current = requestAnimationFrame(runLoop);
  }, [onScanWithFace, onScanNoFace, lastQrFlash, captureFaceZone]);

  // drawPill: pill background drawn normally (no flip needed for shapes),
  // text inside the pill is locally flipped so it reads correctly.
  function drawPill(ctx: CanvasRenderingContext2D, cx: number, cy: number, text: string, color: string, fs: number) {
    ctx.font = `bold ${fs}px system-ui,sans-serif`;
    const tw = ctx.measureText(text).width;
    const pw = tw + fs * 1.8; const ph = fs * 1.6; const pr = ph / 2;

    // Pill background + border — no flip needed, shapes are symmetric
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath(); ctx.roundRect(cx-pw/2, cy-ph/2, pw, ph, pr); ctx.fill();
    ctx.strokeStyle = color + "99"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(cx-pw/2, cy-ph/2, pw, ph, pr); ctx.stroke();

    // Text — locally flipped so it reads correctly over the mirrored video
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    drawMirroredText(ctx, text, cx, cy, "center");
    ctx.textBaseline = "alphabetic";
  }

  const startScanning = useCallback(async () => {
    if (!cameraReady) await startCamera();
    setScanning(true);
    onStart();
    loopRef.current = requestAnimationFrame(runLoop);
  }, [cameraReady, startCamera, onStart, runLoop]);

  const stopScanning = useCallback(() => {
    cancelAnimationFrame(loopRef.current);
    setScanning(false);
    processingRef.current = false;
    onStop();
  }, [onStop]);

  useEffect(() => {
    if (active && !cameraReady) startCamera();
    if (!active) { stopScanning(); stopCamera(); }
  }, [active]); // eslint-disable-line

  useEffect(() => {
    if (cameraReady && scanning) {
      cancelAnimationFrame(loopRef.current);
      loopRef.current = requestAnimationFrame(runLoop);
    }
  }, [cameraReady, scanning, runLoop]);

  useEffect(() => () => { cancelAnimationFrame(loopRef.current); stopCamera(); }, []); // eslint-disable-line

  return (
    <div className="card overflow-hidden flex flex-col">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-slate-900 flex items-center gap-2">
            Scanner double zone
            {scanning && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                Actif
              </span>
            )}
          </h3>
          <p className="text-slate-500 text-sm mt-0.5">
            {salleeName ? `Salle : ${salleeName}` : "Visage à gauche · QR à droite"}
          </p>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${faceDetected ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-500 border-slate-200"}`}>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          {faceDetected ? "Visage ✓" : "Pas de visage"}
        </div>
      </div>

      <div ref={containerRef} className="relative bg-slate-900 w-full" style={{ aspectRatio: "16/9" }}>
        {cameraError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-red-900/30 flex items-center justify-center">
              <svg className="w-7 h-7 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              </svg>
            </div>
            <p className="text-red-400 text-sm font-medium">{cameraError}</p>
          </div>
        ) : !active ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-slate-600 flex items-center justify-center">
              <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              </svg>
            </div>
            <p className="text-slate-500 text-sm">Caméra désactivée</p>
          </div>
        ) : (
          <>
            {/* Video is CSS-mirrored so movement feels natural (like a mirror).
                The canvas overlay has NO transform — it draws in raw-frame space.
                Text inside the canvas is locally flipped to stay readable. */}
            <video
              ref={videoRef}
              muted
              playsInline
              style={{
                position: "absolute", inset: 0,
                width: "100%", height: "100%",
                objectFit: "cover", display: "block",
                transform: "scaleX(-1)",
              }}
            />
            <canvas
              ref={canvasRef}
              style={{
                position: "absolute", inset: 0,
                width: "100%", height: "100%",
                pointerEvents: "none",
                // No transform — overlay stays in raw-frame coordinate space
              }}
            />
            <canvas ref={workerRef} style={{ display:"none" }} />
            {!cameraReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-7 h-7 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-slate-400 text-sm">Démarrage caméra…</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {active && cameraReady && (
        <div className="grid grid-cols-2 divide-x divide-slate-100 border-t border-slate-100">
          <div className={`flex items-center gap-2 px-4 py-3 transition-colors ${faceDetected ? "bg-emerald-50" : "bg-slate-50"}`}>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${faceDetected ? "bg-emerald-100" : "bg-slate-200"}`}>
              <svg className={`w-4 h-4 ${faceDetected ? "text-emerald-600" : "text-slate-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <p className={`text-xs font-bold ${faceDetected ? "text-emerald-700" : "text-slate-600"}`}>{faceDetected ? "Visage détecté ✓" : "Zone VISAGE"}</p>
              <p className="text-slate-400 text-xs">Côté gauche de la caméra</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-4 py-3 bg-slate-50">
            <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-600">Zone CODE QR</p>
              <p className="text-slate-400 text-xs">Côté droit de la caméra</p>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 border-t border-slate-100">
        {!scanning ? (
          <button onClick={startScanning} disabled={!!cameraError}
            className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 disabled:opacity-40 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-200">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.36a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Démarrer le scanner
          </button>
        ) : (
          <button onClick={stopScanning}
            className="w-full bg-red-50 hover:bg-red-100 text-red-600 font-bold py-3 rounded-xl transition-all border-2 border-red-200 flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            </svg>
            Arrêter le scanner
          </button>
        )}
      </div>
    </div>
  );
}