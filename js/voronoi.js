/**
 * js/voronoi.js — 計算層
 * 回傳完整結構化資料：sites、vertices、edges、bisectors、cells、animSteps
 */
'use strict';

const PALETTE = [
  '#5b8dee','#7c6fe8','#60a5fa','#34d399','#f59e0b','#fbbf24',
  '#a78bfa','#f472b6','#fb923c','#4ade80','#e879f9','#38bdf8',
  '#6ee7b7','#fda4af','#f87171','#c4b5fd','#67e8f9','#86efac',
  '#fdba74','#94a3b8','#fb7185','#22d3ee',
];

const VoronoiCalculator = (() => {

  // ── 生成 N 個隨機點 ──────────────────────────────────────────
  function generateRandom(n, width, height, margin = 40) {
    return Array.from({ length: n }, (_, i) => ({
      id:    'pt_' + i,
      name:  'P' + (i + 1),
      x:     margin + Math.random() * (width  - margin * 2),
      y:     margin + Math.random() * (height - margin * 2),
      color: PALETTE[i % PALETTE.length],
      vx: 0, vy: 0,   // 速度（拖曳用）
    }));
  }

  // ── 從 cell polygons 提取所有 Voronoi 邊段 ───────────────────
  function _extractEdges(points, voronoi) {
    const map = new Map();

    points.forEach((pt, i) => {
      const poly = voronoi.cellPolygon(i);
      if (!poly || poly.length < 2) return;
      const n = poly.length - 1; // closed polygon, first===last

      for (let k = 0; k < n; k++) {
        const [x0, y0] = poly[k];
        const [x1, y1] = poly[(k + 1) % n];
        const a = `${x0.toFixed(2)},${y0.toFixed(2)}`;
        const b = `${x1.toFixed(2)},${y1.toFixed(2)}`;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;

        if (map.has(key)) {
          const e = map.get(key);
          if (e.cellA !== i) e.cellB = i;
        } else {
          map.set(key, { from: { x: x0, y: y0 }, to: { x: x1, y: y1 }, cellA: i, cellB: -1 });
        }
      }
    });

    // 附加中垂線資訊
    return [...map.values()].map(edge => {
      if (edge.cellB < 0) return { ...edge, bisector: null };
      const sA = points[edge.cellA], sB = points[edge.cellB];
      const mx  = (sA.x + sB.x) / 2,  my  = (sA.y + sB.y) / 2;
      const len = Math.hypot(sB.x - sA.x, sB.y - sA.y) || 1;
      const ndx = (sB.x - sA.x) / len, ndy = (sB.y - sA.y) / len; // sA→sB 方向
      return {
        ...edge,
        bisector: {
          siteA:    { x: sA.x, y: sA.y, idx: edge.cellA },
          siteB:    { x: sB.x, y: sB.y, idx: edge.cellB },
          midpoint: { x: mx, y: my },
          // bisector 沿線方向（垂直於 sA→sB）
          direction: { dx: -ndy, dy:  ndx },
          // sA→sB 法線方向
          normal:    { dx:  ndx, dy:  ndy },
        },
      };
    });
  }

  // ── 主計算函式 ────────────────────────────────────────────────
  /**
   * compute(points, width, height)
   * @returns {{
   *   points, delaunay, voronoi,
   *   vertices:  Array<{x,y}>,          // 所有 Voronoi 交點（外接圓圓心）
   *   cells:     Array<CellData>,        // 每個 site 的完整資料
   *   edges:     Array<EdgeData>,        // 所有邊段（含中垂線資訊）
   *   siteEdges: Array<Array<EdgeData>>, // 每個 site 的相鄰邊段
   *   animSteps: Array<AnimStep>,        // 動畫用逐步資料
   * }}
   */
  function compute(points, width, height) {
    if (points.length < 1) return null;

    const delaunay = d3.Delaunay.from(points, d => d.x, d => d.y);
    const voronoi  = delaunay.voronoi([0, 0, width, height]);

    // ── Voronoi 交點（circumcenters）──
    const cc = voronoi.circumcenters;
    const vertices = [];
    for (let i = 0; i < cc.length; i += 2)
      vertices.push({ x: cc[i], y: cc[i + 1] });

    // ── Per-cell 資料 ──
    const cells = points.map((pt, i) => {
      const poly = voronoi.cellPolygon(i) || [];
      const area = poly.length > 2 ? Math.abs(d3.polygonArea(poly)) : 0;
      let cx = pt.x, cy = pt.y;
      if (poly.length > 2) { const c = d3.polygonCentroid(poly); cx = c[0]; cy = c[1]; }
      return {
        index:          i,
        site:           pt,
        polygon:        poly,          // [[x,y],...]，已閉合
        area,
        centroid:       { x: cx, y: cy },
        neighborIndices: [...delaunay.neighbors(i)],
      };
    });

    // ── Voronoi 邊段（含中垂線）──
    const edges = _extractEdges(points, voronoi);

    // ── Per-site 邊段快速查詢表 ──
    const siteEdges = points.map(() => []);
    edges.forEach(e => {
      siteEdges[e.cellA].push(e);
      if (e.cellB >= 0) siteEdges[e.cellB].push(e);
    });

    // ── 輔助函式：用中垂線切割多邊形（Sutherland-Hodgman 概念）──
    function clipPolygonByBisector(poly, siteA, siteB) {
      if (!poly || poly.length < 3) return poly;
      const result = [];
      const distSq = (p, s) => (p[0] - s.x) ** 2 + (p[1] - s.y) ** 2;
      const isInside = (p) => distSq(p, siteA) <= distSq(p, siteB) + 1e-9;

      const M = { x: (siteA.x + siteB.x) / 2, y: (siteA.y + siteB.y) / 2 };
      const V = { x: siteB.x - siteA.x, y: siteB.y - siteA.y };

      for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i];
        const p2 = poly[(i + 1) % poly.length];
        const in1 = isInside(p1);
        const in2 = isInside(p2);

        if (in1) result.push(p1);

        if (in1 !== in2) {
          const d1 = (p1[0] - M.x) * V.x + (p1[1] - M.y) * V.y;
          const d2 = (p2[0] - M.x) * V.x + (p2[1] - M.y) * V.y;
          const t = d1 / (d1 - d2);
          result.push([
            p1[0] + t * (p2[0] - p1[0]),
            p1[1] + t * (p2[1] - p1[1])
          ]);
        }
      }
      return result;
    }

    // ── 動畫序列：大範圍被中垂線慢慢切割 ──
    const animSteps = cells.map(cell => {
      const site = cell.site;
      let currentPoly = [[0, 0], [width, 0], [width, height], [0, height]];
      const bisectSteps = [];
      const ext = Math.max(width, height) * 2;

      cell.neighborIndices.forEach(nIdx => {
        const neighbor = points[nIdx];
        const M = { x: (site.x + neighbor.x) / 2, y: (site.y + neighbor.y) / 2 };
        const V = { x: neighbor.x - site.x, y: neighbor.y - site.y };
        const len = Math.hypot(V.x, V.y) || 1;
        const ndx = V.x / len, ndy = V.y / len;
        
        // 貫穿整個畫面的中垂線
        const lineStart = { x: M.x - ndy * ext, y: M.y + ndx * ext };
        const lineEnd   = { x: M.x + ndy * ext, y: M.y - ndx * ext };

        currentPoly = clipPolygonByBisector(currentPoly, site, neighbor);

        bisectSteps.push({
          neighborIndex: nIdx,
          neighborSite:  neighbor,
          bisector: {
            siteA: site, siteB: neighbor, midpoint: M,
            direction: { dx: -ndy, dy: ndx },
            normal: { dx: ndx, dy: ndy }
          },
          from: lineStart,
          to:   lineEnd,
          currPoly: [...currentPoly]
        });
      });

      return {
        siteIndex: cell.index,
        site:      cell.site,
        bisectors: bisectSteps,
        cell: {
          polygon: cell.polygon,
          color:   cell.site.color,
          area:    cell.area,
        },
      };
    });

    return { points, width, height, delaunay, voronoi, vertices, cells, edges, siteEdges, animSteps };
  }

  // ── Lloyd Relaxation（一步）────────────────────────────────────
  function lloydRelax(data) {
    const relaxed = data.points.map((pt, i) => {
      const poly = data.cells[i].polygon;
      if (!poly || poly.length < 3) return { ...pt };
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      return { ...pt,
        x: Math.max(0, Math.min(data.width,  cx)),
        y: Math.max(0, Math.min(data.height, cy)),
      };
    });
    return compute(relaxed, data.width, data.height);
  }

  // ── 面積計算（供 tooltip 用）──────────────────────────────────
  function polygonArea(polygon) {
    return polygon && polygon.length > 2 ? Math.abs(d3.polygonArea(polygon)) : 0;
  }

  return { generateRandom, compute, lloydRelax, polygonArea, PALETTE };
})();
