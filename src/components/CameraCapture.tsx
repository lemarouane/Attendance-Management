import { useRef, useState, useCallback } from "react";
import Webcam from "react-webcam";

interface CameraCaptureProps {
  title: string;
  subtitle: string;
  facingMode?: "user" | "environment";
  onCapture: (imageData: string) => void;
  onRetake?: () => void;
  capturedImage?: string | null;
  icon?: React.ReactNode;
}

export default function CameraCapture({
  title,
  subtitle,
  facingMode = "environment",
  onCapture,
  onRetake,
  capturedImage,
  icon,
}: CameraCaptureProps) {
  const webcamRef = useRef<Webcam>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string>("");
  const [flash, setFlash] = useState(false);

  const capture = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      // Flash effect
      setFlash(true);
      setTimeout(() => setFlash(false), 300);
      onCapture(imageSrc);
    }
  }, [onCapture]);

  const videoConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode,
  };

  // Already captured — show preview
  if (capturedImage) {
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <img
            src={capturedImage}
            alt="Captured"
            className="w-full max-w-xs rounded-2xl border-4 border-emerald-500/50 object-cover"
            style={{ maxHeight: "260px" }}
          />
          <div className="absolute top-3 right-3 bg-emerald-500 rounded-full p-1.5">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
        <p className="text-emerald-400 text-sm font-medium">✓ {title} captured</p>
        {onRetake && (
          <button
            type="button"
            onClick={onRetake}
            className="text-gray-400 hover:text-white text-sm underline underline-offset-2 transition-colors"
          >
            Retake photo
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Title */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          {icon && <span className="text-2xl">{icon}</span>}
          <h3 className="text-white font-semibold">{title}</h3>
        </div>
        <p className="text-gray-500 text-sm">{subtitle}</p>
      </div>

      {/* Camera viewport */}
      <div className="relative w-full max-w-xs overflow-hidden rounded-2xl bg-gray-900 border border-white/10">
        {/* Flash overlay */}
        {flash && (
          <div className="absolute inset-0 bg-white/80 z-10 rounded-2xl pointer-events-none" />
        )}

        {cameraError ? (
          <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
            <svg className="w-12 h-12 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            </svg>
            <p className="text-red-400 text-sm">{cameraError}</p>
            <button
              type="button"
              onClick={() => setCameraError("")}
              className="text-emerald-400 text-xs underline"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <Webcam
              ref={webcamRef}
              audio={false}
              screenshotFormat="image/png"
              videoConstraints={videoConstraints}
              onUserMedia={() => setCameraReady(true)}
              onUserMediaError={(err) => {
                const msg = err instanceof Error ? err.message : String(err);
                if (msg.includes("Permission") || msg.includes("NotAllowed")) {
                  setCameraError("Camera permission denied. Please allow camera access in your browser.");
                } else if (msg.includes("NotFound") || msg.includes("DevicesNotFound")) {
                  setCameraError("No camera found on this device.");
                } else {
                  setCameraError("Camera error: " + msg);
                }
              }}
              className="w-full rounded-2xl"
              style={{ display: "block", minHeight: "200px" }}
            />

            {/* Guide overlay */}
            {cameraReady && facingMode === "environment" && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="border-2 border-dashed border-white/30 rounded-xl"
                  style={{ width: "80%", height: "60%" }}
                />
              </div>
            )}

            {/* Loading state */}
            {!cameraReady && !cameraError && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-gray-500 text-sm">Starting camera...</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Capture button */}
      {cameraReady && !cameraError && (
        <button
          type="button"
          onClick={capture}
          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white font-semibold px-8 py-3 rounded-2xl transition-all duration-200 shadow-lg shadow-emerald-500/20"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Capture Photo
        </button>
      )}
    </div>
  );
}
