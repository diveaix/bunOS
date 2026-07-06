import { useRef, useEffect, useCallback } from 'react';

const PARTICLE_SIZE = 1.2;
const SCATTER_RADIUS = 35;
const SCATTER_FORCE = 4;
const RETURN_SPEED = 0.08;
const FRICTION = 0.92;
const GRAIN_DENSITY = 2;

export default function GrainIcon({ src, size = 64, color = 'accent' }) {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const rafRef = useRef(null);
  const dimRef = useRef({ w: 0, h: 0 });

  const initParticles = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = size;
    const h = size;
    dimRef.current = { w, h };
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const offCtx = offscreen.getContext('2d');
    // Keep transparent — we'll sample alpha channel
    offCtx.clearRect(0, 0, w, h);

    const img = new Image();
    img.onload = () => {
      offCtx.drawImage(img, 0, 0, w, h);

      const imageData = offCtx.getImageData(0, 0, w, h);
      const data = imageData.data;
      const particles = [];

      for (let y = 0; y < h; y += GRAIN_DENSITY) {
        for (let x = 0; x < w; x += GRAIN_DENSITY) {
          const idx = (y * w + x) * 4;
          const alpha = data[idx + 3];
          // Only sample pixels with significant opacity (the icon shape)
          if (alpha > 60) {
            particles.push({
              ox: x, oy: y,
              x, y,
              vx: 0, vy: 0,
              brightness: 0.3 + Math.random() * 0.7,
              size: PARTICLE_SIZE * (0.5 + Math.random() * 0.8),
            });
          }
        }
      }
      particlesRef.current = particles;
    };

    fetch(src)
      .then(r => r.text())
      .then(svgText => {
        // Parse SVG and strip background paths (full-viewport rectangles)
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');
        const paths = doc.querySelectorAll('path');
        paths.forEach(p => {
          const d = p.getAttribute('d') || '';
          const fill = p.getAttribute('fill') || '';
          // Remove paths that are the full-viewport background
          if (d.startsWith('M 0.00 0.00') || d.startsWith('M 0 0') || 
              fill === 'rgb(0,0,0)' || fill === '#000' || fill === '#000000' || fill === 'black') {
            p.remove();
          }
        });
        // Also remove any <rect> backgrounds
        doc.querySelectorAll('rect').forEach(r => {
          const fill = r.getAttribute('fill') || '';
          if (fill === 'rgb(0,0,0)' || fill === '#000' || fill === '#000000' || fill === 'black') {
            r.remove();
          }
        });
        const cleaned = new XMLSerializer().serializeToString(doc.documentElement);
        const blob = new Blob([cleaned], { type: 'image/svg+xml' });
        img.src = URL.createObjectURL(blob);
      })
      .catch(() => {});
  }, [src, size]);

  useEffect(() => {
    initParticles();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;

    const animate = () => {
      const { w, h } = dimRef.current;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const particles = particlesRef.current;

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

        const alpha = p.brightness * 0.85;
        let r, g, b;
        if (color === 'dark') {
          r = 0; g = 0; b = 0;
        } else {
          r = 251; g = 51 + Math.round(p.brightness * 10); b = 21;
        }
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

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
  }, [initParticles]);

  return (
    <canvas
      ref={canvasRef}
      className="grain-icon"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        display: 'block',
        cursor: 'default',
      }}
    />
  );
}
