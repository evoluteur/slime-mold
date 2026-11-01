/*
  Slime Mold
  Thousands of agents, each following the scent left by the others, grow
  the vein networks of Physarum polycephalum (after Jeff Jones, 2010).
  https://github.com/evoluteur/slime-mold
  (c) 2026 Olivier Giulieri
*/

const SIM = 512; // the trail map is SIM x SIM
const CAP = 3; // the most scent a cell holds: no single vein takes over

const PRESETS = {
  network: { name: "Network", sa: 22.5, sd: 9, ra: 45, ss: 1, decay: 0.1, wander: 0, text: "The classic: agents settle into a web of veins, like the mold linking food sources." },
  veins: { name: "Long veins", sa: 15, sd: 30, ra: 10, ss: 1.5, decay: 0.06, wander: 0.05, text: "Agents that look far ahead and turn gently: long trunks crossing the dish." },
  lace: { name: "Lace", sa: 30, sd: 4, ra: 45, ss: 0.7, decay: 0.2, wander: 0, text: "Agents that look close: a fine mesh of small cells." },
  cells: { name: "Cells", sa: 75, sd: 14, ra: 50, ss: 1, decay: 0.1, wander: 0, text: "A wide sensor angle: the walls of the cells wobble, open and merge." },
  worms: { name: "Worms", sa: 90, sd: 12, ra: 90, ss: 1, decay: 0.15, wander: 0, text: "Agents that look sideways and turn square: a maze of crawling worms." },
  bubbles: { name: "Bubbles", sa: 11, sd: 40, ra: 22, ss: 2, decay: 0.03, wander: 0, text: "Far-sighted and slow to forget: big bubbles push each other around." },
  foam: { name: "Foam", sa: 60, sd: 20, ra: -20, ss: 1.2, decay: 0.08, wander: 0, text: "A negative turn: agents turn away from the scent, and the trails open into a foam of holes." },
};

const PALETTES = {
  slime: { name: "Slime yellow", stops: ["#0c0a05", "#4a3a07", "#c99a12", "#f6e27a", "#fffbe0"] },
  glow: { name: "Bioluminescent", stops: ["#020a12", "#063247", "#0d8a8f", "#5ef0c8", "#f2fffb"] },
  gold: { name: "Gold on black", stops: ["#000000", "#2b1d05", "#8a6418", "#e0b54f", "#fff4d6"] },
  ember: { name: "Ember", stops: ["#050000", "#3b0707", "#a3240e", "#f28b2c", "#fff1c2"] },
  ink: { name: "Ink on paper", stops: ["#f3eee2", "#cfc6b2", "#7d7463", "#2e2a24", "#0b0a08"] },
  violet: { name: "Violet", stops: ["#07030f", "#2a0f4f", "#7b2fbf", "#d58cff", "#fbefff"] },
};

const SHAPES = {
  random: "Scattered",
  disk: "Disk",
  ring: "Ring",
  burst: "Burst from the center",
};

const state = {
  preset: "network",
  sa: 22.5, // sensor angle, degrees (all from Jeff Jones' model)
  sd: 9, // sensor distance, cells
  ra: 45, // turn angle, degrees
  ss: 1, // step, cells
  decay: 0.1,
  wander: 0, // random wobble of the heading, radians
  n: 50000,
  palette: "slime",
  shape: "disk",
  running: true,
};

let canvas, ctx, img, lut;
let trail = new Float32Array(SIM * SIM), tmp = new Float32Array(SIM * SIM);
let ax, ay, aa; // agents: position and heading
let steps = 0;

// ------------------------------------------------------------ colors

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const makeLut = () => {
  const stops = PALETTES[state.palette].stops.map(hex);
  lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const t = Math.pow(i / 255, 0.6) * (stops.length - 1); // lift the faint trails
    const k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
    const c = stops[k].map((v, j) => Math.round(v + (stops[k + 1][j] - v) * f));
    lut[i] = (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0]; // little-endian RGBA
  }
};

// ------------------------------------------------------------ agents

const seedAgents = () => {
  const n = state.n;
  ax = new Float32Array(n);
  ay = new Float32Array(n);
  aa = new Float32Array(n);
  const c = SIM / 2;
  for (let i = 0; i < n; i++) {
    const t = Math.random() * Math.PI * 2;
    let x, y, a;
    if (state.shape === "random") {
      x = Math.random() * SIM;
      y = Math.random() * SIM;
      a = t;
    } else if (state.shape === "disk") {
      const r = Math.sqrt(Math.random()) * SIM * 0.36;
      x = c + Math.cos(t) * r;
      y = c + Math.sin(t) * r;
      a = t; // facing out
    } else if (state.shape === "ring") {
      const r = SIM * (0.34 + Math.random() * 0.04);
      x = c + Math.cos(t) * r;
      y = c + Math.sin(t) * r;
      a = t + Math.PI + (Math.random() - 0.5);
    } else {
      const r = Math.random() * SIM * 0.03;
      x = c + Math.cos(t) * r;
      y = c + Math.sin(t) * r;
      a = t; // facing out
    }
    ax[i] = x;
    ay[i] = y;
    aa[i] = a;
  }
  trail.fill(0);
  steps = 0;
};

const restart = () => {
  seedAgents();
  render(); // show the fresh start even while paused
  saveHash();
};

// one step of the model: sense, turn, move, deposit, then diffuse and decay
const step = () => {
  const n = ax.length, S = SIM;
  const sa = (state.sa * Math.PI) / 180, ra = (state.ra * Math.PI) / 180;
  const sd = state.sd, ss = state.ss, wander = state.wander;
  const sense = (x, y, a) => {
    let sx = Math.floor(x + Math.cos(a) * sd), sy = Math.floor(y + Math.sin(a) * sd);
    sx = ((sx % S) + S) % S;
    sy = ((sy % S) + S) % S;
    return trail[sy * S + sx];
  };
  for (let i = 0; i < n; i++) {
    const x = ax[i], y = ay[i];
    let a = aa[i];
    const f = sense(x, y, a), l = sense(x, y, a - sa), r = sense(x, y, a + sa);
    if (f > l && f > r) {
      // straight on
    } else if (f < l && f < r) a += Math.random() < 0.5 ? -ra : ra;
    else if (l < r) a += ra;
    else if (r < l) a -= ra;
    if (wander) a += (Math.random() - 0.5) * wander;
    let nx = x + Math.cos(a) * ss, ny = y + Math.sin(a) * ss;
    if (nx < 0) nx += S;
    else if (nx >= S) nx -= S;
    if (ny < 0) ny += S;
    else if (ny >= S) ny -= S;
    ax[i] = nx;
    ay[i] = ny;
    aa[i] = a;
    const k = (ny | 0) * S + (nx | 0);
    trail[k] = trail[k] < CAP - 1 ? trail[k] + 1 : CAP;
  }
  // diffuse: a 3x3 box blur (two passes, wrapping), then decay
  const keep = 1 - state.decay;
  for (let y = 0; y < S; y++) {
    const row = y * S;
    for (let x = 0; x < S; x++) {
      const xl = x ? x - 1 : S - 1, xr = x < S - 1 ? x + 1 : 0;
      tmp[row + x] = trail[row + xl] + trail[row + x] + trail[row + xr];
    }
  }
  for (let y = 0; y < S; y++) {
    const up = (y ? y - 1 : S - 1) * S, dn = (y < S - 1 ? y + 1 : 0) * S, row = y * S;
    for (let x = 0; x < S; x++) {
      trail[row + x] = ((tmp[up + x] + tmp[row + x] + tmp[dn + x]) / 9) * keep;
    }
  }
  steps++;
};

// ------------------------------------------------------------ drawing

const render = () => {
  const px = new Uint32Array(img.data.buffer);
  // scale to the brightest trails (sampled), which depend on the number of agents
  let max = 0;
  for (let i = 0; i < trail.length; i += 97) if (trail[i] > max) max = trail[i];
  const k = 255 / Math.max(0.3, max * 0.85);
  for (let i = 0; i < trail.length; i++) {
    const v = trail[i] * k;
    px[i] = lut[v > 255 ? 255 : v | 0];
  }
  ctx.putImageData(img, 0, 0);
};

// ------------------------------------------------------------ food under the pointer

let pointer = null;
const layFood = () => {
  if (!pointer) return;
  const r = 6, amount = 6;
  const cx = pointer.x | 0, cy = pointer.y | 0;
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y > r * r) continue;
      const X = (cx + x + SIM) % SIM, Y = (cy + y + SIM) % SIM;
      const k = Y * SIM + X;
      trail[k] = Math.min(trail[k] + amount, CAP * 2); // capped, so the rest of the picture keeps its brightness
    }
};

const loop = () => {
  if (state.running) {
    layFood();
    step();
    if (ax.length < 30000) step(); // fewer agents run faster: two steps a frame
    render();
  } else if (pointer) {
    layFood();
    render();
  }
  requestAnimationFrame(loop);
};

// ------------------------------------------------------------ controls

const $ = (id) => document.getElementById(id);
const SLIDERS = ["sa", "sd", "ra", "ss", "decay", "wander"];

let hashTimer;
const saveHash = () => {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const q = new URLSearchParams({ p: state.preset, c: state.palette, s: state.shape, n: state.n });
    if (state.preset === "custom") SLIDERS.forEach((k) => q.set(k, state[k]));
    history.replaceState(null, "", "#" + q.toString());
  }, 300);
};

const readHash = () => {
  const q = new URLSearchParams(location.hash.slice(1));
  if (PRESETS[q.get("p")]) Object.assign(state, PRESETS[q.get("p")], { preset: q.get("p") });
  else if (q.get("p") === "custom") {
    state.preset = "custom";
    SLIDERS.forEach((k) => {
      const v = parseFloat(q.get(k)), el = $(k);
      if (!isNaN(v)) state[k] = Math.min(+el.max, Math.max(+el.min, v)); // keep shared links within the sliders' range
    });
  }
  if (PALETTES[q.get("c")]) state.palette = q.get("c");
  if (SHAPES[q.get("s")]) state.shape = q.get("s");
  const n = +q.get("n");
  if (n >= 5000 && n <= 100000) state.n = n;
};

const showValues = () => {
  $("v-sa").textContent = state.sa + "°";
  $("v-ra").textContent = state.ra + "°";
  $("v-sd").textContent = state.sd;
  $("v-ss").textContent = state.ss;
  $("v-decay").textContent = Math.round(state.decay * 100) + "%";
  $("v-wander").textContent = state.wander ? Math.round((state.wander * 180) / Math.PI) + "°" : "none";
  $("v-n").textContent = state.n.toLocaleString("en-US");
  $("preset-text").textContent = PRESETS[state.preset] ? PRESETS[state.preset].text : "Your own settings.";
};

const syncControls = () => {
  $("preset").value = state.preset;
  SLIDERS.forEach((k) => ($(k).value = state[k]));
  $("n").value = state.n;
  $("palette").value = state.palette;
  $("shape").value = state.shape;
  showValues();
};

const options = (o) => Object.entries(o).map(([k, v]) => `<option value="${k}">${v.name || v}</option>`).join("");

const toSim = (e) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * SIM, y: ((e.clientY - r.top) / r.height) * SIM };
};

const initSlime = () => {
  canvas = $("slime");
  canvas.width = canvas.height = SIM;
  ctx = canvas.getContext("2d");
  img = ctx.createImageData(SIM, SIM);
  readHash();
  $("preset").innerHTML = options(PRESETS) + '<option value="custom">Custom</option>';
  $("palette").innerHTML = options(PALETTES);
  $("shape").innerHTML = options(SHAPES);
  syncControls();
  makeLut();

  $("preset").addEventListener("change", (e) => {
    if (PRESETS[e.target.value]) Object.assign(state, PRESETS[e.target.value]);
    state.preset = e.target.value;
    syncControls();
    restart();
  });
  SLIDERS.forEach((k) =>
    $(k).addEventListener("input", (e) => {
      state[k] = +e.target.value;
      state.preset = "custom";
      $("preset").value = "custom";
      showValues();
      saveHash();
    }),
  );
  $("n").addEventListener("change", (e) => {
    state.n = +e.target.value;
    showValues();
    restart();
  });
  $("n").addEventListener("input", (e) => ($("v-n").textContent = (+e.target.value).toLocaleString("en-US")));
  $("palette").addEventListener("change", (e) => {
    state.palette = e.target.value;
    makeLut();
    render();
    saveHash();
  });
  $("shape").addEventListener("change", (e) => {
    state.shape = e.target.value;
    restart();
  });
  $("btn-run").addEventListener("click", () => {
    state.running = !state.running;
    $("btn-run").textContent = state.running ? "Pause" : "Play";
  });
  $("btn-restart").addEventListener("click", restart);
  $("btn-png").addEventListener("click", () => {
    canvas.toBlob((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `slime-mold-${state.preset}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  });
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointer = toSim(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (pointer) pointer = toSim(e);
  });
  const up = () => (pointer = null);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  seedAgents();
  saveHash();
  requestAnimationFrame(loop);
};
