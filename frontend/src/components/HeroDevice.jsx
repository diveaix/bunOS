import { useRef, useEffect, useMemo, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RoundedBox, Environment } from '@react-three/drei';
import * as THREE from 'three';
import gsap from 'gsap';

/* ─── Screen texture — draws live terminal animation ─── */
function useScreenTexture() {
  const canvasRef = useRef(document.createElement('canvas'));
  const textureRef = useRef(null);
  const stateRef = useRef({
    phase: 'boot',    // boot → typing → steps → summary → pause → typing
    timer: 0,
    charIdx: 0,
    stepIdx: -1,
    stepDone: [false, false, false, false],
    summaryVisible: false,
    pauseTimer: 0,
  });

  const COMMAND = 'swap $20 EURC to USDC';
  const STEPS = ['Finding route…', 'Signing tx…', 'Executing swap…', 'Confirming…'];
  const DONE_LABELS = ['Route found', 'Signed', 'Executed', 'Confirmed'];

  useMemo(() => {
    const c = canvasRef.current;
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 512, 512);
    textureRef.current = new THREE.CanvasTexture(c);
    textureRef.current.needsUpdate = true;
  }, []);

  const drawScreen = useCallback((delta) => {
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    const s = stateRef.current;
    s.timer += delta;

    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 512, 512);

    // Logo watermark (subtle)
    ctx.save();
    ctx.globalAlpha = 0.03;
    ctx.font = 'bold 120px Inter, sans-serif';
    ctx.fillStyle = '#fb3315';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('bunOS', 256, 256);
    ctx.restore();

    // Status bar
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '500 16px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('bunOS terminal', 28, 38);
    ctx.textAlign = 'right';
    const now = new Date();
    ctx.fillText(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`, 484, 38);
    ctx.textAlign = 'left';

    // Divider
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(28, 52, 456, 1);

    if (s.phase === 'boot') {
      // Show logo then transition
      ctx.save();
      ctx.globalAlpha = Math.min(1, s.timer * 2);
      ctx.font = 'bold 48px Inter, sans-serif';
      ctx.fillStyle = '#fb3315';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('bunOS', 256, 240);
      ctx.font = '400 18px Inter, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText('agent-native wallet', 256, 290);
      ctx.restore();

      if (s.timer > 2.5) {
        s.phase = 'typing';
        s.timer = 0;
        s.charIdx = 0;
      }
    } else if (s.phase === 'typing') {
      // Prompt
      const promptY = 80;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '500 18px "SF Mono", "Fira Code", monospace';
      const typed = COMMAND.slice(0, s.charIdx);
      ctx.fillText('> ' + typed, 28, promptY);

      // Cursor blink
      if (Math.floor(s.timer * 3) % 2 === 0) {
        const tw = ctx.measureText('> ' + typed).width;
        ctx.fillStyle = '#fb3315';
        ctx.fillRect(28 + tw + 2, promptY - 14, 2, 18);
      }

      // Type speed
      if (s.timer > 0.06) {
        s.timer = 0;
        if (s.charIdx < COMMAND.length) {
          s.charIdx++;
        } else {
          s.phase = 'steps';
          s.timer = 0;
          s.stepIdx = 0;
          s.stepDone = [false, false, false, false];
          s.summaryVisible = false;
        }
      }
    } else if (s.phase === 'steps' || s.phase === 'summary') {
      // Show typed command
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '500 18px "SF Mono", "Fira Code", monospace';
      ctx.fillText('> ' + COMMAND, 28, 80);

      // Steps
      for (let i = 0; i < 4; i++) {
        const y = 125 + i * 42;
        const isActive = i <= s.stepIdx;
        const isDone = s.stepDone[i];

        if (!isActive) continue;

        // Checkmark or spinner
        if (isDone) {
          ctx.fillStyle = '#fb3315';
          ctx.beginPath();
          ctx.arc(42, y - 4, 9, 0, Math.PI * 2);
          ctx.fill();
          // Checkmark
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(37, y - 4);
          ctx.lineTo(40, y - 1);
          ctx.lineTo(47, y - 8);
          ctx.stroke();

          ctx.fillStyle = '#fb3315';
          ctx.font = '500 16px "SF Mono", "Fira Code", monospace';
          ctx.fillText(DONE_LABELS[i], 60, y);
        } else {
          // Spinning circle
          ctx.strokeStyle = 'rgba(255,255,255,0.2)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(42, y - 4, 8, 0, Math.PI * 2);
          ctx.stroke();
          // Spinner arc
          const angle = s.timer * 6;
          ctx.strokeStyle = 'rgba(255,255,255,0.5)';
          ctx.beginPath();
          ctx.arc(42, y - 4, 8, angle, angle + 1.2);
          ctx.stroke();

          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.font = '500 16px "SF Mono", "Fira Code", monospace';
          ctx.fillText(STEPS[i], 60, y);
        }
      }

      // Step progression
      if (s.phase === 'steps') {
        if (s.stepIdx < 4 && s.timer > 0.7) {
          s.stepDone[s.stepIdx] = true;
          s.stepIdx++;
          s.timer = 0;
          if (s.stepIdx >= 4) {
            s.phase = 'summary';
            s.timer = 0;
          }
        }
      }

      if (s.phase === 'summary') {
        if (s.timer > 0.5) s.summaryVisible = true;
        if (s.summaryVisible) {
          const sy = 310;
          // Summary box
          ctx.fillStyle = 'rgba(251, 51, 21, 0.08)';
          ctx.strokeStyle = 'rgba(251, 51, 21, 0.25)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(28, sy, 456, 70, 10);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#fff';
          ctx.font = 'bold 18px "SF Mono", "Fira Code", monospace';
          ctx.fillText('20.00 EURC → 21.47 USDC', 44, sy + 30);

          ctx.fillStyle = 'rgba(251, 51, 21, 0.6)';
          ctx.font = '400 14px "SF Mono", "Fira Code", monospace';
          ctx.fillText('Tx: 0x4f2a…8c1e ↗', 44, sy + 54);
        }

        if (s.timer > 4) {
          s.phase = 'typing';
          s.timer = 0;
          s.charIdx = 0;
        }
      }
    }

    if (textureRef.current) textureRef.current.needsUpdate = true;
  }, []);

  return { texture: textureRef.current, drawScreen };
}

/* ─── Device 3D model ─── */
function Device({ mousePos }) {
  const groupRef = useRef();
  const { texture, drawScreen } = useScreenTexture();
  const floatRef = useRef({ y: 0, rot: 0 });

  // Floating animation
  useEffect(() => {
    const f = floatRef.current;
    gsap.to(f, {
      y: 0.15,
      duration: 2.8,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });
    gsap.to(f, {
      rot: 0.04,
      duration: 3.5,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    });
  }, []);

  useFrame((_, delta) => {
    drawScreen(delta);

    if (groupRef.current) {
      const f = floatRef.current;
      // Float
      groupRef.current.position.y = f.y;
      // Mouse tilt
      const tiltX = mousePos.current.y * 0.15;
      const tiltY = mousePos.current.x * 0.2;
      groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, tiltX + f.rot, 0.05);
      groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, tiltY + 0.3, 0.05);
    }
  });

  const bodyMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#fb3315',
    roughness: 0.35,
    metalness: 0.1,
  }), []);

  const darkMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#1a1a1a',
    roughness: 0.5,
    metalness: 0.2,
  }), []);

  const glossMat = useMemo(() => new THREE.MeshStandardMaterial({
    color: '#cc2200',
    roughness: 0.15,
    metalness: 0.6,
  }), []);

  return (
    <group ref={groupRef} scale={2.1}>
      {/* Main body */}
      <RoundedBox args={[2.6, 2.6, 0.32]} radius={0.22} smoothness={8} material={bodyMat} />

      {/* Screen bezel (inset) */}
      <RoundedBox args={[2.2, 2.2, 0.02]} radius={0.15} smoothness={6} position={[-.12, 0, 0.17]} material={darkMat} />

      {/* Screen display */}
      <mesh position={[-.12, 0, 0.185]}>
        <planeGeometry args={[2.05, 2.05]} />
        <meshBasicMaterial map={texture} />
      </mesh>

      {/* Screen glass reflection */}
      <mesh position={[-.12, 0, 0.19]}>
        <planeGeometry args={[2.05, 2.05]} />
        <meshPhysicalMaterial
          transparent
          opacity={0.04}
          roughness={0}
          metalness={0.2}
          color="#fff"
        />
      </mesh>

      {/* Camera module housing */}
      <RoundedBox args={[0.52, 0.52, 0.1]} radius={0.12} smoothness={6} position={[1.12, 1.0, 0.16]} material={glossMat} />

      {/* Camera lens */}
      <mesh position={[1.12, 1.0, 0.24]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.12, 0.12, 0.06, 24]} />
        <meshStandardMaterial color="#0a0a0a" roughness={0.1} metalness={0.8} />
      </mesh>
      <mesh position={[1.12, 1.0, 0.27]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.08, 0.08, 0.02, 24]} />
        <meshPhysicalMaterial color="#111" roughness={0} metalness={1} clearcoat={1} />
      </mesh>

      {/* Scroll wheel housing */}
      <RoundedBox args={[0.46, 0.7, 0.18]} radius={0.1} smoothness={6} position={[1.12, 0.15, 0.08]} material={glossMat} />

      {/* Scroll wheel */}
      <mesh position={[1.38, 0.15, 0.08]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.16, 0.16, 0.12, 32]} />
        <meshStandardMaterial color="#fb3315" roughness={0.25} metalness={0.3} />
      </mesh>

      {/* Scroll wheel axis pin */}
      <mesh position={[1.46, 0.15, 0.08]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.04, 0.04, 0.06, 16]} />
        <meshStandardMaterial color="#cc2200" roughness={0.2} metalness={0.7} />
      </mesh>

      {/* Bottom edge detail */}
      <mesh position={[0, -1.32, 0]}>
        <boxGeometry args={[2.2, 0.02, 0.28]} />
        <meshStandardMaterial color="#e62d10" roughness={0.4} metalness={0.1} />
      </mesh>
    </group>
  );
}

/* ─── Scene wrapper ─── */
function Scene({ mousePos }) {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
      <directionalLight position={[-3, 2, 4]} intensity={0.4} color="#ffd4cc" />
      <pointLight position={[0, -2, 3]} intensity={0.3} color="#fb3315" />
      <Device mousePos={mousePos} />
      <Environment preset="city" />
    </>
  );
}

/* ─── Exported component ─── */
export default function HeroDevice() {
  const containerRef = useRef(null);
  const mousePos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      mousePos.current.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      mousePos.current.y = -((e.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  return (
    <div ref={containerRef} className="hero-device-container">
      <Canvas
        camera={{ position: [0, 0, 5.8], fov: 40 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <Scene mousePos={mousePos} />
      </Canvas>
    </div>
  );
}
