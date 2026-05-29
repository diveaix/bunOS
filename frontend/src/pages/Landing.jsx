import { useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import "./Landing.css";

const CODE_SRC = `module runtime::consensus { use std::hash::keccak256; use crypto::bls12_381::G1; use runtime::epoch::EpochState;
  const MAX_VALIDATORS: u64 = 128; const QUORUM_THRESHOLD: u64 = 67; const EPOCH_DURATION_MS: u64 = 86_400_000;
  public struct Validator has key, store { id: UID, stake: u64, pubkey: vector<u8>, commission_bps: u16, last_attestation: u64, }
  public struct Block has key { id: UID, height: u64, parent_hash: vector<u8>, state_root: vector<u8>, timestamp: u64, proposer: address, signatures: vector<Signature>, }
  public struct Signature has store, drop { validator: address, sig: vector<u8>, epoch: u64, }
  public fun propose_block(ctx: &mut TxContext, parent: &Block, txns: vector<Transaction>) : Block {
    let proposer = tx_context::sender(ctx); let height = parent.height + 1; let state_root = merkle::compute_root(&txns);
    let parent_hash = hash::sha3_256(bcs::to_bytes(parent)); Block { id: object::new(ctx), height, parent_hash, state_root, timestamp: epoch::now_ms(), proposer, signatures: vector::empty(), } }
  public fun attest(validator: &Validator, block: &mut Block, sig: vector<u8>) {
    assert!(bls12_381::verify(&validator.pubkey, &bcs::to_bytes(&block.state_root), &sig), EInvalidSignature);
    vector::push_back(&mut block.signatures, Signature { validator: object::uid_to_address(&validator.id), sig, epoch: epoch::current() }); }
  public fun finalize(block: &Block, validators: &ValidatorSet) : bool {
    let total_stake = validator_set::total_stake(validators); let attested_stake = 0u64; let i = 0;
    while (i < vector::length(&block.signatures)) { let sig = vector::borrow(&block.signatures, i);
      let v = validator_set::get(validators, sig.validator); attested_stake = attested_stake + v.stake; i = i + 1; };
    (attested_stake * 100) / total_stake >= QUORUM_THRESHOLD } }
module runtime::vm { use std::vector; use runtime::memory::LinearMemory; use runtime::opcode::{Op, decode};
  const STACK_LIMIT: u64 = 1024; const MAX_GAS: u64 = 30_000_000; const MEMORY_PAGE: u64 = 65536;
  public struct Frame has store, drop { pc: u64, locals: vector<Value>, stack: vector<Value>, gas_remaining: u64, return_addr: u64, }
  public struct Value has store, drop, copy { kind: u8, i64_val: i64, f64_val: u64, ref_val: u64, }
  public fun execute(bytecode: &vector<u8>, entry: u64, args: vector<Value>, gas: u64) : vector<Value> {
    let memory = memory::alloc(MEMORY_PAGE * 4); let frame = Frame { pc: entry, locals: args, stack: vector::empty(), gas_remaining: gas, return_addr: 0 };
    let frames: vector<Frame> = vector::empty(); vector::push_back(&mut frames, frame);
    loop { let f = vector::borrow_mut(&mut frames, vector::length(&frames) - 1); if (f.pc >= vector::length(bytecode)) break;
      let op = decode(bytecode, f.pc); f.gas_remaining = f.gas_remaining - op_cost(&op); assert!(f.gas_remaining > 0, EOutOfGas);
      match (op) { Op::I64Const(v) => vector::push_back(&mut f.stack, Value { kind: 0, i64_val: v, f64_val: 0, ref_val: 0 }),
        Op::I64Add => { let b = vector::pop_back(&mut f.stack); let a = vector::pop_back(&mut f.stack);
          vector::push_back(&mut f.stack, Value { kind: 0, i64_val: a.i64_val + b.i64_val, f64_val: 0, ref_val: 0 }) },
        Op::MemoryLoad(offset) => { let addr = vector::pop_back(&mut f.stack).i64_val as u64;
          let val = memory::load_i64(&memory, addr + offset); vector::push_back(&mut f.stack, Value { kind: 0, i64_val: val, f64_val: 0, ref_val: 0 }) },
        Op::Call(target) => { let new_frame = Frame { pc: target, locals: vector::empty(), stack: vector::empty(), gas_remaining: f.gas_remaining, return_addr: f.pc + 1 };
          vector::push_back(&mut frames, new_frame) },
        Op::Return => { let result = vector::pop_back(&mut f.stack); let finished = vector::pop_back(&mut frames);
          if (vector::is_empty(&frames)) { return vector::singleton(result) };
          let caller = vector::borrow_mut(&mut frames, vector::length(&frames) - 1);
          caller.gas_remaining = finished.gas_remaining; caller.pc = finished.return_addr; vector::push_back(&mut caller.stack, result) },
        _ => { f.pc = f.pc + op_size(&op); } }; }; vector::borrow(&frames, 0).stack }
  fun op_cost(op: &Op) : u64 { match (op) { Op::I64Const(_) => 1, Op::I64Add | Op::I64Sub | Op::I64Mul => 3, Op::MemoryLoad(_) | Op::MemoryStore(_) => 5, Op::Call(_) => 10, Op::Return => 1, _ => 2 } } }
module crypto::merkle { use std::hash; use std::vector;
  public struct MerkleTree has store { leaves: vector<vector<u8>>, root: vector<u8>, depth: u8, }
  public struct Proof has store, drop { path: vector<vector<u8>>, indices: vector<bool>, }
  public fun build(data: &vector<vector<u8>>) : MerkleTree { let leaves: vector<vector<u8>> = vector::empty();
    let i = 0; while (i < vector::length(data)) { vector::push_back(&mut leaves, hash::sha3_256(*vector::borrow(data, i))); i = i + 1; };
    let depth = ceil_log2(vector::length(&leaves)); let padded = pad_to_power_of_two(&leaves);
    let root = compute_root_inner(&padded, 0, vector::length(&padded)); MerkleTree { leaves, root, depth: (depth as u8) } }
  public fun verify(root: &vector<u8>, leaf: &vector<u8>, proof: &Proof) : bool {
    let current = hash::sha3_256(*leaf); let i = 0;
    while (i < vector::length(&proof.path)) { let sibling = vector::borrow(&proof.path, i);
      current = if (*vector::borrow(&proof.indices, i)) { hash::sha3_256(concat(sibling, &current)) } else { hash::sha3_256(concat(&current, sibling)) }; i = i + 1; }; &current == root }
  fun compute_root_inner(nodes: &vector<vector<u8>>, start: u64, end: u64) : vector<u8> {
    if (end - start == 1) { return *vector::borrow(nodes, start) }; let mid = start + (end - start) / 2;
    let left = compute_root_inner(nodes, start, mid); let right = compute_root_inner(nodes, mid, end); hash::sha3_256(concat(&left, &right)) } }
module runtime::scheduler { use std::priority_queue::PriorityQueue; use runtime::task::{Task, TaskId};
  const MAX_CONCURRENT: u64 = 256; const TIME_SLICE_US: u64 = 10_000; const PRIORITY_LEVELS: u8 = 4;
  public struct Scheduler has key { id: UID, ready: PriorityQueue<Task>, blocked: vector<Task>, running: Option<Task>, time_remaining: u64, context_switches: u64, }
  public fun schedule(sched: &mut Scheduler) : Option<TaskId> { if (option::is_some(&sched.running)) {
      let current = option::extract(&mut sched.running); if (sched.time_remaining == 0) {
        priority_queue::push(&mut sched.ready, current.priority, current); sched.context_switches = sched.context_switches + 1;
      } else { sched.running = option::some(current); return option::some(current.id) } };
    if (priority_queue::is_empty(&sched.ready)) { return option::none() };
    let (_, next) = priority_queue::pop(&mut sched.ready); sched.time_remaining = TIME_SLICE_US * ((next.priority as u64) + 1);
    let id = next.id; sched.running = option::some(next); option::some(id) }
  public fun block_current(sched: &mut Scheduler, reason: u8) { if (option::is_some(&sched.running)) {
    let mut task = option::extract(&mut sched.running); task.blocked_reason = reason; vector::push_back(&mut sched.blocked, task); } }
  public fun unblock(sched: &mut Scheduler, task_id: TaskId) { let i = 0;
    while (i < vector::length(&sched.blocked)) { if (vector::borrow(&sched.blocked, i).id == task_id) {
      let task = vector::swap_remove(&mut sched.blocked, i); priority_queue::push(&mut sched.ready, task.priority, task); return }; i = i + 1; } } }`;

// ─── Per-character glow constants ─────────────────────
const GLOW_RADIUS = 220;
const GRID_CELL = 40;

export default function Landing() {
  const wallRef = useRef(null);
  const codeRef = useRef(null);
  const spansRef = useRef([]);
  const gridRef = useRef({});
  const rafRef = useRef(null);
  const prevLitRef = useRef(new Set());

  const buildGrid = useCallback(() => {
    const container = codeRef.current;
    if (!container || !spansRef.current.length) return;
    const rect = container.getBoundingClientRect();
    const grid = {};
    for (let i = 0; i < spansRef.current.length; i++) {
      const span = spansRef.current[i];
      const sr = span.getBoundingClientRect();
      const cx = sr.left - rect.left + sr.width * 0.5;
      const cy = sr.top - rect.top + sr.height * 0.5;
      span._cx = cx;
      span._cy = cy;
      const gx = Math.floor(cx / GRID_CELL);
      const gy = Math.floor(cy / GRID_CELL);
      const key = `${gx},${gy}`;
      (grid[key] ||= []).push(i);
    }
    gridRef.current = grid;
  }, []);

  useEffect(() => {
    const container = codeRef.current;
    const wall = wallRef.current;
    if (!container || !wall) return;

    // Build per-character spans
    container.innerHTML = '';
    const chars = CODE_SRC.split('');
    const spans = [];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (ch === '\n') {
        frag.appendChild(document.createTextNode('\n'));
        continue;
      }
      const span = document.createElement('span');
      span.textContent = ch;
      span.className = 'cw-char';
      // Each character gets unique activation energy and color offset
      span._energy = 0.25 + Math.random() * 0.75; // 0.25–1.0
      span._hue = Math.random() * 40 - 20;        // -20 to +20
      frag.appendChild(span);
      spans.push(span);
    }
    container.appendChild(frag);
    spansRef.current = spans;

    // Build spatial grid after layout
    requestAnimationFrame(() => {
      buildGrid();
    });

    // Resize handler
    let resizeTimer;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(buildGrid, 200);
    };
    window.addEventListener('resize', onResize);

    // Mouse handlers
    const onMove = (e) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const rect = container.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const gridRadius = Math.ceil(GLOW_RADIUS / GRID_CELL);
        const centerGx = Math.floor(mx / GRID_CELL);
        const centerGy = Math.floor(my / GRID_CELL);
        const grid = gridRef.current;
        const allSpans = spansRef.current;
        const prevLit = prevLitRef.current;
        const nowLit = new Set();

        // Check all grid cells within radius
        for (let dx = -gridRadius; dx <= gridRadius; dx++) {
          for (let dy = -gridRadius; dy <= gridRadius; dy++) {
            const key = `${centerGx + dx},${centerGy + dy}`;
            const bucket = grid[key];
            if (!bucket) continue;
            for (let b = 0; b < bucket.length; b++) {
              const idx = bucket[b];
              const span = allSpans[idx];
              const distX = span._cx - mx;
              const distY = span._cy - my;
              const dist = Math.sqrt(distX * distX + distY * distY);
              if (dist < GLOW_RADIUS) {
                const t = 1 - dist / GLOW_RADIUS;
                // Character only activates when proximity exceeds its threshold
                const threshold = (1 - span._energy) * 0.65;
                if (t > threshold) {
                  const intensity = Math.min(1, (t - threshold) / (1 - threshold));
                  const i2 = intensity * intensity;
                  const h = span._hue;
                  const r = Math.min(255, Math.max(0, 255 + h * 0.3));
                  const g = Math.min(255, Math.max(0, 50 + h + i2 * 30));
                  const bv = Math.min(255, Math.max(0, 20 + h * 0.3 + i2 * 10));
                  span.style.color = `rgb(${r},${g},${bv})`;
                  nowLit.add(idx);
                }
                // Characters below their threshold stay dark — creates gaps
              }
            }
          }
        }

        // Reset previously lit characters that are no longer in range
        for (const idx of prevLit) {
          if (!nowLit.has(idx)) {
            allSpans[idx].style.color = '';
          }
        }
        prevLitRef.current = nowLit;
      });
    };

    const onLeave = () => {
      cancelAnimationFrame(rafRef.current);
      const allSpans = spansRef.current;
      const prevLit = prevLitRef.current;
      for (const idx of prevLit) {
        allSpans[idx].style.color = '';
      }
      prevLitRef.current = new Set();
    };

    wall.addEventListener('mousemove', onMove);
    wall.addEventListener('mouseleave', onLeave);
    return () => {
      wall.removeEventListener('mousemove', onMove);
      wall.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(rafRef.current);
    };
  }, [buildGrid]);

  return (
    <>
      {/* Nav */}
      <nav className="landing-nav" aria-label="Primary navigation">
        <div className="shell nav-inner">
          <Link className="brand" to="/" aria-label="bunOS home">
            <img src="/bunOS.svg" alt="" />
            <span>bunOS</span>
          </Link>
          <div className="nav-links">
            <a className="nav-link" href="#use">Use</a>
            <a className="nav-link" href="#build">Build</a>
            <a className="nav-link" href="#mcp">MCP</a>
            <a className="nav-link" href="#safety">Safety</a>
            <Link className="nav-link" to="/terminal">Terminal</Link>
            <Link className="nav-cta" to="/wallet">
              <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>
              Launch wallet
            </Link>
          </div>
        </div>
      </nav>

      <main>
        {/* Hero */}
        <section className="shell hero" id="top">
          <div className="code-wall" ref={wallRef} aria-hidden="true">
            <pre className="cw-pre" ref={codeRef} />
            <div className="code-wall-fade" />
          </div>

          <div className="hero-copy">
            <h1>Money you can talk to.</h1>
            <div className="hero-actions">
              <Link className="button primary" to="/wallet">
                <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>
                Launch wallet
              </Link>
              <Link className="button secondary" to="/terminal">
                <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="m4 17 6-6-6-6" /><path d="M12 19h8" /></svg>
                Open terminal
              </Link>
              <Link className="button secondary" to="/mcp-guide">
                <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h10" /></svg>
                MCP guide
              </Link>
            </div>
          </div>

          <aside className="product-stage" aria-label="bunOS product preview">
            <div className="wallet-card">
              <div className="wallet-top">
                <div className="handle"><small>X wallet</small><strong>@yourhandle</strong></div>
              </div>
              <div className="balance"><span>Available balance</span><strong>US$184.25</strong></div>
              <div className="asset-grid">
                <div className="asset-cell"><span>Assets</span><strong>USDC, EURC, cirBTC</strong></div>
                <div className="asset-cell"><span>Rails</span><strong>Arc + Base Sepolia</strong></div>
              </div>
            </div>

            <div className="terminal-card">
              <div className="terminal-chrome"><span /><span /><span /></div>
              <div className="terminal-body">
                <div className="terminal-line">&gt; <strong>swap $20 EURC to USDC on Arc</strong></div>
                <div className="terminal-result">
                  <span>Route found</span>
                  <span>Circle AppKit -&gt; Arc testnet -&gt; receipt ready</span>
                </div>
              </div>
            </div>
          </aside>
        </section>

        {/* Stack strip */}
        <section className="stack-strip" aria-label="bunOS stack">
          <div className="shell stack-inner">
            <div className="stack-item"><span>01 Identity</span><strong>X handle becomes the account layer.</strong></div>
            <div className="stack-item"><span>02 Wallet</span><strong>Circle wallets hold user-owned balances.</strong></div>
            <div className="stack-item"><span>03 Agent</span><strong>Terminal and MCP call the same tools.</strong></div>
            <div className="stack-item"><span>04 Settlement</span><strong>Arc carries swaps, bridges, trades, and payouts.</strong></div>
          </div>
        </section>

        {/* Build section */}
        <section className="shell section" id="build">
          <div className="section-head">
            <span className="section-index">Build</span>
            <div className="section-title">
              <h2>A wallet stack for agent builders.</h2>
              <p>bunOS exposes the pieces other agents need: identity, balances, transfers, swaps, bridges, automations, and receipts. The site should feel like a builder portal because the product is one.</p>
            </div>
          </div>

          <div className="developer-grid">
            <div className="code-panel">
              <div className="code-head"><span>mcp.config.json</span><span>user wallet scoped</span></div>
              <pre><code>{`{
  `}<span className="code-red">{`"mcpServers"`}</span>{`: {
    `}<span className="code-red">{`"bunos"`}</span>{`: {
      `}<span className="code-red">{`"url"`}</span>{`: `}<span className="code-green">{`"https://bunos.xyz/mcp"`}</span>{`,
      `}<span className="code-red">{`"headers"`}</span>{`: {
        `}<span className="code-red">{`"Authorization"`}</span>{`: `}<span className="code-green">{`"Bearer bunos_mcp_..."`}</span>{`
      }
    }
  }
}

`}<span className="code-blue">{`// same wallet, same tools`}</span>{`
`}<span className="code-white">{`run_agent_action`}</span>{`({
  prompt: `}<span className="code-green">{`"bridge $5 USDC from Arc to Base"`}</span>{`
})`}</code></pre>
            </div>

            <div className="module-stack">
              <article className="module-panel">
                <span className="mini-label">MCP tools</span>
                <strong>Create wallet, send, swap, bridge, trade.</strong>
                <p>Clients connect through one URL and inherit the user wallet bound to the API key.</p>
                <div className="module-meta"><span>/mcp</span><span>/sse</span><span>API keys</span></div>
              </article>
              <article className="module-panel">
                <span className="mini-label">App surface</span>
                <strong>Buttons for users, terminal for operators.</strong>
                <p>The wallet UI and agent terminal are different doors into the same backend tools.</p>
                <div className="module-meta"><span>Wallet</span><span>Terminal</span><span>Receipts</span></div>
              </article>
            </div>
          </div>
        </section>

        {/* Use section */}
        <section className="shell section" id="use">
          <div className="section-head">
            <span className="section-index">Use</span>
            <div className="section-title">
              <h2>Ask for the outcome. bunOS handles the rails.</h2>
              <p>The interface is intentionally split: normal users use wallet actions, power users type commands, and agents connect over MCP.</p>
            </div>
          </div>

          <div className="capability-list">
            <article className="capability-row"><span>Payments</span><strong>Pay an X handle.</strong><p>Send USDC to onboarded users or create a claimable payment for someone who has not connected yet.</p></article>
            <article className="capability-row"><span>Tokens</span><strong>Swap supported Arc assets.</strong><p>Route USDC, EURC, cirBTC, WETH, and other supported tokens through the same agent surface.</p></article>
            <article className="capability-row"><span>Bridge</span><strong>Move value across rails.</strong><p>Use Arc and Base Sepolia for cross-chain movement while keeping receipts and execution status visible.</p></article>
            <article className="capability-row"><span>Perps</span><strong>Trade from a prompt.</strong><p>Create ArcPerps testnet positions from natural language without pretending failures succeeded.</p></article>
            <article className="capability-row"><span>Distribution</span><strong>Move funds to groups or communities.</strong><p>Create recipient lists, social reward flows, and payout trails without turning the interface into a campaign dashboard.</p></article>
            <article className="capability-row"><span>Automation</span><strong>Schedule recurring wallet work.</strong><p>Run due jobs for balance syncs, repeated agent actions, and operational checks through the same tool layer.</p></article>
          </div>
        </section>

        {/* Safety section */}
        <section className="shell section" id="safety">
          <div className="section-head">
            <span className="section-index">Safety</span>
            <div className="section-title">
              <h2>No shared backend signer for user funds.</h2>
              <p>This is the part worth being blunt about. A slick agent wallet becomes dangerous fast if every user rides one hidden key. bunOS scopes tools to the user's wallet context.</p>
            </div>
          </div>

          <div className="safety-grid">
            <article className="safety-panel primary">
              <div><span className="mini-label">Signing model</span><h3>User-wallet scoped execution.</h3></div>
              <p>API keys bind MCP clients to the same wallet created after X login. Protocol admin keys are not used as user spending keys.</p>
            </article>
            <div className="safety-panel">
              <div className="policy-stack">
                <div className="policy-item"><span>Receipts</span><strong>Every serious action needs a status trail.</strong><p>Pending, submitted, failed, or completed. No fake success screens.</p></div>
                <div className="policy-item"><span>Risk</span><strong>Large actions can be policy gated.</strong><p>Payments, swaps, bridges, and perps can be checked before execution.</p></div>
              </div>
            </div>
          </div>
        </section>

        {/* MCP section */}
        <section className="shell section" id="mcp">
          <div className="section-head">
            <span className="section-index">MCP</span>
            <div className="section-title">
              <h2>Connect any agent to the same wallet.</h2>
              <p>The MCP guide and API Keys page now use the canonical domain. No one should be copy-pasting Railway URLs into clients.</p>
            </div>
          </div>

          <div className="mcp-layout">
            <article className="mcp-panel">
              <h3>One URL. User scoped tools.</h3>
              <p>Create an API key after signing in with X, paste the MCP config into Claude, Cursor, Windsurf, or another MCP client, then call the same wallet tools the terminal uses.</p>
              <div className="url-box"><span>MCP URL</span><code>https://bunos.xyz/mcp</code></div>
              <div className="hero-actions">
                <Link className="button primary" to="/api-keys">Create API key</Link>
                <Link className="button secondary" to="/mcp-guide">Read MCP guide</Link>
              </div>
            </article>
            <article className="mcp-panel">
              <span className="mini-label">Example prompts</span>
              <div className="prompt-list">
                <div className="prompt-row"><code>send $10 USDC to @alice</code><span>pay</span></div>
                <div className="prompt-row"><code>swap $20 EURC to USDC</code><span>swap</span></div>
                <div className="prompt-row"><code>bridge $5 from Arc to Base</code><span>bridge</span></div>
                <div className="prompt-row"><code>drop $1 to first 10 replies</code><span>reward</span></div>
                <div className="prompt-row"><code>open BTC long 2x with $5</code><span>perps</span></div>
              </div>
            </article>
          </div>
        </section>

        {/* CTA */}
        <section className="shell final-cta">
          <div className="cta-panel">
            <div>
              <h2>Start with a wallet. Then give it tools.</h2>
              <p>Connect X, inspect balances, try the terminal, and create an MCP key when you want your own agent to use the same wallet.</p>
            </div>
            <div className="cta-actions">
              <Link className="button primary" to="/wallet">Launch wallet</Link>
              <Link className="button secondary" to="/terminal">Use terminal</Link>
              <Link className="button secondary" to="/api-keys">API keys</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="shell footer-inner">
          <Link className="brand" to="/"><img src="/bunOS.svg" alt="" /><span>bunOS</span></Link>
          <div className="footer-links">
            <Link to="/wallet">Wallet</Link>
            <Link to="/terminal">Terminal</Link>
            <Link to="/mcp-guide">MCP Guide</Link>
            <Link to="/api-keys">API Keys</Link>
            <a href="https://testnet.arcscan.app" target="_blank" rel="noreferrer">Arc Explorer</a>
          </div>
        </div>
      </footer>
    </>
  );
}
