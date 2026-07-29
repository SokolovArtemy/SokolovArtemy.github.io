// app.js — glues the GeoGebra applet to the meshgen/stlexport helpers.

let ggbApplet = null;
let lastTriangles = null; // triangles from the most recent "build" (used by the download button + preview)

// ---- persist the construction across page reloads (localStorage) ----------
// GeoGebra itself has no "autosave to disk" for a plain embedded applet, so a
// browser refresh would normally lose whatever the user built. We work around
// that by periodically snapshotting the construction as base64 (the same
// format .ggb files use) into localStorage, and restoring it right after the
// applet finishes loading.
const AUTOSAVE_KEY = "ggb2stl_autosave_v1";
let lastSavedBase64 = null;

function saveConstructionToLocalStorage() {
  if (!ggbApplet || typeof ggbApplet.getBase64 !== "function") return;
  try {
    const b64 = ggbApplet.getBase64();
    if (typeof b64 === "string" && b64.length > 0 && b64 !== lastSavedBase64) {
      localStorage.setItem(AUTOSAVE_KEY, b64);
      lastSavedBase64 = b64;
    }
  } catch (e) { /* localStorage unavailable (e.g. some file:// setups) or serialization failed -- ignore */ }
}

function restoreConstructionFromLocalStorage() {
  if (!ggbApplet || typeof ggbApplet.setBase64 !== "function") return;
  let saved = null;
  try { saved = localStorage.getItem(AUTOSAVE_KEY); } catch (e) { /* ignore */ }
  if (!saved) return;
  try {
    ggbApplet.setBase64(saved, () => {
      lastSavedBase64 = saved;
      setStatus("Восстановлена автоматически сохранённая конструкция (после обновления страницы).", "ok");
    });
  } catch (e) { /* ignore restore errors -- just start with a blank applet */ }
}

function forgetAutosave() {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch (e) { /* ignore */ }
  lastSavedBase64 = null;
  setStatus("Автосохранённая конструкция удалена. Обновите страницу, чтобы начать с чистого листа.", "ok");
}

// named global function, since GeoGebra's classic listener-registration API
// takes the *name* of a global callback function (a string), not a direct
// function reference, for broadest compatibility across applet versions.
if (typeof window !== "undefined") {
  window.__ggb2stlOnStoreUndo = function () { saveConstructionToLocalStorage(); };
}

function initApplet() {
  const wrap = document.getElementById("ggb-wrap");
  const w = Math.max(300, wrap ? wrap.clientWidth : 900);
  const h = Math.max(300, wrap ? wrap.clientHeight : 640);
  const params = {
    appName: "classic",
    width: w,
    height: h,
    showToolBar: true,
    showAlgebraInput: true,
    showMenuBar: true,
    showResetIcon: true,
    enableRightClick: true,
    language: "ru",
    appletOnLoad: function (api) {
      ggbApplet = api;
      const btn = document.getElementById("buildBtn");
      btn.disabled = false;
      btn.textContent = "Построить модель и показать превью";

      restoreConstructionFromLocalStorage();

      // save on every meaningful edit (GeoGebra pushes an undo point), plus a
      // periodic safety-net save, plus a best-effort flush right before the
      // tab closes/reloads.
      try { ggbApplet.registerStoreUndoListener("__ggb2stlOnStoreUndo"); } catch (e) { /* older/newer API mismatch -- rely on the interval below */ }
      setInterval(saveConstructionToLocalStorage, 5000);
      window.addEventListener("beforeunload", saveConstructionToLocalStorage);
    },
  };
  const applet = new GGBApplet(params, true);
  applet.inject("ggb-element");
}
if (typeof window !== "undefined") window.addEventListener("load", initApplet);

// ---- keep the GeoGebra applet sized to its container (incl. fullscreen) ---

function fitAppletToContainer() {
  if (!ggbApplet || typeof ggbApplet.setSize !== "function") return;
  const wrap = document.getElementById("ggb-wrap");
  if (!wrap) return;
  const w = Math.max(200, wrap.clientWidth);
  const h = Math.max(200, wrap.clientHeight);
  ggbApplet.setSize(w, h);
}

if (typeof window !== "undefined") {
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitAppletToContainer, 150);
  });
}

if (typeof document !== "undefined") {
  const onFullscreenChange = () => {
    const btn = document.getElementById("fullscreenBtn");
    const wrap = document.getElementById("ggb-wrap");
    const isFull = document.fullscreenElement === wrap || document.webkitFullscreenElement === wrap;
    if (btn) btn.textContent = isFull ? "✕ Свернуть" : "⛶ На весь экран";
    // give the browser a moment to finish the fullscreen transition before measuring
    setTimeout(fitAppletToContainer, 150);
  };
  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);
}

// ---- loading a local .ggb file via a plain <input type=file> -------------

if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("ggbFileInput");
  fileInput.addEventListener("change", (ev) => {
    const file = ev.target.files[0];
    if (!file || !ggbApplet) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result; // "data:application/octet-stream;base64,XXXX"
      const base64 = dataUrl.substring(dataUrl.indexOf(",") + 1);
      ggbApplet.setBase64(base64, () => {
        setStatus("Файл «" + file.name + "» загружен в апплет.", "ok");
      });
    };
    reader.readAsDataURL(file);
  });

  document.getElementById("buildBtn").addEventListener("click", () => {
    const scene = buildScene();
    if (scene) initOrUpdatePreview(scene.triangles);
  });
  document.getElementById("downloadBtn").addEventListener("click", downloadCurrent);

  const forgetBtn = document.getElementById("forgetAutosaveBtn");
  if (forgetBtn) forgetBtn.addEventListener("click", forgetAutosave);

  document.getElementById("fullscreenBtn").addEventListener("click", () => {
    const wrap = document.getElementById("ggb-wrap");
    const isFull = document.fullscreenElement === wrap || document.webkitFullscreenElement === wrap;
    try {
      if (!isFull) {
        const req = wrap.requestFullscreen || wrap.webkitRequestFullscreen;
        if (req) {
          const result = req.call(wrap);
          if (result && typeof result.catch === "function") {
            result.catch((e) => setStatus("Не удалось развернуть апплет на весь экран: " + e.message, "warn"));
          }
        } else {
          setStatus("Браузер не поддерживает полноэкранный режим для этого элемента.", "warn");
        }
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) exit.call(document);
      }
    } catch (e) {
      setStatus("Не удалось переключить полноэкранный режим: " + e.message, "warn");
    }
  });

  document.querySelectorAll('input[name="mode"]').forEach((radio) => {
    radio.addEventListener("change", updateFieldAvailability);
  });
  document.getElementById("addPlate").addEventListener("change", updateFieldAvailability);
  updateFieldAvailability();

  initPreviewViewer();
});

function updateFieldAvailability() {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const addPlate = document.getElementById("addPlate").checked;
  const plateFieldset = document.getElementById("plateOptions");
  const disable = mode !== "relief" || !addPlate;
  plateFieldset.querySelectorAll('input[type="number"]').forEach((i) => (i.disabled = disable));
  plateFieldset.style.opacity = disable ? 0.45 : 1;
  document.getElementById("addPlate").disabled = mode !== "relief";
}

function setStatus(text, kind) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = kind || "";
}

// ---- small geometry helpers (pure, exported for testing) ------------------

function dist2D(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// Circumcenter of triangle ABC in the XY plane. Returns {x,y,r} or null if
// the three points are (nearly) collinear.
function circumcenter(A, B, C) {
  const ax = A.x, ay = A.y, bx = B.x, by = B.y, cx = C.x, cy = C.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return { x: ux, y: uy, r: Math.hypot(ux - ax, uy - ay) };
}

// Clips the parametrized line point(t) = (px+t*dx, py+t*dy) against
// [tLoBound,tHiBound] intersected with the axis-aligned box. Returns [tmin,tmax]
// or null if there's no overlap.
function clipParamRangeToBox(px, py, dx, dy, minX, minY, maxX, maxY, tLoBound, tHiBound) {
  let tmin = tLoBound, tmax = tHiBound;
  function clipAxis(p, d, lo, hi) {
    if (Math.abs(d) < 1e-12) return p >= lo - 1e-9 && p <= hi + 1e-9;
    let t1 = (lo - p) / d, t2 = (hi - p) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    return true;
  }
  if (!clipAxis(px, dx, minX, maxX)) return null;
  if (!clipAxis(py, dy, minY, maxY)) return null;
  if (tmin > tmax) return null;
  return [tmin, tmax];
}

function clipLineToBox(px, py, dx, dy, minX, minY, maxX, maxY) {
  const r = clipParamRangeToBox(px, py, dx, dy, minX, minY, maxX, maxY, -Infinity, Infinity);
  if (!r || !isFinite(r[0]) || !isFinite(r[1])) return null;
  return { ax: px + r[0] * dx, ay: py + r[0] * dy, bx: px + r[1] * dx, by: py + r[1] * dy };
}

function clipRayToBox(px, py, dx, dy, minX, minY, maxX, maxY) {
  const r = clipParamRangeToBox(px, py, dx, dy, minX, minY, maxX, maxY, 0, Infinity);
  if (!r || !isFinite(r[0]) || !isFinite(r[1])) return null;
  return { ax: px + r[0] * dx, ay: py + r[0] * dy, bx: px + r[1] * dx, by: py + r[1] * dy };
}

// Approximates a circle as an N-gon: returns sample points plus consecutive
// edges between them (used to reuse the half-cylinder/cylinder edge pipeline
// instead of needing a dedicated torus primitive).
function circleToPolyline(cx, cy, r, segs) {
  segs = segs || 48;
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  const edges = [];
  for (let i = 0; i < segs; i++) edges.push([pts[i], pts[(i + 1) % segs]]);
  return { points: pts, edges };
}

// Normalizes an angle difference into [0, 2*PI).
function normalizeAngleDiff(diff) {
  let d = diff % (Math.PI * 2);
  if (d < 0) d += Math.PI * 2;
  return d;
}

// Samples an *open* circular arc from startAngle to endAngle (endAngle may be
// numerically less than startAngle -- the sweep direction is whatever the
// caller already resolved). Density is proportional to the angular span.
function arcToPolyline(cx, cy, r, startAngle, endAngle, pointsPerFullCircle) {
  pointsPerFullCircle = pointsPerFullCircle || 48;
  const span = Math.abs(endAngle - startAngle);
  const segs = Math.max(2, Math.round((span / (Math.PI * 2)) * pointsPerFullCircle));
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const a = startAngle + (i / segs) * (endAngle - startAngle);
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  const edges = [];
  for (let i = 0; i < segs; i++) edges.push([pts[i], pts[i + 1]]);
  return { points: pts, edges };
}

// Resolves a CircleArc(center, A, B)-style arc: center given explicitly,
// radius = dist(center,A), sweeping counter-clockwise from A's angle to B's.
function circleArcAngles(center, A, B) {
  const r = dist2D(center, A);
  const startAngle = Math.atan2(A.y - center.y, A.x - center.x);
  const rawEnd = Math.atan2(B.y - center.y, B.x - center.x);
  const endAngle = startAngle + normalizeAngleDiff(rawEnd - startAngle);
  return { cx: center.x, cy: center.y, r, startAngle, endAngle };
}

// Resolves a CircumcircleArc(A,B,C)-style arc: the arc of the circumcircle of
// A,B,C that runs from A to C while passing through B. Returns null if A,B,C
// are (nearly) collinear.
function circumcircleArcAngles(A, B, C) {
  const center = circumcenter(A, B, C);
  if (!center) return null;
  const aA = Math.atan2(A.y - center.y, A.x - center.x);
  const aB = Math.atan2(B.y - center.y, B.x - center.x);
  const aC = Math.atan2(C.y - center.y, C.x - center.x);
  const sweepToC = normalizeAngleDiff(aC - aA);
  const sweepToB = normalizeAngleDiff(aB - aA);
  const endAngle = sweepToB <= sweepToC ? aA + sweepToC : aA + (sweepToC - Math.PI * 2);
  return { cx: center.x, cy: center.y, r: center.r, startAngle: aA, endAngle };
}

// Converts an implicit line equation a*x + b*y + c = 0 (GeoGebra's internal
// representation for every line, however it was constructed -- see
// Coefficients Command docs: "for a line in implicit form l: ax+by+c=0 it is
// possible to obtain the coefficients using x(l), y(l), z(l)") into a point
// on the line (closest to the origin) plus a direction vector. Returns null
// if (a,b) is (nearly) the zero vector, i.e. not a valid line.
function lineFromCoefficients(a, b, c) {
  const denom = a * a + b * b;
  if (denom < 1e-18) return null;
  return { px: (-a * c) / denom, py: (-b * c) / denom, dx: -b, dy: a };
}

// Approximates an axis-rotated ellipse as a closed N-gon (same shape as
// circleToPolyline, but with independent semi-axes a,b and a rotation angle).
function ellipseToPolyline(cx, cy, a, b, rotation, segs) {
  segs = segs || 64;
  const cosR = Math.cos(rotation), sinR = Math.sin(rotation);
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    const lx = a * Math.cos(t), ly = b * Math.sin(t);
    pts.push({ x: cx + lx * cosR - ly * sinR, y: cy + lx * sinR + ly * cosR });
  }
  const edges = [];
  for (let i = 0; i < segs; i++) edges.push([pts[i], pts[(i + 1) % segs]]);
  return { points: pts, edges };
}

// ---- dashed/dotted line-style rendering ------------------------------------
// GeoGebra's own XML schema ("lineTypes") defines line-style codes:
// 0=full, 10=dashed short, 15=dashed long, 20=dotted, 30=dashed dotted.
// We turn each non-solid code into a repeating cycle of tokens -- "on"
// (render as a short ridge), "gap" (nothing), "dot" (render as a small
// hemisphere bump instead of a sliver of ridge, since a real dot is more
// print-friendly than a tiny cylinder) -- measured in raw GeoGebra units.
function dashTokensForLineType(lineType, baseUnit) {
  const u = baseUnit;
  if (!(u > 0)) return null;
  switch (lineType) {
    case 10: // dashed short
      return [{ type: "on", len: u }, { type: "gap", len: u }];
    case 15: // dashed long
      return [{ type: "on", len: 2 * u }, { type: "gap", len: u }];
    case 20: // dotted
      return [{ type: "dot", len: u * 0.4 }, { type: "gap", len: u }];
    case 30: // dashed dotted
      return [
        { type: "on", len: 2 * u }, { type: "gap", len: u },
        { type: "dot", len: u * 0.4 }, { type: "gap", len: u },
      ];
    default:
      return null; // solid (0) or unrecognized -- caller keeps the continuous path
  }
}

// Total length of a polyline path (open: n-1 segments, closed: n segments
// including the wrap-around from the last point back to the first).
function pathLength(points, closed) {
  let len = 0;
  const n = points.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) len += dist2D(points[i], points[(i + 1) % n]);
  return len;
}

// Returns the point at arc-length `t` along the path (wrapping for closed
// paths, clamped to the endpoints for open ones).
function samplePathAt(points, closed, t) {
  const n = points.length;
  const count = closed ? n : n - 1;
  let tt = t;
  if (closed) {
    const total = pathLength(points, closed);
    if (total <= 1e-12) return points[0];
    tt = ((t % total) + total) % total;
  } else {
    tt = Math.max(0, t);
  }
  let acc = 0;
  for (let i = 0; i < count; i++) {
    const a = points[i], b = points[(i + 1) % n];
    const segLen = dist2D(a, b);
    if (tt <= acc + segLen + 1e-9 || i === count - 1) {
      const local = segLen > 1e-12 ? Math.min(1, Math.max(0, (tt - acc) / segLen)) : 0;
      return { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local };
    }
    acc += segLen;
  }
  return points[closed ? 0 : n - 1];
}

// Walks a path (open or closed) applying a repeating dash-token cycle.
// Returns { onSegments: [{a,b}], dots: [{x,y}] } in the same units as `points`.
function applyDashPattern(points, closed, tokens) {
  const onSegments = [];
  const dots = [];
  if (!tokens || !points || points.length < 2) return { onSegments, dots };
  const total = pathLength(points, closed);
  const cycleLen = tokens.reduce((s, t) => s + t.len, 0);
  if (total <= 1e-9 || cycleLen <= 1e-9) return { onSegments, dots };
  let pos = 0;
  let idx = 0;
  const guardLimit = Math.ceil(total / cycleLen) * tokens.length + tokens.length + 10;
  let iterations = 0;
  while (pos < total - 1e-9 && iterations < guardLimit) {
    iterations++;
    const token = tokens[idx % tokens.length];
    const segStart = pos;
    const segEnd = Math.min(pos + token.len, total);
    if (token.type === "on") {
      const a = samplePathAt(points, closed, segStart);
      const b = samplePathAt(points, closed, segEnd);
      if (dist2D(a, b) > 1e-9) onSegments.push({ a, b });
    } else if (token.type === "dot") {
      dots.push(samplePathAt(points, closed, (segStart + segEnd) / 2));
    }
    pos += token.len;
    idx++;
  }
  return { onSegments, dots };
}

// ---- extraction from the live GeoGebra construction -----------------------

function safeGetZ(name) {
  try {
    if (typeof ggbApplet.getZcoord === "function") {
      const z = ggbApplet.getZcoord(name);
      return typeof z === "number" && isFinite(z) ? z : 0;
    }
  } catch (e) { /* not a 3D-capable app / not a point in 3D space */ }
  return 0;
}

function tryGetNumericValue(labelOrLiteral) {
  const s = String(labelOrLiteral).trim();
  if (/^-?[0-9]*\.?[0-9]+$/.test(s)) return parseFloat(s);
  try {
    const v = ggbApplet.getValue(labelOrLiteral);
    if (typeof v === "number" && isFinite(v)) return v;
  } catch (e) { /* not a numeric object */ }
  return null;
}

// Reads the full construction XML to resolve *topology* (which point labels
// a Segment/Vector/Polygon/PolyLine/Circle/Line/Ray command connects) in a
// way that doesn't depend on string-parsing localized command syntax.
// Coordinates themselves still come from the JS API (getXcoord/getYcoord/
// getZcoord), which correctly handles GeoGebra's internal homogeneous-
// coordinate representation.
//
// Supported: Point, Segment, Vector, Polygon (edges), PolyLine (edges),
// Circle (two-point / center+radius-number / three-point variants),
// Line and Ray defined through two points (clipped to the model's bounding
// box since they're infinite/semi-infinite), Semicircle, CircleArc,
// CircumcircleArc, CircleSector/CircumcircleSector (arc + the two radii),
// and Ellipse (two foci + number/point/segment). Everything else that is
// visible in the construction is reported back in `skipped` rather than
// silently dropped.
function extractGeometry() {
  const n = ggbApplet.getObjectNumber();
  const allPointCoords = {}; // label -> {x,y,z}
  const visiblePointLabels = new Set();
  const skipped = [];
  const handledLabels = new Set();

  for (let i = 0; i < n; i++) {
    const name = ggbApplet.getObjectName(i);
    const type = ggbApplet.getObjectType(name);
    if (type === "point") {
      allPointCoords[name] = {
        x: ggbApplet.getXcoord(name),
        y: ggbApplet.getYcoord(name),
        z: safeGetZ(name),
      };
      if (ggbApplet.getVisible(name)) visiblePointLabels.add(name);
      handledLabels.add(name);
    }
  }

  const edgeLabelPairs = []; // [labelA, labelB]
  const circles = []; // {x,y,r}
  const lineDefs = []; // {px,py,dx,dy,label}
  const rayDefs = []; // {px,py,dx,dy,label}
  const arcs = []; // {cx,cy,r,startAngle,endAngle,withRadii}
  const ellipses = []; // {cx,cy,a,b,rot}
  const angleArcs = []; // {cx,cy,startAngle,endAngle,maxRadius} -- rendered with their own thickness/radius
  const polygonVertices = {}; // polygon label -> ordered array of vertex point labels (for Angle(polygon))

  let xmlDoc = null;
  try {
    const xmlStr = ggbApplet.getXML();
    xmlDoc = new DOMParser().parseFromString(xmlStr, "text/xml");
  } catch (e) {
    skipped.push("Не удалось прочитать XML конструкции: " + e.message);
  }

  function labelVisible(label) {
    try { return ggbApplet.getVisible(label); } catch (e) { return true; }
  }
  function haveCoords(label) { return Object.prototype.hasOwnProperty.call(allPointCoords, label); }

  // GeoGebra's own "Size" setting for an angle (Object Properties -> Basic ->
  // Radius, shown as a slider in the style bar) is stored per-angle-object as
  // <arcSize val="..."/> inside that angle's <element> tag; its default is 30.
  // We read it so that angles the user has sized differently *inside*
  // GeoGebra come out proportionally different in the printed model too,
  // relative to the app's "Радиус дуги угла" base setting.
  //
  // We also read each object's own <lineStyle type="..."/> here (same
  // <element> pass), which is GeoGebra's line-dash setting: per the official
  // XML schema ("lineTypes"), the value is one of 0=full, 10=dashed short,
  // 15=dashed long, 20=dotted, 30=dashed dotted. Objects with no <lineStyle>
  // (or type 0) are solid, exactly as before.
  const angleArcSizeByLabel = {};
  const lineStyleTypeByLabel = {};
  if (xmlDoc) {
    const elements = xmlDoc.getElementsByTagName("element");
    for (let ei = 0; ei < elements.length; ei++) {
      const el = elements[ei];
      const label = el.getAttribute("label");
      if (el.getAttribute("type") === "angle") {
        const arcSizeEls = el.getElementsByTagName("arcSize");
        if (label && arcSizeEls.length > 0) {
          const val = parseFloat(arcSizeEls[0].getAttribute("val"));
          if (isFinite(val) && val > 0) angleArcSizeByLabel[label] = val / 30;
        }
      }
      if (label) {
        const lineStyleEls = el.getElementsByTagName("lineStyle");
        if (lineStyleEls.length > 0) {
          const t = parseInt(lineStyleEls[0].getAttribute("type"), 10);
          if (!isNaN(t)) lineStyleTypeByLabel[label] = t;
        }
      }
    }
  }
  function getLineType(label) { return (label && lineStyleTypeByLabel[label]) || 0; }

  if (xmlDoc) {
    const commands = xmlDoc.getElementsByTagName("command");
    for (let ci = 0; ci < commands.length; ci++) {
      const cmd = commands[ci];
      const cmdName = cmd.getAttribute("name");
      const inputEl = cmd.getElementsByTagName("input")[0];
      const outputEl = cmd.getElementsByTagName("output")[0];
      if (!inputEl || !outputEl) continue;

      const inputs = [];
      for (let k = 0; ; k++) {
        const v = inputEl.getAttribute("a" + k);
        if (v === null) break;
        inputs.push(v);
      }
      const outputs = [];
      for (let k = 0; ; k++) {
        const v = outputEl.getAttribute("a" + k);
        if (v === null) break;
        outputs.push(v);
      }

      if (cmdName === "Segment" || cmdName === "Vector") {
        handledLabels.add(outputs[0]);
        if (inputs.length >= 2 && haveCoords(inputs[0]) && haveCoords(inputs[1])) {
          const edgeLabel = outputs[0];
          if (!edgeLabel || labelVisible(edgeLabel)) edgeLabelPairs.push([inputs[0], inputs[1], edgeLabel]);
        }
      } else if (cmdName === "Polygon") {
        outputs.forEach((o) => handledLabels.add(o));
        const verts = inputs.filter(haveCoords);
        if (verts.length >= 2) {
          if (outputs[0]) polygonVertices[outputs[0]] = verts;
          for (let k = 0; k < verts.length; k++) {
            const a = verts[k], b = verts[(k + 1) % verts.length];
            const edgeLabel = outputs[k + 1]; // outputs[0] is the polygon itself
            if (!edgeLabel || labelVisible(edgeLabel)) edgeLabelPairs.push([a, b, edgeLabel]);
          }
        }
      } else if (cmdName === "PolyLine" || cmdName === "Polyline") {
        handledLabels.add(outputs[0]);
        const verts = inputs.filter(haveCoords);
        // PolyLine has no per-segment labels of its own -- every link shares
        // the line style of the polyline object itself.
        for (let k = 0; k < verts.length - 1; k++) edgeLabelPairs.push([verts[k], verts[k + 1], outputs[0]]);
      } else if (cmdName === "Circle") {
        const circleLabel = outputs[0];
        handledLabels.add(circleLabel);
        let resolved = null;
        if (inputs.length >= 3 && haveCoords(inputs[0]) && haveCoords(inputs[1]) && haveCoords(inputs[2])) {
          resolved = circumcenter(allPointCoords[inputs[0]], allPointCoords[inputs[1]], allPointCoords[inputs[2]]);
        } else if (inputs.length >= 2 && haveCoords(inputs[0]) && haveCoords(inputs[1])) {
          const A = allPointCoords[inputs[0]], B = allPointCoords[inputs[1]];
          resolved = { x: A.x, y: A.y, r: dist2D(A, B) };
        } else if (inputs.length >= 2 && haveCoords(inputs[0])) {
          const A = allPointCoords[inputs[0]];
          const rVal = tryGetNumericValue(inputs[1]);
          if (rVal !== null && rVal > 0) resolved = { x: A.x, y: A.y, r: rVal };
        }
        if (resolved && resolved.r > 1e-9 && (!circleLabel || labelVisible(circleLabel))) {
          circles.push({ ...resolved, label: circleLabel });
        } else if (!circleLabel || labelVisible(circleLabel)) {
          skipped.push(`Окружность "${circleLabel || "?"}": не удалось определить центр/радиус (неподдерживаемый вариант команды Circle) — пропущена.`);
        }
      } else if (cmdName === "Ray") {
        const rayLabel = outputs[0];
        handledLabels.add(rayLabel);
        if (inputs.length >= 2 && haveCoords(inputs[0]) && haveCoords(inputs[1])) {
          if (!rayLabel || labelVisible(rayLabel)) {
            const A = allPointCoords[inputs[0]], B = allPointCoords[inputs[1]];
            rayDefs.push({ px: A.x, py: A.y, dx: B.x - A.x, dy: B.y - A.y, label: rayLabel });
          }
        } else if (!rayLabel || labelVisible(rayLabel)) {
          skipped.push(`Луч "${rayLabel || "?"}" построен не через две точки — пока не поддерживается.`);
        }
      } else if (cmdName === "Angle") {
        // Angle(A,B,C): vertex B, marking arc swept counter-clockwise from
        // ray B->A to ray B->C (GeoGebra's default convention). Reflex-angle
        // display quirks (allowReflexAngle/forceReflexAngle) aren't modeled.
        // Angle(Polygon): one marking arc per vertex of the polygon.
        function pushAngleArc(A, B, C, outLabel) {
          if (!outLabel || labelVisible(outLabel)) {
            const resolved = circleArcAngles(B, A, C);
            const maxRadius = Math.min(dist2D(B, A), dist2D(B, C));
            if (resolved.r > 1e-9 && maxRadius > 1e-9) {
              const sizeFactor = (outLabel && angleArcSizeByLabel[outLabel]) || 1;
              const lineType = getLineType(outLabel);
              angleArcs.push({ cx: B.x, cy: B.y, startAngle: resolved.startAngle, endAngle: resolved.endAngle, maxRadius, sizeFactor, lineType });
              return true;
            }
          }
          return false;
        }
        if (inputs.length >= 3 && haveCoords(inputs[0]) && haveCoords(inputs[1]) && haveCoords(inputs[2])) {
          const label = outputs[0];
          handledLabels.add(label);
          const A = allPointCoords[inputs[0]], B = allPointCoords[inputs[1]], C = allPointCoords[inputs[2]];
          if (!pushAngleArc(A, B, C, label) && (!label || labelVisible(label))) {
            skipped.push(`Угол "${label || "?"}": вершина совпадает с одной из точек — пропущен.`);
          }
        } else if (inputs.length === 1 && polygonVertices[inputs[0]]) {
          const verts = polygonVertices[inputs[0]];
          for (let k = 0; k < verts.length; k++) {
            const outLabel = outputs[k];
            handledLabels.add(outLabel);
            const A = allPointCoords[verts[(k - 1 + verts.length) % verts.length]];
            const B = allPointCoords[verts[k]];
            const C = allPointCoords[verts[(k + 1) % verts.length]];
            pushAngleArc(A, B, C, outLabel);
          }
        } else {
          const label = outputs[0];
          handledLabels.add(label);
          if (!label || labelVisible(label)) {
            skipped.push(`Угол "${label || "?"}": поддержаны только варианты Angle(точка, точка, точка) и Angle(многоугольник) — пропущен.`);
          }
        }
      } else if (cmdName === "Semicircle") {
        const label = outputs[0];
        handledLabels.add(label);
        if (inputs.length >= 2 && haveCoords(inputs[0]) && haveCoords(inputs[1]) && (!label || labelVisible(label))) {
          const A = allPointCoords[inputs[0]], B = allPointCoords[inputs[1]];
          const center = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
          const r = dist2D(A, B) / 2;
          const startAngle = Math.atan2(A.y - center.y, A.x - center.x);
          if (r > 1e-9) arcs.push({ cx: center.x, cy: center.y, r, startAngle, endAngle: startAngle + Math.PI, withRadii: false, label });
        } else if (!label || labelVisible(label)) {
          skipped.push(`Полуокружность "${label || "?"}" — не удалось определить (нужны две точки-концы диаметра).`);
        }
      } else if (cmdName === "CircleArc" || cmdName === "CircleSector") {
        const label = outputs[0];
        handledLabels.add(label);
        const withRadii = cmdName === "CircleSector";
        if (inputs.length >= 3 && haveCoords(inputs[0]) && haveCoords(inputs[1]) && haveCoords(inputs[2]) && (!label || labelVisible(label))) {
          const M = allPointCoords[inputs[0]], A = allPointCoords[inputs[1]], B = allPointCoords[inputs[2]];
          const resolved = circleArcAngles(M, A, B);
          if (resolved.r > 1e-9) arcs.push({ ...resolved, withRadii, label });
        } else if (!label || labelVisible(label)) {
          skipped.push(`${withRadii ? "Сектор" : "Дуга"} "${label || "?"}": не удалось определить (нужны центр + две точки) — пропущен(а).`);
        }
      } else if (cmdName === "CircumcircleArc" || cmdName === "CircumcircleSector") {
        const label = outputs[0];
        handledLabels.add(label);
        const withRadii = cmdName === "CircumcircleSector";
        let resolved = null;
        if (inputs.length >= 3 && haveCoords(inputs[0]) && haveCoords(inputs[1]) && haveCoords(inputs[2])) {
          resolved = circumcircleArcAngles(allPointCoords[inputs[0]], allPointCoords[inputs[1]], allPointCoords[inputs[2]]);
        }
        if (resolved && resolved.r > 1e-9 && (!label || labelVisible(label))) {
          arcs.push({ ...resolved, withRadii, label });
        } else if (!label || labelVisible(label)) {
          skipped.push(`${withRadii ? "Сектор" : "Дуга"} "${label || "?"}" (по трём точкам): точки коллинеарны или не удалось определить — пропущен(а).`);
        }
      } else if (cmdName === "Ellipse") {
        const label = outputs[0];
        handledLabels.add(label);
        let ok = false;
        if (inputs.length >= 3 && haveCoords(inputs[0]) && haveCoords(inputs[1]) && (!label || labelVisible(label))) {
          const F1 = allPointCoords[inputs[0]], F2 = allPointCoords[inputs[1]];
          let a = null;
          if (haveCoords(inputs[2])) {
            const P = allPointCoords[inputs[2]];
            a = (dist2D(F1, P) + dist2D(F2, P)) / 2;
          } else {
            a = tryGetNumericValue(inputs[2]);
          }
          const c = dist2D(F1, F2) / 2;
          if (a !== null && a > c + 1e-9) {
            const b = Math.sqrt(a * a - c * c);
            const cx = (F1.x + F2.x) / 2, cy = (F1.y + F2.y) / 2;
            const rot = Math.atan2(F2.y - F1.y, F2.x - F1.x);
            ellipses.push({ cx, cy, a, b, rot, label });
            ok = true;
          }
        }
        if (!ok && (!label || labelVisible(label))) {
          skipped.push(`Эллипс "${label || "?"}": не удалось определить (поддержаны только варианты через 2 фокуса + число/точку/отрезок) — пропущен.`);
        }
      }
    }
  }

  // ---- generic handling of ANY "line"-type object, regardless of which tool
  // created it ---------------------------------------------------------------
  // Every GeoGebra line -- however it was built (Line, LineBisector /
  // PerpendicularBisector, AngleBisector, PerpendicularLine, ParallelLine,
  // Tangent, PolarLine, Asymptote, Directrix, ...) -- is internally an
  // implicit equation a*x + b*y + c = 0. GeoGebra exposes these coefficients
  // through the ordinary x(), y(), z() commands (documented: "for a line in
  // implicit form l: ax+by+c=0 it is possible to obtain the coefficients
  // using the syntax x(l), y(l), z(l)"), and the JS API's getXcoord/getYcoord/
  // getZcoord are the same operation used for point coordinates. So instead
  // of enumerating every possible line-producing command, we just read the
  // coefficients directly off any object whose type is "line" -- this covers
  // every tool that outputs a line, including ones not explicitly named here.
  for (let i = 0; i < n; i++) {
    const name = ggbApplet.getObjectName(i);
    if (ggbApplet.getObjectType(name) !== "line") continue;
    handledLabels.add(name);
    let visible = true;
    try { visible = ggbApplet.getVisible(name); } catch (e) { /* ignore */ }
    if (!visible) continue;
    try {
      const a = ggbApplet.getXcoord(name), b = ggbApplet.getYcoord(name), c = ggbApplet.getZcoord(name);
      const resolved = isFinite(a) && isFinite(b) && isFinite(c) ? lineFromCoefficients(a, b, c) : null;
      if (!resolved) {
        skipped.push(`Прямая "${name}": не удалось получить коэффициенты уравнения — пропущена.`);
        continue;
      }
      lineDefs.push({ px: resolved.px, py: resolved.py, dx: resolved.dx, dy: resolved.dy, label: name });
    } catch (e) {
      skipped.push(`Прямая "${name}": ошибка при чтении коэффициентов (${e.message}) — пропущена.`);
    }
  }

  // ---- report any other visible object we didn't handle above -------------
  const quietlyIgnoredTypes = new Set([
    "numeric", "boolean", "text", "list", "button", "textfield", "image", "video", "audio", "embed",
  ]);
  for (let i = 0; i < n; i++) {
    const name = ggbApplet.getObjectName(i);
    if (handledLabels.has(name)) continue;
    let visible = true;
    try { visible = ggbApplet.getVisible(name); } catch (e) { /* ignore */ }
    if (!visible) continue;
    const type = ggbApplet.getObjectType(name);
    if (quietlyIgnoredTypes.has(type)) continue;
    skipped.push(`Объект "${name}" (тип "${type}") пока не поддерживается и не попадёт в 3D модель.`);
  }

  // ---- resolve label-based edges to coordinates ----------------------------
  // dashedPaths collects every drawable feature whose own GeoGebra line style
  // is non-solid (dashed short/long, dotted, dash-dot) -- these are rendered
  // in buildScene as an alternating sequence of short ridges/dot bumps
  // instead of one continuous ridge. Each entry is { points, closed, lineType }
  // in raw GeoGebra units; `points` is an ordered path (closed=true for full
  // circles/ellipses). Solid objects (the overwhelming majority, and every
  // object in constructions that never touch line style) are completely
  // unaffected and keep flowing through the pre-existing edges/circleJoints
  // arrays exactly as before.
  const dashedPaths = [];

  const resolvedEdgesAll = edgeLabelPairs
    .filter(([a, b]) => allPointCoords[a] && allPointCoords[b])
    .map(([a, b, ownLabel]) => ({ a: allPointCoords[a], b: allPointCoords[b], labelA: a, labelB: b, lineType: getLineType(ownLabel) }));
  const resolvedEdges = resolvedEdgesAll.filter((e) => e.lineType === 0);
  for (const e of resolvedEdgesAll) {
    if (e.lineType !== 0) dashedPaths.push({ points: [e.a, e.b], closed: false, lineType: e.lineType });
  }

  const rawEdges = []; // {a:{x,y}, b:{x,y}}
  const circleJoints = []; // {x,y} — synthetic vertices where a circle's polyline approximation bends

  for (const c of circles) {
    const lineType = getLineType(c.label);
    const { points: cPts, edges: cEdges } = circleToPolyline(c.x, c.y, c.r, 48);
    if (lineType === 0) {
      for (const [p0, p1] of cEdges) rawEdges.push({ a: p0, b: p1 });
      for (const p of cPts) circleJoints.push(p);
    } else {
      dashedPaths.push({ points: cPts, closed: true, lineType });
    }
  }

  for (const e of ellipses) {
    const lineType = getLineType(e.label);
    const { points: ePts, edges: eEdges } = ellipseToPolyline(e.cx, e.cy, e.a, e.b, e.rot, 64);
    if (lineType === 0) {
      for (const [p0, p1] of eEdges) rawEdges.push({ a: p0, b: p1 });
      for (const p of ePts) circleJoints.push(p);
    } else {
      dashedPaths.push({ points: ePts, closed: true, lineType });
    }
  }

  for (const arc of arcs) {
    const lineType = getLineType(arc.label);
    const pointsPerFullCircle = arc.r > 0 ? 48 : 48;
    const { points: aPts, edges: aEdges } = arcToPolyline(arc.cx, arc.cy, arc.r, arc.startAngle, arc.endAngle, pointsPerFullCircle);
    if (lineType === 0) {
      for (const [p0, p1] of aEdges) rawEdges.push({ a: p0, b: p1 });
      for (const p of aPts) circleJoints.push(p);
      if (arc.withRadii && aPts.length >= 2) {
        const center = { x: arc.cx, y: arc.cy };
        rawEdges.push({ a: center, b: aPts[0] });
        rawEdges.push({ a: center, b: aPts[aPts.length - 1] });
        circleJoints.push(center);
      }
    } else {
      dashedPaths.push({ points: aPts, closed: false, lineType });
      if (arc.withRadii && aPts.length >= 2) {
        const center = { x: arc.cx, y: arc.cy };
        dashedPaths.push({ points: [center, aPts[0]], closed: false, lineType });
        dashedPaths.push({ points: [center, aPts[aPts.length - 1]], closed: false, lineType });
      }
    }
  }

  // ---- bounding box (raw GeoGebra units) used only to clip infinite lines/rays
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  function extend(x, y) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  for (const label of Object.keys(allPointCoords)) extend(allPointCoords[label].x, allPointCoords[label].y);
  for (const c of circles) { extend(c.x - c.r, c.y - c.r); extend(c.x + c.r, c.y + c.r); }
  for (const e of ellipses) { const m = Math.max(e.a, e.b); extend(e.cx - m, e.cy - m); extend(e.cx + m, e.cy + m); }
  for (const arc of arcs) { extend(arc.cx - arc.r, arc.cy - arc.r); extend(arc.cx + arc.r, arc.cy + arc.r); }
  for (const a of angleArcs) { extend(a.cx - a.maxRadius, a.cy - a.maxRadius); extend(a.cx + a.maxRadius, a.cy + a.maxRadius); }
  for (const l of lineDefs) extend(l.px, l.py);
  for (const r of rayDefs) extend(r.px, r.py);
  if (!isFinite(bx0)) { bx0 = -5; bx1 = 5; by0 = -5; by1 = 5; }
  const pad = Math.max(bx1 - bx0, by1 - by0, 1) * 0.15 + 0.5;
  const clipBox = [bx0 - pad, by0 - pad, bx1 + pad, by1 + pad];

  for (const l of lineDefs) {
    if (Math.hypot(l.dx, l.dy) < 1e-9) { skipped.push(`Прямая "${l.label || "?"}" вырождена (совпадающие точки).`); continue; }
    const seg = clipLineToBox(l.px, l.py, l.dx, l.dy, clipBox[0], clipBox[1], clipBox[2], clipBox[3]);
    if (!seg) { skipped.push(`Прямая "${l.label || "?"}" не пересекает область модели — пропущена.`); continue; }
    const lineType = getLineType(l.label);
    if (lineType === 0) rawEdges.push({ a: { x: seg.ax, y: seg.ay }, b: { x: seg.bx, y: seg.by } });
    else dashedPaths.push({ points: [{ x: seg.ax, y: seg.ay }, { x: seg.bx, y: seg.by }], closed: false, lineType });
  }
  for (const r of rayDefs) {
    if (Math.hypot(r.dx, r.dy) < 1e-9) { skipped.push(`Луч "${r.label || "?"}" вырожден (совпадающие точки).`); continue; }
    const seg = clipRayToBox(r.px, r.py, r.dx, r.dy, clipBox[0], clipBox[1], clipBox[2], clipBox[3]);
    if (!seg) { skipped.push(`Луч "${r.label || "?"}" не пересекает область модели — пропущен.`); continue; }
    const lineType = getLineType(r.label);
    if (lineType === 0) rawEdges.push({ a: { x: seg.ax, y: seg.ay }, b: { x: seg.bx, y: seg.by } });
    else dashedPaths.push({ points: [{ x: seg.ax, y: seg.ay }, { x: seg.bx, y: seg.by }], closed: false, lineType });
  }

  const points = Array.from(visiblePointLabels).map((label) => ({ label, ...allPointCoords[label] }));
  const edges = resolvedEdges.concat(rawEdges);

  // angleArcs are returned raw (un-sampled): their print radius is a UI
  // parameter (mm), not something derivable from the construction alone, so
  // sampling into a polyline happens later in buildScene once mmPerUnit and
  // the user's angle-arc radius/thickness settings are known. Their lineType
  // (if dashed/dotted) is carried along and applied at that same point.
  return { points, edges, circleJoints, angleArcs, dashedPaths, skipped };
}

// ---- build triangles (no download) -----------------------------------------

function readParams() {
  return {
    mmPerUnit: parseFloat(document.getElementById("mmPerUnit").value) || 10,
    pointRadius: parseFloat(document.getElementById("pointRadius").value) || 3,
    segmentRadius: parseFloat(document.getElementById("segmentRadius").value) || 2,
    angleArcRadius: parseFloat(document.getElementById("angleArcRadius").value) || 8,
    angleArcThickness: parseFloat(document.getElementById("angleArcThickness").value) || 1,
    plateThickness: parseFloat(document.getElementById("plateThickness").value) || 2,
    plateMargin: parseFloat(document.getElementById("plateMargin").value) || 6,
    embedDepth: parseFloat(document.getElementById("embedDepth").value) || 0.4,
    segsAround: parseInt(document.getElementById("segsAround").value, 10) || 24,
    segsAlong: parseInt(document.getElementById("segsAlong").value, 10) || 8,
    mode: document.querySelector('input[name="mode"]:checked').value,
    addPlate: document.getElementById("addPlate").checked,
  };
}

function buildScene() {
  if (!ggbApplet) { setStatus("Апплет ещё не загружен.", "error"); return null; }

  const p = readParams();

  let scene;
  try {
    scene = extractGeometry();
  } catch (e) {
    setStatus("Ошибка чтения конструкции из GeoGebra: " + e.message, "error");
    return null;
  }

  if (scene.points.length === 0) {
    setStatus(
      "В конструкции не найдено видимых точек.\n" +
        "Загрузите .ggb файл (кнопка слева или меню «Файл → Открыть» в апплете) и убедитесь, что точки видимы.",
      "error"
    );
    return null;
  }

  const triangles = [];
  let warnings = scene.skipped.slice();
  let edgeCount = scene.edges.length + (scene.dashedPaths || []).length;

  if (p.mode === "relief") {
    const scaledPoints = scene.points.map((pt) => ({ x: pt.x * p.mmPerUnit, y: pt.y * p.mmPerUnit }));
    const scaledEdges = scene.edges.map((e) => ({
      ax: e.a.x * p.mmPerUnit, ay: e.a.y * p.mmPerUnit,
      bx: e.b.x * p.mmPerUnit, by: e.b.y * p.mmPerUnit,
    }));
    const scaledJoints = scene.circleJoints.map((j) => ({ x: j.x * p.mmPerUnit, y: j.y * p.mmPerUnit }));

    // Objects with a non-solid GeoGebra line style (dashed short/long, dotted,
    // dash-dot) become an alternating sequence of short ridges + small dot
    // bumps, using the same "Радиус отрезка" as ordinary solid edges. The
    // dash/gap unit length scales with that radius so thicker ridges get
    // proportionally longer dashes.
    const dashBaseUnitRaw = (p.segmentRadius * 5) / p.mmPerUnit;
    const scaledDashEdges = [];
    const scaledDashDots = [];
    for (const dp of scene.dashedPaths || []) {
      const tokens = dashTokensForLineType(dp.lineType, dashBaseUnitRaw);
      if (!tokens) continue;
      const { onSegments, dots } = applyDashPattern(dp.points, dp.closed, tokens);
      for (const seg of onSegments) {
        scaledDashEdges.push({ ax: seg.a.x * p.mmPerUnit, ay: seg.a.y * p.mmPerUnit, bx: seg.b.x * p.mmPerUnit, by: seg.b.y * p.mmPerUnit });
      }
      for (const d of dots) scaledDashDots.push({ x: d.x * p.mmPerUnit, y: d.y * p.mmPerUnit });
    }

    // Angle-marking arcs get their own (usually much smaller/thinner) radius
    // and ridge thickness -- sampled here, in raw units, then scaled like
    // everything else. Each angle's own GeoGebra "Size" property (a.sizeFactor,
    // 1 = GeoGebra's default of 30) scales the base radius up/down relative to
    // the other angles, so angles you've sized differently inside GeoGebra
    // print differently too. The in-plane radius is then clamped to 90% of
    // the shorter adjacent side so the mark never overshoots a short segment.
    const angleArcRadiusRaw = p.angleArcRadius / p.mmPerUnit;
    const angleDashBaseUnitRaw = (p.angleArcThickness * 5) / p.mmPerUnit;
    const scaledAngleEdges = [];
    const scaledAngleJoints = [];
    const scaledAngleDashEdges = [];
    const scaledAngleDashDots = [];
    for (const a of scene.angleArcs || []) {
      const r = Math.min(angleArcRadiusRaw * (a.sizeFactor || 1), a.maxRadius * 0.9);
      if (r <= 1e-9) continue;
      const { points: rawPts, edges: rawEdgesForArc } = arcToPolyline(a.cx, a.cy, r, a.startAngle, a.endAngle, 48);
      const tokens = dashTokensForLineType(a.lineType, angleDashBaseUnitRaw);
      if (!tokens) {
        for (const [p0, p1] of rawEdgesForArc) {
          scaledAngleEdges.push({ ax: p0.x * p.mmPerUnit, ay: p0.y * p.mmPerUnit, bx: p1.x * p.mmPerUnit, by: p1.y * p.mmPerUnit });
        }
        for (const pt of rawPts) scaledAngleJoints.push({ x: pt.x * p.mmPerUnit, y: pt.y * p.mmPerUnit });
      } else {
        const { onSegments, dots } = applyDashPattern(rawPts, false, tokens);
        for (const seg of onSegments) {
          scaledAngleDashEdges.push({ ax: seg.a.x * p.mmPerUnit, ay: seg.a.y * p.mmPerUnit, bx: seg.b.x * p.mmPerUnit, by: seg.b.y * p.mmPerUnit });
        }
        for (const d of dots) scaledAngleDashDots.push({ x: d.x * p.mmPerUnit, y: d.y * p.mmPerUnit });
      }
    }

    if (scaledEdges.length === 0 && scaledAngleEdges.length === 0 && scaledDashEdges.length === 0 && scaledDashDots.length === 0 && scaledAngleDashEdges.length === 0 && scaledAngleDashDots.length === 0) {
      warnings.push("Отрезки/векторы/окружности/прямые/многоугольники не найдены — печатаются только точки.");
    }

    const z0 = p.addPlate ? -p.embedDepth : 0;

    if (p.addPlate) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of scaledPoints) { minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x); minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y); }
      for (const e of scaledEdges) {
        minX = Math.min(minX, e.ax, e.bx); maxX = Math.max(maxX, e.ax, e.bx);
        minY = Math.min(minY, e.ay, e.by); maxY = Math.max(maxY, e.ay, e.by);
      }
      for (const e of scaledAngleEdges) {
        minX = Math.min(minX, e.ax, e.bx); maxX = Math.max(maxX, e.ax, e.bx);
        minY = Math.min(minY, e.ay, e.by); maxY = Math.max(maxY, e.ay, e.by);
      }
      for (const e of scaledDashEdges.concat(scaledAngleDashEdges)) {
        minX = Math.min(minX, e.ax, e.bx); maxX = Math.max(maxX, e.ax, e.bx);
        minY = Math.min(minY, e.ay, e.by); maxY = Math.max(maxY, e.ay, e.by);
      }
      for (const d of scaledDashDots.concat(scaledAngleDashDots)) {
        minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x);
        minY = Math.min(minY, d.y); maxY = Math.max(maxY, d.y);
      }
      triangles.push(...MeshGen.boxMesh(minX - p.plateMargin, minY - p.plateMargin, -p.plateThickness, maxX + p.plateMargin, maxY + p.plateMargin, 0));
    }

    for (const pt of scaledPoints) triangles.push(...MeshGen.hemisphereMesh(pt.x, pt.y, z0, p.pointRadius, p.segsAround, p.segsAlong));
    for (const e of scaledEdges) triangles.push(...MeshGen.halfCylinderMesh(e.ax, e.ay, z0, e.bx, e.by, z0, p.segmentRadius, p.segsAround));
    for (const j of scaledJoints) triangles.push(...MeshGen.hemisphereMesh(j.x, j.y, z0, p.segmentRadius, p.segsAround, Math.max(4, Math.round(p.segsAlong / 2))));
    for (const e of scaledAngleEdges) triangles.push(...MeshGen.halfCylinderMesh(e.ax, e.ay, z0, e.bx, e.by, z0, p.angleArcThickness, p.segsAround));
    for (const j of scaledAngleJoints) triangles.push(...MeshGen.hemisphereMesh(j.x, j.y, z0, p.angleArcThickness, p.segsAround, Math.max(4, Math.round(p.segsAlong / 2))));

    // Dashed/dotted ridges: each "on" segment is its own short isolated
    // cylinder (no shared joint with neighbours, since a gap separates them),
    // so both ends get a rounding hemisphere cap. Dots are plain hemisphere
    // bumps -- more print-friendly than a sliver-thin cylinder.
    const dashHemiSegs = Math.max(4, Math.round(p.segsAlong / 2));
    for (const e of scaledDashEdges) {
      triangles.push(...MeshGen.halfCylinderMesh(e.ax, e.ay, z0, e.bx, e.by, z0, p.segmentRadius, p.segsAround));
      triangles.push(...MeshGen.hemisphereMesh(e.ax, e.ay, z0, p.segmentRadius, p.segsAround, dashHemiSegs));
      triangles.push(...MeshGen.hemisphereMesh(e.bx, e.by, z0, p.segmentRadius, p.segsAround, dashHemiSegs));
    }
    for (const d of scaledDashDots) triangles.push(...MeshGen.hemisphereMesh(d.x, d.y, z0, p.segmentRadius, p.segsAround, dashHemiSegs));
    for (const e of scaledAngleDashEdges) {
      triangles.push(...MeshGen.halfCylinderMesh(e.ax, e.ay, z0, e.bx, e.by, z0, p.angleArcThickness, p.segsAround));
      triangles.push(...MeshGen.hemisphereMesh(e.ax, e.ay, z0, p.angleArcThickness, p.segsAround, dashHemiSegs));
      triangles.push(...MeshGen.hemisphereMesh(e.bx, e.by, z0, p.angleArcThickness, p.segsAround, dashHemiSegs));
    }
    for (const d of scaledAngleDashDots) triangles.push(...MeshGen.hemisphereMesh(d.x, d.y, z0, p.angleArcThickness, p.segsAround, dashHemiSegs));
  } else {
    // full 3D mode: real spheres/cylinders, true (x,y,z) positions, no plate.
    // Circles are not yet supported in this mode (orientation is ambiguous
    // without reading the circle's plane normal) — they're already reported
    // as skipped by extractGeometry only in relief-incompatible cases; here
    // we simply don't render circleJoints/derived edges twice, so nothing
    // extra is needed, full3D just ignores circleJoints.
    for (const pt of scene.points) {
      triangles.push(...MeshGen.sphereMesh(pt.x * p.mmPerUnit, pt.y * p.mmPerUnit, pt.z * p.mmPerUnit, p.pointRadius, p.segsAround, Math.max(p.segsAlong, 8) * 2));
    }
    for (const e of scene.edges) {
      triangles.push(...MeshGen.cylinderMesh(
        e.a.x * p.mmPerUnit, e.a.y * p.mmPerUnit, (e.a.z || 0) * p.mmPerUnit,
        e.b.x * p.mmPerUnit, e.b.y * p.mmPerUnit, (e.b.z || 0) * p.mmPerUnit,
        p.segmentRadius, p.segsAround
      ));
    }
    // Dashed/dotted line styles aren't modeled in "Полный 3D" -- every
    // dashed/dotted object still prints, just as a solid cylinder (dashing
    // is a relief-mode-only visual feature, see README limitations).
    for (const dp of scene.dashedPaths || []) {
      const cnt = dp.closed ? dp.points.length : dp.points.length - 1;
      for (let i = 0; i < cnt; i++) {
        const a = dp.points[i], b = dp.points[(i + 1) % dp.points.length];
        triangles.push(...MeshGen.cylinderMesh(
          a.x * p.mmPerUnit, a.y * p.mmPerUnit, (a.z || 0) * p.mmPerUnit,
          b.x * p.mmPerUnit, b.y * p.mmPerUnit, (b.z || 0) * p.mmPerUnit,
          p.segmentRadius, p.segsAround
        ));
      }
    }
  }

  const angleCount = (scene.angleArcs || []).length;
  const summaryStats = { points: scene.points.length, edges: edgeCount, angles: angleCount, triangles: triangles.length, warnings };
  lastTriangles = triangles;
  document.getElementById("downloadBtn").disabled = false;

  const summary =
    `Готово: ${summaryStats.points} точек, ${summaryStats.edges} отрезков/дуг` +
    (angleCount ? `, ${angleCount} углов` : "") +
    `, ${summaryStats.triangles} треугольников.\n` +
    (warnings.length ? "\nПредупреждения:\n- " + warnings.join("\n- ") : "");
  setStatus(summary, warnings.length ? "warn" : "ok");

  return { triangles, summaryStats };
}

function downloadCurrent() {
  if (!lastTriangles) { setStatus("Сначала постройте модель.", "error"); return; }
  const { bytes, degenerateSkipped } = STLExport.trianglesToBinarySTL(lastTriangles, "ggb2stl");
  downloadBlob(bytes, "model.stl");
  if (degenerateSkipped > 0) {
    setStatus(`Скачано. Внимание: ${degenerateSkipped} вырожденных треугольников были обнулены.`, "warn");
  }
}

function downloadBlob(bytes, filename) {
  const blob = new Blob([bytes], { type: "model/stl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---- lightweight Three.js preview (no OrbitControls dependency: a small
// custom orbit/zoom controller is implemented directly below) --------------

let previewState = null;

function initPreviewViewer() {
  const canvas = document.getElementById("previewCanvas");
  const hint = document.getElementById("previewHint");
  if (!canvas) return;
  if (typeof THREE === "undefined") {
    if (hint) hint.textContent = "3D-библиотека не загрузилась (нет подключения к CDN) — превью недоступно, но экспорт STL работает.";
    return;
  }

  try {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(1, 1.4, 1.2);
    scene.add(dirLight);
    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-1, -0.5, -1);
    scene.add(dirLight2);

    let mesh = null;

    // --- minimal orbit controller (drag to rotate, wheel to zoom) ---
    const orbit = { theta: Math.PI / 4, phi: Math.PI / 3.2, radius: 100, target: new THREE.Vector3(0, 0, 0) };
    function applyOrbit() {
      const sinPhi = Math.sin(orbit.phi);
      camera.position.set(
        orbit.target.x + orbit.radius * sinPhi * Math.cos(orbit.theta),
        orbit.target.y + orbit.radius * sinPhi * Math.sin(orbit.theta),
        orbit.target.z + orbit.radius * Math.cos(orbit.phi)
      );
      camera.up.set(0, 0, 1);
      camera.lookAt(orbit.target);
    }
    applyOrbit();

    let dragging = false, lastX = 0, lastY = 0;
    canvas.addEventListener("pointerdown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointerup", () => { dragging = false; });
    canvas.addEventListener("pointerleave", () => { dragging = false; });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      orbit.theta -= dx * 0.008;
      orbit.phi = Math.min(Math.PI - 0.05, Math.max(0.05, orbit.phi - dy * 0.008));
      applyOrbit();
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      orbit.radius *= Math.exp(e.deltaY * 0.001);
      orbit.radius = Math.max(1, Math.min(100000, orbit.radius));
      applyOrbit();
    }, { passive: false });

    function resize() {
      const w = canvas.clientWidth || 400, h = canvas.clientHeight || 300;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener("resize", resize);
    resize();

    function animate() {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();

    previewState = {
      setMesh(triangles) {
        if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
        const positions = new Float32Array(triangles.length * 9);
        let idx = 0;
        let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const tri of triangles) {
          for (const v of tri) {
            positions[idx++] = v[0]; positions[idx++] = v[1]; positions[idx++] = v[2];
            minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
            minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
            minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]);
          }
        }
        const geom = new THREE.BufferGeometry();
        geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geom.computeVertexNormals();
        const material = new THREE.MeshStandardMaterial({ color: 0xe8823c, metalness: 0.05, roughness: 0.7, side: THREE.DoubleSide });
        mesh = new THREE.Mesh(geom, material);
        scene.add(mesh);

        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
        const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 10;
        orbit.target.set(cx, cy, cz);
        orbit.radius = diag * 1.6;
        applyOrbit();
      },
    };
  } catch (e) {
    if (hint) hint.textContent = "Не удалось инициализировать 3D-превью: " + e.message;
  }
}

function initOrUpdatePreview(triangles) {
  const hint = document.getElementById("previewHint");
  if (!previewState) return;
  if (hint) hint.style.display = "none";
  previewState.setMesh(triangles);
}

// ---- Node-testability hooks (no effect in the browser) --------------------
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    extractGeometry,
    setGgbApplet: (a) => { ggbApplet = a; },
    circumcenter,
    clipLineToBox,
    clipRayToBox,
    circleToPolyline,
    dist2D,
    arcToPolyline,
    circleArcAngles,
    circumcircleArcAngles,
    ellipseToPolyline,
    normalizeAngleDiff,
    lineFromCoefficients,
    dashTokensForLineType,
    pathLength,
    samplePathAt,
    applyDashPattern,
  };
}
