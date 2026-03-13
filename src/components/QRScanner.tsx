import { useEffect, useRef, useState, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";

interface QRScannerProps {
  onScan: (data: string) => void;
  onError?: (error: string) => void;
  active?: boolean;
}

// Generate a unique ID per instance to avoid DOM conflicts with React StrictMode
let scannerInstanceCount = 0;

export function QRScanner({ onScan, onError, active = true }: QRScannerProps) {
  const [instanceId] = useState(() => `qr-scanner-${++scannerInstanceCount}`);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isRunningRef = useRef(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const lastScanRef = useRef<string>("");
  const lastScanTimeRef = useRef<number>(0);
  const SCAN_COOLDOWN = 3000;

  const stopScanner = useCallback(async () => {
    if (scannerRef.current && isRunningRef.current) {
      try {
        await scannerRef.current.stop();
      } catch {
        // ignore stop errors
      }
      isRunningRef.current = false;
      setIsRunning(false);
    }
  }, []);

  const startScanner = useCallback(async () => {
    if (isRunningRef.current || isStarting) return;

    const el = document.getElementById(instanceId);
    if (!el) return;

    setIsStarting(true);

    try {
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(instanceId);
      }

      await scannerRef.current.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 260, height: 260 },
          aspectRatio: 1.0,
        },
        (decodedText) => {
          const now = Date.now();
          if (
            decodedText === lastScanRef.current &&
            now - lastScanTimeRef.current < SCAN_COOLDOWN
          ) {
            return;
          }
          lastScanRef.current = decodedText;
          lastScanTimeRef.current = now;
          onScan(decodedText);
        },
        () => {
          // per-frame errors — ignore
        }
      );

      isRunningRef.current = true;
      setIsRunning(true);
      setCameraError(null);
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : "Camera access denied.";
      setCameraError(errMsg);
      onError?.(errMsg);
    } finally {
      setIsStarting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, isStarting, onScan]);

  // Handle active/inactive toggling
  useEffect(() => {
    if (active) {
      startScanner();
    } else {
      stopScanner();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current && isRunningRef.current) {
        scannerRef.current.stop().catch(() => {});
        isRunningRef.current = false;
      }
    };
  }, []);

  const handleRetry = () => {
    setCameraError(null);
    if (scannerRef.current) {
      scannerRef.current = null;
    }
    isRunningRef.current = false;
    setTimeout(() => startScanner(), 300);
  };

  if (cameraError) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-red-950/30 border-2 border-red-800/50 rounded-2xl gap-4">
        <div className="w-16 h-16 bg-red-900/40 rounded-full flex items-center justify-center">
          <svg
            className="w-8 h-8 text-red-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </div>
        <div className="text-center">
          <h3 className="font-semibold text-red-300 mb-1">Camera Error</h3>
          <p className="text-sm text-red-400 max-w-xs">{cameraError}</p>
          <p className="text-xs text-red-500 mt-2">
            Allow camera access in browser settings, then click Retry.
          </p>
        </div>
        <button
          onClick={handleRetry}
          className="px-5 py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 transition-colors"
        >
          Retry Camera
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Scanner mount point */}
      <div
        id={instanceId}
        className="rounded-2xl overflow-hidden"
        style={{ minHeight: "300px" }}
      />

      {/* Scan frame overlay */}
      {isRunning && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="relative w-64 h-64">
            {/* Corner brackets */}
            <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-green-400 rounded-tl-lg" />
            <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-green-400 rounded-tr-lg" />
            <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-green-400 rounded-bl-lg" />
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-green-400 rounded-br-lg" />
            {/* Animated scan line */}
            <div
              className="absolute left-2 right-2 h-0.5 bg-green-400 rounded-full"
              style={{
                animation: "scanLine 2s linear infinite",
                boxShadow: "0 0 10px rgba(74, 222, 128, 0.9)",
                top: "8px",
              }}
            />
          </div>
        </div>
      )}

      {/* Loading state */}
      {!isRunning && !cameraError && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 rounded-2xl">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-purple-500 border-t-transparent" />
            <span className="text-sm text-white/70 font-medium">
              {isStarting ? "Starting camera..." : "Initializing..."}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
