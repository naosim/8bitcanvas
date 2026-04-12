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
    if (node.type === "circle") {
      const dx2 = to.x - from.x;
      const dy2 = to.y - from.y;
      const angle = Math.atan2(dy2, dx2);
      const radius = node.width / 2;
      return {
        x: from.x + Math.cos(angle) * radius,
        y: from.y + Math.sin(angle) * radius
      };
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
    AUTOSAVE: "8bitcanvas-autosave",
    DEV_MODE: "8bitcanvas-dev"
  };
  var _app = {
    document,
    canvas: document.getElementById("canvas"),
    ctx: document.getElementById("canvas").getContext("2d"),
    fileInput: document.getElementById("file-input")
  };
  function getStrokeWidth(zoom) {
    return 3 * zoom;
  }
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
        colorPalettes: state.colorPalettes,
        strokePalettes: state.strokePalettes
      }));
      this.historyIndex++;
      if (this.history.length > this.maxSize) {
        this.history.shift();
        this.historyIndex--;
      }
      const data = JSON.stringify({
        nodes: state.nodes,
        edges: state.edges,
        colorPalettes: state.colorPalettes,
        strokePalettes: state.strokePalettes
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
      if (data.strokePalettes) state.strokePalettes = data.strokePalettes;
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
    strokePalettes: [
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
  var VERTICAL_PADDING = 32;
  var LINE_HEIGHT = 18;
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
  function drawNode(node, context2) {
    const { state, app } = context2;
    const { ctx, canvas } = app;
    const pos = worldToScreen({ x: node.x, y: node.y }, state, canvas);
    const w = node.width * state.zoom;
    const h = node.height * state.zoom;
    const isSelected = state.selectedNode?.id === node.id || state.selectedNodes.includes(node);
    if (pos.x + w < 0 || pos.x > canvas.width || pos.y + h < 0 || pos.y > canvas.height) {
      return;
    }
    if (node.type === "text") {
      const bgHex = state.colorPalettes[node.bgPaletteIndex] || "#4444aa";
      const strokeHex = state.strokePalettes[node.strokePaletteIndex] || "#ffffff";
      const bgTransparent = node.bgTransparent;
      const strokeTransparent = node.strokeTransparent;
      const r = 4 * state.zoom;
      if (!bgTransparent) {
        ctx.fillStyle = bgHex;
        ctx.beginPath();
        ctx.moveTo(pos.x + r, pos.y);
        ctx.lineTo(pos.x + w - r, pos.y);
        ctx.quadraticCurveTo(pos.x + w, pos.y, pos.x + w, pos.y + r);
        ctx.lineTo(pos.x + w, pos.y + h - r);
        ctx.quadraticCurveTo(pos.x + w, pos.y + h, pos.x + w - r, pos.y + h);
        ctx.lineTo(pos.x + r, pos.y + h);
        ctx.quadraticCurveTo(pos.x, pos.y + h, pos.x, pos.y + h - r);
        ctx.lineTo(pos.x, pos.y + r);
        ctx.quadraticCurveTo(pos.x, pos.y, pos.x + r, pos.y);
        ctx.closePath();
        ctx.fill();
      }
      if (isSelected) {
        ctx.strokeStyle = "#ffff00";
        ctx.lineWidth = getStrokeWidth(state.zoom);
        ctx.beginPath();
        ctx.moveTo(pos.x + r, pos.y);
        ctx.lineTo(pos.x + w - r, pos.y);
        ctx.quadraticCurveTo(pos.x + w, pos.y, pos.x + w, pos.y + r);
        ctx.lineTo(pos.x + w, pos.y + h - r);
        ctx.quadraticCurveTo(pos.x + w, pos.y + h, pos.x + w - r, pos.y + h);
        ctx.lineTo(pos.x + r, pos.y + h);
        ctx.quadraticCurveTo(pos.x, pos.y + h, pos.x, pos.y + h - r);
        ctx.lineTo(pos.x, pos.y + r);
        ctx.quadraticCurveTo(pos.x, pos.y, pos.x + r, pos.y);
        ctx.closePath();
        ctx.stroke();
      } else if (!strokeTransparent) {
        ctx.strokeStyle = strokeHex;
        ctx.lineWidth = getStrokeWidth(state.zoom);
        ctx.beginPath();
        ctx.moveTo(pos.x + r, pos.y);
        ctx.lineTo(pos.x + w - r, pos.y);
        ctx.quadraticCurveTo(pos.x + w, pos.y, pos.x + w, pos.y + r);
        ctx.lineTo(pos.x + w, pos.y + h - r);
        ctx.quadraticCurveTo(pos.x + w, pos.y + h, pos.x + w - r, pos.y + h);
        ctx.lineTo(pos.x + r, pos.y + h);
        ctx.quadraticCurveTo(pos.x, pos.y + h, pos.x, pos.y + h - r);
        ctx.lineTo(pos.x, pos.y + r);
        ctx.quadraticCurveTo(pos.x, pos.y, pos.x + r, pos.y);
        ctx.closePath();
        ctx.stroke();
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
        let startY = pos.y + verticalPaddingTop;
        if (valign === "top") {
          startY = pos.y + verticalPaddingTop;
        } else if (valign === "bottom") {
          startY = pos.y + h - totalTextHeight - verticalPaddingBottom;
        }
        lines.forEach((line, i) => {
          let x = pos.x + HORIZONTAL_PADDING / 2;
          if (align === "center") {
            x = pos.x + w / 2;
          } else if (align === "right") {
            x = pos.x + w - HORIZONTAL_PADDING / 2;
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
    } else if (node.type === "circle") {
      const bgHex = state.colorPalettes[node.bgPaletteIndex] || "#44aa44";
      const strokeHex = state.strokePalettes[node.strokePaletteIndex] || "#ffffff";
      const bgTransparent = node.bgTransparent;
      const strokeTransparent = node.strokeTransparent;
      if (!bgTransparent) {
        ctx.fillStyle = bgHex;
        ctx.beginPath();
        ctx.arc(pos.x + w / 2, pos.y + h / 2, w / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!strokeTransparent) {
        ctx.strokeStyle = isSelected ? "#ffff00" : strokeHex;
        ctx.lineWidth = getStrokeWidth(state.zoom);
        ctx.beginPath();
        ctx.arc(pos.x + w / 2, pos.y + h / 2, w / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
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
    ctx.strokeStyle = state.selectedEdge?.id === edge.id ? "#ffff00" : "#ffffff";
    ctx.lineWidth = getStrokeWidth(state.zoom);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    function drawArrow(from2, to2) {
      const arrowAngle = Math.atan2(to2.y - from2.y, to2.x - from2.x);
      const arrowLen = getStrokeWidth(state.zoom) * 4;
      ctx.beginPath();
      ctx.moveTo(to2.x, to2.y);
      ctx.lineTo(to2.x - arrowLen * Math.cos(arrowAngle - Math.PI / 6), to2.y - arrowLen * Math.sin(arrowAngle - Math.PI / 6));
      ctx.moveTo(to2.x, to2.y);
      ctx.lineTo(to2.x - arrowLen * Math.cos(arrowAngle + Math.PI / 6), to2.y - arrowLen * Math.sin(arrowAngle + Math.PI / 6));
      ctx.stroke();
    }
    if (edge.arrowStart) {
      drawArrow(to, from);
    }
    if (edge.arrowEnd) {
      drawArrow(from, to);
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
      strokePaletteIndex: 2,
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
  function addCircleNode(state) {
    const id = "node-" + Date.now();
    const node = {
      id,
      type: "circle",
      x: -50,
      y: -50,
      width: 14,
      height: 14,
      bgPaletteIndex: 4,
      bgTransparent: false,
      strokePaletteIndex: 2,
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
    if (state.selectedNodes.length >= 2) {
      const edge = {
        id: "edge-" + Date.now(),
        fromNode: state.selectedNodes[0].id,
        toNode: state.selectedNodes[1].id,
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
      alert("SHIFT\u62BC\u3057\u306A\u304C\u30892\u3064\u306E\u30CE\u30FC\u30C9\u3092\u9078\u629E\u3057\u3066\u304F\u3060\u3055\u3044");
    }
  }
  function exportToObsidianCanvas(state) {
    const data = {
      nodes: state.nodes.map((n) => ({
        id: n.id,
        type: n.type === "circle" ? "text" : n.type,
        x: Math.round(n.x),
        y: Math.round(n.y),
        width: n.width,
        height: n.height,
        text: n.text || "",
        bg: state.colorPalettes[n.bgPaletteIndex] || "#000000",
        color: state.strokePalettes[n.strokePaletteIndex] || "#ffffff",
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
      strokePalettes: state.strokePalettes,
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
              node.type = "circle";
              node.bgPaletteIndex = findPaletteIndex(state.colorPalettes, n.bg);
              node.strokePaletteIndex = findPaletteIndex(state.strokePalettes, n.color);
            } else {
              node.type = n.type || "text";
              node.bgPaletteIndex = findPaletteIndex(state.colorPalettes, n.bg);
              node.strokePaletteIndex = findPaletteIndex(state.strokePalettes, n.color);
            }
            node.bgTransparent = n.bgTransparent || false;
            node.strokeTransparent = n.strokeTransparent || false;
            node.autoResize = n.autoResize !== void 0 ? n.autoResize : true;
            return node;
          });
        }
        if (data.edges) state.edges = data.edges;
        if (data.colorPalettes) state.colorPalettes = data.colorPalettes;
        if (data.strokePalettes) state.strokePalettes = data.strokePalettes;
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
        if (parsed.strokePalettes) state.strokePalettes = parsed.strokePalettes;
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
      if (e.shiftKey) redo(state);
      else undo(state);
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
        state.resizeNode = node;
        state.resizeStart = { x: world.x, y: world.y };
        state.resizeStartSize = { width: node.width, height: node.height };
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
          state.selectedNodes = [];
          state.selectedNode = node;
        }
        state.selectedEdge = null;
        state.isDragging = true;
        state.dragStart = screenToWorld({ x, y }, context2.state, canvas);
        state.dragOffset = {
          x: state.dragStart.x - node.x,
          y: state.dragStart.y - node.y
        };
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
    if (state.isDragging && state.selectedNode) {
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
    const strokeTransparentOpt = document2.querySelectorAll(".transparent-option")[1];
    updatePaletteDisplay("bg-palette", context);
    updatePaletteDisplay("stroke-palette", context);
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
      strokeTransparentOpt.style.display = isText ? "inline" : "none";
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
    const palettes = containerId === "stroke-palette" ? state.strokePalettes : state.colorPalettes;
    const selectedIdx = containerId === "stroke-palette" ? state.selectedNode?.strokePaletteIndex : state.selectedNode?.bgPaletteIndex;
    const propName = containerId === "stroke-palette" ? "strokePaletteIndex" : "bgPaletteIndex";
    palettes.forEach((color, idx) => {
      const swatch = document2.createElement("div");
      swatch.className = "palette-swatch";
      swatch.style.backgroundColor = color;
      if (selectedIdx === idx) {
        swatch.classList.add("selected");
      }
      swatch.addEventListener("click", () => {
        if (state.selectedNode) {
          state.selectedNode[propName] = idx;
          render();
          updatePaletteDisplay("bg-palette", context2);
          updatePaletteDisplay("stroke-palette", context2);
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
    app.document.getElementById("btn-add-circle").addEventListener("click", () => addCircleNode(_state));
    app.document.getElementById("btn-add-edge").addEventListener("click", () => addEdgeNode(_state));
    app.document.getElementById("btn-undo").addEventListener("click", () => undo(_state));
    app.document.getElementById("btn-redo").addEventListener("click", () => redo(_state));
    app.document.getElementById("btn-front").addEventListener("click", () => bringToFront(_state));
    app.document.getElementById("btn-back").addEventListener("click", () => sendToBack(_state));
    app.document.getElementById("btn-save").addEventListener("click", () => saveToFile(context2));
    app.document.getElementById("btn-load").addEventListener("click", () => fileInput.click());
    app.document.getElementById("btn-log").addEventListener("click", () => {
      const data = exportToObsidianCanvas(context2.state);
      console.log(data);
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
        const palettes = context2.state.editingPaletteType === "stroke-palette" ? context2.state.strokePalettes : context2.state.colorPalettes;
        palettes[context2.state.editingPaletteIndex] = hexToRgba(e.target.value);
        if (context2.state.selectedNode) {
          updatePaletteDisplay("bg-palette", context2);
          updatePaletteDisplay("stroke-palette", context2);
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
