// stlexport.js
// Converts a flat list of triangles (each [[x,y,z],[x,y,z],[x,y,z]], CCW
// winding = outward normal) into a binary STL file (ArrayBuffer / Uint8Array).
// No dependencies. Works in Node (module.exports) and in the browser
// (window.STLExport) via a plain <script> tag.

(function (root) {
  "use strict";

  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function normalize(a) {
    const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }

  // triangles: array of [ [x,y,z], [x,y,z], [x,y,z] ]
  // returns a Uint8Array containing a valid binary STL file.
  function trianglesToBinarySTL(triangles, headerText) {
    const triCount = triangles.length;
    const bufSize = 80 + 4 + triCount * 50;
    const buf = new ArrayBuffer(bufSize);
    const view = new DataView(buf);

    const header = (headerText || "ggb2stl").slice(0, 79);
    for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i));

    view.setUint32(80, triCount, true);

    let offset = 84;
    let degenerateSkipped = 0;
    for (const tri of triangles) {
      const [v0, v1, v2] = tri;
      const n = normalize(cross(sub(v1, v0), sub(v2, v0)));
      if (!isFinite(n[0]) || !isFinite(n[1]) || !isFinite(n[2])) {
        // zero-area triangle; write a zero normal (still valid STL, slicers
        // ignore/skip degenerate facets) rather than crash on NaN.
        degenerateSkipped++;
      }
      view.setFloat32(offset, isFinite(n[0]) ? n[0] : 0, true); offset += 4;
      view.setFloat32(offset, isFinite(n[1]) ? n[1] : 0, true); offset += 4;
      view.setFloat32(offset, isFinite(n[2]) ? n[2] : 0, true); offset += 4;
      for (const v of [v0, v1, v2]) {
        view.setFloat32(offset, v[0], true); offset += 4;
        view.setFloat32(offset, v[1], true); offset += 4;
        view.setFloat32(offset, v[2], true); offset += 4;
      }
      view.setUint16(offset, 0, true); offset += 2; // attribute byte count
    }

    return { bytes: new Uint8Array(buf), degenerateSkipped };
  }

  const STLExport = { trianglesToBinarySTL };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = STLExport;
  } else {
    root.STLExport = STLExport;
  }
})(typeof window !== "undefined" ? window : globalThis);
