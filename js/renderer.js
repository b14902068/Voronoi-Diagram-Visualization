/**
 * js/renderer.js — 渲染層（強化視覺版）
 * 支援：IDLE 脈衝、BUILDING 動畫、DRAGGING 高亮
 */
'use strict';

const Renderer = (() => {

  let _canvas, _ctx, _dpr = 1, _W = 0, _H = 0;
  let _hoveredIdx = -1;
  let _draggedIdx = -1;
  let _showLabels = true;
  let _flashCells = new Map(); // index → { color, start, duration }

  // ── Init / Resize ────────────────────────────────────────────
  function init(canvas) {
    _canvas = canvas;
    _ctx    = canvas.getContext('2d');
    _dpr    = window.devicePixelRatio || 1;
    _resize();
  }

  function _resize() {
    const rect = _canvas.parentElement.getBoundingClientRect();
    _W = rect.width; _H = rect.height;
    _canvas.width  = Math.round(_W * _dpr);
    _canvas.height = Math.round(_H * _dpr);
    _canvas.style.width  = _W + 'px';
    _canvas.style.height = _H + 'px';
    _ctx.scale(_dpr, _dpr);
  }

  function resize() { _resize(); }
  function getSize() { return { width: _W, height: _H }; }

  // ── Flash 效果 ───────────────────────────────────────────────
  function flashCell(index, color, duration = 350) {
    _flashCells.set(index, { color, start: performance.now(), duration });
  }

  function _getFlashAlpha(index) {
    if (!_flashCells.has(index)) return 0;
    const f = _flashCells.get(index);
    const t = (performance.now() - f.start) / f.duration;
    if (t >= 1) { _flashCells.delete(index); return 0; }
    return Math.sin(t * Math.PI) * 0.88; // 更強烈的閃爍
  }

  // ── 主繪製 ───────────────────────────────────────────────────
  function draw(data, opts = {}) {
    if (!data) return;
    const ctx = _ctx;
    ctx.clearRect(0, 0, _W, _H);

    const { points, voronoi, cells } = data;
    const highlightSet = opts.highlightIndices || null;
    const completedSet = opts.completedIndices || null;
    const now = performance.now() / 1000; // seconds（用於脈衝動畫）

    // ① Cell 填色（Radial Gradient 從中心向外）
    cells.forEach((cell, i) => {
      const poly = cell.polygon;
      if (!poly || poly.length < 2) return;

      const isHovered   = i === _hoveredIdx;
      const isDragged   = i === _draggedIdx;
      const isHighlight = highlightSet && highlightSet.has(i);
      const isComplete  = !completedSet || completedSet.has(i);
      const flashAlpha  = _getFlashAlpha(i);
      const pt          = points[i];

      let baseAlpha = 0.18;
      if      (isDragged)   baseAlpha = 0.62;
      else if (isHovered)   baseAlpha = 0.52;
      else if (isHighlight) baseAlpha = 0.56;
      else if (!isComplete) baseAlpha = 0.04;

      const totalAlpha = Math.min(1, baseAlpha + flashAlpha);

      // Radial gradient：中心較亮，邊緣漸暗
      const cx = cell.centroid.x, cy = cell.centroid.y;
      const maxR = Math.max(
        ...poly.map(([px, py]) => Math.hypot(px - cx, py - cy)),
        30
      );
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
      grad.addColorStop(0,   _rgba(pt.color, totalAlpha * 1.4));
      grad.addColorStop(0.5, _rgba(pt.color, totalAlpha));
      grad.addColorStop(1,   _rgba(pt.color, totalAlpha * 0.35));

      ctx.beginPath();
      voronoi.renderCell(i, ctx);
      ctx.fillStyle = grad;
      ctx.fill();
    });

    // ② Cell 邊界線（hover/drag 加 shadow glow）
    cells.forEach((cell, i) => {
      const isComplete = !completedSet || completedSet.has(i);
      if (!isComplete) return; // 處理過後（或非動畫狀態）才畫最終邊界

      const isActive = i === _hoveredIdx || i === _draggedIdx;
      ctx.beginPath();
      voronoi.renderCell(i, ctx);

      if (isActive) {
        ctx.shadowColor = points[i].color;
        ctx.shadowBlur  = 18;
        ctx.strokeStyle = _rgba(points[i].color, 1);
        ctx.lineWidth   = 3;
      } else {
        ctx.shadowBlur  = 0;
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth   = 1;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    });

    // ③ Voronoi 頂點（交點）：帶光暈
    if (opts.showVertices) {
      data.vertices.forEach(v => {
        // 外圈光暈
        const g = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, 8);
        g.addColorStop(0, 'rgba(255,255,255,0.6)');
        g.addColorStop(1, 'transparent');
        ctx.beginPath(); ctx.arc(v.x, v.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = g; ctx.fill();
        // 中心點
        ctx.beginPath(); ctx.arc(v.x, v.y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
      });
    }

    // ④ Sites（生成點）：時基脈衝動畫
    points.forEach((pt, i) => {
      const isActive  = i === _hoveredIdx || i === _draggedIdx;
      const flashAlp  = _getFlashAlpha(i);
      _drawSite(ctx, pt, isActive, flashAlp, now);
    });

    // ⑤ 標籤（hover 時放大 + 加 glow）
    if (_showLabels) {
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      points.forEach((pt, i) => {
        const isActive = i === _hoveredIdx || i === _draggedIdx;
        const size     = isActive ? 13 : 11;
        ctx.font = `${isActive ? 700 : 600} ${size}px Inter, sans-serif`;

        if (isActive) {
          ctx.shadowColor = pt.color;
          ctx.shadowBlur  = 10;
        }
        // 深色陰影底
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillText(pt.name, pt.x + 1, pt.y + 15);
        // 正式文字
        ctx.fillStyle = isActive ? '#fff' : '#ccd5ea';
        ctx.fillText(pt.name, pt.x, pt.y + 14);
        ctx.shadowBlur = 0;
      });
    }
  }

  // ── 單個 site 繪製（三層光暈 + 時基脈衝環）──────────────────
  function _drawSite(ctx, pt, isActive, flashAlpha, now) {
    const { x, y, color } = pt;
    const pulse = (Math.sin(now * 2.2) * 0.5 + 0.5); // 0~1 緩慢脈衝

    // 層 1：最外層脈衝光暈
    const pulseR = (isActive ? 28 : 20) + pulse * 8;
    const g1 = ctx.createRadialGradient(x, y, 0, x, y, pulseR);
    g1.addColorStop(0,   _rgba(color, (isActive ? 0.35 : 0.18) + flashAlpha * 0.2));
    g1.addColorStop(0.5, _rgba(color, (isActive ? 0.15 : 0.07)));
    g1.addColorStop(1,   'transparent');
    ctx.beginPath(); ctx.arc(x, y, pulseR, 0, Math.PI * 2);
    ctx.fillStyle = g1; ctx.fill();

    // 層 2：脈衝外環（描邊）
    ctx.beginPath();
    ctx.arc(x, y, (isActive ? 14 : 10) + pulse * 4, 0, Math.PI * 2);
    ctx.strokeStyle = _rgba(color, 0.25 + pulse * 0.2);
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // 層 3：固定中環（帶 shadow）
    const midR = isActive ? 9 : 6.5;
    if (isActive || flashAlpha > 0.1) {
      ctx.shadowColor = color;
      ctx.shadowBlur  = isActive ? 20 : 12;
    }
    ctx.beginPath(); ctx.arc(x, y, midR, 0, Math.PI * 2);
    ctx.strokeStyle = _rgba(color, isActive ? 1 : 0.82);
    ctx.lineWidth   = isActive ? 2.5 : 2;
    ctx.stroke();
    ctx.shadowBlur  = 0;

    // 層 4：白色核心 + 彩色小點
    ctx.beginPath(); ctx.arc(x, y, isActive ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, isActive ? 2.5 : 1.5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
  }

  // ── 中垂線（3 層光暈 + 十字中點標記）──────────────────────────
  function drawBisector(edge, alpha = 1.0, glowing = false) {
    const ctx = _ctx;
    const { from, to, bisector } = edge;

    if (glowing) {
      // 層 1：最外層漫射光暈（寬）
      ctx.beginPath();
      ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = `rgba(160,210,255,${alpha * 0.10})`;
      ctx.lineWidth   = 22; ctx.lineCap = 'round'; ctx.stroke();

      // 層 2：中層光暈
      ctx.beginPath();
      ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = `rgba(200,230,255,${alpha * 0.25})`;
      ctx.lineWidth   = 8; ctx.stroke();
    }

    // 層 3：核心線（帶顏色）
    ctx.beginPath();
    ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
    if (glowing) {
      ctx.shadowColor = 'rgba(180,220,255,0.9)';
      ctx.shadowBlur  = 8;
    }
    ctx.strokeStyle = glowing
      ? `rgba(190,225,255,${alpha})`
      : `rgba(255,255,255,${alpha * 0.45})`;
    ctx.lineWidth   = glowing ? 2.5 : 1;
    ctx.lineCap     = 'round'; ctx.stroke();
    ctx.shadowBlur  = 0;

    // 中點十字 + 光暈
    if (bisector && glowing) {
      const { midpoint } = bisector;

      // 外光暈
      const mg = ctx.createRadialGradient(midpoint.x, midpoint.y, 0, midpoint.x, midpoint.y, 16);
      mg.addColorStop(0, `rgba(255,255,160,${alpha * 0.9})`);
      mg.addColorStop(1, 'transparent');
      ctx.beginPath(); ctx.arc(midpoint.x, midpoint.y, 16, 0, Math.PI * 2);
      ctx.fillStyle = mg; ctx.fill();

      // 十字線
      const d = 9;
      ctx.beginPath();
      ctx.moveTo(midpoint.x - d, midpoint.y); ctx.lineTo(midpoint.x + d, midpoint.y);
      ctx.moveTo(midpoint.x, midpoint.y - d); ctx.lineTo(midpoint.x, midpoint.y + d);
      ctx.strokeStyle = `rgba(255,255,150,${alpha * 0.85})`;
      ctx.lineWidth   = 1.5; ctx.stroke();

      // 核心圓點
      ctx.beginPath(); ctx.arc(midpoint.x, midpoint.y, 4, 0, Math.PI * 2);
      ctx.fillStyle   = `rgba(255,255,180,${alpha})`;
      ctx.shadowColor = 'rgba(255,255,100,0.9)';
      ctx.shadowBlur  = 10;
      ctx.fill();
      ctx.shadowBlur  = 0;
    }
  }

  // ── 兩 site 連線（動畫用虛線）─────────────────────────────────
  function drawSiteLink(siteA, siteB, alpha) {
    const ctx = _ctx;
    ctx.beginPath();
    ctx.setLineDash([6, 5]);
    ctx.moveTo(siteA.x, siteA.y);
    ctx.lineTo(siteB.x, siteB.y);
    ctx.strokeStyle = `rgba(255,230,80,${alpha * 0.65})`;
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── Cell 填色（動畫完成閃光）──────────────────────────────────
  function drawCellFill(data, idx, alpha) {
    const ctx   = _ctx;
    const color = data.points[idx].color;
    ctx.beginPath();
    data.voronoi.renderCell(idx, ctx);
    ctx.fillStyle   = _rgba(color, alpha);
    ctx.shadowColor = color;
    ctx.shadowBlur  = 20;
    ctx.fill();
    ctx.strokeStyle = _rgba(color, Math.min(1, alpha * 1.8));
    ctx.lineWidth   = 2.5; ctx.stroke();
    ctx.shadowBlur  = 0;
  }

  // ── 動畫專用：繪製切割中的多邊形 ──────────────────────────────────
  function drawAnimPoly(poly, color) {
    if (!poly || poly.length < 3) return;
    const ctx = _ctx;
    ctx.beginPath();
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i][0], poly[i][1]);
    }
    ctx.closePath();
    ctx.fillStyle = _rgba(color, 0.45);
    ctx.fill();
    ctx.strokeStyle = _rgba(color, 0.9);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ── Quadtree 最近點（O(log n)）───────────────────────────────
  function findNearest(data, mx, my) {
    if (!data) return -1;
    return data.delaunay.find(mx, my);
  }

  // ── Setters ──────────────────────────────────────────────────
  function setHovered(idx)    { _hoveredIdx = idx; }
  function setDragged(idx)    { _draggedIdx = idx; }
  function setShowLabels(val) { _showLabels = val; }

  // ── 工具：hex → rgba ─────────────────────────────────────────
  function _rgba(hex, a) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${Math.max(0,Math.min(1,a))})`;
  }

  return {
    init, resize, getSize,
    draw, drawBisector, drawCellFill, drawSiteLink, drawAnimPoly,
    flashCell,
    findNearest, setHovered, setDragged, setShowLabels,
  };
})();
