import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, RotateCcw, RotateCw, ZoomIn, ZoomOut, Check, RefreshCw } from 'lucide-react';

export interface AspectOption {
 label: string;
 value: number | null; // null = free (use the photo's own shape)
}

interface Props {
 file: File | null;
 title?: string;
 /** Crop-frame choices. Default: free crop. */
 aspects?: AspectOption[];
 /** Longest output side in px (downscaled JPEG — always under server caps). */
 maxOutputPx?: number;
 onCancel: () => void;
 onDone: (file: File) => void;
}

const MAX_ZOOM = 5;
const MIN_ZOOM = 1; // 1 = image just covers the crop frame

/**
 * In-app image editor: rotate 90° steps, pinch/wheel/buttons zoom, drag to
 * pan, crop to a chosen aspect. Everything renders on a canvas; Apply exports
 * a source-resolution JPEG (long side capped at maxOutputPx, default 1080 —
 * the Instagram master standard: crisp on retina, light on bandwidth).
 *
 * Decoding tries createImageBitmap with EXIF orientation first, then an <img>
 * fallback. Files the browser cannot decode (e.g. desktop-picked HEIC) get a
 * clear "use JPG/PNG" message instead of a silent failure.
 */
export default function ImageEditorModal({ file, title = 'Edit photo', aspects = [{ label: 'Free', value: null }], maxOutputPx = 1080, onCancel, onDone }: Props) {
 const canvasRef = useRef<HTMLCanvasElement>(null);
 const bitmapRef = useRef<ImageBitmap | HTMLImageElement | null>(null);
 const [ready, setReady] = useState(false);
 const [fatal, setFatal] = useState('');
 const [rotation, setRotation] = useState(0); // 0 | 90 | 180 | 270
 const [aspectIdx, setAspectIdx] = useState(0);
 const [zoom, setZoom] = useState(1);
 const [offset, setOffset] = useState({ x: 0, y: 0 });
 const offsetRef = useRef(offset);
 offsetRef.current = offset;
 const [exporting, setExporting] = useState(false);

 const aspect = aspects[aspectIdx]?.value ?? null;

 // ── Decode the file once ──
 useEffect(() => {
 let dead = false;
 setReady(false);
 setFatal('');
 if (!file) return;
 (async () => {
 try {
 let bmp: ImageBitmap | HTMLImageElement | null = null;
 try {
 bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
 } catch {
 // Older browsers: no options support / no bitmap support. <img> respects EXIF in modern engines.
 bmp = await new Promise<HTMLImageElement>((res, rej) => {
 const img = new Image();
 const url = URL.createObjectURL(file);
 img.onload = () => res(img);
 img.onerror = () => rej(new Error('decode'));
 img.src = url;
 });
 }
 if (dead) return;
 bitmapRef.current = bmp;
 setReady(true);
 } catch {
 if (!dead) setFatal("This photo's format can't be read by your browser. Try a JPG or PNG (iPhone: Settings → Camera → Formats → Most Compatible, or share the photo as 'Actual Size').");
 }
 })();
 return () => {
 dead = true;
 };
 }, [file]);

 const rotatedDims = useMemo(() => {
 const b = bitmapRef.current;
 if (!b) return { w: 1, h: 1 };
 const w = 'width' in b ? b.width : 0;
 const h = 'height' in b ? b.height : 0;
 return rotation % 180 === 0 ? { w, h } : { w: h, h: w };
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [rotation, ready]);

 // Frame size: fit within the viewport, honoring the aspect (null = photo's shape)
 const frame = useMemo(() => {
 const maxW = Math.min(560, window.innerWidth - 48);
 const maxH = Math.min(window.innerHeight * 0.55, 480);
 const a = aspect ?? rotatedDims.w / rotatedDims.h;
 let w = maxW;
 let h = w / a;
 if (h > maxH) {
 h = maxH;
 w = h * a;
 }
 return { w: Math.round(w), h: Math.round(h) };
 }, [aspect, rotatedDims]);

 // Cover scale: smallest scale where the rotated image fully covers the frame
 const coverScale = useMemo(() => {
 const b = bitmapRef.current;
 if (!b) return 1;
 return Math.max(frame.w / rotatedDims.w, frame.h / rotatedDims.h);
 }, [frame, rotatedDims]);

 // Reset pan/zoom whenever the geometry changes
 useEffect(() => {
 setOffset({ x: 0, y: 0 });
 setZoom(1);
 }, [aspectIdx, rotation, ready]);

 const clampOffset = useCallback((ox: number, oy: number, z: number) => {
 const b = bitmapRef.current;
 if (!b) return { x: 0, y: 0 };
 const scale = coverScale * z;
 const imgW = rotatedDims.w * scale;
 const imgH = rotatedDims.h * scale;
 const maxX = Math.max(0, (imgW - frame.w) / 2);
 const maxY = Math.max(0, (imgH - frame.h) / 2);
 return { x: Math.min(maxX, Math.max(-maxX, ox)), y: Math.min(maxY, Math.max(-maxY, oy)) };
 }, [coverScale, frame, rotatedDims]);

 // ── Render loop ──
 useEffect(() => {
 const canvas = canvasRef.current;
 const b = bitmapRef.current;
 if (!canvas || !b || !ready) return;
 const dpr = Math.min(window.devicePixelRatio || 1, 2);
 canvas.width = frame.w * dpr;
 canvas.height = frame.h * dpr;
 const ctx = canvas.getContext('2d');
 if (!ctx) return;
 ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
 ctx.clearRect(0, 0, frame.w, frame.h);
 ctx.fillStyle = '#111';
 ctx.fillRect(0, 0, frame.w, frame.h);

 const scale = coverScale * zoom;
 const cx = frame.w / 2 + offset.x;
 const cy = frame.h / 2 + offset.y;
 ctx.save();
 ctx.translate(cx, cy);
 ctx.rotate((rotation * Math.PI) / 180);
 const w = 'width' in b ? b.width : 0;
 const h = 'height' in b ? b.height : 0;
 ctx.drawImage(b as CanvasImageSource, (-w * scale) / 2, (-h * scale) / 2, w * scale, h * scale);
 ctx.restore();
 }, [ready, frame, coverScale, zoom, offset, rotation]);

 // ── Pointer interactions: 1 finger/wheel = pan/zoom, 2 fingers = pinch ──
 const pointers = useRef(new Map<number, { x: number; y: number }>());
 const pinchStart = useRef<{ dist: number; zoom: number } | null>(null);

 const onPointerDown = (e: React.PointerEvent) => {
 (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
 pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
 if (pointers.current.size === 2) {
 const [a, b2] = [...pointers.current.values()];
 pinchStart.current = { dist: Math.hypot(a.x - b2.x, a.y - b2.y), zoom };
 }
 };
 const onPointerMove = (e: React.PointerEvent) => {
 if (!pointers.current.has(e.pointerId)) return;
 const prev = pointers.current.get(e.pointerId)!;
 pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
 if (pointers.current.size === 1) {
 const dx = e.clientX - prev.x;
 const dy = e.clientY - prev.y;
 const next = clampOffset(offsetRef.current.x + dx, offsetRef.current.y + dy, zoom);
 setOffset(next);
 } else if (pointers.current.size === 2 && pinchStart.current) {
 const [a, b2] = [...pointers.current.values()];
 const dist = Math.hypot(a.x - b2.x, a.y - b2.y);
 const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinchStart.current.zoom * (dist / pinchStart.current.dist)));
 setZoom(z);
 setOffset((o) => clampOffset(o.x, o.y, z));
 }
 };
 const onPointerUp = (e: React.PointerEvent) => {
 pointers.current.delete(e.pointerId);
 if (pointers.current.size < 2) pinchStart.current = null;
 };
 const onWheel = (e: React.WheelEvent) => {
 e.preventDefault();
 const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
 setZoom(z);
 setOffset((o) => clampOffset(o.x, o.y, z));
 };

  const iconBtn = 'w-11 h-11 bg-white border-nb-2 border-ink flex items-center justify-center hover:bg-nb-yellow/50 active:translate-y-[1px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nb-violet';

 const rotate = (dir: 1 | -1) => setRotation((r) => (r + dir * 90 + 360) % 360);
 const nudgeZoom = (dir: 1 | -1) => {
 const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (dir === 1 ? 1.25 : 1 / 1.25)));
 setZoom(z);
 setOffset((o) => clampOffset(o.x, o.y, z));
 };

  // ── Export: redraw the exact viewport transform at full resolution ──
  const apply = async () => {
  const b = bitmapRef.current;
  if (!b || exporting) return;
  setExporting(true);
  try {
  const scale = coverScale * zoom;
  // INSTAGRAM RULE: export what the sensor saw, not the preview size. The
  // frame shows a (frame/scale)-pixel window of the source, so the output's
  // long side is that window capped at maxOutputPx — never the tiny
  // (frame×scale) preview resolution, which exported postage stamps that
  // browsers then upscaled into blur. Never upscale beyond the source crop.
  let outW = Math.min(maxOutputPx, Math.max(1, Math.round(frame.w / scale)));
  let outH = Math.round(outW * (frame.h / frame.w));
  if (outH > maxOutputPx) {
  outH = maxOutputPx;
  outW = Math.round(outH * (frame.w / frame.h));
  }
 const out = document.createElement('canvas');
 out.width = outW;
 out.height = outH;
 const ctx = out.getContext('2d')!;
 const k = outW / frame.w;
 ctx.translate(outW / 2 + offset.x * k, outH / 2 + offset.y * k);
 ctx.rotate((rotation * Math.PI) / 180);
 const w = 'width' in b ? b.width : 0;
 const h = 'height' in b ? b.height : 0;
 ctx.drawImage(b as CanvasImageSource, (-w * scale * k) / 2, (-h * scale * k) / 2, w * scale * k, h * scale * k);
 const blob: Blob = await new Promise((res, rej) => out.toBlob((bb) => (bb ? res(bb) : rej(new Error('encode'))), 'image/jpeg', 0.9));
 onDone(new File([blob], file?.name?.replace(/\.[^.]+$/, '') + '.jpg' || 'photo.jpg', { type: 'image/jpeg' }));
 } catch {
 setFatal('Could not process this photo — try a different one.');
 } finally {
 setExporting(false);
 }
 };

 if (!file) return null;

 // Same safe modal pattern as ProfileEditModal: fixed = scroll container,
 // min-h-full wrapper centers — tall content never clips its own top.
 return (
 <div className="fixed inset-0 z-[90] bg-black/80 backdrop-blur-sm overflow-y-auto overscroll-contain" onClick={onCancel}>
 <div className="min-h-full flex items-center justify-center p-4 pb-[calc(2rem+env(safe-area-inset-bottom))]" onClick={onCancel}>
 <div className="nb-card bg-white p-4 sm:p-5 max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
 <div className="flex items-center justify-between mb-3">
 <h2 className="font-display font-bold text-lg">{title}</h2>
 <button onClick={onCancel} className="text-gray-500 hover:text-ink" title="Cancel">
 <X size={20} strokeWidth={2.5} />
 </button>
 </div>

 {fatal ? (
 <div className="text-center py-10 px-4">
 <p className="text-sm text-nb-violet font-medium">{fatal}</p>
 <button onClick={onCancel} className="nb-btn-ghost mt-6">Close</button>
 </div>
 ) : !ready ? (
 <div className="flex flex-col items-center justify-center py-16 text-gray-500">
 <RefreshCw size={26} className="animate-spin" />
 <p className="text-sm mt-3">Loading photo…</p>
 </div>
 ) : (
 <>
 <div className="flex justify-center">
 <canvas
 ref={canvasRef}
 style={{ width: frame.w, height: frame.h }}
 className=" touch-none cursor-grab active:cursor-grabbing border-nb-2 border-ink shadow-nb-sm"
 onPointerDown={onPointerDown}
 onPointerMove={onPointerMove}
 onPointerUp={onPointerUp}
 onPointerCancel={onPointerUp}
 onWheel={onWheel}
 />
 </div>
 <p className="text-[11px] text-gray-500 text-center mt-2">Drag to reposition · pinch or scroll to zoom</p>

 {aspects.length > 1 && (
 <div className="flex justify-center gap-2 mt-3">
 {aspects.map((a, i) => (
 <button
 key={a.label}
 onClick={() => setAspectIdx(i)}
 className={`px-3 py-1 text-xs font-display font-semibold border-nb-2 transition-colors ${
 i === aspectIdx ? 'bg-ink text-white border-ink' : 'bg-white border-gray-300 text-gray-600 hover:border-nb-violet'
 }`}
 >
 {a.label}
 </button>
 ))}
 </div>
 )}

 <div className="flex items-center justify-center gap-2 mt-4 flex-wrap">
 <button onClick={() => rotate(-1)} className={iconBtn} title="Rotate left">
 <RotateCcw size={18} />
 </button>
 <button onClick={() => nudgeZoom(-1)} className={iconBtn} title="Zoom out">
 <ZoomOut size={18} />
 </button>
 <input
 type="range"
 min={1}
 max={MAX_ZOOM}
 step={0.01}
 value={zoom}
 onChange={(e) => {
 const z = Number(e.target.value);
 setZoom(z);
 setOffset((o) => clampOffset(o.x, o.y, z));
 }}
 className="w-32 sm:w-44 accent-nb-violet"
 title="Zoom"
 />
 <button onClick={() => nudgeZoom(1)} className={iconBtn} title="Zoom in">
 <ZoomIn size={18} />
 </button>
 <button onClick={() => rotate(1)} className={iconBtn} title="Rotate right">
 <RotateCw size={18} />
 </button>
 </div>

  <div className="flex gap-2 mt-5">
  <button type="button" onClick={onCancel} className="nb-btn-ghost flex-1">Cancel</button>
  <button type="button" onClick={apply} disabled={exporting} aria-busy={exporting} className="nb-btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed">
 {exporting ? 'Processing…' : (<><Check size={16} className="inline mr-1" /> Use this photo</>)}
 </button>
 </div>
 </>
 )}
 </div>
 </div>
 </div>
 );
}
