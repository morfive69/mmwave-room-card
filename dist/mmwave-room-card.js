/**
 * mmwave-room-card v2.0.0
 * Card do Home Assistant que mostra em tempo real a posição de alvos mmWave
 * (x/y ou só distância) sobre a planta do quarto: paredes, portas, janelas,
 * mobiliário, zonas, cone do sensor e rasto do movimento.
 */
const VERSION = "2.0.0";
console.info(
  `%c MMWAVE-ROOM-CARD %c v${VERSION} `,
  "color:#fff;background:#3b82f6;font-weight:700;border-radius:3px 0 0 3px",
  "color:#3b82f6;background:#fff;font-weight:700;border-radius:0 3px 3px 0"
);

const ZONE_COLORS = { zone: "#8b5cf6", exclusion: "#ef4444", entry: "#10b981", default: "#3b82f6" };
const TARGET_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ec4899", "#06b6d4"];
const UNIT_GRID = { mm: 1000, cm: 100, m: 1 }; // unidades por metro
const POSITIONS = ["top", "bottom", "left", "right"];
const D2R = Math.PI / 180;
const ARC_STEPS = 24;

const I18N = {
  pt: { none: "Sem alvos detetados", problems: "⚠ Entidades com problemas:", notFound: "não existe", debug: "🔧 Debug (valores brutos):", angle: "ângulo", fromConfig: "config", fromEntity: "entidade", fromXY: "calculado de x/y", dist: "dist" },
  en: { none: "No targets detected", problems: "⚠ Entities with problems:", notFound: "not found", debug: "🔧 Debug (raw values):", angle: "angle", fromConfig: "config", fromEntity: "entity", fromXY: "computed from x/y", dist: "dist" },
};
const lang = (h) => (((h && (h.language || h.locale?.language)) || "pt").toLowerCase().startsWith("pt") ? I18N.pt : I18N.en);

// ---------- utilitários ----------
// arredonda valores mostrados a, no máximo, 3 casas decimais (texto/estados não numéricos ficam iguais)
const rnd = (v, d = 3) => {
  if (v === undefined || v === null || v === "" || !Number.isFinite(Number(v))) return v;
  return Number(Number(v).toFixed(d));
};
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const A = (n) => n.toFixed(1);
const N = (v, d) => {
  const n = typeof v === "string" && v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : d;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// o editor visual pode deixar valores vazios: ignora-os para manter os valores por defeito
const clean = (v) =>
  Array.isArray(v)
    ? v.map(clean)
    : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "" && x !== null && x !== undefined).map(([k, x]) => [k, clean(x)]))
    : v;

// O YAML 1.1 interpreta a chave "y" como booleano (true): aceita pos_x/pos_y, x/y e a variante "true"
const posX = (o) => o.pos_x ?? o.x;
const posY = (o) => o.pos_y ?? o.y ?? o["true"];
const pt = (p) => (Array.isArray(p) ? [N(p[0], NaN), N(p[1], NaN)] : [N(posX(p), NaN), N(posY(p), NaN)]);
const finite = (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]);
const isEntity = (v) => typeof v === "string" && /^[a-z_]+\.[a-z0-9_]+$/i.test(v.trim());
const rotator = (rad) => {
  const cs = Math.cos(rad), sn = Math.sin(rad);
  return (x, y) => [x * cs - y * sn, x * sn + y * cs];
};
const along = (x, y, len, a) => [x + len * Math.cos(a), y + len * Math.sin(a)];

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygonCentroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [x0, y0] = pts[j], [x1, y1] = pts[i];
    const k = x0 * y1 - x1 * y0;
    a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
  }
  if (Math.abs(a) < 1e-9) return [pts.reduce((s, q) => s + q[0], 0) / pts.length, pts.reduce((s, q) => s + q[1], 0) / pts.length];
  return [cx / (3 * a), cy / (3 * a)];
}

// ângulo: número, texto numérico, palavra (esquerda/direita) ou entidade
function resolveAngle(v, states, fov = 120) {
  if (v === undefined || v === null || v === "") return 0;
  if (typeof v === "number") return v;
  let str = String(v).trim();
  if (isEntity(str)) str = String(states[str]?.state ?? "");
  const n = parseFloat(str);
  if (Number.isFinite(n)) return n;
  const k = str.toLowerCase(), q = fov / 4;
  if (k === "left" || k === "esquerda") return -q;
  if (k === "right" || k === "direita") return q;
  return 0;
}

const targetIds = (t) =>
  t.distance ? [t.distance, ...(isEntity(t.angle) ? [String(t.angle).trim()] : [])] : [t.x, t.y].filter(Boolean);

// posição de um alvo no referencial do sensor (antes de sensor_rotation)
function computeTarget(t, c, states) {
  const read = (id) => {
    const s = states[id];
    const v = s ? parseFloat(s.state) : NaN;
    return Number.isFinite(v) ? v : NaN;
  };
  if (t.distance) {
    const u = states[t.distance]?.attributes?.unit_of_measurement;
    const du = t.distance_unit || (UNIT_GRID[u] ? u : "m");
    const d = (read(t.distance) / (UNIT_GRID[du] || 1)) * c.perM;
    const angDeg = (t.invert_angle ? -1 : 1) * resolveAngle(t.angle, states, c.fov);
    const a = angDeg * D2R;
    return { dOnly: true, valid: Number.isFinite(d) && d >= 0 && !(c.hide_zero && d === 0), x: d * Math.sin(a), y: d * Math.cos(a), d, angDeg };
  }
  const x = read(t.x), y = read(t.y);
  const ok = Number.isFinite(x) && Number.isFinite(y);
  return { dOnly: false, valid: ok && !(c.hide_zero && x === 0 && y === 0), x, y, d: ok ? Math.hypot(x, y) : NaN, angDeg: ok && (x !== 0 || y !== 0) ? Math.atan2(x, y) / D2R : NaN };
}

// ---------- configuração ----------
function normalize(raw) {
  const cfg = clean(raw || {});
  const unit = UNIT_GRID[cfg.unit] ? cfg.unit : "mm";
  const perM = UNIT_GRID[unit];

  let targets = Array.isArray(cfg.targets) ? cfg.targets : [];
  if (!targets.length && cfg.prefix) {
    targets = [1, 2, 3].map((n) => ({ name: "T" + n, pos_x: `${cfg.prefix}_target_${n}_x`, pos_y: `${cfg.prefix}_target_${n}_y` }));
  }
  targets = targets.map((t, i) => ({
    name: t.name ?? `T${i + 1}`,
    color: t.color || TARGET_COLORS[i % TARGET_COLORS.length],
    x: posX(t),
    y: t.pos_y ?? t.entity_y ?? t.y ?? t["true"],
    distance: t.distance ?? t.entity_distance ?? t.pos_distance, // sensores só com distância (ex.: Aqara FP1E)
    angle: t.angle,
    distance_unit: t.distance_unit ?? cfg.distance_unit,
    invert_angle: !!(t.invert_angle ?? cfg.invert_angle),
    show_arc: (t.show_arc ?? cfg.show_arc) !== false,
  }));
  if (!targets.length) throw new Error('Define "prefix" ou pelo menos um alvo em "targets" / Set "prefix" or at least one entry in "targets"');

  const walls = [];
  (cfg.walls || []).forEach((w) => {
    const points = w.points ? w.points.map(pt) : [[N(w.pos_x1, NaN), N(w.pos_y1, NaN)], [N(w.pos_x2, NaN), N(w.pos_y2, NaN)]];
    if (points.length >= 2 && points.every(finite)) walls.push({ points, closed: !!w.closed, color: w.color });
  });
  if (cfg.room) {
    const [rx, ry] = pt(cfg.room), rw = N(cfg.room.width, NaN), rh = N(cfg.room.height, NaN);
    if (finite([rx, ry]) && Number.isFinite(rw) && Number.isFinite(rh)) {
      walls.push({ closed: true, points: [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]] });
    }
  }

  const zones = [];
  (cfg.zones || []).forEach((z) => {
    const points = (z.points || []).map(pt);
    if (points.length >= 3 && points.every(finite)) zones.push({ name: z.name, type: z.type, color: z.color, points });
  });

  const furniture = [];
  (cfg.furniture || []).forEach((m) => {
    const [x, y] = pt(m), w = N(m.width, NaN), h = N(m.height, NaN);
    if (finite([x, y]) && Number.isFinite(w) && Number.isFinite(h)) furniture.push({ label: m.label, color: m.color, x, y, w, h });
  });

  const opening = (kind) => (o) => {
    const [x, y] = pt(o), w = N(o.width, kind === "door" ? 0.8 * perM : perM);
    if (!finite([x, y]) || !(w > 0)) return null;
    return { kind, x, y, w, a: N(o.angle, 0) * D2R, open: N(o.open, 90) * D2R, double: o.double === true || o.type === "double", color: o.color };
  };
  const doors = (cfg.doors || []).map(opening("door")).filter(Boolean);
  const windows = (cfg.windows || []).map(opening("window")).filter(Boolean);

  // limites: as paredes definem o tamanho do card (caixa das paredes + margem)
  const thick = Math.max(0, N(cfg.wall_thickness, 0.1 * perM));
  const margin = Math.max(0, N(cfg.margin, 0.25 * perM));
  const defaults = { xmin: -3 * perM, xmax: 3 * perM, ymin: 0, ymax: 6 * perM };
  let b = { xmin: N(cfg.x_min, defaults.xmin), xmax: N(cfg.x_max, defaults.xmax), ymin: N(cfg.y_min, defaults.ymin), ymax: N(cfg.y_max, defaults.ymax) };
  if (cfg.auto_bounds !== false && walls.length) {
    const all = walls.flatMap((w) => w.points), pad = thick / 2 + margin;
    b = { xmin: Math.min(...all.map((q) => q[0])) - pad, xmax: Math.max(...all.map((q) => q[0])) + pad, ymin: Math.min(...all.map((q) => q[1])) - pad, ymax: Math.max(...all.map((q) => q[1])) + pad };
  }
  if (!(b.xmax > b.xmin && b.ymax > b.ymin)) b = defaults; // evita divisões por zero

  let grid = N(cfg.grid, perM);
  if (!(grid > 0)) grid = perM;
  while ((b.xmax - b.xmin) / grid > 100 || (b.ymax - b.ymin) / grid > 100) grid *= 2; // limita o nº de linhas

  const rotDeg = N(cfg.sensor_rotation, 0);
  return {
    title: cfg.title, unit, perM, targets, walls, zones, furniture, doors, windows, bounds: b, grid,
    sensor_position: POSITIONS.includes(cfg.sensor_position) ? cfg.sensor_position : "top",
    flip_x: !!cfg.flip_x,
    rot: rotDeg * D2R,
    vrot: N(cfg.fov_rotation, rotDeg) * D2R,
    fov: clamp(N(cfg.fov, 120), 1, 360),
    fov_range: N(cfg.fov_range, 0) > 0 ? N(cfg.fov_range, 0) : null,
    show_fov: cfg.show_fov !== false,
    show_sensor_arrow: cfg.show_sensor_arrow !== false,
    show_info: cfg.show_info !== false,
    show_grid_labels: cfg.show_grid_labels !== false,
    hide_zero: cfg.hide_zero !== false,
    debug: !!cfg.debug,
    trail: clamp(Math.round(N(cfg.trail, 20)), 0, 200),
    background: String(cfg.background || "#0f1729").replace(/[;{}<>]/g, ""),
    wall_thickness: thick,
    wall_color: cfg.wall_color || "#cbd5e1",
  };
}

// ---------- geometria / desenho ----------
function makeView(c) {
  const { xmin, xmax, ymin, ymax } = c.bounds;
  const t = (x, y) => {
    if (c.flip_x) x = -x;
    switch (c.sensor_position) {
      case "bottom": return [x, -y];
      case "left": return [y, x];
      case "right": return [-y, -x];
      default: return [x, y];
    }
  };
  const cs = [[xmin, ymin], [xmax, ymin], [xmax, ymax], [xmin, ymax]].map(([x, y]) => t(x, y));
  const us = cs.map((q) => q[0]), vs = cs.map((q) => q[1]);
  const umin = Math.min(...us), vmin = Math.min(...vs);
  const W = 800, s = W / (Math.max(...us) - umin), H = (Math.max(...vs) - vmin) * s;
  const p = (x, y) => {
    const [u, v] = t(x, y);
    return [(u - umin) * s, (v - vmin) * s];
  };
  const pts = (arr) => arr.map((q) => p(q[0], q[1]).map(A).join(",")).join(" ");
  return { p, pts, W, H, s };
}

const svgLine = (a, b, attrs) => `<line x1="${A(a[0])}" y1="${A(a[1])}" x2="${A(b[0])}" y2="${A(b[1])}" ${attrs}/>`;
const svgText = (x, y, cls, str) => `<text x="${A(x)}" y="${A(y)}" class="${cls}">${esc(str)}</text>`;

function buildSvg(c, view) {
  const { p, pts, W, H, s } = view;
  const { xmin, xmax, ymin, ymax } = c.bounds;
  const rotV = rotator(c.vrot);
  let o = "";

  // grelha (linhas + valores nos dois eixos)
  const lbl = (v) => `${rnd(v / c.perM)}m`;
  for (let k = Math.ceil(xmin / c.grid); k * c.grid <= xmax; k++) {
    const gx = k * c.grid, a = p(gx, ymin), b = p(gx, ymax);
    o += svgLine(a, b, 'class="grid"');
    if (c.show_grid_labels) {
      const top = a[1] <= b[1] ? a : b; // extremo junto ao topo do desenho
      o += svgText(top[0] + 4, top[1] + 12, "axis", lbl(gx));
    }
  }
  for (let k = Math.ceil(ymin / c.grid); k * c.grid <= ymax; k++) {
    const gy = k * c.grid, a = p(xmin, gy), b = p(xmax, gy);
    o += svgLine(a, b, 'class="grid"');
    if (c.show_grid_labels) {
      const left = a[0] <= b[0] ? a : b; // extremo junto à esquerda do desenho
      o += svgText(left[0] + 4, left[1] + 12, "axis", lbl(gy));
    }
  }

  // cone do sensor
  if (c.show_fov) {
    const r = c.fov_range ?? (Math.hypot(Math.max(Math.abs(xmin), Math.abs(xmax)), Math.max(Math.abs(ymin), Math.abs(ymax))) || 1);
    const half = (c.fov / 2) * D2R, arr = [[0, 0]];
    for (let i = -10; i <= 10; i++) arr.push(rotV(r * Math.sin((half * i) / 10), r * Math.cos((half * i) / 10)));
    o += `<polygon points="${pts(arr)}" class="fov"/>`;
  }

  // paredes (com aberturas feitas por máscara, sem depender da cor de fundo)
  const tpx = c.wall_thickness * s;
  const openings = [...c.windows, ...c.doors];
  const gaps = openings.map((op) => [p(op.x, op.y), p(...along(op.x, op.y, op.w, op.a))]);
  if (c.walls.length) {
    if (gaps.length) {
      o += `<mask id="wm" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${A(H)}"><rect x="0" y="0" width="${W}" height="${A(H)}" fill="#fff"/>` +
        gaps.map(([a, b]) => svgLine(a, b, `stroke="#000" stroke-width="${A(tpx + 2)}"`)).join("") + "</mask>";
    }
    o += `<g${gaps.length ? ' mask="url(#wm)"' : ""}>`;
    c.walls.forEach((w) => {
      o += `<${w.closed ? "polygon" : "polyline"} points="${pts(w.points)}" fill="none" stroke="${esc(w.color || c.wall_color)}" stroke-width="${A(tpx)}" stroke-linejoin="miter" stroke-linecap="square"/>`;
    });
    o += "</g>";
  }

  // janelas e portas
  openings.forEach((op, i) => {
    const [p1, p2] = gaps[i];
    if (op.kind === "window") {
      o += svgLine(p1, p2, `stroke="${esc(op.color || "#7dd3fc")}" stroke-width="${A(tpx * 0.7)}"`);
      o += svgLine(p1, p2, 'stroke="#fff" stroke-opacity=".8" stroke-width="1"');
      return;
    }
    const col = esc(op.color || "#d9a86c");
    const e = along(op.x, op.y, op.w, op.a);
    // cada folha: dobradiça, comprimento, direção fechada, ângulo de abertura
    const leaves = op.double ? [[op.x, op.y, op.w / 2, op.a, op.open], [e[0], e[1], op.w / 2, op.a + Math.PI, -op.open]] : [[op.x, op.y, op.w, op.a, op.open]];
    leaves.forEach(([hx, hy, len, a0, s0]) => {
      const arc = [];
      for (let k = 0; k <= 12; k++) arc.push(along(hx, hy, len, a0 + (s0 * k) / 12));
      const hp = p(hx, hy), tip = p(...along(hx, hy, len, a0 + s0));
      o += `<polyline points="${pts(arc)}" fill="none" stroke="${col}" stroke-opacity=".6" stroke-dasharray="4 3" stroke-width="1.5"/>`;
      o += svgLine(hp, tip, `stroke="${col}" stroke-width="3" stroke-linecap="round"`);
      o += `<circle cx="${A(hp[0])}" cy="${A(hp[1])}" r="3" fill="${col}"/>`;
    });
  });

  // mobiliário
  c.furniture.forEach((m) => {
    const col = esc(m.color || "#d9a86c");
    o += `<polygon points="${pts([[m.x, m.y], [m.x + m.w, m.y], [m.x + m.w, m.y + m.h], [m.x, m.y + m.h]])}" fill="${col}" fill-opacity="0.75" stroke="${col}" stroke-width="1"/>`;
    if (m.label) {
      const [lx, ly] = p(m.x + m.w / 2, m.y + m.h / 2);
      o += svgText(lx, ly, "flabel", m.label);
    }
  });

  // zonas
  c.zones.forEach((z, i) => {
    const col = esc(z.color || ZONE_COLORS[z.type] || ZONE_COLORS.default);
    o += `<polygon id="z${i}" points="${pts(z.points)}" fill="${col}" stroke="${col}" class="zone"/>`;
    if (z.name) {
      const [lx, ly] = p(...polygonCentroid(z.points));
      o += svgText(lx, ly, "zlabel", z.name);
    }
  });

  // sensor
  const [sx, sy] = p(0, 0);
  if (c.show_sensor_arrow) o += svgLine([sx, sy], p(...rotV(0, 0.3 * c.perM)), 'stroke="#94a3b8" stroke-width="3" stroke-linecap="round"');
  o += `<circle cx="${A(sx)}" cy="${A(sy)}" r="7" class="sensor"/>`;

  // arcos (sensores só com distância), rasto e alvos
  c.targets.forEach((t, i) => {
    if (t.distance && t.show_arc) {
      o += `<polyline id="a${i}" points="" fill="none" stroke="${esc(t.color)}" stroke-width="3" stroke-opacity=".55" stroke-linecap="round" style="visibility:hidden"/>`;
    }
  });
  o += '<g id="trails"></g>';
  c.targets.forEach((t, i) => {
    const col = esc(t.color);
    o += `<g id="t${i}" class="target" style="visibility:hidden"><circle r="16" fill="none" stroke="${col}" stroke-opacity=".6" stroke-width="1.5" class="pulse"/><circle r="8" fill="${col}" stroke="#fff" stroke-width="2"/>${svgText(0, -22, "tlabel", t.name)}</g>`;
  });
  return o;
}

const cardCss = (c) => `
:host{display:block}
.wrap{padding:0 12px 12px}
.wrap.nohead{padding-top:12px}
svg{width:100%;height:auto;display:block;border-radius:10px;background:${c.background}}
.grid{stroke:#fff;stroke-opacity:.07;stroke-width:1}
.axis{fill:#fff;fill-opacity:.35;font:10px sans-serif}
.fov{fill:#22d3ee;fill-opacity:.04;stroke:#22d3ee;stroke-opacity:.5;stroke-dasharray:6 4}
.zone{fill-opacity:.18;stroke-width:2;stroke-opacity:.9;transition:fill-opacity .2s}
.zone.active{fill-opacity:.45}
.zlabel,.flabel,.tlabel{fill:#fff;font:600 13px sans-serif;text-anchor:middle;paint-order:stroke;stroke:#000;stroke-opacity:.6;stroke-width:3px;pointer-events:none}
.flabel{font-size:11px;font-weight:500}
.sensor{fill:#94a3b8;stroke:#fff;stroke-width:2}
.target{transition:transform .25s linear}
.pulse{animation:pulse 1.6s ease-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes pulse{0%{transform:scale(.6);opacity:1}100%{transform:scale(1.6);opacity:0}}
.info{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:13px;color:var(--secondary-text-color)}
.info b{color:var(--primary-text-color)}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}
.warn{margin-top:10px;font-size:12px;color:var(--error-color,#f87171)}
[hidden]{display:none!important}
@media (prefers-reduced-motion:reduce){.pulse{animation:none}.target{transition:none}}`;

// ---------- card ----------
class MmwaveRoomCard extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" }); // isola os estilos dos restantes cards
    this._raf = 0;
  }

  setConfig(config) {
    this._c = normalize(config);
    this._view = makeView(this._c);
    this._rotS = rotator(this._c.rot);
    this._rotV = rotator(this._c.vrot);
    this._ids = [...new Set(this._c.targets.flatMap(targetIds))];
    this._trails = this._c.targets.map(() => []);
    this._refs = null; // força nova atualização depois de reconstruir (importante no editor visual)
    this._activeSig = null;
    this._render();
    this._schedule();
  }

  set hass(hass) {
    this._hass = hass;
    this._schedule();
  }

  connectedCallback() { this._schedule(); }

  disconnectedCallback() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  getCardSize() { return this._view ? Math.max(3, Math.round(this._view.H / 100) + 2) : 6; }

  getGridOptions() { return { columns: 12, min_columns: 6 }; }

  static getConfigElement() { return document.createElement("mmwave-room-card-editor"); }

  static getStubConfig() {
    return { title: "Quarto", targets: [{ name: "T1", pos_x: "sensor.ld2450_target_1_x", pos_y: "sensor.ld2450_target_1_y" }] };
  }

  // agrupa várias atualizações (ex.: x e y a chegarem em eventos separados) numa só
  _schedule() {
    if (this._raf || !this._c || !this._hass) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._update();
    });
  }

  _render() {
    const c = this._c, v = this._view;
    this._root.innerHTML = `<style>${cardCss(c)}</style>
      <ha-card${c.title ? ` header="${esc(c.title)}"` : ""}>
        <div class="wrap${c.title ? "" : " nohead"}">
          <svg viewBox="0 0 ${v.W} ${A(v.H)}" role="img" aria-label="${esc(c.title || "mmWave")}">${buildSvg(c, v)}</svg>
          <div id="warn" class="warn" hidden></div>
          ${c.show_info ? '<div class="info" id="info"></div>' : ""}
        </div>
      </ha-card>`;
    const q = (sel) => this._root.querySelector(sel);
    this._els = {
      targets: c.targets.map((_, i) => ({ g: q(`#t${i}`), arc: q(`#a${i}`) })),
      trails: q("#trails"), info: q("#info"), warn: q("#warn"),
      zones: c.zones.map((_, i) => q(`#z${i}`)),
    };
  }

  _update() {
    const h = this._hass, c = this._c, v = this._view, els = this._els, L = lang(h);
    // só recalcula quando alguma entidade usada mudou (os objetos de estado são novos a cada alteração)
    const refs = this._ids.map((id) => h.states[id]);
    if (this._refs && refs.every((r, i) => r === this._refs[i])) return;
    this._refs = refs;

    const missing = [];
    this._ids.forEach((id, i) => {
      const st = refs[i];
      if (!st) missing.push(`${id} (${L.notFound})`);
      else if (st.state === "unavailable" || st.state === "unknown") missing.push(`${id} (${st.state})`);
    });
    let html = missing.length ? `${L.problems}<br>${missing.map(esc).join("<br>")}` : "";
    if (c.debug) {
      html += (html ? "<br><br>" : "") + `${L.debug}<br>` + c.targets.map((t) => {
        const raw = targetIds(t).map((id) => `${esc(id)} = <b>${esc(rnd(h.states[id]?.state))}</b> ${esc(h.states[id]?.attributes?.unit_of_measurement || "")}`).join("<br>");
        const r = computeTarget(t, c, h.states);
        const src = t.distance ? (isEntity(t.angle) ? L.fromEntity : L.fromConfig) : L.fromXY;
        return `${raw}<br>${esc(t.name)} ${L.angle} = <b>${Number.isFinite(r.angDeg) ? rnd(r.angDeg) + "°" : "—"}</b> (${src})`;
      }).join("<br><br>");
    }
    if (els.warn) {
      els.warn.hidden = !html;
      els.warn.innerHTML = html;
    }

    const active = new Set(), infos = [];
    let trailSvg = "";
    const fmt = (n) => `${rnd(n)} ${c.unit}`;

    c.targets.forEach((t, i) => {
      const e = els.targets[i], trail = this._trails[i], r = computeTarget(t, c, h.states);
      if (e.arc) e.arc.style.visibility = r.valid ? "visible" : "hidden";
      if (!r.valid) {
        e.g.style.visibility = "hidden";
        trail.length = 0;
        return;
      }
      const [rx, ry] = this._rotS(r.x, r.y), [px, py] = v.p(rx, ry);
      e.g.style.visibility = "visible";
      e.g.style.transform = `translate(${A(px)}px, ${A(py)}px)`;

      if (e.arc) {
        // o arco acompanha a distância mas fica alinhado com o cone (não roda com o ângulo do alvo)
        const half = (c.fov / 2) * D2R, arr = [];
        for (let k = 0; k <= ARC_STEPS; k++) {
          const a = half * ((2 * k) / ARC_STEPS - 1);
          arr.push(this._rotV(r.d * Math.sin(a), r.d * Math.cos(a)));
        }
        e.arc.setAttribute("points", v.pts(arr));
      }

      const last = trail[trail.length - 1];
      if (!last || Math.hypot(px - last[0], py - last[1]) > 0.5) trail.push([px, py]);
      if (trail.length > c.trail) trail.splice(0, trail.length - c.trail);
      trail.forEach(([tx, ty], k) => {
        trailSvg += `<circle cx="${A(tx)}" cy="${A(ty)}" r="${(2 + (k / trail.length) * 3).toFixed(1)}" fill="${esc(t.color)}" fill-opacity="${(((k + 1) / trail.length) * 0.5).toFixed(2)}"/>`;
      });

      const inZones = [];
      c.zones.forEach((z, zi) => {
        if (pointInPolygon(rx, ry, z.points)) {
          active.add(zi);
          if (z.name) inZones.push(z.name);
        }
      });
      infos.push(`<span><span class="dot" style="background:${esc(t.color)}"></span><b>${esc(t.name)}</b> ${r.dOnly ? "" : `x: ${fmt(r.x)} · y: ${fmt(r.y)} · `}${L.dist}: ${fmt(r.d)}${inZones.length ? " · " + inZones.map(esc).join(", ") : ""}</span>`);
    });

    if (els.trails) els.trails.innerHTML = trailSvg;
    const sig = [...active].join(",");
    if (sig !== this._activeSig) {
      this._activeSig = sig;
      els.zones.forEach((z, zi) => z && z.classList.toggle("active", active.has(zi)));
    }
    if (els.info) els.info.innerHTML = infos.length ? infos.join("") : `<span>${L.none}</span>`;
  }
}

// ---------- editor visual ----------
const E_NUM = { number: { mode: "box", step: "any" } };
const E_TXT = { text: {} };
const E_BOOL = { boolean: {} };
const E_SEL = (opts) => ({ select: { mode: "dropdown", options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) } });
const E_ENT = { entity: { domain: ["sensor", "number", "input_number"] } };
const E_F = (label, selector) => ({ label, selector });
const E_LIST = (fields, label_field) => ({ object: { multiple: true, ...(label_field ? { label_field } : {}), fields } });
const E_POINTS = E_F("Pontos", E_LIST({ pos_x: E_F("X", E_NUM), pos_y: E_F("Y", E_NUM) }));

const EDITOR_LABELS = {
  title: "Título",
  prefix: "Prefixo das entidades (cria os alvos 1 a 3 automaticamente)",
  unit: "Unidade",
  sensor_position: "Posição do sensor no desenho",
  flip_x: "Espelhar eixo X",
  hide_zero: "Esconder alvo em 0,0",
  show_info: "Mostrar texto de informação",
  debug: "Modo debug",
  sensor_rotation: "Rotação do sensor (graus)",
  trail: "Tamanho do rasto",
  grid: "Espaçamento da grelha",
  show_grid_labels: "Mostrar valores da grelha",
  background: "Cor de fundo",
  auto_bounds: "Ajustar tamanho às paredes",
  margin: "Margem em redor das paredes",
  x_min: "X mínimo", x_max: "X máximo", y_min: "Y mínimo", y_max: "Y máximo",
  show_fov: "Mostrar cone", fov: "Abertura do cone (graus)", fov_range: "Alcance do cone",
  fov_rotation: "Rotação do cone (só visual)", show_sensor_arrow: "Mostrar seta do sensor",
  show_arc: "Mostrar arco (sensores só com distância)", invert_angle: "Inverter ângulo (sensores só com distância)",
  distance_unit: "Unidade da distância (m, cm, mm)",
  room: "Quarto (retângulo)", wall_thickness: "Espessura das paredes", wall_color: "Cor das paredes",
  walls: "Paredes (segmentos)", doors: "Portas", windows: "Janelas", furniture: "Mobiliário", zones: "Zonas", targets: "Alvos",
};

const EDITOR_SCHEMA = [
  { name: "title", selector: E_TXT },
  { name: "prefix", selector: E_TXT },
  { name: "", type: "grid", schema: [
    { name: "unit", selector: E_SEL(["mm", "cm", "m"]) },
    { name: "sensor_position", selector: E_SEL([
      { value: "top", label: "Topo" }, { value: "bottom", label: "Em baixo" },
      { value: "left", label: "Esquerda" }, { value: "right", label: "Direita" } ]) },
  ] },
  { name: "", type: "grid", schema: [
    { name: "flip_x", selector: E_BOOL }, { name: "hide_zero", selector: E_BOOL },
    { name: "show_info", selector: E_BOOL }, { name: "debug", selector: E_BOOL },
  ] },
  { name: "sensor_rotation", selector: E_NUM },
  { type: "expandable", name: "s_targets", flatten: true, title: "Alvos", expanded: true, schema: [
    { name: "targets", selector: E_LIST({
      name: E_F("Nome", E_TXT),
      pos_x: E_F("Entidade X", E_ENT),
      pos_y: E_F("Entidade Y", E_ENT),
      distance: E_F("Entidade de distância (sensores sem x/y)", E_ENT),
      distance_unit: E_F("Unidade da distância", E_SEL(["m", "cm", "mm"])),
      angle: E_F("Ângulo (número, texto ou entidade)", E_TXT),
      invert_angle: E_F("Inverter ângulo", E_BOOL),
      show_arc: E_F("Mostrar arco", E_BOOL),
      color: E_F("Cor", E_TXT),
    }, "name") },
    { name: "invert_angle", selector: E_BOOL },
    { name: "show_arc", selector: E_BOOL },
    { name: "distance_unit", selector: E_SEL(["m", "cm", "mm"]) },
  ] },
  { type: "expandable", name: "s_room", flatten: true, title: "Quarto, paredes, portas e janelas", schema: [
    { name: "room", selector: { object: { fields: {
      pos_x: E_F("X (canto)", E_NUM), pos_y: E_F("Y (canto)", E_NUM),
      width: E_F("Largura", E_NUM), height: E_F("Altura", E_NUM),
    } } } },
    { name: "walls", selector: E_LIST({
      pos_x1: E_F("X inicial", E_NUM), pos_y1: E_F("Y inicial", E_NUM),
      pos_x2: E_F("X final", E_NUM), pos_y2: E_F("Y final", E_NUM),
      color: E_F("Cor", E_TXT),
    }) },
    { name: "", type: "grid", schema: [
      { name: "wall_thickness", selector: E_NUM }, { name: "wall_color", selector: E_TXT },
    ] },
    { name: "doors", selector: E_LIST({
      pos_x: E_F("X (dobradiça)", E_NUM), pos_y: E_F("Y (dobradiça)", E_NUM),
      width: E_F("Largura", E_NUM), angle: E_F("Ângulo ao longo da parede", E_NUM),
      open: E_F("Abertura (graus, ± escolhe o lado)", E_NUM),
      double: E_F("Porta dupla", E_BOOL), color: E_F("Cor", E_TXT),
    }) },
    { name: "windows", selector: E_LIST({
      pos_x: E_F("X inicial", E_NUM), pos_y: E_F("Y inicial", E_NUM),
      width: E_F("Largura", E_NUM), angle: E_F("Ângulo ao longo da parede", E_NUM),
      color: E_F("Cor", E_TXT),
    }) },
    { name: "furniture", selector: E_LIST({
      label: E_F("Nome", E_TXT),
      pos_x: E_F("X", E_NUM), pos_y: E_F("Y", E_NUM),
      width: E_F("Largura", E_NUM), height: E_F("Altura", E_NUM),
      color: E_F("Cor", E_TXT),
    }, "label") },
  ] },
  { type: "expandable", name: "s_zones", flatten: true, title: "Zonas", schema: [
    { name: "zones", selector: E_LIST({
      name: E_F("Nome", E_TXT),
      type: E_F("Tipo", E_SEL([
        { value: "zone", label: "Zona" }, { value: "exclusion", label: "Exclusão" }, { value: "entry", label: "Entrada" } ])),
      color: E_F("Cor", E_TXT),
      points: E_POINTS,
    }, "name") },
  ] },
  { type: "expandable", name: "s_view", flatten: true, title: "Cone, grelha e limites", schema: [
    { name: "", type: "grid", schema: [
      { name: "show_fov", selector: E_BOOL }, { name: "show_sensor_arrow", selector: E_BOOL },
      { name: "fov", selector: E_NUM }, { name: "fov_range", selector: E_NUM },
      { name: "fov_rotation", selector: E_NUM }, { name: "trail", selector: E_NUM },
      { name: "grid", selector: E_NUM }, { name: "show_grid_labels", selector: E_BOOL },
      { name: "auto_bounds", selector: E_BOOL }, { name: "margin", selector: E_NUM },
      { name: "x_min", selector: E_NUM }, { name: "x_max", selector: E_NUM },
      { name: "y_min", selector: E_NUM }, { name: "y_max", selector: E_NUM },
    ] },
    { name: "background", selector: E_TXT },
  ] },
];

class MmwaveRoomCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._form) this._form.hass = hass;
  }

  _render() {
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (schema) => EDITOR_LABELS[schema.name] || schema.title || schema.name;
      this._form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: ev.detail.value }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = EDITOR_SCHEMA;
    this._form.data = this._config;
  }
}
customElements.define("mmwave-room-card-editor", MmwaveRoomCardEditor);

customElements.define("mmwave-room-card", MmwaveRoomCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "mmwave-room-card",
  name: "mmWave Room Card",
  preview: true,
  description: "Posição em tempo real de alvos mmWave (x/y ou só distância) com zonas, paredes e mobiliário.",
});

// exportação apenas para testes em Node (no browser/HA `module` não existe)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { MmwaveRoomCard, normalize, makeView, buildSvg, computeTarget, resolveAngle, pointInPolygon, polygonCentroid, esc, rnd };
}
