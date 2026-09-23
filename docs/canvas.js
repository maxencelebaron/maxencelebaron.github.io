(function () {
  const canvas = document.getElementById('bg-canvas');
  const ctx    = canvas.getContext('2d');
  let W, H, dpr;

  const isDark = () => document.documentElement.getAttribute('data-theme') !== 'light';

  /* ── constants ───────────────────────────────────────────── */
  const HUES          = [205, 220, 240, 190, 260, 180];
  const CELL          = 16;
  const N_RUNS        = 4;
  const N_HILLS       = 14;
  const N_ROLLERS     = 5;
  const RUN_CAP       = 44;
  const SAMPLE_EVERY  = 14;
  const GROW_FRAMES   = 22;
  const FAIL_P        = 0.10;
  const FAIL_TTL      = 320;
  const CROSS_P       = 0.40;
  const PAD           = 16;
  const BLOCK_FADE    = 60;
  const RECENCY       = 0.0006;
  const SPAWN_MIN     = 2.5;
  const SPAWN_MAX     = 3.5;
  const PRIOR         = 0.5;
  const STAGNATE_BEATS    = 40;
  const SUMMIT_FRAC       = 0.78;
  const RECYCLE_COOLDOWN  = 180;
  const CLEARANCE         = 0.9;
  const CROWD_R           = 48;
  const step = () => 46 + Math.random() * 30;

  /* ── resize ──────────────────────────────────────────────── */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    W   = window.innerWidth;
    H   = window.innerHeight;
    canvas.width  = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ── block avoidance ─────────────────────────────────────── */
  let blocks = [];
  const BLOCK_SELECTORS = [
    '.topnav', '.hero-grid', '.hero-text-col', '.hero-badge',
    '.hero-quote-text', '.home-section', '.item', '.section-header',
    '.page-header', '.home-pub', '.home-exp', '.pub-entry',
    '.exp-entry', '.edu-entry', '.talk-entry', '.proj-entry',
    '.placeholder', '.footer-inner',
  ];

  function collectBlocks() {
    blocks = [];
    const nodes = document.querySelectorAll(BLOCK_SELECTORS.join(','));
    for (let i = 0; i < nodes.length; i++) {
      const r = nodes[i].getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      blocks.push({ x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 });
    }
  }

  function insideBlock(x, y) {
    for (const b of blocks)
      if (x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h) return true;
    return false;
  }

  function blockDist(x, y) {
    let d = Infinity;
    for (const b of blocks) {
      const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
      const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
      const dd = Math.hypot(dx, dy);
      if (dd < d) d = dd;
    }
    return d === Infinity ? BLOCK_FADE * 2 : d;
  }

  /* ── terrain ─────────────────────────────────────────────── */
  let peaks = [];

  function placePeak(y0, y1, decoy, clearanceFactor = 1) {
    let best = null, bestV = -1;
    for (let c = 0; c < 40; c++) {
      const sigma = decoy
        ? 45  + Math.random() * 80
        : 130 + Math.random() * 80;
      const x = sigma * 0.6 + Math.random() * (W - sigma * 1.2);
      const y = Math.max(sigma * 0.6, Math.min(H - sigma * 0.6, y0 + Math.random() * (y1 - y0)));
      const clear = blockDist(x, y) / sigma;
      if (clear < CLEARANCE * clearanceFactor) continue;
      const dPeaks = peaks.length
        ? Math.min(...peaks.map(p => Math.hypot(p.x - x, p.y - y)))
        : 9999;
      const v = Math.min(clear, 2) + Math.min(dPeaks / 500, 2);
      if (v > bestV) {
        bestV = v;
        best = {
          x, y,
          amp:   decoy ? 0.18 + Math.random() * 0.27 : 0.6 + Math.random() * 0.4,
          sigma,
          decoy,
        };
      }
    }
    return best;
  }

  function terrain(x, y) {
    if (x < 14 || y < 14 || x > W - 14 || y > H - 14) return 0;
    const bd = blockDist(x, y);
    if (bd <= 0) return 0;
    let f = 0.06;
    for (const pk of peaks) {
      const d2 = (x - pk.x) ** 2 + (y - pk.y) ** 2;
      if (d2 < pk.sigma * pk.sigma * 9)
        f += pk.amp * Math.exp(-d2 / (2 * pk.sigma * pk.sigma));
    }
    if (bd < BLOCK_FADE) {
      const m = bd / BLOCK_FADE;
      f *= m * m * (3 - 2 * m);
    }
    return Math.min(1, f);
  }

  let mouse = null;
  window.addEventListener('pointermove', e => { mouse = { x: e.clientX, y: e.clientY }; });

  function fitness(x, y) {
    let f = terrain(x, y);
    if (f > 0 && mouse) {
      const d2 = (x - mouse.x) ** 2 + (y - mouse.y) ** 2;
      f += 0.25 * Math.exp(-d2 / (2 * 150 * 150));
    }
    return Math.min(1, f);
  }

  /* ── heatmap ─────────────────────────────────────────────── */
  const heat  = document.createElement('canvas');
  const hctx  = heat.getContext('2d');
  let heatDirty = true;

  function drawHeatmap() {
    const dark = isDark();
    const gw = Math.max(1, Math.ceil(W / CELL));
    const gh = Math.max(1, Math.ceil(H / CELL));
    heat.width  = gw;
    heat.height = gh;
    const img  = hctx.createImageData(gw, gh);
    const cr   = dark ? 56  : 20;
    const cg   = dark ? 120 : 70;
    const cb   = dark ? 220 : 160;
    const maxA = dark ? 0.34 : 0.42;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const f = terrain(gx * CELL + CELL / 2, gy * CELL + CELL / 2);
        if (f <= 0.035) continue;
        const level = Math.ceil(Math.min(1, f) * 10) / 10;
        const i4 = (gy * gw + gx) * 4;
        img.data[i4]     = cr;
        img.data[i4 + 1] = cg;
        img.data[i4 + 2] = cb;
        img.data[i4 + 3] = Math.floor(level * maxA * 255);
      }
    }
    hctx.putImageData(img, 0, 0);
  }

  /* ── runs ────────────────────────────────────────────────── */
  let runs     = [];
  let frameN   = 0;
  let lastRecycle = 0;

  const ease = t => 1 - (1 - t) ** 3;

  function makeNode(run, parents, score, outcome, ax, ay) {
    const px = parents.length ? parents.reduce((s, p) => s + p.x, 0) / parents.length : ax;
    const py = parents.length ? parents.reduce((s, p) => s + p.y, 0) / parents.length : ay;
    return {
      run, parents, children: 0,
      ax, ay, x: px, y: py,
      t: parents.length ? 0 : 1,
      score, outcome,
      alpha: 0, removing: false,
      born: frameN, phase: Math.random() * Math.PI * 2, flash: 0,
    };
  }

  function sampleParents(run, k) {
    const pool = run.nodes.filter(n => !n.removing && n.outcome !== 'fail' && n.t >= 1);
    const out  = [];
    for (let s = 0; s < k && pool.length; s++) {
      const weights = pool.map(n => Math.exp(n.score * 4 - (frameN - n.born) * RECENCY));
      const total   = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * total, pick = pool.length - 1;
      for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) { pick = i; break; } }
      out.push(pool[pick]);
      pool.splice(pick, 1);
    }
    return out;
  }

  function childAnchor(run, parents) {
    const px = parents.reduce((s, p) => s + p.ax, 0) / parents.length;
    const py = parents.reduce((s, p) => s + p.ay, 0) / parents.length;
    const toTarget = Math.atan2(run.target.y - py, run.target.x - px);
    const cands = [];
    for (let c = 0; c < 7; c++) {
      const dir = Math.random() * Math.PI * 2;
      const d   = step() * (Math.random() < 0.15 ? 2.4 : 1);
      const ax  = px + Math.cos(dir) * d;
      const ay  = py + Math.sin(dir) * d;
      const f   = fitness(ax, ay);
      if (f <= 0.015) continue;
      let crowd = 0;
      for (const n of run.nodes)
        if (!n.removing && (n.ax - ax) ** 2 + (n.ay - ay) ** 2 < CROWD_R * CROWD_R) crowd++;
      const v = Math.max(1e-4, (f * (1 + PRIOR * Math.cos(dir - toTarget))) / (1 + 0.7 * crowd));
      cands.push({ ax, ay, f, v });
    }
    if (!cands.length) return null;
    const total = cands.reduce((s, c) => s + c.v * c.v, 0);
    let r = Math.random() * total;
    for (const c of cands) { r -= c.v * c.v; if (r <= 0) return [c.ax, c.ay, c.f]; }
    const last = cands[cands.length - 1];
    return [last.ax, last.ay, last.f];
  }

  function generateChildren(run, parents) {
    const n      = 2 + Math.floor(Math.random() * 2);
    const pScore = Math.max(...parents.map(p => p.score));
    for (let k = 0; k < n; k++) {
      const spot = childAnchor(run, parents);
      if (!spot || Math.random() < FAIL_P) {
        const p0 = parents[0];
        const a  = Math.random() * Math.PI * 2;
        run.nodes.push(makeNode(run, parents, 0, 'fail', p0.ax + Math.cos(a) * 14, p0.ay + Math.sin(a) * 14));
      } else {
        const score   = Math.min(1, Math.max(0.02, spot[2] * 0.85 + (Math.random() - 0.35) * 0.12));
        const outcome = score > pScore ? 'better' : 'worse';
        run.nodes.push(makeNode(run, parents, score, outcome, spot[0], spot[1]));
        if (score > run.bestScore) { run.bestScore = score; run.lastImproveBeat = run.beats; }
      }
      for (const p of parents) p.children++;
    }
    for (const p of parents) p.flash = 1;
  }

  function spawnRun(target, hue) {
    let sx = target.x, sy = target.y;
    for (let c = 0; c < 24; c++) {
      const a = Math.random() * Math.PI * 2;
      const d = target.sigma * (SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN));
      const x = Math.max(40, Math.min(W - 40, target.x + Math.cos(a) * d));
      const y = Math.max(40, Math.min(H - 40, target.y + Math.sin(a) * d));
      if (insideBlock(x, y) || blockDist(x, y) < 30) continue;
      sx = x; sy = y; break;
    }
    const run = {
      nodes: [], hue, target, state: 'running',
      nextSample: frameN + 20 + Math.floor(Math.random() * 30),
      beats: 0, bestScore: 0, lastImproveBeat: 0, convergedAt: 0,
    };
    const root = makeNode(run, [], 0.2, 'root', sx, sy);
    root.t = 1;
    run.nodes.push(root);
    generateChildren(run, [root]);
    return run;
  }

  function runChampion(run) {
    let best = null;
    for (const n of run.nodes)
      if (!n.removing && n.outcome !== 'fail' && (!best || n.score > best.score)) best = n;
    return best;
  }

  /* ── bootstrap ───────────────────────────────────────────── */
  function initPeaks() {
    peaks = [];
    const bandH = H / N_RUNS;
    for (let i = 0; i < N_RUNS; i++) {
      const pk = placePeak(i * bandH, (i + 1) * bandH, false);
      if (pk) peaks.push(pk);
    }
    for (let i = 0; i < N_HILLS; i++) {
      const y0 = (i / N_HILLS) * H;
      const pk = placePeak(y0, y0 + H / N_HILLS, true, 0.75);
      if (pk) peaks.push(pk);
    }
    for (let i = 0; i < N_ROLLERS; i++) {
      const y0 = (i / N_ROLLERS) * H;
      peaks.push({
        x: W * (0.15 + Math.random() * 0.7),
        y: y0 + (H / N_ROLLERS) * (0.2 + Math.random() * 0.6),
        amp:   0.10 + Math.random() * 0.06,
        sigma: 350 + Math.random() * 250,
        decoy: true,
      });
    }
  }

  function initRuns() {
    runs = [];
    const main = peaks.filter(p => !p.decoy);
    for (let i = 0; i < main.length; i++)
      runs.push(spawnRun(main[i], HUES[i % HUES.length]));
  }

  /* ── main tick ───────────────────────────────────────────── */
  function tick() {
    frameN++;
    const dark = isDark();
    ctx.clearRect(0, 0, W, H);

    if (heatDirty || frameN % 45 === 0) {
      collectBlocks();
      drawHeatmap();
      heatDirty = false;
    }

    /* landscape */
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(heat, 0, 0, heat.width, heat.height, 0, 0, W, H);

    /* peak markers */
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (const pk of peaks) {
      if (pk.decoy) continue;
      const a0 = 0.3 + pk.amp * 0.5;
      ctx.strokeStyle = dark
        ? `hsla(205,60%,70%,${(a0 * 0.5).toFixed(3)})`
        : `hsla(205,70%,24%,${(a0 * 0.7).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pk.x - 4, pk.y); ctx.lineTo(pk.x + 4, pk.y);
      ctx.moveTo(pk.x, pk.y - 4); ctx.lineTo(pk.x, pk.y + 4);
      ctx.stroke();
      ctx.fillStyle = dark
        ? `hsla(205,45%,78%,${a0.toFixed(3)})`
        : `hsla(205,75%,18%,${Math.min(1, a0 * 1.3).toFixed(3)})`;
      ctx.fillText(pk.amp.toFixed(2), pk.x, pk.y - 9);
    }

    /* ---- live runs: beat sampling ---- */
    for (const run of runs) {
      if (run.state !== 'running') continue;
      if (frameN >= run.nextSample) {
        run.beats++;
        const k = Math.random() < CROSS_P ? 2 : 1;
        const parents = sampleParents(run, k);
        if (parents.length) generateChildren(run, parents);
        const champ = runChampion(run);
        const near  = mouse && champ &&
          (mouse.x - champ.x) ** 2 + (mouse.y - champ.y) ** 2 < 300 * 300;
        run.nextSample = frameN + (near ? SAMPLE_EVERY / 2.5 : SAMPLE_EVERY) * (0.7 + Math.random() * 0.6);

        const c = runChampion(run);
        const onSummit = c &&
          (c.ax - run.target.x) ** 2 + (c.ay - run.target.y) ** 2 < (run.target.sigma * 0.6) ** 2 &&
          c.score >= run.target.amp * SUMMIT_FRAC;
        const stagnant = run.beats - run.lastImproveBeat > STAGNATE_BEATS;
        if (onSummit || (stagnant && run.beats > 15)) {
          run.state = 'converged';
          run.convergedAt = frameN;
          for (const n of run.nodes) if (n.outcome === 'fail') n.removing = true;
        }
      }
    }

    /* renewal */
    const live    = runs.filter(r => r.state === 'running').length;
    const minLive = Math.max(1, Math.round(N_RUNS * 0.4));
    if (live < minLive && frameN - lastRecycle > RECYCLE_COOLDOWN) {
      const oldest = runs
        .filter(r => r.state === 'converged')
        .sort((a, b) => a.convergedAt - b.convergedAt)[0];
      if (oldest) {
        lastRecycle = frameN;
        oldest.state = 'fading';
        for (const n of oldest.nodes) n.removing = true;
        const idx   = peaks.indexOf(oldest.target);
        const bandH = H / N_RUNS;
        const band  = Math.max(0, Math.min(N_RUNS - 1, Math.floor(oldest.target.y / bandH)));
        const fresh = placePeak(band * bandH, (band + 1) * bandH, false);
        if (fresh && idx >= 0) {
          peaks[idx] = fresh;
          runs.push(spawnRun(fresh, oldest.hue));
        }
      }
    }

    /* node cap + animation */
    for (const run of runs) {
      if (run.state === 'running') {
        const lc = run.nodes.filter(n => !n.removing).length;
        if (lc > RUN_CAP) {
          const leaves = run.nodes
            .filter(n => !n.removing && n.children === 0 && n.outcome !== 'root')
            .sort((a, b) => a.score - b.score);
          const trim = Math.max(4, lc - RUN_CAP);
          for (let li = 0; li < Math.min(trim, leaves.length); li++) leaves[li].removing = true;
        }
      }
      for (const n of run.nodes) {
        if (n.t < 1) n.t = Math.min(1, n.t + 1 / GROW_FRAMES);
        const te     = ease(n.t);
        const living = n.parents.filter(p => p.alpha > 0);
        const ppx    = living.length ? living.reduce((s, p) => s + p.x, 0) / living.length : n.ax;
        const ppy    = living.length ? living.reduce((s, p) => s + p.y, 0) / living.length : n.ay;
        const frozen = run.state !== 'running';
        const bx     = frozen ? 0 : Math.sin(frameN * 0.008 + n.phase) * 2;
        const by     = frozen ? 0 : Math.cos(frameN * 0.009 + n.phase) * 2;
        n.x = ppx + (n.ax + bx - ppx) * te;
        n.y = ppy + (n.ay + by - ppy) * te;
        if (run.state === 'running' && n.outcome === 'fail' && frameN - n.born > FAIL_TTL) n.removing = true;
        if (n.removing) n.alpha = Math.max(0, n.alpha - 0.02);
        else            n.alpha = Math.min(n.outcome === 'fail' ? 0.5 : 1, n.alpha + 0.035);
        if (n.flash > 0) n.flash -= 0.025;
      }
      for (let i = run.nodes.length - 1; i >= 0; i--) {
        const n = run.nodes[i];
        if (n.removing && n.alpha <= 0) {
          for (const p of n.parents) p.children--;
          run.nodes.splice(i, 1);
        }
      }
    }
    runs = runs.filter(r => !(r.state === 'fading' && r.nodes.length === 0));

    /* edges */
    for (const run of runs) {
      const dim = run.state === 'running' ? 1 : 0.7;
      for (const n of run.nodes) {
        for (const p of n.parents) {
          const ea = Math.min(n.alpha, p.alpha) * dim;
          if (ea <= 0) continue;
          let stroke, lw = 0.8;
          if (n.outcome === 'better') {
            stroke = dark
              ? `hsla(${run.hue},70%,70%,${(0.45 * ea).toFixed(3)})`
              : `hsla(${run.hue},65%,32%,${(0.40 * ea).toFixed(3)})`;
            lw = 1.1;
          } else if (n.outcome === 'worse') {
            stroke = dark
              ? `hsla(40,45%,60%,${(0.25 * ea).toFixed(3)})`
              : `hsla(38,50%,40%,${(0.22 * ea).toFixed(3)})`;
          } else {
            stroke = dark
              ? `hsla(5,65%,58%,${(0.28 * ea).toFixed(3)})`
              : `hsla(4,70%,42%,${(0.25 * ea).toFixed(3)})`;
          }
          ctx.strokeStyle = stroke;
          ctx.lineWidth   = lw;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(n.x, n.y);
          ctx.stroke();
        }
      }
    }

    /* nodes */
    for (const run of runs) {
      const dim = run.state === 'running' ? 1 : 0.7;
      for (const n of run.nodes) {
        if (n.alpha <= 0) continue;
        const a = n.alpha * dim;
        const r = 1.6 + n.score * 3;
        let fill;
        if (n.outcome === 'fail') {
          fill = dark
            ? `hsla(5,70%,55%,${(0.45 * a).toFixed(3)})`
            : `hsla(4,75%,45%,${(0.40 * a).toFixed(3)})`;
        } else if (n.outcome === 'worse') {
          fill = dark
            ? `hsla(40,40%,58%,${(0.50 * a).toFixed(3)})`
            : `hsla(38,45%,45%,${(0.45 * a).toFixed(3)})`;
        } else {
          const l = dark ? 55 + n.score * 32 : 45 - n.score * 18;
          fill = `hsla(${run.hue},65%,${l.toFixed(1)}%,${((0.45 + n.score * 0.5) * a).toFixed(3)})`;
        }
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.outcome === 'fail' ? 1.5 : r, 0, Math.PI * 2);
        ctx.fill();

        if (n.flash > 0) {
          ctx.strokeStyle = dark
            ? `hsla(${run.hue},80%,78%,${(n.flash * 0.6).toFixed(3)})`
            : `hsla(${run.hue},70%,35%,${(n.flash * 0.5).toFixed(3)})`;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 4 + (1 - n.flash) * 7, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    /* champions */
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    for (const run of runs) {
      if (run.state === 'fading') continue;
      const champ  = runChampion(run);
      if (!champ) continue;
      const active = run.state === 'running';
      const halo   = active ? 6 + Math.sin(frameN * 0.06) * 1.5 : 6;
      ctx.strokeStyle = dark
        ? `hsla(50,90%,72%,${active ? 0.75 : 0.5})`
        : `hsla(45,95%,38%,${active ? 0.70 : 0.45})`;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(champ.x, champ.y, halo, 0, Math.PI * 2);
      ctx.stroke();
      if (!active) {
        ctx.fillStyle = dark ? 'hsla(50,80%,75%,0.6)' : 'hsla(45,90%,35%,0.55)';
        ctx.fillText(`✓ ${champ.score.toFixed(2)}`, champ.x + 10, champ.y + 3);
      }
    }

    requestAnimationFrame(tick);
  }

  /* ── init ────────────────────────────────────────────────── */
  function init() {
    resize();
    collectBlocks();
    initPeaks();
    drawHeatmap();
    initRuns();
    requestAnimationFrame(tick);
  }

  window.addEventListener('resize', () => {
    resize(); collectBlocks(); initPeaks(); drawHeatmap(); initRuns();
  });

  window.addEventListener('scroll', () => { heatDirty = true; }, { passive: true });

  new MutationObserver(() => { heatDirty = true; })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  init();
})();
