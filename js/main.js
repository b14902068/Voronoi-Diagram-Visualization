/**
 * js/main.js — 協調層
 * 功能：① 數量輸入生成點  ② 逐步動畫  ③ 拖曳（限速）
 */
'use strict';

/* ═══ 常數 ════════════════════════════════════════════════════ */
const MAX_DRAG_VEL = 18; // px/frame，拖曳最大速度

/**
 * _animMs() — 根據速度 slider 動態回傳動畫時間（ms）
 * slider 值 1（慢）~ 10（快），每次 tick 即時讀取，mid-animation 也可生效
 */
function _animMs() {
  const v = parseInt(document.getElementById('slider-speed')?.value ?? 5);
  // speed factor：slider=1 最慢(factor=10)，slider=10 最快(factor=1)
  const f = 11 - v;
  return {
    bisect: f * 40,    // 40ms (fast) ~ 400ms (slow)
    cell:   f * 60,    // 60ms ~ 600ms
    flash:  f * 45,    // 45ms ~ 450ms
  };
}

/* ═══ State ════════════════════════════════════════════════════ */
const State = {
  data:        null,    // 最新 VoronoiData
  mode:        'IDLE',  // IDLE | BUILDING | DRAGGING
  showLabels:  true,
  showVertices:false,

  // 動畫狀態
  anim: {
    stepIdx:         0,
    phase:           'site',
    bisectIdx:       0,
    timer:           null,
    completed:       new Set(),
    activeBisectors: [],
    paused:          false,   // ← 暫停旗標
  },

  // 拖曳狀態
  drag: {
    idx:     -1,
    targetX: 0,
    targetY: 0,
    rafId:   null,
  },
};

/* ═══ DOM ═══════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const DOM = {
  canvas:        $('voronoi-canvas'),
  wrap:          $('canvas-wrap'),
  tooltip:       $('tooltip'),
  tipName:       $('tip-name'),
  tipArea:       $('tip-area'),
  tipNeighbors:  $('tip-neighbors'),
  statPoints:    $('stat-points'),
  statMode:      $('stat-mode'),
  inputCount:    $('input-count'),
  btnGenerate:   $('btn-generate'),
  btnRelax:      $('btn-relax'),
  btnLabels:     $('btn-labels'),
  lblLabelBadge: $('lbl-label-badge'),
  btnVertices:   $('btn-vertices'),
  lblVertBadge:  $('lbl-vert-badge'),
  legend:        $('legend'),
  animProgress:  $('anim-progress'),
  animBar:       $('anim-bar'),
  btnPause:      $('btn-pause'),
  btnSkip:       $('btn-skip'),
  sliderSpeed:   $('slider-speed'),
  lblSpeed:      $('lbl-speed'),
  lblSpeedText:  $('lbl-speed-text'),
};

/* ═══ 格式化 ══════════════════════════════════════════════════ */
const fmt = {
  area: n => n.toFixed(0) + ' px²',
};

/* ═══ Recompute & Draw ════════════════════════════════════════ */
let _rafId = null;
function scheduleDraw(opts) {
  if (_rafId) return;
  _rafId = requestAnimationFrame(() => {
    _rafId = null;
    if (State.data) Renderer.draw(State.data, opts || _buildDrawOpts());
  });
}

function _buildDrawOpts() {
  if (State.mode === 'BUILDING') {
    return {
      showVertices:   State.showVertices,
      completedIndices: State.anim.completed,
    };
  }
  return { showVertices: State.showVertices };
}

function recompute(points) {
  const { width, height } = Renderer.getSize();
  State.data = VoronoiCalculator.compute(points, width, height);
  DOM.statPoints.textContent = points.length;
}

/* ═══ 閒置脈衝循環（讓 site 在 IDLE 時持續脈衝）══════════════ */
let _idleLoopId = null;
function _startIdleLoop() {
  if (_idleLoopId) return;
  function loop() {
    if (State.mode !== 'IDLE' || !State.data) { _idleLoopId = null; return; }
    Renderer.draw(State.data, { showVertices: State.showVertices });
    _idleLoopId = requestAnimationFrame(loop);
  }
  _idleLoopId = requestAnimationFrame(loop);
}
function _stopIdleLoop() {
  cancelAnimationFrame(_idleLoopId);
  _idleLoopId = null;
}

/* ═══ 動畫 ════════════════════════════════════════════════════ */
function startBuildAnimation() {
  _stopAnim();
  _stopIdleLoop();
  State.mode = 'BUILDING';
  State.anim.paused = false;
  DOM.statMode.textContent = '建構中';
  DOM.animProgress.style.display = 'flex';
  _updatePauseBtn();

  const anim = State.anim;
  anim.stepIdx         = 0;
  anim.bisectIdx       = 0;
  anim.phase           = 'site';
  anim.completed       = new Set();
  anim.activeBisectors = [];

  _animTick();
}

function _animTick() {
  if (State.anim.paused) return; // 暫停中，不繼續
  const anim  = State.anim;
  const steps = State.data.animSteps;
  if (!steps || anim.stepIdx >= steps.length) {
    _finishAnim();
    return;
  }

  // 更新進度條
  const pct = (anim.stepIdx / steps.length) * 100;
  DOM.animBar.style.width = pct + '%';

  const step = steps[anim.stepIdx];

  const ms = _animMs(); // 每 tick 即時讀取速度

  if (anim.phase === 'site') {
    // ── 閃爍 site ──
    Renderer.flashCell(step.siteIndex, step.site.color, ms.flash);
    scheduleDraw();
    anim.phase     = 'bisector';
    anim.bisectIdx = 0;
    anim.timer = setTimeout(_animTick, ms.flash);

  } else if (anim.phase === 'bisector') {
    // ── 逐條畫中垂線 ──
    const bisectors = step.bisectors;
    if (anim.bisectIdx < bisectors.length) {
      const b = bisectors[anim.bisectIdx];
      anim.activeBisectors.push(b);
      _drawBuildFrame(step, anim.activeBisectors, b);
      anim.bisectIdx++;
      anim.timer = setTimeout(_animTick, ms.bisect);
    } else {
      anim.phase = 'cell';
      _animTick();
    }

  } else if (anim.phase === 'cell') {
    // ── 填色當前 cell，閃爍，進入下一個 ──
    anim.completed.add(step.siteIndex);
    Renderer.flashCell(step.siteIndex, step.site.color, ms.cell);
    scheduleDraw();
    anim.stepIdx++;
    anim.bisectIdx = 0;
    anim.phase     = 'site';
    anim.activeBisectors = [];
    anim.timer = setTimeout(_animTick, ms.cell + 30);
  }
}

function _drawBuildFrame(step, bisectors, latestBisector) {
  // 重繪背景（已完成的 cells）
  Renderer.draw(State.data, {
    showVertices:    State.showVertices,
    completedIndices: State.anim.completed,
  });

  // 畫出正在被中垂線切割的當前大範圍多邊形
  if (latestBisector && latestBisector.currPoly) {
    Renderer.drawAnimPoly(latestBisector.currPoly, step.site.color);
  }

  // 畫已累積的中垂線（暗色）
  bisectors.forEach((b, i) => {
    const isLatest = b === latestBisector;
    Renderer.drawSiteLink(b.bisector.siteA, b.bisector.siteB, isLatest ? 0.8 : 0.3);
    Renderer.drawBisector(b, isLatest ? 1.0 : 0.4, isLatest);
  });
}

function _finishAnim() {
  State.mode = 'IDLE';
  State.anim.paused    = false;
  State.anim.completed = new Set(State.data.points.map((_, i) => i));
  DOM.statMode.textContent = '完成';
  DOM.animBar.style.width  = '100%';
  _updatePauseBtn();
  setTimeout(() => { DOM.animProgress.style.display = 'none'; }, 800);
  scheduleDraw();
  buildLegend();
  _startIdleLoop(); // 切回閒置脈衝
}

function togglePause() {
  if (State.mode !== 'BUILDING') return;
  State.anim.paused = !State.anim.paused;
  DOM.statMode.textContent = State.anim.paused ? '暫停' : '建構中';
  _updatePauseBtn();
  if (!State.anim.paused) _animTick(); // 繼續
}

function _updatePauseBtn() {
  if (!DOM.btnPause) return;
  const paused = State.anim.paused;
  DOM.btnPause.textContent = paused ? '▶ 繼續' : '⏸ 暫停';
  DOM.btnPause.classList.toggle('btn-paused', paused);
}

function _stopAnim() {
  clearTimeout(State.anim.timer);
  State.anim.timer = null;
}

/* ═══ 拖曳（限速物理）══════════════════════════════════════════ */
function _startDrag(idx, x, y) {
  if (State.mode === 'BUILDING') return;
  State.mode = 'DRAGGING';
  State.drag.idx     = idx;
  State.drag.targetX = x;
  State.drag.targetY = y;
  Renderer.setDragged(idx);
  DOM.statMode.textContent = '拖曳中';
  _dragLoop();
}

function _dragLoop() {
  const d = State.drag;
  if (d.idx < 0) return;

  const pt = State.data.points[d.idx];

  // 限速：每幀最多移動 MAX_DRAG_VEL px
  const dx   = d.targetX - pt.x;
  const dy   = d.targetY - pt.y;
  const dist = Math.hypot(dx, dy);
  const step = Math.min(dist, MAX_DRAG_VEL);

  if (dist > 0.5) {
    const ratio = step / dist;
    pt.x += dx * ratio;
    pt.y += dy * ratio;
    recompute(State.data.points);
    scheduleDraw();
  }

  d.rafId = requestAnimationFrame(_dragLoop);
}

function _endDrag() {
  cancelAnimationFrame(State.drag.rafId);
  State.drag.idx  = -1;
  State.mode      = 'IDLE';
  Renderer.setDragged(-1);
  DOM.statMode.textContent = '閒置';
  buildLegend();
  _startIdleLoop();
}

/* ═══ Canvas 事件 ════════════════════════════════════════════ */
DOM.canvas.addEventListener('mousemove', e => {
  const r  = DOM.canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;

  // 更新拖曳目標
  if (State.mode === 'DRAGGING') {
    State.drag.targetX = mx;
    State.drag.targetY = my;
    return;
  }

  // Hover（Quadtree O(log n)）
  const idx = Renderer.findNearest(State.data, mx, my);
  if (idx !== undefined && idx >= 0) {
    Renderer.setHovered(idx);
    _showTooltip(idx, mx, my);
    scheduleDraw();
  }
});

DOM.canvas.addEventListener('mouseleave', () => {
  if (State.mode === 'DRAGGING') return;
  Renderer.setHovered(-1);
  _hideTooltip();
  scheduleDraw();
});

DOM.canvas.addEventListener('mousedown', e => {
  const r   = DOM.canvas.getBoundingClientRect();
  const mx  = e.clientX - r.left;
  const my  = e.clientY - r.top;
  const idx = Renderer.findNearest(State.data, mx, my);
  if (idx < 0 || !State.data) return;

  const pt   = State.data.points[idx];
  const dist = Math.hypot(mx - pt.x, my - pt.y);
  if (dist < 20) {      // 必須點在 site 附近才能拖
    _startDrag(idx, mx, my);
  }
});

DOM.canvas.addEventListener('mouseup', () => {
  if (State.mode === 'DRAGGING') _endDrag();
});

/* ═══ Tooltip ════════════════════════════════════════════════ */
function _showTooltip(idx, mx, my) {
  if (!State.data) return;
  const cell = State.data.cells[idx];
  const pt   = cell.site;

  DOM.tipName.textContent     = pt.name;
  DOM.tipName.style.color     = pt.color;
  DOM.tipArea.textContent     = fmt.area(cell.area);
  DOM.tipNeighbors.textContent= cell.neighborIndices.length + ' 個';

  const wrap  = DOM.wrap.getBoundingClientRect();
  const tipW  = 210;
  const left  = mx + 20 + tipW > wrap.width ? mx - tipW - 10 : mx + 20;
  DOM.tooltip.style.left = left + 'px';
  DOM.tooltip.style.top  = Math.min(my - 10, wrap.height - 120) + 'px';
  DOM.tooltip.classList.add('visible');
}

function _hideTooltip() {
  DOM.tooltip.classList.remove('visible');
}

/* ═══ Legend ═════════════════════════════════════════════════ */
function buildLegend() {
  DOM.legend.innerHTML = '';
  if (!State.data) return;
  State.data.points.forEach((pt, i) => {
    const div = document.createElement('div');
    div.className = 'legend-item';
    div.innerHTML = `
      <div class="legend-swatch" style="background:${pt.color}"></div>
      <span class="legend-name">${pt.name}</span>
      <span class="legend-pop">${State.data.cells[i].neighborIndices.length}鄰</span>`;
    div.addEventListener('mouseenter', () => { Renderer.setHovered(i); scheduleDraw(); });
    div.addEventListener('mouseleave', () => { Renderer.setHovered(-1); scheduleDraw(); });
    DOM.legend.appendChild(div);
  });
}

/* ═══ 控制按鈕 ═══════════════════════════════════════════════ */
DOM.btnGenerate.addEventListener('click', () => {
  _stopAnim();
  const n = Math.max(2, Math.min(200, parseInt(DOM.inputCount.value) || 10));
  DOM.inputCount.value = n;
  const { width, height } = Renderer.getSize();
  const pts = VoronoiCalculator.generateRandom(n, width, height);
  recompute(pts);
  buildLegend();        // ← 立刻同步圖例，不等動畫結束
  startBuildAnimation();
});

DOM.btnRelax.addEventListener('click', () => {
  if (!State.data || State.mode === 'BUILDING') return;
  State.data = VoronoiCalculator.lloydRelax(State.data);
  scheduleDraw();
  buildLegend();
});

DOM.btnLabels.addEventListener('click', () => {
  State.showLabels = !State.showLabels;
  Renderer.setShowLabels(State.showLabels);
  DOM.lblLabelBadge.textContent = State.showLabels ? 'ON' : 'OFF';
  scheduleDraw();
});

DOM.btnVertices.addEventListener('click', () => {
  State.showVertices = !State.showVertices;
  DOM.lblVertBadge.textContent = State.showVertices ? 'ON' : 'OFF';
  scheduleDraw();
});

// ── 暫停/繼續/立刻完成 ────────────────────────────────────────────────
DOM.btnPause.addEventListener('click', togglePause);
DOM.btnSkip.addEventListener('click', () => {
  if (State.mode !== 'BUILDING') return;
  _stopAnim();
  _finishAnim();
});

// 空白鍵快捷鍵
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    togglePause();
  }
});

// ── 動畫速度 slider ────────────────────────────────────────────
const _speedLabels = { 1:'極慢', 2:'很慢', 3:'慢', 4:'偏慢', 5:'正常', 6:'偏快', 7:'快', 8:'很快', 9:'極快', 10:'最快' };
DOM.sliderSpeed.addEventListener('input', function () {
  const v = +this.value;
  DOM.lblSpeed.textContent     = v;
  DOM.lblSpeedText.textContent = _speedLabels[v] ?? '';
  // 不需要重繪——下次 _animTick() 會自動讀取新速度
});

window.addEventListener('resize', () => {
  Renderer.resize();
  if (State.data) recompute(State.data.points);
  scheduleDraw();
});

/* ═══ Init ════════════════════════════════════════════════════ */
(function init() {
  Renderer.init(DOM.canvas);
  Renderer.setShowLabels(State.showLabels);
  DOM.statMode.textContent = '閒置';
  _updatePauseBtn();

  const { width, height } = Renderer.getSize();
  const pts = VoronoiCalculator.generateRandom(12, width, height);
  recompute(pts);
  startBuildAnimation();

  console.log('%c[Voronoi] 初始化完成', 'color:#5b8dee;font-weight:bold');
})();
