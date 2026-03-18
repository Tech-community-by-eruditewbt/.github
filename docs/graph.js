(function () {
  const canvas = document.getElementById("graph");
  const ctx = canvas.getContext("2d");

  const countsEl = document.getElementById("counts");
  const selectedEl = document.getElementById("selected");
  const qEl = document.getElementById("q");
  const typeEl = document.getElementById("type");
  const modeEl = document.getElementById("mode");
  const resetEl = document.getElementById("reset");
  const randomEl = document.getElementById("random");
  const copyLinkEl = document.getElementById("copyLink");
  const pathEl = document.getElementById("path");

  const COLORS = {
    occupation: "#27d0a0",
    industry_division: "#f1c66a",
    technology: "#ff6a3d",
    tool: "#8aa0ff",
    computing_pillar: "#ffffff",
    root: "rgba(232,236,245,0.4)",
    other: "rgba(232,236,245,0.65)",
  };

  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

  let W = 0;
  let H = 0;
  let nodes = [];
  let links = [];
  let nodeById = new Map();
  let adj = new Map(); // id -> Set<neighborId>
  let pinnedId = null;

  // view transform (world -> screen)
  let scale = 1;
  let panX = 0;
  let panY = 0;

  // simulation
  let raf = 0;
  let tick = 0;
  let dragging = null;
  let dragOffset = { x: 0, y: 0 };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.floor(rect.width));
    H = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    draw();
  }

  function colorOf(n) {
    return COLORS[n.type] || COLORS.other;
  }

  function worldToScreen(p) {
    return { x: (p.x * scale + panX), y: (p.y * scale + panY) };
  }

  function screenToWorld(p) {
    return { x: (p.x - panX) / scale, y: (p.y - panY) / scale };
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function buildAdj() {
    adj = new Map();
    for (const n of nodes) adj.set(n.id, new Set());
    for (const e of links) {
      const a = e.source;
      const b = e.target;
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b);
      adj.get(b).add(a);
    }
  }

  function edgeListFor(id) {
    const out = [];
    for (const e of links) {
      if (e.source === id || e.target === id) out.push(e);
    }
    return out;
  }

  function setHashForNode(id) {
    try {
      if (!id) {
        history.replaceState(null, "", location.pathname + location.search);
        return;
      }
      const h = `#node=${encodeURIComponent(id)}`;
      history.replaceState(null, "", h);
    } catch (_) {}
  }

  function parseHashNode() {
    const h = (location.hash || "").replace(/^#/, "");
    if (!h) return null;
    const parts = h.split("&");
    for (const p of parts) {
      const [k, v] = p.split("=");
      if (k === "node" && v) return decodeURIComponent(v);
    }
    return null;
  }

  function pickNode(mx, my) {
    const p = screenToWorld({ x: mx, y: my });
    // brute force; dataset is small enough for a UI build
    let best = null;
    let bestD2 = 1e18;
    for (const n of visibleNodes()) {
      const dx = n.x - p.x;
      const dy = n.y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = n;
      }
    }
    // selection radius in world space
    const r = 10 / scale;
    if (best && bestD2 <= r * r) return best;
    return null;
  }

  function visibleNodes() {
    const mode = modeEl?.value || "ego";
    if (mode === "pillars") {
      return nodes.filter((n) => n.type === "computing_pillar");
    }

    if (pinnedId) {
      const nset = new Set([pinnedId]);
      const neighbors = adj.get(pinnedId) || new Set();
      for (const x of neighbors) nset.add(x);
      // include one more hop for context (limited)
      for (const x of neighbors) {
        const nn = adj.get(x);
        if (!nn) continue;
        let c = 0;
        for (const y of nn) {
          if (c++ > 30) break;
          nset.add(y);
        }
      }
      return nodes.filter((n) => nset.has(n.id));
    }

    // global view: limit to pillars + top occupations by degree + some tech
    const degrees = [];
    for (const n of nodes) degrees.push([n.id, (adj.get(n.id)?.size || 0)]);
    degrees.sort((a, b) => b[1] - a[1]);

    const keep = new Set();
    for (const n of nodes) if (n.type === "computing_pillar") keep.add(n.id);
    for (const [id] of degrees.slice(0, 260)) keep.add(id);
    // add a small tech slice
    let t = 0;
    for (const [id] of degrees) {
      const n = nodeById.get(id);
      if (!n) continue;
      if (n.type === "technology" || n.type === "tool") {
        keep.add(id);
        if (++t >= 140) break;
      }
    }
    return nodes.filter((n) => keep.has(n.id));
  }

  function visibleLinks(vnodes) {
    const set = new Set(vnodes.map((n) => n.id));
    return links.filter((e) => set.has(e.source) && set.has(e.target));
  }

  function stepSim() {
    tick++;
    const vnodes = visibleNodes();
    const vset = new Set(vnodes.map((n) => n.id));
    const vlinks = visibleLinks(vnodes);

    // pull toward center
    const cx = 0;
    const cy = 0;
    for (const n of vnodes) {
      if (dragging && dragging.id === n.id) continue;
      n.vx = (n.vx || 0) * 0.92;
      n.vy = (n.vy || 0) * 0.92;
      n.vx += (cx - n.x) * 0.0008;
      n.vy += (cy - n.y) * 0.0008;
    }

    // link spring
    for (const e of vlinks) {
      const a = nodeById.get(e.source);
      const b = nodeById.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const target = 44;
      const k = 0.0012;
      const f = (d - target) * k;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      if (!dragging || dragging.id !== a.id) {
        a.vx -= fx;
        a.vy -= fy;
      }
      if (!dragging || dragging.id !== b.id) {
        b.vx += fx;
        b.vy += fy;
      }
    }

    // repel
    const arr = vnodes;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy + 0.01;
        const min = 20;
        const f = (min * min) / d2 * 0.015;
        const fx = dx * f;
        const fy = dy * f;
        if (!dragging || dragging.id !== a.id) {
          a.vx -= fx;
          a.vy -= fy;
        }
        if (!dragging || dragging.id !== b.id) {
          b.vx += fx;
          b.vy += fy;
        }
      }
    }

    for (const n of vnodes) {
      if (!vset.has(n.id)) continue;
      if (dragging && dragging.id === n.id) continue;
      n.x += (n.vx || 0);
      n.y += (n.vy || 0);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(scale, scale);

    const vnodes = visibleNodes();
    const vlinks = visibleLinks(vnodes);
    const vset = new Set(vnodes.map((n) => n.id));

    // edges
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = "rgba(232,236,245,0.12)";
    ctx.beginPath();
    for (const e of vlinks) {
      const a = nodeById.get(e.source);
      const b = nodeById.get(e.target);
      if (!a || !b) continue;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // nodes
    for (const n of vnodes) {
      const r = n.type === "computing_pillar" ? 8 : 5;
      ctx.beginPath();
      ctx.fillStyle = colorOf(n);
      ctx.arc(n.x, n.y, r / scale, 0, Math.PI * 2);
      ctx.fill();
      if (n.id === pinnedId) {
        ctx.strokeStyle = "rgba(241,198,106,0.9)";
        ctx.lineWidth = 2 / scale;
        ctx.stroke();
      }
    }

    // labels (only if zoomed in)
    if (scale > 1.35) {
      ctx.font = `${12 / scale}px "Space Grotesk", sans-serif`;
      ctx.fillStyle = "rgba(232,236,245,0.86)";
      for (const n of vnodes) {
        if (n.type === "root") continue;
        const label = (n.label || "").slice(0, 46);
        ctx.fillText(label, n.x + 9 / scale, n.y - 8 / scale);
      }
    }

    ctx.restore();

    if (countsEl) {
      countsEl.textContent = `${vnodes.length} nodes shown · ${vlinks.length} links shown`;
    }
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      for (let i = 0; i < 2; i++) stepSim();
      draw();
      schedule();
    });
  }

  function setSelected(n) {
    if (!selectedEl) return;
    if (!n) {
      selectedEl.textContent = "Click a node to inspect it.";
      if (pathEl) pathEl.textContent = "Select an occupation to get suggested pillars and project tracks.";
      return;
    }
    const deg = adj.get(n.id)?.size || 0;
    const bits = [];
    bits.push(`<b>Label:</b> ${escapeHtml(n.label || n.id)}`);
    bits.push(`<b>Type:</b> ${escapeHtml(n.type || "unknown")}`);
    if (n.code) bits.push(`<b>O*NET Code:</b> ${escapeHtml(n.code)}`);
    bits.push(`<b>Degree:</b> ${deg}`);
    if (n.description) bits.push(`<b>Description:</b> ${escapeHtml(n.description)}`);
    selectedEl.innerHTML = bits.join("<br/>");

    // Path suggestions (only for occupations)
    if (pathEl) {
      if (n.type !== "occupation") {
        pathEl.textContent = "Select an occupation to get suggested pillars and project tracks.";
      } else {
        pathEl.innerHTML = buildPathHtml(n.id);
      }
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function applySearch() {
    const q = (qEl?.value || "").trim().toLowerCase();
    const t = typeEl?.value || "all";
    if (!q) return null;

    // match by label/id
    let best = null;
    for (const n of nodes) {
      if (t !== "all" && n.type !== t) continue;
      const label = (n.label || "").toLowerCase();
      if (label === q || n.id.toLowerCase() === q) return n;
      if (label.includes(q)) {
        best = best || n;
        // prefer closer labels
        if (label.startsWith(q)) return n;
      }
    }
    return best;
  }

  function resetView() {
    pinnedId = null;
    scale = 1;
    panX = W * 0.5;
    panY = H * 0.5;
    setHashForNode(null);
    setSelected(null);
  }

  function pinNode(n) {
    if (!n) return;
    pinnedId = n.id;
    setSelected(n);
    setHashForNode(n.id);
    // center view
    panX = W * 0.5 - n.x * scale;
    panY = H * 0.5 - n.y * scale;
  }

  function buildPathHtml(occId) {
    // Pillars by explicit digitized_by edges
    const pillarScores = new Map(); // pillarId -> score
    const relatedOcc = [];

    for (const e of links) {
      if (e.source === occId && e.relation === "digitized_by") {
        const tgt = nodeById.get(e.target);
        if (tgt && tgt.type === "computing_pillar") {
          pillarScores.set(tgt.id, (pillarScores.get(tgt.id) || 0) + (e.weight || 1));
        }
      }
      if (e.source === occId && e.relation === "related_occupation") {
        const tgt = nodeById.get(e.target);
        if (tgt && tgt.type === "occupation") relatedOcc.push(tgt);
      }
      if (e.target === occId && e.relation === "related_occupation") {
        const src = nodeById.get(e.source);
        if (src && src.type === "occupation") relatedOcc.push(src);
      }
    }

    const topPillars = Array.from(pillarScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, score]) => ({ n: nodeById.get(id), score }));

    // Tracks based on pillars
    const trackLinks = [];
    const base = "https://github.com/eruditewbt/Tech_Community_by_EruditeWBT/blob/main/projects/tracks/";

    const addTrack = (file, label) => trackLinks.push({ file, label });

    const pillarIds = topPillars.map((p) => p.n?.id).filter(Boolean);
    if (pillarIds.some((x) => x === "pill:ai")) addTrack("ai_projects.md", "AI projects");
    if (pillarIds.some((x) => x === "pill:data")) addTrack("industry_projects.md", "Industry projects");
    if (pillarIds.some((x) => x === "pill:cloud" || x === "pill:security" || x === "pill:networks"))
      addTrack("beginner_projects.md", "Beginner projects");
    if (pillarIds.some((x) => x === "pill:automation")) addTrack("industry_projects.md", "Automation/industry projects");

    // Always include a fast-start option
    addTrack("beginner_projects.md", "Fast-start projects");

    // de-dupe tracks by file
    const seen = new Set();
    const uniqTracks = [];
    for (const t of trackLinks) {
      if (seen.has(t.file)) continue;
      seen.add(t.file);
      uniqTracks.push(t);
    }

    const escape = escapeHtml;
    const parts = [];

    parts.push(`<b>Next step:</b> pick one pillar, then ship one small project this week.`);
    parts.push(`<br/><br/><b>Top pillars:</b>`);
    if (!topPillars.length) {
      parts.push(`<br/>No pillar scores found for this node in the web build.`);
    } else {
      for (const p of topPillars) {
        parts.push(`<br/>• ${escape(p.n?.label || "Pillar")} <span style="opacity:.7">(${p.score.toFixed(1)})</span>`);
      }
    }

    parts.push(`<br/><br/><b>Suggested tracks:</b>`);
    for (const t of uniqTracks.slice(0, 3)) {
      parts.push(`<br/>• <a class="inline" href="${base + t.file}" target="_blank" rel="noreferrer">${escape(t.label)}</a>`);
    }

    if (relatedOcc.length) {
      const uniq = [];
      const seen2 = new Set();
      for (const o of relatedOcc) {
        if (seen2.has(o.id)) continue;
        seen2.add(o.id);
        uniq.push(o);
        if (uniq.length >= 6) break;
      }
      parts.push(`<br/><br/><b>Adjacent roles:</b>`);
      for (const o of uniq) {
        parts.push(`<br/>• ${escape(o.label || o.id)}`);
      }
    }

    parts.push(
      `<br/><br/><span style="opacity:.75">Formula:</span> <span style="font-weight:900">Field → Role → Skills → Tools → Projects → Income</span>`
    );
    return parts.join("");
  }

  function normalizeData(raw) {
    const rawNodes = raw.nodes || [];
    const rawLinks = raw.links || raw.links || [];

    nodes = rawNodes.map((n, i) => ({
      ...n,
      id: n.id,
      label: n.label || n.id,
      type: n.type || "other",
      x: (Math.random() - 0.5) * 600,
      y: (Math.random() - 0.5) * 520,
      vx: 0,
      vy: 0,
      _i: i,
    }));

    nodeById = new Map(nodes.map((n) => [n.id, n]));

    links = rawLinks.map((e) => ({
      source: typeof e.source === "object" ? e.source.id : e.source,
      target: typeof e.target === "object" ? e.target.id : e.target,
      relation: e.relation || "",
      weight: Number(e.weight || 1),
    }));

    // drop links to missing nodes (just in case)
    links = links.filter((e) => nodeById.has(e.source) && nodeById.has(e.target));
    buildAdj();

    if (countsEl) countsEl.textContent = `${nodes.length} nodes · ${links.length} links loaded`;
  }

  async function load() {
    resize();
    resetView();

    const res = await fetch("assets/graph/graph.json", { cache: "no-store" });
    const raw = await res.json();
    normalizeData(raw);

    // If URL specifies a node, pin it.
    const hashNode = parseHashNode();
    if (hashNode && nodeById.has(hashNode)) {
      pinNode(nodeById.get(hashNode));
      scale = 1.2;
    }

    schedule();
  }

  // interactions
  let isPanning = false;
  let panStart = { x: 0, y: 0, ox: 0, oy: 0 };

  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const picked = pickNode(mx, my);
    if (picked) {
      dragging = picked;
      const w = screenToWorld({ x: mx, y: my });
      dragOffset.x = picked.x - w.x;
      dragOffset.y = picked.y - w.y;
      return;
    }
    isPanning = true;
    panStart = { x: mx, y: my, ox: panX, oy: panY };
  });

  window.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (dragging) {
      const w = screenToWorld({ x: mx, y: my });
      dragging.x = w.x + dragOffset.x;
      dragging.y = w.y + dragOffset.y;
      dragging.vx = 0;
      dragging.vy = 0;
      return;
    }
    if (isPanning) {
      panX = panStart.ox + (mx - panStart.x);
      panY = panStart.oy + (my - panStart.y);
      return;
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (dragging) {
      dragging = null;
      return;
    }
    if (isPanning) isPanning = false;
  });

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const picked = pickNode(mx, my);
    if (!picked) return;
    pinNode(picked);
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const before = screenToWorld({ x: mx, y: my });
      const dz = e.deltaY > 0 ? 0.92 : 1.08;
      scale = clamp(scale * dz, 0.5, 3.2);
      const after = screenToWorld({ x: mx, y: my });

      // zoom around cursor
      panX += (after.x - before.x) * scale;
      panY += (after.y - before.y) * scale;
    },
    { passive: false }
  );

  qEl?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const n = applySearch();
    if (n) {
      pinNode(n);
    }
  });

  modeEl?.addEventListener("change", () => {
    pinnedId = null;
    setSelected(null);
  });

  resetEl?.addEventListener("click", () => {
    qEl.value = "";
    typeEl.value = "all";
    modeEl.value = "ego";
    resetView();
  });

  randomEl?.addEventListener("click", () => {
    const occ = nodes.filter((n) => n.type === "occupation");
    if (!occ.length) return;
    const pick = occ[Math.floor(Math.random() * occ.length)];
    pinNode(pick);
  });

  copyLinkEl?.addEventListener("click", async () => {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      if (countsEl) countsEl.textContent = "Link copied.";
      window.setTimeout(() => {
        if (countsEl) countsEl.textContent = `${visibleNodes().length} nodes shown · ${visibleLinks(visibleNodes()).length} links shown`;
      }, 1200);
    } catch (_) {
      if (countsEl) countsEl.textContent = "Copy failed.";
    }
  });

  window.addEventListener("resize", resize);

  load().catch((err) => {
    if (countsEl) countsEl.textContent = "Failed to load graph.";
    if (selectedEl) selectedEl.textContent = String(err);
  });
})();
