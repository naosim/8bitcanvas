"use strict";
(() => {
  // src/util.ts
  function hexToRgba(hex, alpha = 1) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  function resizeCanvas(app) {
    const { canvas } = app;
    const container = app.document.getElementById("canvas-container");
    canvas.width = container.offsetWidth;
    canvas.height = container.offsetHeight;
  }
  function calcTextRectSize(text, font, lineHeight, ctx) {
    const lines = text.split("\n");
    ctx.font = font;
    return {
      width: lines.reduce((memo, line) => Math.max(memo, ctx.measureText(line).width), 0),
      height: lines.length * lineHeight
    };
  }
  function screenToWorld(point, state, canvas) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    return {
      x: (point.x - centerX - state.offset.x) / state.zoom,
      y: (point.y - centerY - state.offset.y) / state.zoom
    };
  }
  function worldToScreen(point, state, canvas) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    return {
      x: point.x * state.zoom + state.offset.x + centerX,
      y: point.y * state.zoom + state.offset.y + centerY
    };
  }
  function getRectEdgePoint(node, toNode) {
    const from = {
      x: node.x + node.width / 2,
      y: node.y + node.height / 2
    };
    const to = {
      x: toNode.x + toNode.width / 2,
      y: toNode.y + toNode.height / 2
    };
    if (node.type === "dot") {
      return { x: from.x, y: from.y };
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 0 && dy === 0) {
      return { x: from.x, y: from.y };
    }
    const tMin = 1e-4;
    let t = Infinity;
    if (dx !== 0) {
      const t1 = (node.x - from.x) / dx;
      const t2 = (node.x + node.width - from.x) / dx;
      if (t1 > tMin && t1 < 1) t = Math.min(t, t1);
      if (t2 > tMin && t2 < 1) t = Math.min(t, t2);
    }
    if (dy !== 0) {
      const t1 = (node.y - from.y) / dy;
      const t2 = (node.y + node.height - from.y) / dy;
      if (t1 > tMin && t1 < 1) t = Math.min(t, t1);
      if (t2 > tMin && t2 < 1) t = Math.min(t, t2);
    }
    return {
      x: from.x + dx * t,
      y: from.y + dy * t
    };
  }
  function pointToLineDistance(p, lineStart, lineEnd) {
    const A = p.x - lineStart.x;
    const B = p.y - lineStart.y;
    const C = lineEnd.x - lineStart.x;
    const D = lineEnd.y - lineStart.y;
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;
    let xx, yy;
    if (param < 0) {
      xx = lineStart.x;
      yy = lineStart.y;
    } else if (param > 1) {
      xx = lineEnd.x;
      yy = lineEnd.y;
    } else {
      xx = lineStart.x + param * C;
      yy = lineStart.y + param * D;
    }
    const dx = p.x - xx;
    const dy = p.y - yy;
    return Math.sqrt(dx * dx + dy * dy);
  }
  function findPaletteIndex(palettes, color) {
    if (!color) return 0;
    const idx = palettes.indexOf(color);
    return idx >= 0 ? idx : 0;
  }

  // src/app.ts
  var STORAGE_KEYS = {
    AUTOSAVE: "tinytidycanvas-autosave",
    DEV_MODE: "tinytidycanvas-dev"
  };
  var _app = {
    document,
    canvas: document.getElementById("canvas"),
    ctx: document.getElementById("canvas").getContext("2d"),
    fileInput: document.getElementById("file-input")
  };
  var HistoryManager = class {
    constructor(maxSize = 50) {
      this.history = [];
      this.historyIndex = -1;
      this.maxSize = maxSize;
    }
    save(state) {
      this.history = this.history.slice(0, this.historyIndex + 1);
      this.history.push(JSON.stringify({
        nodes: state.nodes,
        edges: state.edges,
        colorPalettes: state.colorPalettes
      }));
      this.historyIndex++;
      if (this.history.length > this.maxSize) {
        this.history.shift();
        this.historyIndex--;
      }
      const data = JSON.stringify({
        nodes: state.nodes,
        edges: state.edges,
        colorPalettes: state.colorPalettes
      });
      localStorage.setItem(STORAGE_KEYS.AUTOSAVE, data);
    }
    undo(state) {
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.restore(state);
        return true;
      }
      return false;
    }
    redo(state) {
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex++;
        this.restore(state);
        return true;
      }
      return false;
    }
    restore(state) {
      const data = JSON.parse(this.history[this.historyIndex]);
      state.nodes = data.nodes;
      state.edges = data.edges;
      if (data.colorPalettes) state.colorPalettes = data.colorPalettes;
      state.selectedNode = null;
      state.selectedEdge = null;
    }
    canUndo() {
      return this.historyIndex > 0;
    }
    canRedo() {
      return this.historyIndex < this.history.length - 1;
    }
  };
  var _state = {
    nodes: [],
    edges: [],
    selectedNode: null,
    selectedNodes: [],
    selectedEdge: null,
    lastSelectedNode: null,
    mode: "select",
    zoom: 1,
    offset: { x: 0, y: 0 },
    isDragging: false,
    isResizing: false,
    dragStart: { x: 0, y: 0 },
    resizeNode: null,
    resizeStart: null,
    resizeStartSize: null,
    dragOffset: { x: 0, y: 0 },
    historyManager: new HistoryManager(50),
    colorPalettes: [
      "#000000",
      "#888888",
      "#ffffff",
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#ffff00",
      "#00ffff"
    ],
    selectedPaletteIndex: 0,
    editingPaletteIndex: void 0,
    editingPaletteType: void 0
  };
  var context = { state: _state, app: _app };
  var HORIZONTAL_PADDING = 18;
  var VERTICAL_PADDING = 16;
  var LINE_HEIGHT = 18;
  var PIXEL_SIZE = 4;
  function resizeCanvasWithRender(app) {
    resizeCanvas(app);
    render();
  }
  function autoResizeNode(node, context2) {
    const { app } = context2;
    const { ctx } = app;
    if (!node.text) return;
    const { width, height } = calcTextRectSize(node.text, "14px 'DotGothic16'", LINE_HEIGHT, ctx);
    const minWidth = 80;
    const minHeight = 40;
    node.width = Math.max(minWidth, width + HORIZONTAL_PADDING);
    node.height = Math.max(minHeight, height + VERTICAL_PADDING);
  }
  function undo(state) {
    if (state.historyManager.undo(state)) {
      render();
    }
  }
  function redo(state) {
    if (state.historyManager.redo(state)) {
      render();
    }
  }
  function drawGrid(app, state) {
    const { ctx, canvas } = app;
    const gridSize = 32 * state.zoom;
    const offsetX = state.offset.x % gridSize;
    const offsetY = state.offset.y % gridSize;
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = offsetX; x < canvas.width; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
    }
    for (let y = offsetY; y < canvas.height; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();
    const origin = worldToScreen({ x: 0, y: 0 }, state, canvas);
    ctx.strokeStyle = "#666";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(origin.x, 0);
    ctx.lineTo(origin.x, canvas.height);
    ctx.moveTo(0, origin.y);
    ctx.lineTo(canvas.width, origin.y);
    ctx.stroke();
  }
  function snapToPixel(val, pixelSize) {
    return Math.round(val / pixelSize) * pixelSize;
  }
  function drawPixelRect(ctx, x, y, w, h, pixelSize, cornerSize = 0) {
    for (let px = 0; px < w; px += pixelSize) {
      if (cornerSize > 0 && (px < cornerSize || px >= w - cornerSize)) continue;
      ctx.fillRect(x + px, y, pixelSize, pixelSize);
      ctx.fillRect(x + px, y + h - pixelSize, pixelSize, pixelSize);
    }
    for (let py = pixelSize; py < h - pixelSize; py += pixelSize) {
      ctx.fillRect(x, y + py, pixelSize, pixelSize);
      ctx.fillRect(x + w - pixelSize, y + py, pixelSize, pixelSize);
    }
    if (cornerSize > 0) {
      ctx.fillRect(x + pixelSize, y + pixelSize, pixelSize, pixelSize);
      ctx.fillRect(x + w - pixelSize * 2, y + pixelSize, pixelSize, pixelSize);
      ctx.fillRect(x + pixelSize, y + h - pixelSize * 2, pixelSize, pixelSize);
      ctx.fillRect(x + w - pixelSize * 2, y + h - pixelSize * 2, pixelSize, pixelSize);
    }
  }
  function fillPixelRect(ctx, x, y, w, h, pixelSize, cornerSize = 0) {
    for (let py = 0; py < h; py += pixelSize) {
      for (let px = 0; px < w; px += pixelSize) {
        if (cornerSize > 0) {
          const skipCorner = px < cornerSize && py < cornerSize || px >= w - cornerSize && py < cornerSize || px < cornerSize && py >= h - cornerSize || px >= w - cornerSize && py >= h - cornerSize;
          if (skipCorner) continue;
        }
        ctx.fillRect(x + px, y + py, pixelSize, pixelSize);
      }
    }
  }
  function drawNode(node, context2) {
    const { state, app } = context2;
    const { ctx, canvas } = app;
    const pixelSize = PIXEL_SIZE * state.zoom;
    const pos = worldToScreen({ x: node.x, y: node.y }, state, canvas);
    let w = node.width * state.zoom;
    let h = node.height * state.zoom;
    w = snapToPixel(w, pixelSize) || pixelSize;
    h = snapToPixel(h, pixelSize) || pixelSize;
    const snappedX = snapToPixel(pos.x, pixelSize);
    const snappedY = snapToPixel(pos.y, pixelSize);
    const isSelected = state.selectedNode?.id === node.id || state.selectedNodes.includes(node);
    if (snappedX + w < 0 || snappedX > canvas.width || snappedY + h < 0 || snappedY > canvas.height) {
      return;
    }
    if (node.type === "text") {
      const bgHex = state.colorPalettes[node.bgPaletteIndex] || "#4444aa";
      const bgTransparent = node.bgTransparent;
      const strokeTransparent = node.strokeTransparent;
      if (!bgTransparent) {
        ctx.fillStyle = bgHex;
        fillPixelRect(ctx, snappedX, snappedY, w, h, pixelSize, pixelSize);
      }
      const strokeColor = isSelected ? "#ffff00" : "#ffffff";
      if (isSelected || !strokeTransparent) {
        ctx.fillStyle = strokeColor;
        drawPixelRect(ctx, snappedX, snappedY, w, h, pixelSize, pixelSize);
      }
      if (node.text && state.zoom > 0.3) {
        const lines = node.text.split("\n");
        const lineHeight = 18 * state.zoom;
        const align = node.textAlign || "left";
        const valign = node.textValign || "top";
        ctx.fillStyle = "#ffffff";
        ctx.font = `${14 * state.zoom}px 'DotGothic16'`;
        const verticalPadding = VERTICAL_PADDING * state.zoom;
        const verticalPaddingTop = verticalPadding / 2;
        const verticalPaddingBottom = verticalPadding / 2;
        const totalTextHeight = lines.length * lineHeight;
        const fontSize = 14 * state.zoom;
        const baselineOffset = fontSize * 0.75;
        let textY = 0;
        if (valign === "top") {
          textY = baselineOffset + verticalPaddingTop;
        } else if (valign === "middle") {
          textY = (h - totalTextHeight) / 2 + baselineOffset;
        } else if (valign === "bottom") {
          textY = h - totalTextHeight + baselineOffset;
        }
        const startY = snappedY + textY;
        lines.forEach((line, i) => {
          let x = snappedX + HORIZONTAL_PADDING / 2;
          if (align === "center") {
            x = snappedX + w / 2;
          } else if (align === "right") {
            x = snappedX + w - HORIZONTAL_PADDING / 2;
          }
          const y = startY + i * lineHeight;
          if (align === "center") {
            ctx.textAlign = "center";
            ctx.fillText(line, x, y);
          } else if (align === "right") {
            ctx.textAlign = "right";
            ctx.fillText(line, x, y);
          } else {
            ctx.textAlign = "left";
            ctx.fillText(line, x, y);
          }
        });
        ctx.textAlign = "left";
      }
    } else if (node.type === "dot" || node.type === "circle") {
      const bgHex = state.colorPalettes[node.bgPaletteIndex] || "#44aa44";
      const bgTransparent = node.bgTransparent;
      const strokeColor = isSelected ? "#ffff00" : "#ffffff";
      if (snappedX + w < 0 || snappedX > canvas.width || snappedY + h < 0 || snappedY > canvas.height) {
        return;
      }
      if (!bgTransparent) {
        ctx.fillStyle = bgHex;
        fillPixelRect(ctx, snappedX, snappedY, w, h, pixelSize);
      }
      ctx.fillStyle = strokeColor;
      drawPixelRect(ctx, snappedX, snappedY, w, h, pixelSize);
    }
  }
  function drawEdge(edge, context2) {
    const { state, app } = context2;
    const { ctx, canvas } = app;
    const fromNode = state.nodes.find((n) => n.id === edge.fromNode);
    const toNode = state.nodes.find((n) => n.id === edge.toNode);
    if (!fromNode || !toNode) return;
    const fromCenter = {
      x: fromNode.x + fromNode.width / 2,
      y: fromNode.y + fromNode.height / 2
    };
    const toCenter = {
      x: toNode.x + toNode.width / 2,
      y: toNode.y + toNode.height / 2
    };
    const fromEdgePoint = getRectEdgePoint(fromNode, toNode);
    const toEdgePoint = getRectEdgePoint(toNode, fromNode);
    const from = worldToScreen({ x: fromEdgePoint.x, y: fromEdgePoint.y }, context2.state, canvas);
    const to = worldToScreen({ x: toEdgePoint.x, y: toEdgePoint.y }, context2.state, canvas);
    const minX = Math.min(from.x, to.x);
    const maxX = Math.max(from.x, to.x);
    const minY = Math.min(from.y, to.y);
    const maxY = Math.max(from.y, to.y);
    if (maxX < 0 || minX > canvas.width || maxY < 0 || minY > canvas.height) {
      return;
    }
    const pixelSize = PIXEL_SIZE * state.zoom;
    const strokeColor = state.selectedEdge?.id === edge.id ? "#ffff00" : "#ffffff";
    ctx.fillStyle = strokeColor;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.floor(len / pixelSize);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = snapToPixel(from.x + dx * t, pixelSize);
      const y = snapToPixel(from.y + dy * t, pixelSize);
      ctx.fillRect(x, y, pixelSize, pixelSize);
    }
    function drawPixelArrowHead(from2, to2, pixelSize2) {
      const dx2 = to2.x - from2.x;
      const dy2 = to2.y - from2.y;
      const angle = Math.atan2(dy2, dx2);
      const arrowLen = pixelSize2 * 3;
      const arrowAngle = Math.PI / 6;
      const baseX = to2.x - arrowLen * Math.cos(angle);
      const baseY = to2.y - arrowLen * Math.sin(angle);
      const leftX = to2.x - arrowLen * Math.cos(angle - arrowAngle);
      const leftY = to2.y - arrowLen * Math.sin(angle - arrowAngle);
      const rightX = to2.x - arrowLen * Math.cos(angle + arrowAngle);
      const rightY = to2.y - arrowLen * Math.sin(angle + arrowAngle);
      for (let t = 0; t <= 1; t += 0.2) {
        ctx.fillRect(snapToPixel(baseX + (leftX - baseX) * t, pixelSize2), snapToPixel(baseY + (leftY - baseY) * t, pixelSize2), pixelSize2, pixelSize2);
        ctx.fillRect(snapToPixel(baseX + (rightX - baseX) * t, pixelSize2), snapToPixel(baseY + (rightY - baseY) * t, pixelSize2), pixelSize2, pixelSize2);
      }
      ctx.fillRect(snapToPixel(to2.x, pixelSize2), snapToPixel(to2.y, pixelSize2), pixelSize2, pixelSize2);
    }
    if (edge.arrowStart) {
      drawPixelArrowHead(to, from, pixelSize);
    }
    if (edge.arrowEnd) {
      drawPixelArrowHead(from, to, pixelSize);
    }
  }
  function renderFull(context2) {
    const { state, app } = context2;
    const { ctx, canvas } = app;
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawGrid(context2.app, context2.state);
    state.nodes.forEach((node) => drawNode(node, context2));
    state.edges.forEach((edge) => drawEdge(edge, context2));
  }
  var render = () => renderFull(context);
  function findNodeAt(point, context2) {
    const { state, app } = context2;
    const world = screenToWorld(point, context2.state, app.canvas);
    for (let i = state.nodes.length - 1; i >= 0; i--) {
      const node = state.nodes[i];
      if (world.x >= node.x && world.x <= node.x + node.width && world.y >= node.y && world.y <= node.y + node.height) {
        return node;
      }
    }
    return null;
  }
  function findEdgeAt(point, context2) {
    const { state } = context2;
    const threshold = 10;
    for (let i = state.edges.length - 1; i >= 0; i--) {
      const edge = state.edges[i];
      const fromNode = state.nodes.find((n) => n.id === edge.fromNode);
      const toNode = state.nodes.find((n) => n.id === edge.toNode);
      if (!fromNode || !toNode) continue;
      const from = worldToScreen({ x: fromNode.x + fromNode.width / 2, y: fromNode.y + fromNode.height / 2 }, context2.state, context2.app.canvas);
      const to = worldToScreen({ x: toNode.x + toNode.width / 2, y: toNode.y + toNode.height / 2 }, context2.state, context2.app.canvas);
      const dist = pointToLineDistance(point, from, to);
      if (dist < threshold) {
        return edge;
      }
    }
    return null;
  }
  function addTextNode(state, x, y) {
    const id = "node-" + Date.now();
    const node = {
      id,
      type: "text",
      x: x !== void 0 ? x : -50,
      y: y !== void 0 ? y : -50,
      width: 120,
      height: 60,
      text: "\u30C6\u30AD\u30B9\u30C8",
      textAlign: "left",
      textValign: "top",
      bgPaletteIndex: 1,
      bgTransparent: false,
      strokeTransparent: false,
      autoResize: true
    };
    state.nodes.push(node);
    state.selectedNode = node;
    state.mode = "select";
    updatePropertiesPanel(state, _app);
    state.historyManager.save(state);
    render();
  }
  function addDotNode(state) {
    const id = "node-" + Date.now();
    const size = PIXEL_SIZE * 3;
    const node = {
      id,
      type: "dot",
      x: 0,
      y: 0,
      width: size,
      height: size,
      bgPaletteIndex: 4,
      bgTransparent: false,
      strokeTransparent: false,
      autoResize: true
    };
    state.nodes.push(node);
    state.selectedNode = node;
    state.mode = "select";
    updatePropertiesPanel(state, _app);
    state.historyManager.save(state);
    render();
  }
  function addDotAtEdge(state) {
    if (!state.selectedEdge) return;
    const edge = state.selectedEdge;
    const fromNode = state.nodes.find((n) => n.id === edge.fromNode);
    const toNode = state.nodes.find((n) => n.id === edge.toNode);
    if (!fromNode || !toNode) return;
    const fromEdgePoint = getRectEdgePoint(fromNode, toNode);
    const toEdgePoint = getRectEdgePoint(toNode, fromNode);
    const midX = (fromEdgePoint.x + toEdgePoint.x) / 2;
    const midY = (fromEdgePoint.y + toEdgePoint.y) / 2;
    const id = "node-" + Date.now();
    const size = PIXEL_SIZE * 3;
    const node = {
      id,
      type: "dot",
      x: midX - size / 2,
      y: midY - size / 2,
      width: size,
      height: size,
      bgPaletteIndex: 4,
      bgTransparent: false,
      strokeTransparent: false,
      autoResize: true
    };
    state.nodes.push(node);
    state.edges = state.edges.filter((e) => e.id !== edge.id);
    const edge1 = {
      id: "edge-" + Date.now(),
      fromNode: fromNode.id,
      toNode: node.id,
      fromSide: "bottom",
      toSide: "top",
      arrowStart: false,
      arrowEnd: false
    };
    const edge2 = {
      id: "edge-" + (Date.now() + 1),
      fromNode: node.id,
      toNode: toNode.id,
      fromSide: "bottom",
      toSide: "top",
      arrowStart: false,
      arrowEnd: edge.arrowEnd
    };
    state.edges.push(edge1, edge2);
    state.selectedNode = node;
    state.selectedEdge = null;
    state.mode = "select";
    updatePropertiesPanel(state, _app);
    state.historyManager.save(state);
    render();
  }
  function deleteSelected(state) {
    if (state.selectedNode) {
      state.edges = state.edges.filter((e) => e.fromNode !== state.selectedNode.id && e.toNode !== state.selectedNode.id);
      state.nodes = state.nodes.filter((n) => n.id !== state.selectedNode.id);
      state.selectedNode = null;
      state.historyManager.save(state);
      render();
    } else if (state.selectedEdge) {
      state.edges = state.edges.filter((e) => e.id !== state.selectedEdge.id);
      state.selectedEdge = null;
      state.historyManager.save(state);
      render();
    } else if (state.selectedNodes.length > 0) {
      state.selectedNodes.forEach((node) => {
        state.edges = state.edges.filter((e) => e.fromNode !== node.id && e.toNode !== node.id);
      });
      state.nodes = state.nodes.filter((n) => !state.selectedNodes.includes(n));
      state.selectedNodes = [];
      state.historyManager.save(state);
      render();
    }
  }
  function addEdgeNode(state) {
    let fromNode = null;
    let toNode = null;
    console.log("addEdgeNode:", "selectedNodes:", state.selectedNodes.length, "selectedNode:", state.selectedNode?.id, "lastSelectedNode:", state.lastSelectedNode?.id);
    if (state.selectedNodes.length >= 2) {
      fromNode = state.selectedNodes[0];
      toNode = state.selectedNodes[1];
    } else if (state.selectedNode) {
      fromNode = state.lastSelectedNode;
      toNode = state.selectedNode;
    }
    if (fromNode && toNode) {
      const edge = {
        id: "edge-" + Date.now(),
        fromNode: fromNode.id,
        toNode: toNode.id,
        fromSide: "bottom",
        toSide: "top",
        arrowStart: false,
        arrowEnd: false
      };
      state.edges.push(edge);
      state.selectedNodes = [];
      state.historyManager.save(state);
      render();
    } else {
      alert("SHIFT\u62BC\u3057\u306A\u304C\u30892\u3064\u3001\u307E\u305F\u306F1\u3064\u306E\u30CE\u30FC\u30C9\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044");
    }
  }
  function exportToObsidianCanvas(state) {
    const data = {
      nodes: state.nodes.map((n) => ({
        id: n.id,
        type: n.type === "dot" ? "text" : n.type,
        x: Math.round(n.x),
        y: Math.round(n.y),
        width: n.width,
        height: n.height,
        text: n.text || "",
        bg: state.colorPalettes[n.bgPaletteIndex] || "#000000",
        color: "#ffffff",
        textAlign: n.textAlign,
        textValign: n.textValign
      })),
      edges: state.edges.map((e) => ({
        id: e.id,
        fromNode: e.fromNode,
        toNode: e.toNode,
        fromSide: e.fromSide || "bottom",
        toSide: e.toSide || "top",
        arrowStart: e.arrowStart || false,
        arrowEnd: e.arrowEnd || false
      })),
      colorPalettes: state.colorPalettes,
      viewport: {
        x: -state.offset.x / state.zoom,
        y: -state.offset.y / state.zoom,
        zoom: state.zoom
      }
    };
    return JSON.stringify(data, null, 2);
  }
  function saveToFile(context2) {
    const { state } = context2;
    const data = exportToObsidianCanvas(state);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = _app.document.createElement("a");
    a.href = url;
    a.download = "canvas.json";
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem(STORAGE_KEYS.AUTOSAVE, data);
  }
  function exportToPng(context2) {
    const { state, app } = context2;
    if (state.nodes.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    state.nodes.forEach((node) => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    });
    const padding = 50;
    const width = Math.ceil(maxX - minX + padding * 2);
    const height = Math.ceil(maxY - minY + padding * 2);
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.fillStyle = "#1a1a1a";
    tempCtx.fillRect(0, 0, width, height);
    const tempApp = {
      document: app.document,
      canvas: tempCanvas,
      ctx: tempCtx,
      fileInput: app.fileInput
    };
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const tempState = {
      nodes: state.nodes,
      edges: state.edges,
      selectedNode: null,
      selectedNodes: [],
      selectedEdge: null,
      lastSelectedNode: null,
      mode: state.mode,
      zoom: 1,
      offset: { x: -minX + padding - width / 2, y: -minY + padding - height / 2 },
      isDragging: false,
      isResizing: false,
      dragStart: { x: 0, y: 0 },
      resizeNode: null,
      resizeStart: null,
      resizeStartSize: null,
      dragOffset: { x: 0, y: 0 },
      historyManager: state.historyManager,
      colorPalettes: state.colorPalettes,
      selectedPaletteIndex: 0,
      editingPaletteIndex: void 0,
      editingPaletteType: void 0
    };
    tempState.nodes.forEach((n) => {
      drawNode(n, { state: tempState, app: tempApp });
    });
    tempState.edges.forEach((e) => {
      drawEdge(e, { state: tempState, app: tempApp });
    });
    const dataUrl = tempCanvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "canvas.png";
    a.click();
  }
  function loadFromFile(file, context2) {
    const { state, app } = context2;
    const { ctx, canvas } = app;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.nodes) {
          state.nodes = data.nodes.map((n) => {
            const node = { ...n };
            if (n.width <= 20 && n.height <= 20) {
              node.type = "dot";
              const oldSize = PIXEL_SIZE * 3;
              node.width = oldSize;
              node.height = oldSize;
              node.bgPaletteIndex = findPaletteIndex(state.colorPalettes, n.bg);
            } else {
              node.type = n.type || "text";
              node.bgPaletteIndex = findPaletteIndex(state.colorPalettes, n.bg);
            }
            node.bgTransparent = n.bgTransparent || false;
            node.autoResize = n.autoResize !== void 0 ? n.autoResize : true;
            return node;
          });
        }
        if (data.edges) state.edges = data.edges;
        if (data.colorPalettes) state.colorPalettes = data.colorPalettes;
        if (data.viewport) {
          state.zoom = data.viewport.zoom || 1;
          state.offset.x = -data.viewport.x * state.zoom;
          state.offset.y = -data.viewport.y * state.zoom;
        }
        state.historyManager.save(state);
        render();
      } catch (err) {
        alert("\u30D5\u30A1\u30A4\u30EB\u306E\u5F62\u5F0F\u304C\u6B63\u3057\u304F\u3042\u308A\u307E\u305B\u3093");
      }
    };
    reader.readAsText(file);
  }
  function loadFromLocalStorage(state) {
    const data = localStorage.getItem(STORAGE_KEYS.AUTOSAVE);
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.nodes) state.nodes = parsed.nodes;
        if (parsed.edges) state.edges = parsed.edges;
        if (parsed.colorPalettes) state.colorPalettes = parsed.colorPalettes;
        state.historyManager.save(state);
      } catch (e) {
      }
    }
  }
  function bringToFront(state) {
    if (state.selectedNode) {
      const idx = state.nodes.indexOf(state.selectedNode);
      if (idx > -1) {
        state.nodes.splice(idx, 1);
        state.nodes.push(state.selectedNode);
        state.historyManager.save(state);
        render();
      }
    } else if (state.selectedNodes.length > 0) {
      state.selectedNodes.forEach((node) => {
        const idx = state.nodes.indexOf(node);
        if (idx > -1) {
          state.nodes.splice(idx, 1);
        }
      });
      state.nodes.push(...state.selectedNodes);
      state.historyManager.save(state);
      render();
    }
  }
  function sendToBack(state) {
    if (state.selectedNode) {
      const idx = state.nodes.indexOf(state.selectedNode);
      if (idx > -1) {
        state.nodes.splice(idx, 1);
        state.nodes.unshift(state.selectedNode);
        state.historyManager.save(state);
        render();
      }
    } else if (state.selectedNodes.length > 0) {
      const selectedIds = state.selectedNodes.map((n) => n.id);
      state.nodes = state.nodes.filter((n) => !selectedIds.includes(n.id));
      state.nodes.unshift(...state.selectedNodes);
      state.historyManager.save(state);
      render();
    }
  }
  function handleKeyDown(e, context2) {
    const { state, app } = context2;
    const { document: document2 } = app;
    if ((e.ctrlKey || e.metaKey) && e.key === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(state);
      else undo(state);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "1") {
      e.preventDefault();
      addTextNode(state);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "2") {
      e.preventDefault();
      addDotNode(state);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "3") {
      e.preventDefault();
      addEdgeNode(state);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "ArrowUp") {
      e.preventDefault();
      bringToFront(state);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "ArrowDown") {
      e.preventDefault();
      sendToBack(state);
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (state.selectedNode) {
        const fromNode = state.selectedNode;
        const newX = fromNode.x + fromNode.width + 20;
        const newY = fromNode.y;
        addTextNode(state, newX, newY);
        const toNode = state.selectedNode;
        if (fromNode && toNode && fromNode.id !== toNode.id) {
          const edge = {
            id: "edge-" + Date.now(),
            fromNode: fromNode.id,
            toNode: toNode.id,
            fromSide: "bottom",
            toSide: "top",
            arrowStart: false,
            arrowEnd: false
          };
          state.edges.push(edge);
          state.historyManager.save(state);
          render();
        }
      }
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      const active = document2.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) {
        return;
      }
      deleteSelected(state);
    }
  }
  function handleWheel(e, context2) {
    const { state } = context2;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    state.zoom = Math.max(0.1, Math.min(5, state.zoom * delta));
    render();
  }
  function handleMouseDown(e, context2) {
    const { state, app } = context2;
    const { canvas } = app;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const node = findNodeAt({ x, y }, context2);
    if (node) {
      const world = screenToWorld({ x, y }, context2.state, canvas);
      const resizeHandleSize = 10;
      const inResizeZone = world.x >= node.x + node.width - resizeHandleSize && world.y >= node.y + node.height - resizeHandleSize;
      if (inResizeZone && node.autoResize === false) {
        state.isResizing = true;
        state.isDragging = true;
        state.resizeNode = node;
        state.resizeStart = { x: world.x, y: world.y };
        state.resizeStartSize = { width: node.width, height: node.height };
        state.dragStart = { x: e.clientX, y: e.clientY };
        state.dragOffset = {
          x: world.x - node.x,
          y: world.y - node.y
        };
      } else {
        if (e.shiftKey) {
          if (state.selectedNode) {
            if (!state.selectedNodes.includes(state.selectedNode)) {
              state.selectedNodes.push(state.selectedNode);
            }
          }
          if (!state.selectedNodes.includes(node)) {
            state.selectedNodes.push(node);
          }
          state.selectedNode = null;
        } else {
          if (e.shiftKey) {
            if (state.selectedNode) {
              if (!state.selectedNodes.includes(state.selectedNode)) {
                state.selectedNodes.push(state.selectedNode);
              }
            }
            if (!state.selectedNodes.includes(node)) {
              state.selectedNodes.push(node);
            }
            state.selectedNode = null;
          } else {
            if (state.selectedNode && state.selectedNode !== node) {
              state.lastSelectedNode = state.selectedNode;
            } else if (!state.lastSelectedNode) {
              state.lastSelectedNode = node;
            }
            state.selectedNodes = [];
            state.selectedNode = node;
          }
          state.selectedEdge = null;
          state.isDragging = true;
          state.dragStart = { x: e.clientX, y: e.clientY };
          state.dragOffset = {
            x: world.x - node.x,
            y: world.y - node.y
          };
        }
      }
    } else {
      const edge = findEdgeAt({ x, y }, context2);
      if (edge) {
        state.selectedEdge = edge;
        state.selectedNode = null;
        state.selectedNodes = [];
      } else {
        state.selectedNode = null;
        state.selectedNodes = [];
        state.selectedEdge = null;
        state.isDragging = true;
        state.dragStart = { x: e.clientX, y: e.clientY };
      }
    }
    updatePropertiesPanel(state, app);
    render();
  }
  function handleMouseMove(e, context2) {
    const { state, app } = context2;
    const { canvas } = app;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (state.isResizing && state.resizeNode) {
      const world = screenToWorld({ x, y }, context2.state, canvas);
      const dx = world.x - state.resizeStart.x;
      const dy = world.y - state.resizeStart.y;
      const newWidth = Math.max(40, state.resizeStartSize.width + dx);
      const newHeight = Math.max(30, state.resizeStartSize.height + dy);
      state.resizeNode.width = newWidth;
      state.resizeNode.height = newHeight;
      render();
      return;
    }
    if (!state.isDragging) return;
    if (state.selectedNode) {
      const world = screenToWorld({ x, y }, context2.state, canvas);
      state.selectedNode.x = world.x - state.dragOffset.x;
      state.selectedNode.y = world.y - state.dragOffset.y;
      render();
    } else {
      state.offset.x += e.clientX - state.dragStart.x;
      state.offset.y += e.clientY - state.dragStart.y;
      state.dragStart = { x: e.clientX, y: e.clientY };
      render();
    }
  }
  function handleMouseUp(context2) {
    const { state } = context2;
    if (state.isDragging && (state.selectedNode || state.selectedNodes.length > 0)) {
      state.historyManager.save(state);
    }
    if (state.isResizing) {
      state.historyManager.save(state);
    }
    state.isDragging = false;
    state.isResizing = false;
    state.resizeNode = null;
  }
  function updatePropertiesPanel(state, app) {
    const { document: document2 } = app;
    const nodeProps = document2.getElementById("node-props");
    const edgeProps = document2.getElementById("edge-props");
    const bgTransparentOpt = document2.querySelector(".transparent-option");
    updatePaletteDisplay("bg-palette", context);
    if (state.selectedNode) {
      nodeProps.style.display = "flex";
      edgeProps.style.display = "none";
      document2.getElementById("prop-text").value = state.selectedNode.text || "";
      document2.getElementById("prop-text-halign").value = state.selectedNode.textAlign || "left";
      document2.getElementById("prop-text-valign").value = state.selectedNode.textValign || "top";
      document2.getElementById("prop-bg-transparent").checked = state.selectedNode.bgTransparent || false;
      document2.getElementById("prop-stroke-transparent").checked = state.selectedNode.strokeTransparent || false;
      document2.getElementById("prop-auto-resize").checked = state.selectedNode.autoResize !== false;
      const isText = state.selectedNode.type === "text";
      bgTransparentOpt.style.display = isText ? "inline" : "none";
    } else if (state.selectedEdge) {
      nodeProps.style.display = "none";
      edgeProps.style.display = "flex";
      document2.getElementById("prop-arrow-start").checked = state.selectedEdge.arrowStart || false;
      document2.getElementById("prop-arrow-end").checked = state.selectedEdge.arrowEnd || false;
    }
  }
  function updatePaletteDisplay(containerId, context2) {
    const { state, app } = context2;
    const { document: document2 } = app;
    const container = document2.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    let palettes = state.colorPalettes;
    let selectedIdx = state.selectedNode?.bgPaletteIndex;
    if (state.selectedNode?.type === "dot") {
      palettes = state.colorPalettes.slice(0, 3);
      if (selectedIdx !== void 0 && selectedIdx >= 3) {
        selectedIdx = 0;
        state.selectedNode.bgPaletteIndex = 0;
      }
    }
    palettes.forEach((color, idx) => {
      const swatch = document2.createElement("div");
      swatch.className = "palette-swatch";
      swatch.style.backgroundColor = color;
      if (selectedIdx === idx) {
        swatch.classList.add("selected");
      }
      swatch.addEventListener("click", () => {
        if (state.selectedNode) {
          if (state.selectedNode.type === "dot") {
            state.selectedNode.bgPaletteIndex = idx;
          } else {
            state.selectedNode.bgPaletteIndex = idx;
          }
          render();
          updatePaletteDisplay("bg-palette", context2);
          state.historyManager.save(state);
        }
      });
      swatch.addEventListener("dblclick", () => {
        state.editingPaletteIndex = idx;
        state.editingPaletteType = containerId;
        document2.getElementById("palette-color-picker").click();
      });
      container.appendChild(swatch);
    });
  }
  function initApp(context2) {
    const { app } = context2;
    const { canvas, fileInput } = app;
    canvas.addEventListener("mousedown", (e) => handleMouseDown(e, context2));
    canvas.addEventListener("mousemove", (e) => handleMouseMove(e, context2));
    canvas.addEventListener("mouseup", () => handleMouseUp(context2));
    canvas.addEventListener("wheel", (e) => handleWheel(e, context2));
    app.document.getElementById("btn-add-text").addEventListener("click", () => addTextNode(_state));
    app.document.getElementById("btn-add-dot").addEventListener("click", () => addDotNode(_state));
    app.document.getElementById("btn-add-edge").addEventListener("click", () => addEdgeNode(_state));
    app.document.getElementById("btn-undo").addEventListener("click", () => undo(_state));
    app.document.getElementById("btn-redo").addEventListener("click", () => redo(_state));
    app.document.getElementById("btn-zoom-in").addEventListener("click", () => {
      _state.zoom = Math.min(5, _state.zoom * 1.2);
      render();
    });
    app.document.getElementById("btn-zoom-out").addEventListener("click", () => {
      _state.zoom = Math.max(0.1, _state.zoom / 1.2);
      render();
    });
    app.document.getElementById("btn-front").addEventListener("click", () => bringToFront(_state));
    app.document.getElementById("btn-back").addEventListener("click", () => sendToBack(_state));
    app.document.getElementById("btn-add-dot-to-edge").addEventListener("click", () => addDotAtEdge(_state));
    app.document.getElementById("btn-save").addEventListener("click", () => saveToFile(context2));
    app.document.getElementById("btn-load").addEventListener("click", () => fileInput.click());
    app.document.getElementById("btn-log").addEventListener("click", () => {
      const data = exportToObsidianCanvas(context2.state);
      console.log(data);
    });
    app.document.getElementById("btn-export-png").addEventListener("click", () => {
      exportToPng(context2);
    });
    fileInput.addEventListener("change", (e) => {
      const target = e.target;
      if (target.files && target.files[0]) loadFromFile(target.files[0], context2);
    });
    app.document.addEventListener("keydown", (e) => handleKeyDown(e, context2));
    window.addEventListener("resize", () => resizeCanvasWithRender(_app));
    app.document.getElementById("prop-arrow-start").addEventListener("change", (e) => {
      if (context2.state.selectedEdge) {
        context2.state.selectedEdge.arrowStart = e.target.checked;
        render();
        context2.state.historyManager.save(context2.state);
      }
    });
    app.document.getElementById("prop-arrow-end").addEventListener("change", (e) => {
      if (context2.state.selectedEdge) {
        context2.state.selectedEdge.arrowEnd = e.target.checked;
        render();
        context2.state.historyManager.save(context2.state);
      }
    });
    app.document.getElementById("prop-bg-transparent").addEventListener("change", (e) => {
      if (context2.state.selectedNode) {
        context2.state.selectedNode.bgTransparent = e.target.checked;
        render();
        context2.state.historyManager.save(context2.state);
      }
    });
    app.document.getElementById("prop-stroke-transparent").addEventListener("change", (e) => {
      if (context2.state.selectedNode) {
        context2.state.selectedNode.strokeTransparent = e.target.checked;
        render();
        context2.state.historyManager.save(context2.state);
      }
    });
    app.document.getElementById("prop-auto-resize").addEventListener("change", (e) => {
      if (context2.state.selectedNode) {
        context2.state.selectedNode.autoResize = e.target.checked;
        if (e.target.checked && context2.state.selectedNode.text) {
          autoResizeNode(context2.state.selectedNode, context2);
        }
        render();
        context2.state.historyManager.save(context2.state);
      }
    });
    app.document.getElementById("prop-text").addEventListener("input", (e) => {
      if (context2.state.selectedNode) {
        context2.state.selectedNode.text = e.target.value;
        if (context2.state.selectedNode.autoResize !== false) {
          autoResizeNode(context2.state.selectedNode, context2);
        }
        render();
        context2.state.historyManager.save(context2.state);
      }
    });
    app.document.getElementById("prop-text-halign").addEventListener("change", (e) => {
      if (context2.state.selectedNode) {
        context2.state.selectedNode.textAlign = e.target.value;
        render();
        context2.state.historyManager.save(context2.state);
      }
    });
    app.document.getElementById("prop-text-valign").addEventListener("change", (e) => {
      if (context2.state.selectedNode) {
        context2.state.selectedNode.textValign = e.target.value;
        render();
        context2.state.historyManager.save(context2.state);
      }
    });
    app.document.getElementById("palette-color-picker").addEventListener("input", (e) => {
      if (context2.state.editingPaletteIndex !== void 0) {
        context2.state.colorPalettes[context2.state.editingPaletteIndex] = hexToRgba(e.target.value);
        if (context2.state.selectedNode) {
          updatePaletteDisplay("bg-palette", context2);
        }
        render();
        context2.state.historyManager.save(context2.state);
      }
    });
    resizeCanvasWithRender(_app);
    loadFromLocalStorage(context2.state);
    context2.state.historyManager.save(context2.state);
    render();
    updatePropertiesPanel(_state, _app);
    const isDev = localStorage.getItem(STORAGE_KEYS.DEV_MODE) === "true" || new URLSearchParams(window.location.search).get("dev") === "true";
    if (isDev) {
      app.document.getElementById("btn-clear-storage").style.display = "inline-block";
    }
    app.document.getElementById("btn-clear-storage").addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEYS.AUTOSAVE);
      localStorage.removeItem(STORAGE_KEYS.DEV_MODE);
      location.reload();
    });
  }
  initApp(context);
})();
