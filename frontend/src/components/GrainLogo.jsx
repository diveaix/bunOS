import { useRef, useEffect, useCallback } from 'react';

const PARTICLE_SIZE = 1.6;
const SCATTER_RADIUS = 50;
const SCATTER_FORCE = 5;
const RETURN_SPEED = 0.08;
const FRICTION = 0.92;
const FONT_SIZE = 120;
const LOGO_SIZE = 110; // SVG logo height in px
const GRAIN_DENSITY = 2;
const LOGO_GAP = 20; // gap between logo and text

export default function GrainLogo() {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const rafRef = useRef(null);
  const dimRef = useRef({ w: 0, h: 0 });

  const initParticles = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    dimRef.current = { w, h };
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    // We'll draw both logo + text on an offscreen canvas, then sample
    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const offCtx = offscreen.getContext('2d');
    offCtx.fillStyle = '#000';
    offCtx.fillRect(0, 0, w, h);

    // Measure text width first to calculate total layout
    offCtx.font = `900 ${FONT_SIZE}px "Inter", sans-serif`;
    const textMetrics = offCtx.measureText('bunOS');
    const textWidth = textMetrics.width;
    const totalWidth = LOGO_SIZE + LOGO_GAP + textWidth;
    const startX = (w - totalWidth) / 2;

    // Load SVG logo and draw everything
    const img = new Image();
    img.onload = () => {
      // Draw the rabbit logo — nudge up to align with text center
      const logoX = startX;
      const logoY = (h - LOGO_SIZE) / 2 - 8;
      offCtx.drawImage(img, logoX, logoY, LOGO_SIZE, LOGO_SIZE);

      // Draw text next to it
      offCtx.fillStyle = '#fff';
      offCtx.font = `900 ${FONT_SIZE}px "Inter", sans-serif`;
      offCtx.textAlign = 'left';
      offCtx.textBaseline = 'middle';
      offCtx.fillText('bunOS', startX + LOGO_SIZE + LOGO_GAP, h / 2);

      // Sample pixels
      const imageData = offCtx.getImageData(0, 0, w, h);
      const data = imageData.data;
      const particles = [];

      for (let y = 0; y < h; y += GRAIN_DENSITY) {
        for (let x = 0; x < w; x += GRAIN_DENSITY) {
          const idx = (y * w + x) * 4;
          // Check if pixel is bright (part of logo or text)
          if (data[idx] > 100 || data[idx + 1] > 100 || data[idx + 2] > 100) {
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
    // The SVG has colored fills; we need it white for sampling
    // Load the SVG, inject white fill
    fetch('/bunOS.svg')
      .then(r => r.text())
      .then(svgText => {
        // Force all fills to white for sampling
        const whiteSvg = svgText.replace(/fill="[^"]*"/g, 'fill="#fff"');
        const blob = new Blob([whiteSvg], { type: 'image/svg+xml' });
        img.src = URL.createObjectURL(blob);
      })
      .catch(() => {
        // Fallback: just draw text without logo
        offCtx.fillStyle = '#fff';
        offCtx.font = `900 ${FONT_SIZE}px "Inter", sans-serif`;
        offCtx.textAlign = 'center';
        offCtx.textBaseline = 'middle';
        offCtx.fillText('bunOS', w / 2, h / 2);

        const imageData = offCtx.getImageData(0, 0, w, h);
        const data = imageData.data;
        const particles = [];
        for (let y = 0; y < h; y += GRAIN_DENSITY) {
          for (let x = 0; x < w; x += GRAIN_DENSITY) {
            const idx = (y * w + x) * 4;
            if (data[idx] > 128) {
              particles.push({
                ox: x, oy: y, x, y, vx: 0, vy: 0,
                brightness: 0.3 + Math.random() * 0.7,
                size: PARTICLE_SIZE * (0.5 + Math.random() * 0.8),
              });
            }
          }
        }
        particlesRef.current = particles;
      });
  }, []);

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
        const r = 251, g = 51 + Math.round(p.brightness * 10), b = 21;
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

    let resizeTimer;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(initParticles, 200);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('resize', onResize);
    };
  }, [initParticles]);

  return (
    <canvas
      ref={canvasRef}
      className="grain-logo"
      style={{
        width: '100%',
        height: '160px',
        cursor: 'default',
        display: 'block',
      }}
    />
  );
}
