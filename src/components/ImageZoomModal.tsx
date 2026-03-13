import { useEffect, useState, useRef } from "react";

interface ImageZoomModalProps {
  src: string;
  alt?: string;
  label?: string;
  trigger?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export default function ImageZoomModal({ src, alt, label, trigger, className, children }: ImageZoomModalProps) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const lastPos  = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
      setZoom(1);
      setPan({ x: 0, y: 0 });
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(z + 0.5, 5));
      if (e.key === "-") setZoom((z) => Math.max(z - 0.5, 0.5));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    setZoom((z) => Math.min(Math.max(z - e.deltaY * 0.005, 0.5), 5));
  }

  function onMouseDown(e: React.MouseEvent) {
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  }
  function onMouseMove(e: React.MouseEvent) {
    if (!dragging.current) return;
    setPan((p) => ({
      x: p.x + e.clientX - lastPos.current.x,
      y: p.y + e.clientY - lastPos.current.y,
    }));
    lastPos.current = { x: e.clientX, y: e.clientY };
  }
  function onMouseUp() { dragging.current = false; }

  if (!src) return null;

  return (
    <>
      {/* Trigger */}
      <div
        onClick={() => setOpen(true)}
        className={`cursor-zoom-in group relative ${className || ""}`}
        title="Cliquer pour agrandir"
      >
        {children || trigger || (
          <div className="relative">
            <img
              src={src}
              alt={alt || label || "Photo"}
              className="w-full h-full object-cover rounded-xl border border-slate-200 transition-all group-hover:brightness-90"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-xl bg-black/20">
              <div className="bg-white/90 rounded-lg px-2 py-1 flex items-center gap-1">
                <svg className="w-3.5 h-3.5 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                </svg>
                <span className="text-xs font-medium text-slate-700">Zoom</span>
              </div>
            </div>
          </div>
        )}
        {label && <p className="text-center text-xs text-slate-500 mt-1.5 font-medium">{label}</p>}
      </div>

      {/* Lightbox */}
      {open && (
        <div
          className="fixed inset-0 z-[9999] flex flex-col"
          style={{ background: "rgba(0,0,0,0.92)", backdropFilter: "blur(8px)" }}
        >
          {/* Top bar */}
          <div className="flex items-center justify-between px-6 py-4 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <span className="text-white font-medium text-sm">{label || alt || "Photo"}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Zoom controls */}
              <div className="flex items-center gap-1 bg-white/10 rounded-xl p-1">
                <button
                  onClick={() => setZoom((z) => Math.max(z - 0.5, 0.5))}
                  className="w-8 h-8 rounded-lg hover:bg-white/10 text-white flex items-center justify-center text-lg transition-colors"
                >−</button>
                <span className="text-white text-xs font-mono px-2 min-w-[40px] text-center">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  onClick={() => setZoom((z) => Math.min(z + 0.5, 5))}
                  className="w-8 h-8 rounded-lg hover:bg-white/10 text-white flex items-center justify-center text-lg transition-colors"
                >+</button>
              </div>
              <button
                onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors"
              >
                Réinitialiser
              </button>
              <button
                onClick={() => setOpen(false)}
                className="w-9 h-9 rounded-xl bg-white/10 hover:bg-red-500 text-white flex items-center justify-center transition-colors text-lg"
              >
                ×
              </button>
            </div>
          </div>

          {/* Image area */}
          <div
            className="flex-1 flex items-center justify-center overflow-hidden select-none"
            onWheel={onWheel}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
            style={{ cursor: zoom > 1 ? "grab" : "zoom-in" }}
          >
            <img
              src={src}
              alt={alt || "Photo"}
              draggable={false}
              style={{
                transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                transition: dragging.current ? "none" : "transform 0.2s ease",
                maxWidth: "88vw",
                maxHeight: "78vh",
                objectFit: "contain",
                borderRadius: "12px",
                boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
                userSelect: "none",
                pointerEvents: "none",
              }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>

          {/* Bottom hint */}
          <div className="text-center py-4 text-white/40 text-xs flex-shrink-0">
            Molette pour zoomer • Glisser pour déplacer • Échap pour fermer
          </div>
        </div>
      )}
    </>
  );
}
