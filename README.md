# Voronoi Diagram Visualization

這是一個基於 HTML5 Canvas 與原生 JavaScript 開發的高互動性 Voronoi 圖（沃羅諾伊圖）視覺化工具。本專案不依賴後端伺服器，所有的幾何運算、介面互動與視覺特效皆在客戶端（瀏覽器）即時完成。

## 🌟 核心功能與實作技術對照

本專案將架構拆分為三個主要層級：**計算層 (`voronoi.js`)**、**渲染層 (`renderer.js`)** 與**協調層 (`main.js`)**，確保程式碼具備良好的可維護性。以下是各項功能的實作細節與對應技術：

### 1. Voronoi 核心幾何運算
* **達成技術**：使用 `D3.js` (`d3-delaunay`)
* **實作細節**：
  * 在 `voronoi.js` 中，透過 `d3.Delaunay.from(points)` 先建立 Delaunay 三角分割，再呼叫 `delaunay.voronoi()` 取得 Voronoi 圖形物件。
  * 提取 `voronoi.circumcenters` 來獲取 Voronoi 頂點（外接圓圓心），並透過 `voronoi.cellPolygon()` 取得每個區塊的多邊形頂點陣列，封裝成前端好讀取的結構化物件 `cells`、`edges` 與 `vertices`。

### 2. 逐步建構切割動畫 (由內向外擴散)
* **達成技術**：Sutherland-Hodgman 裁切概念 + JS 陣列排序 + `setTimeout` 狀態機
* **實作細節**：
  * 為了呈現「中垂線如何切出多邊形」的過程，`voronoi.js` 實作了 `clipPolygonByBisector`。它會把一張滿版畫布，根據與相鄰點的「中垂線（Bisector）」一刀一刀切出最終形狀，並記錄在 `animSteps` 陣列中。
  * 動畫順序透過計算控制點（Site）到**畫布中心點**的距離進行排序（由近到遠），讓視覺呈現如同漣漪般向外擴散。
  * `main.js` 利用 `setTimeout` 搭配 `State.anim` 狀態機來控制動畫的暫停、繼續與立刻完成（跳過動畫）。

### 3. 高效能視覺特效與渲染
* **達成技術**：HTML5 Canvas 2D API (`createRadialGradient`, `shadowBlur`)
* **實作細節**：
  * 所有的發光點、脈衝動畫與漸層填色皆寫在 `renderer.js`。
  * **發光效果**：大量利用 `ctx.shadowBlur` 與 `ctx.shadowColor` 製造出霓虹發光感（Glow Effect）。
  * **立體填色**：使用 `ctx.createRadialGradient` 從多邊形幾何中心向外輻射出帶有透明度（Alpha）的漸層色彩，讓細胞區塊有飽滿的立體感。
  * **閒置脈衝**：結合 `performance.now()` 與三角函數 `Math.sin()` 綁定在 `requestAnimationFrame` 迴圈中，實作無窮的平滑呼吸燈效果。

### 4. O(log N) 的高效滑鼠 Hover 偵測
* **達成技術**：Quadtree (四元樹 / KD-Tree 概念)
* **實作細節**：
  * 當滑鼠在畫布上移動時，不需要使用 O(N) 的迴圈檢查滑鼠離哪個控制點最近。
  * `renderer.js` 利用 `delaunay.find(mx, my)` 進行高效率的空間查找，即使畫面上點數多達 200 個，仍能保持極度順暢的 Hover 與 Tooltip 顯示。

### 5. 即時拖曳變形與物理限速
* **達成技術**：原生 DOM 事件 + Vector Math 限速 + `requestAnimationFrame`
* **實作細節**：
  * 滑鼠按壓拖曳時，觸發即時重新計算（Recompute）。
  * 為了避免滑鼠瞬間移動過快導致動畫閃爍破圖，`main.js` 實作了 `_dragLoop()`，利用向量數學算出兩點距離，並限制每幀最大移動速度（`MAX_DRAG_VEL = 18px`），讓拖曳點有「彈性跟隨」的流暢物理手感。

### 6. Lloyd Relaxation (細胞鬆弛演算法)
* **達成技術**：D3 多邊形重心計算 (`d3.polygonCentroid`)
* **實作細節**：
  * 按下「Lloyd Relaxation」按鈕時，`voronoi.js` 裡的 `lloydRelax()` 函式會計算每個多邊形目前的「幾何重心（Centroid）」。
  * 接著將控制點（Site）的座標強制移動到該重心位置，然後重新計算 Voronoi 圖形。反覆執行會讓所有多邊形趨近於完美的均勻蜂巢狀。

## 📂 專案結構

```text
Voronoi-Diagram-Visualization/
├── index.html        # UI 介面與畫布容器
├── css/
│   └── style.css     # 版面佈局、按鈕樣式與暗黑質感設計
└── js/
    ├── voronoi.js    # 計算層：負責 D3 運算、中垂線切割與動畫資料打包
    ├── renderer.js   # 渲染層：封裝 Canvas 的繪製指令與特效
    └── main.js       # 協調層：負責 DOM 事件監聽、拖曳邏輯與動畫時間軸
```

## 🚀 如何運行

這是一個完全靜態的前端專案，不需安裝任何 `npm` 套件即可運行。

1. Clone 或是下載此專案。
2. 使用任何本地伺服器（例如 VSCode 的 Live Server 擴充功能，或 Python 的 `python -m http.server`）將專案目錄啟動。
3. 在瀏覽器中打開 `index.html` 即可開始體驗。

> **注意**：因為安全性限制（CORS），若直接雙擊 `index.html` (使用 `file://` 協議) 可能會造成某些 ES6 Module 或是字型載入異常，強烈建議透過 Local Server 運行。
