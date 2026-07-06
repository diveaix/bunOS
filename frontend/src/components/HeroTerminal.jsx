import { useState, useEffect, useRef, useCallback } from "react";

// ─── Demo scenarios ─────────────────────────────────
const DEMOS = [
  {
    id: "swap",
    label: "Swap",
    command: "swap $20 EURC to USDC",
    steps: [
      { text: "Routing EURC → USDC on Arc…", delay: 600 },
      { text: "Quote: 20.00 EURC → 21.74 USDC", delay: 800 },
      { text: "Slippage: 0.12% · Fee: $0.04", delay: 500 },
      { text: "Executing swap…", delay: 900 },
    ],
    result: {
      status: "success",
      lines: [
        { label: "Received", value: "21.74 USDC" },
        { label: "Rate", value: "1 EURC = 1.087 USDC" },
        { label: "Tx", value: "0x8f3a…c291", accent: true },
      ],
    },
  },
  {
    id: "bridge",
    label: "Bridge",
    command: "bridge $50 USDC from Arc to Base",
    steps: [
      { text: "Checking balance… 184.25 USDC available", delay: 700 },
      { text: "Estimating bridge fee: ~$0.18", delay: 600 },
      { text: "Initiating cross-chain transfer…", delay: 1000 },
      { text: "Waiting for confirmation…", delay: 800 },
    ],
    result: {
      status: "success",
      lines: [
        { label: "Bridged", value: "50.00 USDC" },
        { label: "Destination", value: "Base Sepolia" },
        { label: "Tx", value: "0x4e1b…a7f3", accent: true },
      ],
    },
  },
  {
    id: "perps",
    label: "Perps",
    command: "open BTC long 2x with $5",
    steps: [
      { text: "Fetching BTC oracle price…", delay: 600 },
      { text: "Price: $104,287.50 · 2x leverage", delay: 700 },
      { text: "Margin: $5.00 · Notional: $10.00", delay: 500 },
      { text: "Submitting position…", delay: 900 },
    ],
    result: {
      status: "success",
      lines: [
        { label: "Position", value: "BTC Long 2x" },
        { label: "Entry", value: "$104,287.50" },
        { label: "Liq. price", value: "$52,403.00" },
      ],
    },
  },
  {
    id: "auto",
    label: "Automate",
    command: "every day swap $1 USDC to WETH",
    steps: [
      { text: "Creating daily automation…", delay: 600 },
      { text: "Action: swap $1 USDC → WETH", delay: 500 },
      { text: "Schedule: every 24h, starting now", delay: 600 },
      { text: "First run executing…", delay: 800 },
    ],
    result: {
      status: "success",
      lines: [
        { label: "Automation", value: "Active" },
        { label: "Frequency", value: "Every 24h" },
        { label: "Next run", value: "Tomorrow 09:48" },
      ],
    },
  },
];

const TYPING_SPEED = 42;

export default function HeroTerminal() {
  const [activeTab, setActiveTab] = useState(0);
  const [typedText, setTypedText] = useState("");
  const [visibleSteps, setVisibleSteps] = useState([]);
  const [showResult, setShowResult] = useState(false);
  const [phase, setPhase] = useState("idle"); // idle | typing | steps | result
  const timeoutsRef = useRef([]);
  const autoRef = useRef(null);

  const clearAllTimeouts = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    if (autoRef.current) clearTimeout(autoRef.current);
  }, []);

  const runDemo = useCallback(
    (idx) => {
      clearAllTimeouts();
      const demo = DEMOS[idx];
      setTypedText("");
      setVisibleSteps([]);
      setShowResult(false);
      setPhase("typing");

      // Type out the command
      const cmd = demo.command;
      for (let i = 0; i <= cmd.length; i++) {
        const t = setTimeout(() => setTypedText(cmd.slice(0, i)), i * TYPING_SPEED);
        timeoutsRef.current.push(t);
      }

      // After typing, show steps one by one
      let elapsed = cmd.length * TYPING_SPEED + 400;
      const tStart = setTimeout(() => setPhase("steps"), elapsed);
      timeoutsRef.current.push(tStart);

      demo.steps.forEach((step, i) => {
        elapsed += step.delay;
        const t = setTimeout(() => {
          setVisibleSteps((prev) => [...prev, i]);
        }, elapsed);
        timeoutsRef.current.push(t);
      });

      // Show result
      elapsed += 500;
      const tResult = setTimeout(() => {
        setShowResult(true);
        setPhase("result");
      }, elapsed);
      timeoutsRef.current.push(tResult);

      // Auto-advance to next tab
      elapsed += 4000;
      autoRef.current = setTimeout(() => {
        const next = (idx + 1) % DEMOS.length;
        setActiveTab(next);
      }, elapsed);
    },
    [clearAllTimeouts]
  );

  // Run demo when tab changes
  useEffect(() => {
    runDemo(activeTab);
    return clearAllTimeouts;
  }, [activeTab, runDemo, clearAllTimeouts]);

  const demo = DEMOS[activeTab];

  return (
    <div className="hero-terminal" data-reveal="right">
      {/* Tab bar */}
      <div className="ht-tabs">
        {DEMOS.map((d, i) => (
          <button
            key={d.id}
            className={`ht-tab${i === activeTab ? " active" : ""}`}
            onClick={() => setActiveTab(i)}
          >
            {d.label}
          </button>
        ))}
        <div
          className="ht-tab-indicator"
          style={{
            width: `${100 / DEMOS.length}%`,
            transform: `translateX(${activeTab * 100}%)`,
          }}
        />
      </div>

      {/* Terminal chrome */}
      <div className="ht-chrome">
        <span />
        <span />
        <span />
        <span className="ht-chrome-title">bunOS terminal</span>
      </div>

      {/* Terminal body */}
      <div className="ht-body">
        {/* User command */}
        <div className="ht-msg ht-user">
          <div className="ht-avatar ht-avatar-user">You</div>
          <div className="ht-bubble">
            <span className="ht-cmd-text">
              {typedText}
              {phase === "typing" && <span className="ht-cursor" />}
            </span>
          </div>
        </div>

        {/* Agent response */}
        {phase !== "typing" && phase !== "idle" && (
          <div className="ht-msg ht-agent">
            <div className="ht-avatar ht-avatar-agent">B</div>
            <div className="ht-bubble ht-agent-bubble">
              {/* Steps */}
              <div className="ht-steps">
                {demo.steps.map((step, i) => (
                  <div
                    key={i}
                    className={`ht-step${visibleSteps.includes(i) ? " visible" : ""}`}
                  >
                    <span
                      className={`ht-step-dot${
                        showResult ? " done" : visibleSteps.includes(i) ? " active" : ""
                      }`}
                    />
                    <span className="ht-step-text">{step.text}</span>
                  </div>
                ))}
              </div>

              {/* Result card */}
              {showResult && (
                <div className={`ht-result ${demo.result.status}`}>
                  <div className="ht-result-badge">
                    <svg viewBox="0 0 24 24" width="12" height="12">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    Success
                  </div>
                  <dl className="ht-result-grid">
                    {demo.result.lines.map((line, i) => (
                      <div key={i} className="ht-result-row">
                        <dt>{line.label}</dt>
                        <dd className={line.accent ? "accent" : ""}>
                          {line.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
