"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export type SignaturePadHandle = { toBlob: () => Promise<Blob | null>; clear: () => void; isEmpty: () => boolean };

/** Finger or mouse signature, exported as a PNG on a white background. */
export const SignaturePad = forwardRef<SignaturePadHandle, { onChange?: (empty: boolean) => void }>(function SignaturePad({ onChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const strokes = useRef(0);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
  }, []);

  const point = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const clear = () => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    strokes.current = 0;
    setEmpty(true);
    onChange?.(true);
  };

  useImperativeHandle(ref, () => ({
    clear,
    isEmpty: () => strokes.current < 2,
    toBlob: () =>
      new Promise((resolve) => {
        if (strokes.current < 2) return resolve(null);
        canvasRef.current!.toBlob((b) => resolve(b), "image/png");
      }),
  }));

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="h-36 w-full touch-none rounded-lg border border-line bg-white"
        onPointerDown={(e) => {
          drawing.current = true;
          last.current = point(e);
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const ctx = canvasRef.current!.getContext("2d")!;
          const p = point(e);
          ctx.beginPath();
          ctx.moveTo(last.current.x, last.current.y);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          last.current = p;
          strokes.current += 1;
          if (empty && strokes.current > 2) {
            setEmpty(false);
            onChange?.(false);
          }
        }}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
        }}
      />
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>Receiver signs here</span>
        <button type="button" className="underline" onClick={clear}>
          Clear
        </button>
      </div>
    </div>
  );
});
