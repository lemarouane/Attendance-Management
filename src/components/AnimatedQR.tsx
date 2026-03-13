import { useEffect, useState, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { generateQRPayload } from "../utils/qrToken";

interface AnimatedQRProps {
  uid: string;
}

export default function AnimatedQR({ uid }: AnimatedQRProps) {
  const [qrValue, setQrValue] = useState<string>("");
  const [countdown, setCountdown] = useState(5);
  const [flash, setFlash] = useState(false);

  const refresh = useCallback(() => {
    const payload = generateQRPayload(uid);
    setQrValue(JSON.stringify(payload));
    setCountdown(5);
    setFlash(true);
    setTimeout(() => setFlash(false), 300);
  }, [uid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          refresh();
          return 5;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  const circumference = 2 * Math.PI * 20;
  const dashOffset = circumference - (countdown / 5) * circumference;

  return (
    <div className="flex flex-col items-center gap-4">
      {/* QR Code Container */}
      <div
        className={`relative p-4 rounded-2xl bg-white transition-all duration-300 qr-pulse glow ${
          flash ? "scale-95 opacity-70" : "scale-100 opacity-100"
        }`}
        style={{ boxShadow: "0 0 30px rgba(16,185,129,0.4)" }}
      >
        {qrValue && (
          <QRCodeSVG
            value={qrValue}
            size={220}
            level="H"
            includeMargin={false}
            fgColor="#0f172a"
            bgColor="#ffffff"
          />
        )}

        {/* Corner decorations */}
        <div className="absolute top-2 left-2 w-6 h-6 border-t-2 border-l-2 border-emerald-400 rounded-tl" />
        <div className="absolute top-2 right-2 w-6 h-6 border-t-2 border-r-2 border-emerald-400 rounded-tr" />
        <div className="absolute bottom-2 left-2 w-6 h-6 border-b-2 border-l-2 border-emerald-400 rounded-bl" />
        <div className="absolute bottom-2 right-2 w-6 h-6 border-b-2 border-r-2 border-emerald-400 rounded-br" />
      </div>

      {/* Countdown Timer */}
      <div className="flex items-center gap-3">
        <svg width="52" height="52" className="transform -rotate-90">
          <circle
            cx="26"
            cy="26"
            r="20"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="4"
          />
          <circle
            cx="26"
            cy="26"
            r="20"
            fill="none"
            stroke="#10b981"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 1s linear" }}
          />
          <text
            x="26"
            y="26"
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-white text-sm font-bold"
            transform="rotate(90, 26, 26)"
            style={{ fontSize: "14px", fontWeight: "bold", fill: "white" }}
          >
            {countdown}
          </text>
        </svg>
        <div>
          <p className="text-emerald-400 text-sm font-semibold">Auto-refresh in {countdown}s</p>
          <p className="text-gray-500 text-xs">QR changes to prevent sharing</p>
        </div>
      </div>

      {/* Security Badge */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-emerald-400 text-xs font-medium">Dynamic QR — Secured</span>
      </div>
    </div>
  );
}
