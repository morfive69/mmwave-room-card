const assert = require("assert");
const raf = [];
global.requestAnimationFrame = (fn) => { raf.push(fn); return raf.length; };
global.cancelAnimationFrame = () => {};
const flush = () => { while (raf.length) raf.shift()(); };
const makeEl = () => ({ style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, classList: { set: new Set(), toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); } }, innerHTML: "", hidden: false });
global.HTMLElement = class {
  attachShadow() {
    const els = {};
    this.shadowRoot = { _html: "", set innerHTML(s) { this._html = s; for (const k in els) delete els[k]; }, get innerHTML() { return this._html; },
      querySelector(sel) { const id = sel.slice(1); return this._html.includes(`id="${id}"`) ? (els[id] ||= makeEl()) : null; } };
    return this.shadowRoot;
  }
};
global.customElements = { define() {} };
global.window = {};
global.document = { createElement: () => ({}) };
const m = require("../dist/mmwave-room-card.js");

const userCfg = {
  type: "custom:mmwave-room-card", title: "Quarto", prefix: "sensor.q_91f114",
  unit: "mm", sensor_position: "top", trail: 20,
  targets: [
    { name: "T1", x: "sensor.q_target_1_x", true: "sensor.q_target_1_y" },
    { name: "T2", pos_x: "sensor.q_target_2_x", pos_y: "sensor.q_target_2_y" },
  ],
  zones: [
    { name: "Zone 1", type: "zone", points: [[-2500, 300], [2500, 300], [2500, 4500], [-2500, 4500]] },
    { name: "Z2", type: "entry", points: [{ pos_x: -2500, pos_y: 4500 }, { pos_x: -1500, pos_y: 4500 }, { pos_x: -1500, pos_y: 5200 }] },
  ],
  furniture: [{ label: "Cama", pos_x: -800, true: 1200, width: 1600, height: 2000 }],
  room: { pos_x: -2500, pos_y: 0, width: 5000, height: 5200 },
  doors: [{ pos_x: -1000, pos_y: 5200, width: 1600, angle: 0, open: -90, double: true }],
  windows: [{ pos_x: 600, pos_y: 0, width: 1200 }],
};

// 1. normalização (chaves 'true', pos_x/pos_y, arrays e objetos)
const n = m.normalize(userCfg);
assert.strictEqual(n.targets[0].y, "sensor.q_target_1_y");
assert.strictEqual(n.targets[1].y, "sensor.q_target_2_y");
assert.deepStrictEqual(n.zones[1].points[0], [-2500, 4500]);
assert.strictEqual(n.furniture[0].y, 1200);
assert(n.bounds.xmin < -2500 && n.bounds.xmax > 2500, "limites automáticos pelas paredes");
console.log("1 ok normalização; bounds", n.bounds);

// 2. render + atualização
const card = new global.HTMLElement.constructor === undefined ? null : null;
const Card = m.MmwaveRoomCard;
const el = new Card();
el.setConfig(userCfg);
const html = el.shadowRoot.innerHTML;
assert(html.includes('<mask id="wm"') && html.includes("<style>"), "mask + style no shadow DOM");
const st = (v, extra = {}) => ({ state: String(v), attributes: {}, ...extra });
const states = {
  "sensor.q_target_1_x": st(-500), "sensor.q_target_1_y": st(1500),
  "sensor.q_target_2_x": st(0), "sensor.q_target_2_y": st(0),
};
el.hass = { states, language: "pt-PT" };
flush();
const t0 = el._els.targets[0].g, t1 = el._els.targets[1].g;
assert.strictEqual(t0.style.visibility, "visible");
assert.strictEqual(t1.style.visibility, "hidden", "0,0 escondido");
assert(el._els.zones[0].classList.set.has("active"), "alvo dentro da Zone 1");
assert(el._els.info.innerHTML.includes("Zone 1") && el._els.info.innerHTML.includes("x: -500 mm"));
console.log("2 ok render/update:", t0.style.transform);

// 3. bug do editor: nova config + mesmo hass => continua a desenhar
el.setConfig({ ...userCfg, title: "Outro" });
flush();
assert.strictEqual(el._els.targets[0].g.style.visibility, "visible", "reconstrução repõe os alvos");
console.log("3 ok reconstrução sem esperar por novo estado");

// 4. x e y em eventos separados => 1 só atualização
let calls = 0;
const orig = el._update.bind(el);
el._update = () => { calls++; orig(); };
el.hass = { states: { ...states, "sensor.q_target_1_x": st(100) }, language: "pt" };
el.hass = { states: { ...states, "sensor.q_target_1_x": st(100), "sensor.q_target_1_y": st(2000) }, language: "pt" };
flush();
assert.strictEqual(calls, 1);
assert(el._els.targets[0].g.style.transform.length > 0);
console.log("4 ok agrupamento x/y numa atualização");

// 5. entidades em falta e aviso
const el2 = new Card();
el2.setConfig({ prefix: "sensor.nao_existe" });
el2.hass = { states: {}, language: "pt" };
flush();
assert(!el2._els.warn.hidden && el2._els.warn.innerHTML.includes("sensor.nao_existe_target_1_x (não existe)"));
console.log("5 ok aviso entidades");

// 6. só distância + ângulo por entidade + arco
const el3 = new Card();
el3.setConfig({ unit: "mm", fov: 120, targets: [{ name: "P", distance: "sensor.d", angle: "input_number.ang", invert_angle: true }] });
el3.hass = { states: { "sensor.d": st(2.5, { attributes: { unit_of_measurement: "m" } }), "input_number.ang": st(30) }, language: "en" };
flush();
const e3 = el3._els.targets[0];
assert.strictEqual(e3.g.style.visibility, "visible");
assert(e3.arc.attrs.points.split(" ").length === 25);
const r = m.computeTarget(el3._c.targets[0], el3._c, el3._hass.states);
assert(Math.abs(r.angDeg + 30) < 1e-9 && Math.abs(r.d - 2500) < 1e-9, JSON.stringify(r));
console.log("6 ok distância/ângulo/arco", r);

// 7. unidade m: limites por defeito escalados
assert.strictEqual(m.normalize({ unit: "m", prefix: "x" }).bounds.xmax, 3);
// 8. proteções: grid 0, limites inválidos, muitas linhas
const g = m.normalize({ prefix: "x", grid: 0, x_min: 5, x_max: 1 });
assert(g.grid > 0 && g.bounds.xmax > g.bounds.xmin);
assert(m.normalize({ prefix: "x", grid: 1 }).grid >= 64, "limita nº de linhas");
console.log("7/8 ok proteções");

// 9. escape de HTML
const el4 = new Card();
el4.setConfig({ title: '"><img src=x onerror=alert(1)>', targets: [{ name: "<b>x</b>", pos_x: "sensor.a", pos_y: "sensor.b" }] });
const h4 = el4.shadowRoot.innerHTML;
assert(!h4.includes("<img") && !h4.includes("<b>x</b>"));
console.log("9 ok escape HTML");

// 10. configs inválidas não rebentam
assert.throws(() => new Card().setConfig({}), /prefix/);
const el5 = new Card();
el5.setConfig({ prefix: "s", zones: [{ points: [[1]] }], walls: [{ pos_x1: "a" }], doors: [{}], furniture: [{}], room: { width: 1 } });
console.log("10 ok");
console.log("TODOS OS TESTES OK");
