(function () {
  "use strict";

  /**
   * @typedef {Object} CareerPath
   * @property {string} role
   * @property {string|null} code
   * @property {string[]} fields
   * @property {{label:string, weight:number}[]} industries
   * @property {{label:string, score:number, id:string}[]} pillars
   * @property {string[]} technologies
   * @property {string[]} tools
   * @property {string[]} related_roles
   * @property {string[]} skills
   * @property {string[]} projects
   * @property {string[]} income_paths
   * @property {{week:number, title:string, bullets:string[]}[]} plan_4_weeks
   * @property {string[]} next_actions
   * @property {{scope:string, note:string}} provenance
   */

  const PILLAR_SKILLS = {
    "pill:data": [
      "Data literacy (tables, metrics, definitions)",
      "SQL fundamentals (select, joins, group by)",
      "Dashboard design (KPIs, charts, narrative)",
      "ETL basics (extract → clean → load)",
    ],
    "pill:ai": [
      "Prompting + evaluation (what works / fails)",
      "Basic ML concepts (classification, regression)",
      "Data prep + labeling mindset",
      "Safety + privacy awareness",
    ],
    "pill:software": [
      "APIs (requests, auth, error handling)",
      "Version control (Git, pull requests)",
      "Building small services (CRUD, validation)",
      "Debugging + testing habits",
    ],
    "pill:cloud": [
      "Deployment basics (hosting, env vars)",
      "Containers (Docker basics)",
      "Observability (logs, metrics)",
      "Infrastructure mindset (reliability, cost)",
    ],
    "pill:security": [
      "Access control basics (roles, least privilege)",
      "Secure defaults (secrets, updates)",
      "Threat thinking (what can go wrong?)",
      "Basic monitoring + incident response",
    ],
    "pill:networks": [
      "Internet basics (DNS, HTTP, TCP/IP)",
      "Networking mindset (latency, failures)",
      "Debugging connectivity (tools + logs)",
    ],
    "pill:automation": [
      "Workflow mapping (inputs → steps → outputs)",
      "Automation design (triggers, retries, QA)",
      "Integration thinking (APIs, data flow)",
    ],
    "pill:computing": [
      "Systems thinking",
      "Documentation as leverage",
      "Problem decomposition",
    ],
  };

  const INDUSTRY_TO_FIELDS = [
    { match: "Manufacturing", fields: ["Manufacturing", "Operations", "Industrial Systems"] },
    { match: "Construction", fields: ["Construction", "Project Systems", "Infrastructure"] },
    { match: "Financial", fields: ["Finance", "Business Systems", "Risk"] },
    { match: "Retail", fields: ["Retail", "Customer Systems", "Logistics"] },
    { match: "Wholesale", fields: ["Supply Chain", "Distribution", "Operations"] },
    { match: "Transportation", fields: ["Transportation", "Logistics", "Infrastructure"] },
    { match: "Public Administration", fields: ["Public Systems", "Policy", "Civic Infrastructure"] },
    { match: "Agriculture", fields: ["Agriculture", "Food Systems", "Biology"] },
    { match: "Services", fields: ["Services", "Operations", "Business"] },
    { match: "Mining", fields: ["Energy", "Extraction", "Industrial Safety"] },
  ];

  function uniq(arr) {
    const out = [];
    const seen = new Set();
    for (const x of arr) {
      const v = String(x || "").trim();
      if (!v) continue;
      const k = v.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(v);
    }
    return out;
  }

  function topN(items, n) {
    return items.slice(0, Math.max(0, n));
  }

  function normalizeNum(x, def = 1) {
    const v = Number(x);
    return Number.isFinite(v) ? v : def;
  }

  function buildFieldsFromIndustries(industryLabels) {
    const fields = [];
    for (const lbl of industryLabels) {
      for (const row of INDUSTRY_TO_FIELDS) {
        if (lbl.includes(row.match)) fields.push(...row.fields);
      }
    }
    if (!fields.length) fields.push("Modern Work", "Systems", "Technology");
    return uniq(fields);
  }

  function pillarDisplayOrder(p) {
    const ord = {
      "pill:data": 10,
      "pill:ai": 11,
      "pill:software": 12,
      "pill:cloud": 13,
      "pill:security": 14,
      "pill:networks": 15,
      "pill:automation": 16,
      "pill:computing": 99,
    };
    return ord[p] ?? 50;
  }

  /**
   * @param {string} occId
   * @param {{nodeById: Map<string, any>, edgesByNode: Map<string, any[]>}} ctx
   * @returns {CareerPath|null}
   */
  function generateCareerPath(occId, ctx) {
    const n = ctx.nodeById.get(occId);
    if (!n || n.type !== "occupation") return null;

    const edges = ctx.edgesByNode.get(occId) || [];
    const industries = [];
    const tech = [];
    const tools = [];
    const related = [];
    const pillarScores = new Map();

    for (const e of edges) {
      const other = ctx.nodeById.get(e.other);
      if (!other) continue;

      if (e.relation === "works_in_industry" && other.type === "industry_division") {
        industries.push({ label: other.label || other.id, weight: normalizeNum(e.weight, 0) });
      }

      if (e.relation === "uses_technology" && other.type === "technology") {
        tech.push({ label: other.label || other.id, score: normalizeNum(e.weight, 1) });
      }

      if (e.relation === "uses_tool" && other.type === "tool") {
        tools.push({ label: other.label || other.id, score: normalizeNum(e.weight, 1) });
      }

      if (e.relation === "related_occupation" && other.type === "occupation") {
        related.push(other.label || other.id);
      }

      if (e.relation === "digitized_by" && other.type === "computing_pillar") {
        pillarScores.set(other.id, (pillarScores.get(other.id) || 0) + normalizeNum(e.weight, 1));
      }
    }

    industries.sort((a, b) => b.weight - a.weight);
    tech.sort((a, b) => b.score - a.score);
    tools.sort((a, b) => b.score - a.score);

    // If we somehow got no pillars (rare), anchor to computing.
    if (pillarScores.size === 0) pillarScores.set("pill:computing", 1);

    const pillars = Array.from(pillarScores.entries())
      .map(([id, score]) => ({ id, score, label: (ctx.nodeById.get(id)?.label || id) }))
      .sort((a, b) => b.score - a.score || pillarDisplayOrder(a.id) - pillarDisplayOrder(b.id))
      .slice(0, 4);

    const industryLabels = industries.map((x) => x.label);
    const fields = buildFieldsFromIndustries(industryLabels);

    // Skills = pillar skills + universal skills
    const skills = [];
    skills.push("Systems thinking (inputs → process → outputs)");
    skills.push("Clear documentation (one-page explanations)");
    skills.push("Basic data literacy (metrics, quality, definitions)");
    for (const p of pillars) {
      const s = PILLAR_SKILLS[p.id] || [];
      skills.push(...s);
    }

    // Projects based on pillars + tools/tech presence
    const projects = [];
    projects.push("Build a simple dashboard for a real metric set (3–5 KPIs).");
    if (pillars.some((p) => p.id === "pill:data")) projects.push("Create a small dataset → clean it → produce a report.");
    if (pillars.some((p) => p.id === "pill:ai")) projects.push("Build an AI-assisted workflow with evaluation notes.");
    if (pillars.some((p) => p.id === "pill:software")) projects.push("Build a small API/service with a README + diagram.");
    if (pillars.some((p) => p.id === "pill:cloud")) projects.push("Deploy a small app + add logging/monitoring notes.");
    if (pillars.some((p) => p.id === "pill:automation")) projects.push("Automate a weekly process (trigger → action → QA).");
    if (topN(tech, 1).length) projects.push(`Use one tool/tech from the graph: ${topN(tech, 1)[0].label}.`);

    const income_paths = uniq([
      "Freelance micro-projects",
      "Entry role / internship",
      "Consulting (junior scope)",
      "Product builder (small tool)",
    ]);

    // 4-week plan
    const plan_4_weeks = [
      {
        week: 1,
        title: "Clarity + setup",
        bullets: uniq([
          "Pick 1 pillar to focus on.",
          "Pick 1 starter project (small).",
          "Collect example data (or choose a public dataset).",
          "Write a 1-page problem statement.",
        ]),
      },
      {
        week: 2,
        title: "Core skills + first draft",
        bullets: uniq([
          "Learn only what your project needs (avoid course-binging).",
          "Build the first working draft (ugly is fine).",
          "Add a simple diagram of the system.",
        ]),
      },
      {
        week: 3,
        title: "Iteration + proof",
        bullets: uniq([
          "Improve reliability (edge cases, validation).",
          "Add 2–3 screenshots or a short demo.",
          "Write the README as if you’re teaching a beginner.",
        ]),
      },
      {
        week: 4,
        title: "Publish + opportunity",
        bullets: uniq([
          "Publish the project and share it in Discord.",
          "Create a portfolio page / proof post linking to the demo.",
          "Identify 3 adjacent roles and one next project.",
        ]),
      },
    ];

    const next_actions = uniq([
      "Open `docs/START.html` if you’re not sure where to begin.",
      "Use `projects/tracks/` to pick a project type.",
      "Ship one proof artifact this week (demo/diagram/write-up).",
    ]);

    return {
      role: n.label || occId,
      code: n.code || null,
      fields,
      industries: topN(industries, 5),
      pillars,
      technologies: topN(tech.map((x) => x.label), 10),
      tools: topN(tools.map((x) => x.label), 10),
      related_roles: topN(uniq(related), 10),
      skills: topN(uniq(skills), 14),
      projects: topN(uniq(projects), 8),
      income_paths,
      plan_4_weeks,
      next_actions,
      provenance: {
        scope: "Web build (O*NET occupations + industries + tools/tech + related occupations + computing pillars).",
        note: "Skills/projects/plan are generated suggestions from the graph neighborhood and templates.",
      },
    };
  }

  /**
   * @param {CareerPath} path
   * @returns {string}
   */
  function toMarkdown(path) {
    const lines = [];
    lines.push(`# Career Path: ${path.role}`);
    if (path.code) lines.push(`O*NET Code: \`${path.code}\``);
    lines.push("");
    lines.push(`**Formula:** Field → Role → Skills → Tools → Projects → Income`);
    lines.push("");

    lines.push(`## Related Fields`);
    lines.push(path.fields.map((x) => `- ${x}`).join("\n") || "- (none)");
    lines.push("");

    lines.push(`## Computing Pillars`);
    lines.push(
      path.pillars.map((p) => `- ${p.label} (${p.score.toFixed(1)})`).join("\n") || "- (none)"
    );
    lines.push("");

    lines.push(`## Industries`);
    lines.push(path.industries.map((x) => `- ${x.label} (${x.weight.toFixed(1)}%)`).join("\n") || "- (none)");
    lines.push("");

    lines.push(`## Technologies`);
    lines.push(path.technologies.map((x) => `- ${x}`).join("\n") || "- (none)");
    lines.push("");

    lines.push(`## Tools`);
    lines.push(path.tools.map((x) => `- ${x}`).join("\n") || "- (none)");
    lines.push("");

    lines.push(`## Skills (Suggested)`);
    lines.push(path.skills.map((x) => `- ${x}`).join("\n") || "- (none)");
    lines.push("");

    lines.push(`## Projects (Suggested)`);
    lines.push(path.projects.map((x) => `- ${x}`).join("\n") || "- (none)");
    lines.push("");

    lines.push(`## Income Paths`);
    lines.push(path.income_paths.map((x) => `- ${x}`).join("\n") || "- (none)");
    lines.push("");

    lines.push(`## 4-Week Starter Plan`);
    for (const w of path.plan_4_weeks) {
      lines.push(`### Week ${w.week}: ${w.title}`);
      lines.push(w.bullets.map((b) => `- ${b}`).join("\n"));
      lines.push("");
    }

    lines.push(`## Next Actions`);
    lines.push(path.next_actions.map((x) => `- ${x}`).join("\n") || "- (none)");
    lines.push("");

    lines.push(`## Provenance`);
    lines.push(`- Scope: ${path.provenance.scope}`);
    lines.push(`- Note: ${path.provenance.note}`);
    lines.push("");
    lines.push(`*Not career advice. Verify decisions with multiple sources.*`);
    lines.push("");

    return lines.join("\n");
  }

  window.PathGen = {
    generateCareerPath,
    toMarkdown,
  };
})();

