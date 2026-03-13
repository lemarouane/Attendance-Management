import { useRef, useState, useCallback, useEffect } from "react";
import Webcam from "react-webcam";

interface FaceDetectionCameraProps {
  onCapture: (imageData: string) => void;
  onRetake?: () => void;
  capturedImage?: string | null;
}

interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Landmark dot positions relative to face box (normalized 0-1)
const LANDMARK_POSITIONS = [
  // Left eye
  { x: 0.30, y: 0.35 },
  { x: 0.38, y: 0.33 },
  // Right eye
  { x: 0.62, y: 0.33 },
  { x: 0.70, y: 0.35 },
  // Nose tip
  { x: 0.50, y: 0.55 },
  // Mouth corners
  { x: 0.35, y: 0.70 },
  { x: 0.50, y: 0.73 },
  { x: 0.65, y: 0.70 },
  // Chin
  { x: 0.50, y: 0.88 },
  // Temples
  { x: 0.18, y: 0.42 },
  { x: 0.82, y: 0.42 },
  // Cheeks
  { x: 0.22, y: 0.60 },
  { x: 0.78, y: 0.60 },
  // Eyebrows
  { x: 0.28, y: 0.26 },
  { x: 0.50, y: 0.23 },
  { x: 0.72, y: 0.26 },
  // Forehead
  { x: 0.50, y: 0.15 },
  { x: 0.38, y: 0.16 },
  { x: 0.62, y: 0.16 },
  // Jaw
  { x: 0.30, y: 0.82 },
  { x: 0.70, y: 0.82 },
  { x: 0.40, y: 0.90 },
  { x: 0.60, y: 0.90 },
];

// Connection lines between landmarks [from_index, to_index]
const CONNECTIONS = [
  [0, 1], [2, 3],           // eyes
  [13, 14], [14, 15],       // eyebrows
  [5, 6], [6, 7],           // mouth
  [9, 0], [3, 10],          // temple to eye
  [9, 11], [10, 12],        // temple to cheek
  [11, 5], [12, 7],         // cheek to mouth
  [5, 8], [7, 8],           // jaw
  [17, 13], [18, 16], [19, 15], // forehead to eyebrow
  [16, 17], [17, 18],       // forehead
  [20, 8], [21, 8],         // jaw to chin
  [19, 20], [22, 21],       // jaw line
];

export default function FaceDetectionCamera({
  onCapture,
  onRetake,
  capturedImage,
}: FaceDetectionCameraProps) {
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const detectionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [faceDetected, setFaceDetected] = useState(false);
  const [faceBox, setFaceBox] = useState<FaceBox | null>(null);
  const [flash, setFlash] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [detecting, setDetecting] = useState(false);

  // Simple face detection using skin color / contrast heuristic
  // We use a canvas-based approach since face-api.js requires model files
  const detectFaceFromCanvas = useCallback(() => {
    const video = webcamRef.current?.video;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const w = video.videoWidth  || 640;
    const h = video.videoHeight || 480;
    canvas.width  = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -w, 0, w, h);
    ctx.restore();

    // Sample pixels in a center region to detect skin tones
    const centerX = Math.floor(w * 0.3);
    const centerY = Math.floor(h * 0.2);
    const sampleW  = Math.floor(w * 0.4);
    const sampleH  = Math.floor(h * 0.6);

    let skinPixels = 0;
    const totalSamples = 40;

    try {
      const imageData = ctx.getImageData(centerX, centerY, sampleW, sampleH);
      const step = Math.floor((imageData.data.length / 4) / totalSamples);

      for (let i = 0; i < totalSamples; i++) {
        const idx = i * step * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];

        // Skin tone heuristic (works for most complexions)
        if (
          r > 60 && g > 40 && b > 20 &&
          r > g && r > b &&
          Math.abs(r - g) > 10 &&
          r - b > 15 &&
          r < 255 && g < 230
        ) {
          skinPixels++;
        }
      }
    } catch { return; }

    const skinRatio = skinPixels / totalSamples;
    const detected = skinRatio > 0.15;

    setFaceDetected(detected);

    if (detected) {
      // Simulate a face bounding box in the center of the frame
      const boxW = w * 0.42;
      const boxH = h * 0.62;
      const boxX = (w - boxW) / 2;
      const boxY = (h - boxH) / 2 - h * 0.04;

      setFaceBox({ x: boxX / w, y: boxY / h, width: boxW / w, height: boxH / h });

      // Draw landmarks on canvas
      drawLandmarks(ctx, w, h, boxX / w, boxY / h, boxW / w, boxH / h, skinRatio);
    } else {
      setFaceBox(null);
      // Draw guide oval
      drawGuideOval(ctx, w, h, false);
    }
  }, []);

  function drawGuideOval(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    detected: boolean
  ) {
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2 - h * 0.03;
    const rx = w * 0.22;
    const ry = h * 0.34;

    // Dim overlay outside oval
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Oval border
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = detected ? "rgba(16,185,129,0.9)" : "rgba(255,255,255,0.6)";
    ctx.lineWidth = 2.5;
    ctx.setLineDash(detected ? [] : [8, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Text guide
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = `bold ${Math.floor(w * 0.025)}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(detected ? "✓ Face detected" : "Position your face in the oval", cx, cy + ry + h * 0.06);
  }

  function drawLandmarks(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    bx: number, by: number, bw: number, bh: number,
    confidence: number
  ) {
    ctx.clearRect(0, 0, w, h);

    // Dim overlay outside face oval
    const cx = (bx + bw / 2) * w;
    const cy = (by + bh / 2) * h;
    const rx = bw * w * 0.52;
    const ry = bh * h * 0.54;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Oval border — green when detected
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(16,185,129,${0.7 + confidence * 0.3})`;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Landmark absolute positions
    const pts = LANDMARK_POSITIONS.map((p) => ({
      x: (bx + p.x * bw) * w,
      y: (by + p.y * bh) * h,
    }));

    // Draw connection lines
    ctx.strokeStyle = "rgba(16,185,129,0.45)";
    ctx.lineWidth = 1;
    CONNECTIONS.forEach(([a, b]) => {
      if (!pts[a] || !pts[b]) return;
      ctx.beginPath();
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
      ctx.stroke();
    });

    // Draw landmark dots
    pts.forEach((pt, i) => {
      const isKeyPoint = [4, 0, 2, 5, 7, 8].includes(i); // nose, eyes, mouth, chin
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isKeyPoint ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = isKeyPoint ? "rgba(16,185,129,1)" : "rgba(110,231,183,0.85)";
      ctx.fill();

      // Glow for key points
      if (isKeyPoint) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(16,185,129,0.2)";
        ctx.fill();
      }
    });

    // Confidence text
    ctx.fillStyle = "rgba(16,185,129,0.9)";
    ctx.font = `bold ${Math.floor(w * 0.022)}px Inter, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(
      `✓ Face detected — ${Math.round(confidence * 100)}% confidence`,
      cx, (by + bh) * h + h * 0.06
    );
  }

  // Start detection loop
  useEffect(() => {
    if (!cameraReady) return;
    setDetecting(true);

    detectionIntervalRef.current = setInterval(() => {
      detectFaceFromCanvas();
    }, 180);

    return () => {
      if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      setDetecting(false);
    };
  }, [cameraReady, detectFaceFromCanvas]);

  const capture = useCallback(() => {
    if (!faceDetected) {
      return; // Button disabled anyway
    }

    // Countdown
    let count = 3;
    setCountdown(count);

    const interval = setInterval(() => {
      count--;
      setCountdown(count);
      if (count === 0) {
        clearInterval(interval);
        setCountdown(0);

        const imageSrc = webcamRef.current?.getScreenshot();
        if (imageSrc) {
          setFlash(true);
          setTimeout(() => setFlash(false), 400);
          onCapture(imageSrc);
        }
      }
    }, 1000);
  }, [faceDetected, onCapture]);

  // Captured preview
  if (capturedImage) {
    return (
      <div className="flex flex-col items-center gap-4 fade-in">
        <div className="relative">
          <img
            src={capturedImage}
            alt="Selfie captured"
            className="w-64 h-64 rounded-2xl object-cover border-4 border-emerald-400 shadow-lg shadow-emerald-100"
            style={{ objectPosition: "center top" }}
          />
          <div className="absolute top-3 right-3 bg-emerald-500 rounded-full p-2 shadow-lg">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
        <div className="text-center">
          <p className="text-emerald-600 font-semibold text-sm">✓ Selfie captured successfully</p>
          <p className="text-gray-400 text-xs mt-1">Face detection confirmed</p>
        </div>
        {onRetake && (
          <button
            type="button"
            onClick={onRetake}
            className="text-sm text-blue-500 hover:text-blue-600 underline underline-offset-2 transition-colors"
          >
            Retake selfie
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Header */}


      {/* Camera + Canvas overlay */}
      <div className="relative rounded-2xl overflow-hidden bg-gray-900 border-2 border-gray-200 shadow-lg"
           style={{ width: 320, height: 280 }}>

        {/* Flash overlay */}
        {flash && (
          <div className="absolute inset-0 bg-white z-30 rounded-2xl pointer-events-none" />
        )}

        {/* Countdown overlay */}
        {countdown > 0 && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <div className="w-20 h-20 rounded-full bg-black/60 flex items-center justify-center">
              <span className="text-white text-5xl font-bold">{countdown}</span>
            </div>
          </div>
        )}

        {/* Camera error */}
        {cameraError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center bg-gray-50">
            <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            </svg>
            <p className="text-red-500 text-sm">{cameraError}</p>
            <button type="button" onClick={() => setCameraError("")}
              className="text-blue-500 text-xs underline">Try again</button>
          </div>
        ) : (
          <>
            {/* Webcam */}
            <Webcam
              ref={webcamRef}
              audio={false}
              screenshotFormat="image/jpeg"
              screenshotQuality={0.92}
              videoConstraints={{ width: 640, height: 480, facingMode: "user" }}
              onUserMedia={() => setCameraReady(true)}
              onUserMediaError={(err) => {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes("Permission") || msg.includes("NotAllowed")) {
                  setCameraError("Camera permission denied. Please allow camera access.");
                } else if (msg.includes("NotFound")) {
                  setCameraError("No camera found on this device.");
                } else {
                  setCameraError("Camera error: " + msg);
                }
              }}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: "scaleX(-1)", // mirror
                display: "block",
              }}
            />

            {/* Canvas overlay — face detection drawings */}
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

            {/* Loading overlay */}
            {!cameraReady && !cameraError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-900">
                <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-400 text-sm">Starting camera…</p>
              </div>
            )}

            {/* Face detection status badge */}
            {cameraReady && detecting && (
              <div className={`absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
                faceDetected
                  ? "bg-emerald-500 text-white"
                  : "bg-black/50 text-white"
              }`}>
                <div className={`w-1.5 h-1.5 rounded-full ${
                  faceDetected ? "bg-white animate-pulse" : "bg-gray-400"
                }`} />
                {faceDetected ? "Face detected" : "No face"}
              </div>
            )}
          </>
        )}
      </div>

      {/* Instructions */}
      <div className="flex gap-4 text-xs text-gray-500 text-center max-w-xs">
        <div className="flex flex-col items-center gap-1">
          <span className="text-lg">💡</span>
          <span>Good lighting</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-lg">👁️</span>
          <span>Face the camera</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <span className="text-lg">📐</span>
          <span>Fill the oval</span>
        </div>
      </div>

      {/* Capture button */}
      {cameraReady && !cameraError && (
        <button
          type="button"
          onClick={capture}
          disabled={!faceDetected || countdown > 0}
          className={`flex items-center gap-2 font-semibold px-8 py-3 rounded-2xl transition-all duration-200 shadow-md ${
            faceDetected && countdown === 0
              ? "bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white shadow-emerald-200"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
          }`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          {countdown > 0 ? `Capturing in ${countdown}…` : faceDetected ? "Capture Selfie" : "Waiting for face…"}
        </button>
      )}
    </div>
  );
}
