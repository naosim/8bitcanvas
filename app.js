const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const fileInput = document.getElementById('file-input');

function getStrokeWidth() {
  return 3 * state.zoom;
}

const state = {
  nodes: [],
  edges: [],
  selectedNode: null,
  selectedNodes: [],
  selectedEdge: null,
  mode: 'select',
  zoom: 1,
  offset: { x: 0, y: 0 },
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  history: [],
  historyIndex: -1,
  colorPalettes: [
    '#000000', '#888888', '#ffffff',
    '#ff0000', '#00ff00', '#0000ff',
    '#ffff00', '#00ffff'
  ],
  strokePalettes: [
    '#000000', '#888888', '#ffffff',
    '#ff0000', '#00ff00', '#0000ff',
    '#ffff00', '#00ffff'
  ],
  selectedPaletteIndex: 0
};

const OBSIDIAN_CANVAS_VERSION = '1.0.0';

function rgbaToHex(rgba) {
  const match = rgba.match(/rgba?\((\d+),(\d+),(\d+),?([\d.]+)?\)/);
  if (!match) return '#000000';
  const r = parseInt(match[1]).toString(16).padStart(2, '0');
  const g = parseInt(match[2]).toString(16).padStart(2, '0');
  const b = parseInt(match[3]).toString(16).padStart(2, '0');
  return '#' + r + g + b;
}

function hexToRgba(hex, alpha = 1) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function rgbaToHex(rgba) {
  const match = rgba.match(/rgba?\((\d+),(\d+),(\d+)/);
  if (match) {
    const r = parseInt(match[1]).toString(16).padStart(2, '0');
    const g = parseInt(match[2]).toString(16).padStart(2, '0');
    const b = parseInt(match[3]).toString(16).padStart(2, '0');
    return '#' + r + g + b;
  }
  return '#000000';
}

function resizeCanvas() {
  const container = document.getElementById('canvas-container');
  canvas.width = container.offsetWidth;
  canvas.height = container.offsetHeight;
  render();
}

function autoResizeNode(node) {
  if (!node.text) return;
  const lines = node.text.split('\n');
  const minWidth = 80;
  const minHeight = 40;
  ctx.font = "14px 'DotGothic16'";
  let maxWidth = 0;
  lines.forEach(line => {
    const metrics = ctx.measureText(line);
    if (metrics.width > maxWidth) maxWidth = metrics.width;
  });
  const newWidth = Math.max(minWidth, maxWidth + 20);
  const newHeight = Math.max(minHeight, lines.length * 18 + 20);
  node.width = newWidth;
  node.height = newHeight;
}

function saveToHistory() {
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(JSON.stringify({ nodes: state.nodes, edges: state.edges, colorPalettes: state.colorPalettes, strokePalettes: state.strokePalettes }));
  state.historyIndex++;
  if (state.history.length > 50) {
    state.history.shift();
    state.historyIndex--;
  }
  autoSaveToLocalStorage();
}

function autoSaveToLocalStorage() {
  const data = JSON.stringify({
    nodes: state.nodes,
    edges: state.edges,
    colorPalettes: state.colorPalettes,
    strokePalettes: state.strokePalettes
  });
  localStorage.setItem('8bitcanvas-autosave', data);
}

function undo() {
  if (state.historyIndex > 0) {
    state.historyIndex--;
    const data = JSON.parse(state.history[state.historyIndex]);
    state.nodes = data.nodes;
    state.edges = data.edges;
    if (data.colorPalettes) state.colorPalettes = data.colorPalettes;
    if (data.strokePalettes) state.strokePalettes = data.strokePalettes;
    state.selectedNode = null;
    state.selectedEdge = null;
    render();
  }
}

function redo() {
  if (state.historyIndex < state.history.length - 1) {
    state.historyIndex++;
    const data = JSON.parse(state.history[state.historyIndex]);
    state.nodes = data.nodes;
    state.edges = data.edges;
    if (data.colorPalettes) state.colorPalettes = data.colorPalettes;
    if (data.strokePalettes) state.strokePalettes = data.strokePalettes;
    state.selectedNode = null;
    state.selectedEdge = null;
    render();
  }
}

function screenToWorld(x, y) {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  return {
    x: (x - centerX - state.offset.x) / state.zoom,
    y: (y - centerY - state.offset.y) / state.zoom
  };
}

function worldToScreen(x, y) {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  return {
    x: x * state.zoom + state.offset.x + centerX,
    y: y * state.zoom + state.offset.y + centerY
  };
}

function drawGrid() {
  const gridSize = 32 * state.zoom;
  const offsetX = state.offset.x % gridSize;
  const offsetY = state.offset.y % gridSize;

  ctx.strokeStyle = '#333';
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

  const origin = worldToScreen(0, 0);
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(origin.x, 0);
  ctx.lineTo(origin.x, canvas.height);
  ctx.moveTo(0, origin.y);
  ctx.lineTo(canvas.width, origin.y);
  ctx.stroke();
}

function drawNode(node) {
  const pos = worldToScreen(node.x, node.y);
  const w = node.width * state.zoom;
  const h = node.height * state.zoom;
  const isSelected = state.selectedNode?.id === node.id || state.selectedNodes.includes(node);

  if (pos.x + w < 0 || pos.x > canvas.width || pos.y + h < 0 || pos.y > canvas.height) {
    return;
  }

  if (node.type === 'text') {
    const bgHex = state.colorPalettes[node.bgPaletteIndex] || '#4444aa';
    const strokeHex = state.strokePalettes[node.strokePaletteIndex] || '#ffffff';
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
      ctx.strokeStyle = '#ffff00';
      ctx.lineWidth = getStrokeWidth();
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
      ctx.lineWidth = getStrokeWidth();
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
      const lines = node.text.split('\n');
      const lineHeight = 18 * state.zoom;
      const align = node.textAlign || 'left';
      const valign = node.textValign || 'top';
      ctx.fillStyle = '#ffffff';
      ctx.font = `${14 * state.zoom}px 'DotGothic16'`;

      const totalTextHeight = lines.length * lineHeight;
      let startY = pos.y + (h - totalTextHeight) / 2 + lineHeight - 4 * state.zoom;

      if (valign === 'top') {
        startY = pos.y + 12 * state.zoom;
      } else if (valign === 'bottom') {
        startY = pos.y + h - totalTextHeight + 12 * state.zoom;
      }

      lines.forEach((line, i) => {
        let x = pos.x + 8;
        if (align === 'center') {
          x = pos.x + w / 2;
        } else if (align === 'right') {
          x = pos.x + w - 8;
        }
        let y = startY + i * lineHeight;

        if (align === 'center') {
          ctx.textAlign = 'center';
          ctx.fillText(line, x, y);
        } else if (align === 'right') {
          ctx.textAlign = 'right';
          ctx.fillText(line, x, y);
        } else {
          ctx.textAlign = 'left';
          ctx.fillText(line, x, y);
        }
      });
      ctx.textAlign = 'left';
    }
  } else if (node.type === 'circle') {
    const bgHex = state.colorPalettes[node.bgPaletteIndex] || '#44aa44';
    const strokeHex = state.strokePalettes[node.strokePaletteIndex] || '#ffffff';
    const bgTransparent = node.bgTransparent;
    const strokeTransparent = node.strokeTransparent;
    if (!bgTransparent) {
      ctx.fillStyle = bgHex;
      ctx.beginPath();
      ctx.arc(pos.x + w / 2, pos.y + h / 2, w / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!strokeTransparent) {
      ctx.strokeStyle = isSelected ? '#ffff00' : strokeHex;
      ctx.lineWidth = getStrokeWidth();
      ctx.beginPath();
      ctx.arc(pos.x + w / 2, pos.y + h / 2, w / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawEdge(edge) {
  const fromNode = state.nodes.find(n => n.id === edge.fromNode);
  const toNode = state.nodes.find(n => n.id === edge.toNode);
  if (!fromNode || !toNode) return;

  const fromCenter = {
    x: fromNode.x + fromNode.width / 2,
    y: fromNode.y + fromNode.height / 2
  };
  const toCenter = {
    x: toNode.x + toNode.width / 2,
    y: toNode.y + toNode.height / 2
  };

  const fromEdgePoint = getRectEdgePoint(fromNode, fromCenter, toCenter);
  const toEdgePoint = getRectEdgePoint(toNode, toCenter, fromCenter);

  const from = worldToScreen(fromEdgePoint.x, fromEdgePoint.y);
  const to = worldToScreen(toEdgePoint.x, toEdgePoint.y);

  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);

  if (maxX < 0 || minX > canvas.width || maxY < 0 || minY > canvas.height) {
    return;
  }

  ctx.strokeStyle = state.selectedEdge?.id === edge.id ? '#ffff00' : '#ffffff';
  ctx.lineWidth = getStrokeWidth();
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  function drawArrow(fromX, fromY, toX, toY) {
    const arrowAngle = Math.atan2(toY - fromY, toX - fromX);
    const arrowLen = getStrokeWidth() * 4;
    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - arrowLen * Math.cos(arrowAngle - Math.PI / 6), toY - arrowLen * Math.sin(arrowAngle - Math.PI / 6));
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - arrowLen * Math.cos(arrowAngle + Math.PI / 6), toY - arrowLen * Math.sin(arrowAngle + Math.PI / 6));
    ctx.stroke();
  }

  if (edge.arrowStart) {
    drawArrow(to.x, to.y, from.x, from.y);
  }
  if (edge.arrowEnd) {
    drawArrow(from.x, from.y, to.x, to.y);
  }
}

function getRectEdgePoint(node, from, to) {
  if (node.type === 'circle') {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.atan2(dy, dx);
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
  
  const tMin = 0.0001;
  let tMax = 1;
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

function render() {
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  state.nodes.forEach(drawNode);
  state.edges.forEach(drawEdge);
}

function findNodeAt(x, y) {
  const world = screenToWorld(x, y);
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    const node = state.nodes[i];
    if (world.x >= node.x && world.x <= node.x + node.width &&
        world.y >= node.y && world.y <= node.y + node.height) {
      return node;
    }
  }
  return null;
}

function findEdgeAt(x, y) {
  const threshold = 10;
  for (let i = state.edges.length - 1; i >= 0; i--) {
    const edge = state.edges[i];
    const fromNode = state.nodes.find(n => n.id === edge.fromNode);
    const toNode = state.nodes.find(n => n.id === edge.toNode);
    if (!fromNode || !toNode) continue;

    const from = worldToScreen(fromNode.x + fromNode.width / 2, fromNode.y + fromNode.height / 2);
    const to = worldToScreen(toNode.x + toNode.width / 2, toNode.y + toNode.height / 2);
    
    const dist = pointToLineDistance(x, y, from.x, from.y, to.x, to.y);
    if (dist < threshold) {
      return edge;
    }
  }
  return null;
}

function pointToLineDistance(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;
  let xx, yy;
  if (param < 0) {
    xx = x1; yy = y1;
  } else if (param > 1) {
    xx = x2; yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }
  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

function addTextNode() {
  const id = 'node-' + Date.now();
  const node = {
    id,
    type: 'text',
    x: -50,
    y: -50,
    width: 120,
    height: 60,
    text: 'テキスト',
    textAlign: 'left',
    textValign: 'top',
    bgPaletteIndex: 1,
    bgTransparent: false,
    strokePaletteIndex: 2,
    strokeTransparent: false,
    autoResize: true
  };
  state.nodes.push(node);
  state.selectedNode = node;
  state.mode = 'select';
  updatePropertiesPanel();
  saveToHistory();
  render();
}

function addCircleNode() {
  const id = 'node-' + Date.now();
  const node = {
    id,
    type: 'circle',
    x: -50,
    y: -50,
    width: 14,
    height: 14,
    bgPaletteIndex: 4,
    bgTransparent: false,
    strokePaletteIndex: 2,
    strokeTransparent: false
  };
  state.nodes.push(node);
  state.selectedNode = node;
  state.mode = 'select';
  updatePropertiesPanel();
  saveToHistory();
  render();
}

function deleteSelected() {
  if (state.selectedNode) {
    state.edges = state.edges.filter(e => e.fromNode !== state.selectedNode.id && e.toNode !== state.selectedNode.id);
    state.nodes = state.nodes.filter(n => n.id !== state.selectedNode.id);
    state.selectedNode = null;
    saveToHistory();
    render();
  } else if (state.selectedEdge) {
    state.edges = state.edges.filter(e => e.id !== state.selectedEdge.id);
    state.selectedEdge = null;
    saveToHistory();
    render();
  } else if (state.selectedNodes.length > 0) {
    state.selectedNodes.forEach(node => {
      state.edges = state.edges.filter(e => e.fromNode !== node.id && e.toNode !== node.id);
    });
    state.nodes = state.nodes.filter(n => !state.selectedNodes.includes(n));
    state.selectedNodes = [];
    saveToHistory();
    render();
  }
}

function addEdgeNode() {
  if (state.selectedNodes.length >= 2) {
    const id = 'edge-' + Date.now();
    const edge = {
      id,
      fromNode: state.selectedNodes[0].id,
      toNode: state.selectedNodes[1].id,
      fromSide: 'bottom',
      toSide: 'top',
      arrowStart: false,
      arrowEnd: false
    };
    state.edges.push(edge);
    state.selectedNodes = [];
    saveToHistory();
    render();
  } else {
    alert('SHIFT押しながら2つのノードを選択してください');
  }
}

function exportToObsidianCanvas() {
  const data = {
    nodes: state.nodes.map(n => ({
      id: n.id,
      type: n.type === 'circle' ? 'text' : n.type,
      x: Math.round(n.x),
      y: Math.round(n.y),
      width: n.width,
      height: n.height,
      text: n.text || '',
      bg: state.colorPalettes[n.bgPaletteIndex] || '#000000',
      color: state.strokePalettes[n.strokePaletteIndex] || '#ffffff',
      textAlign: n.textAlign,
      textValign: n.textValign
    })),
    edges: state.edges.map(e => ({
      id: e.id,
      fromNode: e.fromNode,
      toNode: e.toNode,
      fromSide: e.fromSide || 'bottom',
      toSide: e.toSide || 'top',
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

function saveToFile() {
  const data = exportToObsidianCanvas();
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'canvas.json';
  a.click();
  URL.revokeObjectURL(url);

  localStorage.setItem('8bitcanvas-autosave', data);
}

function loadFromFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.nodes) {
        state.nodes = data.nodes.map(n => {
          const node = { ...n };
          if (n.width <= 20 && n.height <= 20) {
            node.type = 'circle';
            node.bgPaletteIndex = findPaletteIndex(state.colorPalettes, n.bg);
            node.strokePaletteIndex = findPaletteIndex(state.strokePalettes, n.color);
          } else {
            node.type = n.type || 'text';
            node.bgPaletteIndex = findPaletteIndex(state.colorPalettes, n.bg);
            node.strokePaletteIndex = findPaletteIndex(state.strokePalettes, n.color);
          }
          node.bgTransparent = n.bgTransparent || false;
          node.strokeTransparent = n.strokeTransparent || false;
          node.autoResize = n.autoResize !== undefined ? n.autoResize : true;
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
      saveToHistory();
      render();
    } catch (err) {
      alert('ファイルの形式が正しくありません');
    }
  };
  reader.readAsText(file);
}

function findPaletteIndex(palettes, color) {
  if (!color) return 0;
  const idx = palettes.indexOf(color);
  return idx >= 0 ? idx : 0;
}

function loadFromLocalStorage() {
  const data = localStorage.getItem('8bitcanvas-autosave');
  if (data) {
    try {
      const parsed = JSON.parse(data);
      if (parsed.nodes) state.nodes = parsed.nodes;
      if (parsed.edges) state.edges = parsed.edges;
      if (parsed.colorPalettes) state.colorPalettes = parsed.colorPalettes;
      if (parsed.strokePalettes) state.strokePalettes = parsed.strokePalettes;
      saveToHistory();
    } catch (e) {}
  }
}

canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const node = findNodeAt(x, y);

  if (node) {
    const world = screenToWorld(x, y);
    const resizeHandleSize = 10;
    const inResizeZone = 
      world.x >= node.x + node.width - resizeHandleSize &&
      world.y >= node.y + node.height - resizeHandleSize;
    
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
      state.dragStart = screenToWorld(x, y);
      state.dragOffset = {
        x: state.dragStart.x - node.x,
        y: state.dragStart.y - node.y
      };
    }
  } else {
    const edge = findEdgeAt(x, y);
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
  updatePropertiesPanel();
  render();
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (state.isResizing && state.resizeNode) {
    const world = screenToWorld(x, y);
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
    const world = screenToWorld(x, y);
    state.selectedNode.x = world.x - state.dragOffset.x;
    state.selectedNode.y = world.y - state.dragOffset.y;
    render();
  } else {
    state.offset.x += e.clientX - state.dragStart.x;
    state.offset.y += e.clientY - state.dragStart.y;
    state.dragStart = { x: e.clientX, y: e.clientY };
    render();
  }
});

canvas.addEventListener('mouseup', () => {
  if (state.isDragging && state.selectedNode) {
    saveToHistory();
  }
  if (state.isResizing) {
    saveToHistory();
  }
  state.isDragging = false;
  state.isResizing = false;
  state.resizeNode = null;
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  state.zoom = Math.max(0.1, Math.min(5, state.zoom * delta));
  render();
});

document.getElementById('btn-add-text').addEventListener('click', addTextNode);
document.getElementById('btn-add-circle').addEventListener('click', addCircleNode);
document.getElementById('btn-add-edge').addEventListener('click', addEdgeNode);
document.getElementById('btn-undo').addEventListener('click', undo);
document.getElementById('btn-redo').addEventListener('click', redo);
document.getElementById('btn-zoom-in').addEventListener('click', () => {
  state.zoom = Math.min(5, state.zoom * 1.2);
  render();
});
document.getElementById('btn-zoom-out').addEventListener('click', () => {
  state.zoom = Math.max(0.1, state.zoom / 1.2);
  render();
});
document.getElementById('btn-front').addEventListener('click', () => {
  if (state.selectedNode) {
    const idx = state.nodes.indexOf(state.selectedNode);
    if (idx > -1) {
      state.nodes.splice(idx, 1);
      state.nodes.push(state.selectedNode);
      saveToHistory();
      render();
    }
  } else if (state.selectedNodes.length > 0) {
    state.selectedNodes.forEach(node => {
      const idx = state.nodes.indexOf(node);
      if (idx > -1) {
        state.nodes.splice(idx, 1);
      }
    });
    state.nodes.push(...state.selectedNodes);
    saveToHistory();
    render();
  }
});
document.getElementById('btn-back').addEventListener('click', () => {
  if (state.selectedNode) {
    const idx = state.nodes.indexOf(state.selectedNode);
    if (idx > -1) {
      state.nodes.splice(idx, 1);
      state.nodes.unshift(state.selectedNode);
      saveToHistory();
      render();
    }
  } else if (state.selectedNodes.length > 0) {
    const selectedIds = state.selectedNodes.map(n => n.id);
    state.nodes = state.nodes.filter(n => !selectedIds.includes(n.id));
    state.nodes.unshift(...state.selectedNodes);
    saveToHistory();
    render();
  }
});
document.getElementById('btn-save').addEventListener('click', saveToFile);
document.getElementById('btn-load').addEventListener('click', () => fileInput.click());
document.getElementById('btn-log').addEventListener('click', () => {
  const data = exportToObsidianCanvas();
  console.log(data);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) loadFromFile(e.target.files[0]);
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    if (e.shiftKey) redo();
    else undo();
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const active = document.activeElement;
    if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT') {
      return;
    }
    deleteSelected();
  }
});

window.addEventListener('resize', resizeCanvas);

function updatePropertiesPanel() {
  const nodeProps = document.getElementById('node-props');
  const edgeProps = document.getElementById('edge-props');
  const bgTransparentOpt = document.querySelector('.transparent-option');
  const strokeTransparentOpt = document.querySelectorAll('.transparent-option')[1];
  
  updatePaletteDisplay('bg-palette', state.selectedNode?.bgPaletteIndex ?? 1, 'bgPaletteIndex');
  updatePaletteDisplay('stroke-palette', state.selectedNode?.strokePaletteIndex ?? 2, 'strokePaletteIndex');
  
  if (state.selectedNode) {
    nodeProps.style.display = 'flex';
    edgeProps.style.display = 'none';
    document.getElementById('prop-text').value = state.selectedNode.text || '';
    document.getElementById('prop-text-halign').value = state.selectedNode.textAlign || 'left';
    document.getElementById('prop-text-valign').value = state.selectedNode.textValign || 'top';
    const bgIdx = state.selectedNode.bgPaletteIndex !== undefined ? state.selectedNode.bgPaletteIndex : 1;
    const strokeIdx = state.selectedNode.strokePaletteIndex !== undefined ? state.selectedNode.strokePaletteIndex : 2;
    document.getElementById('prop-bg-transparent').checked = state.selectedNode.bgTransparent || false;
    document.getElementById('prop-stroke-transparent').checked = state.selectedNode.strokeTransparent || false;
    document.getElementById('prop-auto-resize').checked = state.selectedNode.autoResize !== false;
    
    const isText = state.selectedNode.type === 'text';
    bgTransparentOpt.style.display = isText ? 'inline' : 'none';
    strokeTransparentOpt.style.display = isText ? 'inline' : 'none';
  } else if (state.selectedEdge) {
    nodeProps.style.display = 'none';
    edgeProps.style.display = 'flex';
    document.getElementById('prop-arrow-start').checked = state.selectedEdge.arrowStart || false;
    document.getElementById('prop-arrow-end').checked = state.selectedEdge.arrowEnd || false;
  }
}

document.getElementById('prop-arrow-start').addEventListener('change', (e) => {
  if (state.selectedEdge) {
    state.selectedEdge.arrowStart = e.target.checked;
    render();
    saveToHistory();
  }
});

document.getElementById('prop-arrow-end').addEventListener('change', (e) => {
  if (state.selectedEdge) {
    state.selectedEdge.arrowEnd = e.target.checked;
    render();
    saveToHistory();
  }
});

function updatePaletteDisplay(containerId, selectedIdx, propName) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const palettes = containerId === 'stroke-palette' ? state.strokePalettes : state.colorPalettes;
  palettes.forEach((color, idx) => {
    const swatch = document.createElement('div');
    swatch.className = 'palette-swatch';
    swatch.style.backgroundColor = color;
    if (selectedIdx === idx) {
      swatch.classList.add('selected');
    }
    swatch.addEventListener('click', () => {
      if (state.selectedNode) {
        state.selectedNode[propName] = idx;
        render();
        updatePaletteDisplay('bg-palette', state.selectedNode.bgPaletteIndex, 'bgPaletteIndex');
        updatePaletteDisplay('stroke-palette', state.selectedNode.strokePaletteIndex, 'strokePaletteIndex');
        saveToHistory();
      }
    });
    swatch.addEventListener('dblclick', () => {
      state.editingPaletteIndex = idx;
      state.editingPaletteType = containerId;
      document.getElementById('palette-color-picker').click();
    });
    container.appendChild(swatch);
  });
}

document.getElementById('prop-bg-transparent').addEventListener('change', (e) => {
  if (state.selectedNode) {
    state.selectedNode.bgTransparent = e.target.checked;
    render();
    saveToHistory();
  }
});

document.getElementById('prop-stroke-transparent').addEventListener('change', (e) => {
  if (state.selectedNode) {
    state.selectedNode.strokeTransparent = e.target.checked;
    render();
    saveToHistory();
  }
});

document.getElementById('prop-auto-resize').addEventListener('change', (e) => {
  if (state.selectedNode) {
    state.selectedNode.autoResize = e.target.checked;
    if (e.target.checked && state.selectedNode.text) {
      autoResizeNode(state.selectedNode);
    }
    render();
    saveToHistory();
  }
});

document.getElementById('prop-text').addEventListener('input', (e) => {
  if (state.selectedNode) {
    state.selectedNode.text = e.target.value;
    if (state.selectedNode.autoResize !== false) {
      autoResizeNode(state.selectedNode);
    }
    render();
    saveToHistory();
  }
});

document.getElementById('prop-text-halign').addEventListener('change', (e) => {
  if (state.selectedNode) {
    state.selectedNode.textAlign = e.target.value;
    render();
    saveToHistory();
  }
});

document.getElementById('prop-text-valign').addEventListener('change', (e) => {
  if (state.selectedNode) {
    state.selectedNode.textValign = e.target.value;
    render();
    saveToHistory();
  }
});

document.getElementById('palette-color-picker').addEventListener('input', (e) => {
  if (state.editingPaletteIndex !== undefined) {
    const palettes = state.editingPaletteType === 'stroke-palette' ? state.strokePalettes : state.colorPalettes;
    palettes[state.editingPaletteIndex] = hexToRgba(e.target.value);
    if (state.selectedNode) {
      updatePaletteDisplay('bg-palette', state.selectedNode.bgPaletteIndex, 'bgPaletteIndex');
      updatePaletteDisplay('stroke-palette', state.selectedNode.strokePaletteIndex, 'strokePaletteIndex');
    }
    render();
    saveToHistory();
  }
});

resizeCanvas();
loadFromLocalStorage();
saveToHistory();
render();
updatePropertiesPanel();

const isDev = localStorage.getItem('8bitcanvas-dev') === 'true' || new URLSearchParams(window.location.search).get('dev') === 'true';
if (isDev) {
  document.getElementById('btn-clear-storage').style.display = 'inline-block';
}

document.getElementById('btn-clear-storage').addEventListener('click', () => {
  localStorage.removeItem('8bitcanvas-autosave');
  localStorage.removeItem('8bitcanvas-dev');
  location.reload();
});