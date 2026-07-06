import { useRef, useEffect, useCallback } from 'react';

const SOURCES = ['/hero-1.svg', '/hero-2.svg', '/hero-3.svg', '/hero-4.svg'];
const CYCLE_MS = 10000;
const SCATTER_DURATION = 600;

const PARTICLE_SIZE = 1.4;
const SCATTER_RADIUS = 45;
const SCATTER_FORCE = 4.5;
const RETURN_SPEED = 0.065;
const FRICTION = 0.9;
const GRAIN_DENSITY = 2;

/* ── load SVG, strip backgrounds, inject size, render to image ── */
async function loadSvgImage(src, w, h) {
  try {
    const resp = await fetch(src);
    const text = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;

    // Strip background elements:
    // 1. Any element with class cls-0 (always the bg gradient/fill)
    doc.querySelectorAll('.cls-0, [class="cls-0"]').forEach(el => el.remove());
    // 2. Top-level <rect> elements that span the full viewport
    doc.querySelectorAll('rect').forEach(r => {
      const rw = parseFloat(r.getAttribute('width') || 0);
      const rh = parseFloat(r.getAttribute('height') || 0);
      if (rw > 90 && rh > 90) r.remove(); // large rects are backgrounds
    });

    // Set explicit dimensions
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);

    const cleaned = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([cleaned], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  } catch {
    return null;
  }
}

/* ── sample rendered image into particle positions ── */
function samplePixels(img, w, h) {
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const ctx = off.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const pts = [];
  for (let y = 0; y < h; y += GRAIN_DENSITY) {
    for (let x = 0; x < w; x += GRAIN_DENSITY) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 60) {
        pts.push({ x, y });
      }
    }
  }
  return pts;
}

/* ── component ── */
export default function HeroGrainCycler({ size = 480 }) {
  const canvasRef = useRef(null);
  const stateRef = useRef(null);
  const rafRef = useRef(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });

  const init = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    // Load & sample all SVGs at the target size
    const images = await Promise.all(SOURCES.map(s => loadSvgImage(s, size, size)));
    const shapes = images.map(img => img ? samplePixels(img, size, size) : []);

    // Pool = largest shape
    const maxLen = Math.max(...shapes.map(s => s.length), 1);
    const first = shapes[0];
    if (!first.length) return; // nothing to render

    const particles = [];
    for (let i = 0; i < maxLen; i++) {
      const t = first[i % first.length];
      particles.push({
        ox: t.x, oy: t.y,
        x: t.x, y: t.y,
        vx: 0, vy: 0,
        brightness: 0.3 + Math.random() * 0.7,
        sz: PARTICLE_SIZE * (0.5 + Math.random() * 0.8),
        visible: i < first.length,
      });
    }

    stateRef.current = {
      shapes,
      particles,
      shapeIdx: 0,
      phase: 'hold',
      elapsed: 0,
    };
  }, [size]);

  useEffect(() => {
    init();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    let prev = performance.now();

    const tick = (now) => {
      const dt = (now - prev) / 1000;
      prev = now;
      const s = stateRef.current;
      if (!s || !s.particles.length) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      s.elapsed += dt * 1000;
      const { particles, shapes } = s;

      /* ── phase machine ── */
      if (s.phase === 'hold' && s.elapsed >= CYCLE_MS) {
        s.phase = 'scatter';
        s.elapsed = 0;
        for (const p of particles) {
          const a = Math.random() * Math.PI * 2;
          const f = 10 + Math.random() * 14;
          p.vx += Math.cos(a) * f;
          p.vy += Math.sin(a) * f;
        }
      }

      if (s.phase === 'scatter' && s.elapsed >= SCATTER_DURATION) {
        const nextIdx = (s.shapeIdx + 1) % shapes.length;
        s.shapeIdx = nextIdx;
        const next = shapes[nextIdx];
        for (let i = 0; i < particles.length; i++) {
          const t = next[i % next.length];
          particles[i].ox = t.x;
          particles[i].oy = t.y;
          particles[i].visible = i < next.length;
        }
        s.phase = 'reform';
      }

      if (s.phase === 'reform' && s.elapsed >= SCATTER_DURATION + 800) {
        s.phase = 'hold';
        s.elapsed = 0;
      }

      /* ── physics + draw ── */
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const dx = p.x - mx;
        const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < SCATTER_RADIUS && dist > 0) {
          const force = (1 - dist / SCATTER_RADIUS) * SCATTER_FORCE;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }

        p.vx += (p.ox - p.x) * RETURN_SPEED;
        p.vy += (p.oy - p.y) * RETURN_SPEED;
        p.vx *= FRICTION;
        p.vy *= FRICTION;
        p.x += p.vx;
        p.y += p.vy;

        if (!p.visible) continue;

        const alpha = p.brightness * 0.85;
        ctx.fillStyle = `rgba(251,${51 + Math.round(p.brightness * 10)},21,${alpha})`;
        ctx.fillRect(p.x - p.sz / 2, p.y - p.sz / 2, p.sz, p.sz);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    const onMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    };
    const onLeave = () => {
      mouseRef.current.x = -9999;
      mouseRef.current.y = -9999;
    };

    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);

    return () => {
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
    };
  }, [init, size]);

  return (
    <canvas
      ref={canvasRef}
      className="hero-grain-cycler"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        display: 'block',
        cursor: 'default',
      }}
    />
  );
}
