// meshgen.js
// Pure-JS triangle mesh generators for turning a flat (2D, z=0) GeoGebra
// construction into a printable 3D relief: points -> hemispheres (domes),
// segments -> half-cylinders (ridges), all sitting on a rectangular base plate.
//
// Works both in Node (for testing) and in the browser via a plain <script> tag
// (no module system required). Every shape is generated as a fully closed
// ("watertight") triangle mesh with outward-facing consistent winding, so that
// simply concatenating overlapping shapes into one STL slices correctly on
// any standard slicer (Cura, PrusaSlicer, Bambu Studio, etc.) without needing
// an actual boolean union.
//
// Triangle representation: an array of triangles, each triangle is
// [ [x,y,z], [x,y,z], [x,y,z] ] with CCW winding when viewed from outside
// the solid (right-hand rule normal points outward).

(function (root) {
  "use strict";

  // ---- basic vector helpers -------------------------------------------------

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function length(a) { return Math.sqrt(dot(a, a)); }
  function normalize(a) {
    const l = length(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }

  // ---- hemisphere -------------------------------------------------------
  // Dome bulging in +Z, flat circular base (capped) at local z=0, centered
  // at (cx,cy,cz). segsU = around (longitude), segsV = pole-to-rim (latitude).

  function hemisphereMesh(cx, cy, cz, r, segsU, segsV) {
    segsU = segsU || 24;
    segsV = segsV || 8;
    const tris = [];

    function vert(j, i) {
      const phi = (j / segsV) * (Math.PI / 2); // 0 at apex .. PI/2 at rim
      const theta = (i / segsU) * (Math.PI * 2);
      const ringR = r * Math.sin(phi);
      const z = r * Math.cos(phi);
      return [cx + ringR * Math.cos(theta), cy + ringR * Math.sin(theta), cz + z];
    }

    // side surface
    for (let j = 0; j < segsV; j++) {
      for (let i = 0; i < segsU; i++) {
        const i2 = (i + 1) % segsU;
        const v00 = vert(j, i);
        const v01 = vert(j, i2);
        const v10 = vert(j + 1, i);
        const v11 = vert(j + 1, i2);
        if (j === 0) {
          // top ring degenerates to the apex point; emit a single triangle
          // per step (a fan), skip degenerate duplicate.
          tris.push([v00, v10, v11]);
        } else {
          tris.push([v00, v10, v11]);
          tris.push([v00, v11, v01]);
        }
      }
    }

    // bottom cap (flat disk), normal must point in -Z (downward, outward)
    const center = [cx, cy, cz];
    for (let i = 0; i < segsU; i++) {
      const i2 = (i + 1) % segsU;
      const v0 = vert(segsV, i);
      const v1 = vert(segsV, i2);
      tris.push([center, v1, v0]);
    }

    return tris;
  }

  // ---- half-cylinder ------------------------------------------------------
  // Ridge connecting point A=(ax,ay,az) to B=(bx,by,bz) (assumed az === bz,
  // i.e. lying flat in a horizontal plane). Semi-circular cross-section
  // bulges in +Z, flat rectangular bottom face on the A-B line. Closed with
  // two half-disk end caps for watertightness.

  function halfCylinderMesh(ax, ay, az, bx, by, bz, r, segs) {
    segs = segs || 16;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return [];
    const ux = dx / len, uy = dy / len;
    // horizontal perpendicular to the segment direction (rotate dir by +90deg)
    const nx = -uy, ny = ux;

    function ringPoint(t, alpha) {
      const px = ax + dx * t, py = ay + dy * t, pz = az;
      const c = r * Math.cos(alpha), s = r * Math.sin(alpha);
      return [px + nx * c, py + ny * c, pz + s];
    }

    const tris = [];

    // curved side surface (t=0 ring at A, t=1 ring at B)
    for (let k = 0; k < segs; k++) {
      const a0 = (k / segs) * Math.PI;
      const a1 = ((k + 1) / segs) * Math.PI;
      const p00 = ringPoint(0, a0), p01 = ringPoint(0, a1);
      const p10 = ringPoint(1, a0), p11 = ringPoint(1, a1);
      tris.push([p00, p10, p11]);
      tris.push([p00, p11, p01]);
    }

    // flat bottom rectangle (alpha=0 rim to alpha=PI rim, along the length)
    {
      const q00 = ringPoint(0, 0), q0pi = ringPoint(0, Math.PI);
      const q10 = ringPoint(1, 0), q1pi = ringPoint(1, Math.PI);
      tris.push([q00, q1pi, q10]);
      tris.push([q00, q0pi, q1pi]);
    }

    // End caps (half-disks) are fan-triangulated from one of the two rim
    // points (NOT the center) so that the resulting boundary edges are
    // exactly the arc (shared with the curved side surface) plus the
    // diameter chord (shared with the flat bottom rectangle) -- a fan
    // through the center would instead leave two unmatched "spoke" edges.
    function endCapFan(ringFn, reverse) {
      const pts = [];
      for (let i = 0; i <= segs; i++) pts.push(ringFn((i / segs) * Math.PI));
      const out = [];
      for (let i = 1; i < segs; i++) {
        if (!reverse) out.push([pts[0], pts[i], pts[i + 1]]);
        else out.push([pts[0], pts[i + 1], pts[i]]);
      }
      return out;
    }
    // end cap at A
    for (const t of endCapFan((alpha) => ringPoint(0, alpha), false)) tris.push(t);
    // end cap at B (mirrored winding relative to A, see above)
    for (const t of endCapFan((alpha) => ringPoint(1, alpha), true)) tris.push(t);

    // The winding built up above is internally consistent (watertight) but
    // was flipped inward-out relative to the outward-normal convention used
    // elsewhere in this file; flip every triangle to correct it.
    return tris.map((t) => [t[0], t[2], t[1]]);
  }

  // ---- axis-aligned box (used for the base plate) ------------------------

  function boxMesh(minX, minY, minZ, maxX, maxY, maxZ) {
    const p = [
      [minX, minY, minZ], [maxX, minY, minZ], [maxX, maxY, minZ], [minX, maxY, minZ], // bottom 0-3
      [minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ], // top 4-7
    ];
    const tris = [];
    function quad(a, b, c, d) { // CCW seen from outside
      tris.push([p[a], p[b], p[c]]);
      tris.push([p[a], p[c], p[d]]);
    }
    quad(0, 3, 2, 1); // bottom, normal -Z
    quad(4, 5, 6, 7); // top, normal +Z
    quad(0, 1, 5, 4); // -Y side
    quad(1, 2, 6, 5); // +X side
    quad(2, 3, 7, 6); // +Y side
    quad(3, 0, 4, 7); // -X side
    return tris;
  }

  // ---- full sphere / full cylinder (for "true 3D" mode) ------------------

  function sphereMesh(cx, cy, cz, r, segsU, segsV) {
    segsU = segsU || 24;
    segsV = segsV || 16;
    const tris = [];
    function vert(j, i) {
      const phi = (j / segsV) * Math.PI; // 0 (top pole) .. PI (bottom pole)
      const theta = (i / segsU) * (Math.PI * 2);
      const ringR = r * Math.sin(phi);
      const z = r * Math.cos(phi);
      return [cx + ringR * Math.cos(theta), cy + ringR * Math.sin(theta), cz + z];
    }
    for (let j = 0; j < segsV; j++) {
      for (let i = 0; i < segsU; i++) {
        const i2 = (i + 1) % segsU;
        const v00 = vert(j, i), v01 = vert(j, i2);
        const v10 = vert(j + 1, i), v11 = vert(j + 1, i2);
        if (j === 0) {
          tris.push([v00, v10, v11]);
        } else if (j === segsV - 1) {
          tris.push([v00, v10, v01]);
        } else {
          tris.push([v00, v10, v11]);
          tris.push([v00, v11, v01]);
        }
      }
    }
    return tris;
  }

  function cylinderMesh(ax, ay, az, bx, by, bz, r, segs) {
    segs = segs || 20;
    const dir = normalize([bx - ax, by - ay, bz - az]);
    // build an arbitrary orthonormal basis (u,v) perpendicular to dir
    let arbitrary = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = normalize(cross(arbitrary, dir));
    const v = cross(dir, u);
    function ring(t, k) {
      const theta = (k / segs) * Math.PI * 2;
      const c = Math.cos(theta) * r, s = Math.sin(theta) * r;
      return [
        ax + (bx - ax) * t + u[0] * c + v[0] * s,
        ay + (by - ay) * t + u[1] * c + v[1] * s,
        az + (bz - az) * t + u[2] * c + v[2] * s,
      ];
    }
    const tris = [];
    for (let k = 0; k < segs; k++) {
      const k2 = (k + 1) % segs;
      const p00 = ring(0, k), p01 = ring(0, k2);
      const p10 = ring(1, k), p11 = ring(1, k2);
      tris.push([p00, p10, p11]);
      tris.push([p00, p11, p01]);
    }
    const c0 = [ax, ay, az], c1 = [bx, by, bz];
    for (let k = 0; k < segs; k++) {
      const k2 = (k + 1) % segs;
      tris.push([c0, ring(0, k), ring(0, k2)]);
      tris.push([c1, ring(1, k2), ring(1, k)]);
    }
    return tris.map((t) => [t[0], t[2], t[1]]);
  }

  // ---- diagnostics (used by tests, harmless to ship) ---------------------

  // Signed volume via divergence theorem: sum over triangles of
  // dot(v0, cross(v1,v2))/6. Positive if winding is consistently outward.
  function signedVolume(tris) {
    let vol = 0;
    for (const [a, b, c] of tris) {
      vol += dot(a, cross(b, c));
    }
    return vol / 6;
  }

  // Checks that every directed edge (a->b) has a matching opposite (b->a)
  // exactly once, which is the standard closed/watertight-mesh invariant.
  function checkManifold(tris, eps) {
    eps = eps || 1e-6;
    function key(p) {
      return [Math.round(p[0] / eps), Math.round(p[1] / eps), Math.round(p[2] / eps)].join(",");
    }
    const edges = new Map(); // "a|b" -> count
    for (const tri of tris) {
      for (let i = 0; i < 3; i++) {
        const p0 = tri[i], p1 = tri[(i + 1) % 3];
        const k = key(p0) + "|" + key(p1);
        edges.set(k, (edges.get(k) || 0) + 1);
      }
    }
    const problems = [];
    for (const [k, count] of edges) {
      if (count !== 1) { problems.push({ edge: k, count }); continue; }
      const [a, b] = k.split("|");
      const opposite = b + "|" + a;
      if (!edges.has(opposite)) problems.push({ edge: k, missingOpposite: true });
    }
    return { ok: problems.length === 0, problems };
  }

  const MeshGen = {
    hemisphereMesh,
    halfCylinderMesh,
    boxMesh,
    sphereMesh,
    cylinderMesh,
    signedVolume,
    checkManifold,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = MeshGen;
  } else {
    root.MeshGen = MeshGen;
  }
})(typeof window !== "undefined" ? window : globalThis);
