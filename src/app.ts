

import {
  Point,
  Figure,
  rgbaToHex,
  hexToRgba,
  resizeCanvas,
  screenToWorld,
  worldToScreen,
  getRectEdgePoint,
  pointToLineDistance,
  findPaletteIndex,
  calcTextRectSize
} from './util';

const STORAGE_KEYS = {
  AUTOSAVE: 'tinytidycanvas-autosave',
  DEV_MODE: 'tinytidycanvas-dev'
} as const;

interface CanvasNode extends Figure {
  id: string;
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  textValign?: 'top' | 'middle' | 'bottom';
  bgPaletteIndex: number;
  bgTransparent: boolean;
  strokePaletteIndex: number;
  strokeTransparent: boolean;
  autoResize: boolean;
}

interface Edge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide: string;
  toSide: string;
  arrowStart: boolean;
  arrowEnd: boolean;
}

interface State {
  nodes: CanvasNode[];
  edges: Edge[];
  selectedNode: CanvasNode | null;
  selectedNodes: CanvasNode[];
  selectedEdge: Edge | null;
  lastSelectedNode: CanvasNode | null;
  mode: string;
  zoom: number;
  offset: Point;
  isDragging: boolean;
  isResizing: boolean;
  dragStart: Point;
  resizeNode: CanvasNode | null;
  resizeStart: Point | null;
  resizeStartSize: { width: number; height: number } | null;
  dragOffset: Point;
  historyManager: HistoryManager;
  colorPalettes: string[];
  strokePalettes: string[];
  selectedPaletteIndex: number;
  editingPaletteIndex: number | undefined;
  editingPaletteType: string | undefined;
}

interface App {
  document: Document;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  fileInput: HTMLInputElement;
}

interface Context {
  state: State;
  app: App;
}

const _app: App = {
  document: document,
  canvas: document.getElementById('canvas') as HTMLCanvasElement,
  ctx: (document.getElementById('canvas') as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D,
  fileInput: document.getElementById('file-input') as HTMLInputElement
};


function getStrokeWidth(zoom: number): number {
  return 3 * zoom;
}

class HistoryManager {
  private history: string[] = [];
  private historyIndex: number = -1;
  private maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  save(state: State): void {
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

  undo(state: State): boolean {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.restore(state);
      return true;
    }
    return false;
  }

  redo(state: State): boolean {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.restore(state);
      return true;
    }
    return false;
  }

  private restore(state: State): void {
    const data = JSON.parse(this.history[this.historyIndex]);
    state.nodes = data.nodes;
    state.edges = data.edges;
    if (data.colorPalettes) state.colorPalettes = data.colorPalettes;
    if (data.strokePalettes) state.strokePalettes = data.strokePalettes;
    state.selectedNode = null;
    state.selectedEdge = null;
  }

  canUndo(): boolean {
    return this.historyIndex > 0;
  }

  canRedo(): boolean {
    return this.historyIndex < this.history.length - 1;
  }
}

const _state: State = {
  nodes: [],
  edges: [],
  selectedNode: null,
  selectedNodes: [],
  selectedEdge: null,
  lastSelectedNode: null,
  mode: 'select',
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
    '#000000', '#888888', '#ffffff',
    '#ff0000', '#00ff00', '#0000ff',
    '#ffff00', '#00ffff'
  ],
  strokePalettes: [
    '#000000', '#888888', '#ffffff',
    '#ff0000', '#00ff00', '#0000ff',
    '#ffff00', '#00ffff'
  ],
  selectedPaletteIndex: 0,
  editingPaletteIndex: undefined,
  editingPaletteType: undefined
};

const context: Context = { state: _state, app: _app };




const HORIZONTAL_PADDING = 18;
const VERTICAL_PADDING = 16;
const LINE_HEIGHT = 18;

function resizeCanvasWithRender(app: App) {
  resizeCanvas(app);
  render();
}

function autoResizeNode(node: CanvasNode, context: Context): void {
  const { app } = context;
  const { ctx } = app;
  if (!node.text) return;
  const { width, height } = calcTextRectSize(node.text, "14px 'DotGothic16'", LINE_HEIGHT, ctx);

  const minWidth = 80;
  const minHeight = 40;
  node.width = Math.max(minWidth, width + HORIZONTAL_PADDING);
  node.height = Math.max(minHeight, height + VERTICAL_PADDING);
}

function undo(state: State): void {
  if (state.historyManager.undo(state)) {
    render();
  }
}

function redo(state: State): void {
  if (state.historyManager.redo(state)) {
    render();
  }
}

// Functions moved to util.ts


// worldToScreen function moved to util.ts

function drawGrid(app: App, state: State): void {
  const { ctx, canvas } = app;
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

  const origin = worldToScreen({ x: 0, y: 0 }, state, canvas);
  ctx.strokeStyle = '#666';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(origin.x, 0);
  ctx.lineTo(origin.x, canvas.height);
  ctx.moveTo(0, origin.y);
  ctx.lineTo(canvas.width, origin.y);
  ctx.stroke();
}

function drawNode(node: CanvasNode, context: Context): void {
  const { state, app } = context;
  const { ctx, canvas } = app;

  const pos = worldToScreen({ x: node.x, y: node.y }, state, canvas);
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
      const lines = node.text.split('\n');
      const lineHeight = 18 * state.zoom;
      const align = node.textAlign || 'left';
      const valign = node.textValign || 'top';
      ctx.fillStyle = '#ffffff';
      ctx.font = `${14 * state.zoom}px 'DotGothic16'`;

      const verticalPadding = VERTICAL_PADDING * state.zoom;
      const verticalPaddingTop = verticalPadding / 2;
      const verticalPaddingBottom = verticalPadding / 2;

      const totalTextHeight = lines.length * lineHeight;

      const fontSize = 14 * state.zoom;
      const baselineOffset = fontSize * 0.75;

      let textY = 0;
      if (valign === 'top') {
        textY = baselineOffset + verticalPaddingTop;
      } else if (valign === 'middle') {
        textY = (h - totalTextHeight) / 2 + baselineOffset;
      } else if (valign === 'bottom') {
        textY = h - totalTextHeight + baselineOffset;
      }
      const startY = pos.y + textY;

      lines.forEach((line, i) => {
        let x = pos.x + HORIZONTAL_PADDING / 2;
        if (align === 'center') {
          x = pos.x + w / 2;
        } else if (align === 'right') {
          x = pos.x + w - HORIZONTAL_PADDING / 2;
        }
        const y = startY + i * lineHeight;

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
      ctx.lineWidth = getStrokeWidth(state.zoom);
      ctx.beginPath();
      ctx.arc(pos.x + w / 2, pos.y + h / 2, w / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function drawEdge(edge: Edge, context: Context): void {
  const { state, app } = context;
  const { ctx, canvas } = app;
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

  const fromEdgePoint = getRectEdgePoint(fromNode, toNode);
  const toEdgePoint = getRectEdgePoint(toNode, fromNode);

  const from = worldToScreen({ x: fromEdgePoint.x, y: fromEdgePoint.y }, context.state, canvas);
  const to = worldToScreen({ x: toEdgePoint.x, y: toEdgePoint.y }, context.state, canvas);

  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);

  if (maxX < 0 || minX > canvas.width || maxY < 0 || minY > canvas.height) {
    return;
  }

  ctx.strokeStyle = state.selectedEdge?.id === edge.id ? '#ffff00' : '#ffffff';
  ctx.lineWidth = getStrokeWidth(state.zoom);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  function drawArrow(from: Point, to: Point): void {
    const arrowAngle = Math.atan2(to.y - from.y, to.x - from.x);
    const arrowLen = getStrokeWidth(state.zoom) * 4;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - arrowLen * Math.cos(arrowAngle - Math.PI / 6), to.y - arrowLen * Math.sin(arrowAngle - Math.PI / 6));
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - arrowLen * Math.cos(arrowAngle + Math.PI / 6), to.y - arrowLen * Math.sin(arrowAngle + Math.PI / 6));
    ctx.stroke();
  }

  if (edge.arrowStart) {
    drawArrow(to, from);
  }
  if (edge.arrowEnd) {
    drawArrow(from, to);
  }
}

/** @category util */
// getRectEdgePoint function moved to util.ts

function renderFull(context: Context): void {
  const { state, app } = context;
  const { ctx, canvas } = app;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(context.app, context.state);

  state.nodes.forEach(node => drawNode(node, context));
  state.edges.forEach(edge => drawEdge(edge, context));
}

const render = () => renderFull(context);

function findNodeAt(point: Point, context: Context): CanvasNode | null {
  const { state, app } = context;
  const world = screenToWorld(point, context.state, app.canvas);
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    const node = state.nodes[i];
    if (world.x >= node.x && world.x <= node.x + node.width &&
      world.y >= node.y && world.y <= node.y + node.height) {
      return node;
    }
  }
  return null;
}

function findEdgeAt(point: Point, context: Context): Edge | null {
  const { state } = context;
  const threshold = 10;
  for (let i = state.edges.length - 1; i >= 0; i--) {
    const edge = state.edges[i];
    const fromNode = state.nodes.find(n => n.id === edge.fromNode);
    const toNode = state.nodes.find(n => n.id === edge.toNode);
    if (!fromNode || !toNode) continue;

    const from = worldToScreen({ x: fromNode.x + fromNode.width / 2, y: fromNode.y + fromNode.height / 2 }, context.state, context.app.canvas);
    const to = worldToScreen({ x: toNode.x + toNode.width / 2, y: toNode.y + toNode.height / 2 }, context.state, context.app.canvas);

    const dist = pointToLineDistance(point, from, to);
    if (dist < threshold) {
      return edge;
    }
  }
  return null;
}

/** @category util */
// pointToLineDistance function moved to util.ts

function addTextNode(state: State, x?: number, y?: number): void {
  const id = 'node-' + Date.now();
  const node: CanvasNode = {
    id,
    type: 'text',
    x: x !== undefined ? x : -50,
    y: y !== undefined ? y : -50,
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
  updatePropertiesPanel(state, _app);
  state.historyManager.save(state);
  render();
}

function addCircleNode(state: State): void {
  const id = 'node-' + Date.now();
  const node: CanvasNode = {
    id,
    type: 'circle',
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
  state.mode = 'select';
  updatePropertiesPanel(state, _app);
  state.historyManager.save(state);
  render();
}

function deleteSelected(state: State): void {
  if (state.selectedNode) {
    state.edges = state.edges.filter(e => e.fromNode !== state.selectedNode!.id && e.toNode !== state.selectedNode!.id);
    state.nodes = state.nodes.filter(n => n.id !== state.selectedNode!.id);
    state.selectedNode = null;
    state.historyManager.save(state);
    render();
  } else if (state.selectedEdge) {
    state.edges = state.edges.filter(e => e.id !== state.selectedEdge!.id);
    state.selectedEdge = null;
    state.historyManager.save(state);
    render();
  } else if (state.selectedNodes.length > 0) {
    state.selectedNodes.forEach(node => {
      state.edges = state.edges.filter(e => e.fromNode !== node.id && e.toNode !== node.id);
    });
    state.nodes = state.nodes.filter(n => !state.selectedNodes.includes(n));
    state.selectedNodes = [];
    state.historyManager.save(state);
    render();
  }
}

function addEdgeNode(state: State): void {
  let fromNode: CanvasNode | null = null;
  let toNode: CanvasNode | null = null;

  console.log('addEdgeNode:', 'selectedNodes:', state.selectedNodes.length, 'selectedNode:', state.selectedNode?.id, 'lastSelectedNode:', state.lastSelectedNode?.id);

  if (state.selectedNodes.length >= 2) {
    fromNode = state.selectedNodes[0];
    toNode = state.selectedNodes[1];
  } else if (state.selectedNode) {
    fromNode = state.lastSelectedNode;
    toNode = state.selectedNode;
  }

  if (fromNode && toNode) {
    const edge: Edge = {
      id: 'edge-' + Date.now(),
      fromNode: fromNode.id,
      toNode: toNode.id,
      fromSide: 'bottom',
      toSide: 'top',
      arrowStart: false,
      arrowEnd: false
    };
    state.edges.push(edge);
    state.selectedNodes = [];
    state.historyManager.save(state);
    render();
  } else {
    alert('SHIFT押しながら2つ、または1つのノードを選択してください');
  }
}

function exportToObsidianCanvas(state: State): string {
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

function saveToFile(context: Context): void {
  const { state } = context;
  const data = exportToObsidianCanvas(state);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = _app.document.createElement('a');
  a.href = url;
  a.download = 'canvas.json';
  a.click();
  URL.revokeObjectURL(url);
  localStorage.setItem(STORAGE_KEYS.AUTOSAVE, data);
}

function exportToPng(context: Context): void {
  const { state, app } = context;

  if (state.nodes.length === 0) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  state.nodes.forEach(node => {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  });

  const padding = 50;
  const width = Math.ceil(maxX - minX + padding * 2);
  const height = Math.ceil(maxY - minY + padding * 2);

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d')!;

  tempCtx.fillStyle = '#1a1a1a';
  tempCtx.fillRect(0, 0, width, height);

  const tempApp: App = {
    document: app.document,
    canvas: tempCanvas,
    ctx: tempCtx,
    fileInput: app.fileInput
  };

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const tempState: State = {
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
    strokePalettes: state.strokePalettes,
    selectedPaletteIndex: 0,
    editingPaletteIndex: undefined,
    editingPaletteType: undefined
  };

  tempState.nodes.forEach(n => {
    drawNode(n, { state: tempState, app: tempApp });
  });
  tempState.edges.forEach(e => {
    drawEdge(e, { state: tempState, app: tempApp });
  });

  const dataUrl = tempCanvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = 'canvas.png';
  a.click();
}

function loadFromFile(file: File, context: Context): void {
  const { state, app } = context;
  const { ctx, canvas } = app;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target!.result as string);
      if (data.nodes) {
        state.nodes = data.nodes.map((n: any) => {
          const node: CanvasNode = { ...n };
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
      state.historyManager.save(state);
      render();
    } catch (err) {
      alert('ファイルの形式が正しくありません');
    }
  };
  reader.readAsText(file);
}

// Function moved to util.ts
// function findPaletteIndex(palettes: string[], color: string | undefined): number

function loadFromLocalStorage(state: State): void {
  const data = localStorage.getItem(STORAGE_KEYS.AUTOSAVE);
  if (data) {
    try {
      const parsed = JSON.parse(data);
      if (parsed.nodes) state.nodes = parsed.nodes;
      if (parsed.edges) state.edges = parsed.edges;
      if (parsed.colorPalettes) state.colorPalettes = parsed.colorPalettes;
      if (parsed.strokePalettes) state.strokePalettes = parsed.strokePalettes;
      state.historyManager.save(state);
    } catch (e) { }
  }
}

function bringToFront(state: State): void {
  if (state.selectedNode) {
    const idx = state.nodes.indexOf(state.selectedNode);
    if (idx > -1) {
      state.nodes.splice(idx, 1);
      state.nodes.push(state.selectedNode);
      state.historyManager.save(state);
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
    state.historyManager.save(state);
    render();
  }
}

function sendToBack(state: State): void {
  if (state.selectedNode) {
    const idx = state.nodes.indexOf(state.selectedNode);
    if (idx > -1) {
      state.nodes.splice(idx, 1);
      state.nodes.unshift(state.selectedNode);
      state.historyManager.save(state);
      render();
    }
  } else if (state.selectedNodes.length > 0) {
    const selectedIds = state.selectedNodes.map(n => n.id);
    state.nodes = state.nodes.filter(n => !selectedIds.includes(n.id));
    state.nodes.unshift(...state.selectedNodes);
    state.historyManager.save(state);
    render();
  }
}

function handleKeyDown(e: KeyboardEvent, context: Context): void {
  const { state, app } = context;
  const { document } = app;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(state);
    else undo(state);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '1') {
    e.preventDefault();
    addTextNode(state);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '2') {
    e.preventDefault();
    addCircleNode(state);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === '3') {
    e.preventDefault();
    addEdgeNode(state);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowUp') {
    e.preventDefault();
    bringToFront(state);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowDown') {
    e.preventDefault();
    sendToBack(state);
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    if (state.selectedNode) {
      const fromNode = state.selectedNode;
      const newX = fromNode.x + fromNode.width + 20;
      const newY = fromNode.y;
      addTextNode(state, newX, newY);
      const toNode = state.selectedNode;
      if (fromNode && toNode && fromNode.id !== toNode.id) {
        const edge: Edge = {
          id: 'edge-' + Date.now(),
          fromNode: fromNode.id,
          toNode: toNode.id,
          fromSide: 'bottom',
          toSide: 'top',
          arrowStart: false,
          arrowEnd: false
        };
        state.edges.push(edge);
        state.historyManager.save(state);
        render();
      }
    }
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
      return;
    }
    deleteSelected(state);
  }
}

function handleWheel(e: WheelEvent, context: Context): void {
  const { state } = context;
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  state.zoom = Math.max(0.1, Math.min(5, state.zoom * delta));
  render();
}

function handleMouseDown(e: MouseEvent, context: Context): void {
  const { state, app } = context;
  const { canvas } = app;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const node = findNodeAt({ x, y }, context);

  if (node) {
    const world = screenToWorld({ x, y }, context.state, canvas);
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
          if (state.selectedNodes.length > 0) {
          } else if (state.selectedNode && state.selectedNode !== node) {
            state.lastSelectedNode = state.selectedNode;
          } else if (!state.lastSelectedNode) {
            state.lastSelectedNode = node;
          }
          state.selectedNodes = [];
          state.selectedNode = node;
        }
        state.selectedEdge = null;
      }
      state.isDragging = true;
      state.dragStart = screenToWorld({ x, y }, context.state, canvas);
      if (state.selectedNodes.length > 0) {
        state.dragOffset = screenToWorld({ x, y }, context.state, canvas);
      } else {
        state.dragOffset = {
          x: state.dragStart.x - node.x,
          y: state.dragStart.y - node.y
        };
      }
    }
  } else {
    const edge = findEdgeAt({ x, y }, context);
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

function handleMouseMove(e: MouseEvent, context: Context): void {
  const { state, app } = context;
  const { canvas } = app;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (state.isResizing && state.resizeNode) {
    const world = screenToWorld({ x, y }, context.state, canvas);
    const dx = world.x - state.resizeStart!.x;
    const dy = world.y - state.resizeStart!.y;
    const newWidth = Math.max(40, state.resizeStartSize!.width + dx);
    const newHeight = Math.max(30, state.resizeStartSize!.height + dy);
    state.resizeNode.width = newWidth;
    state.resizeNode.height = newHeight;
    render();
    return;
  }

  if (!state.isDragging) return;

  if (state.selectedNode) {
    const world = screenToWorld({ x, y }, context.state, canvas);
    state.selectedNode.x = world.x - state.dragOffset.x;
    state.selectedNode.y = world.y - state.dragOffset.y;
    render();
  } else if (state.selectedNodes.length > 0) {
    const world = screenToWorld({ x, y }, context.state, canvas);
    const dx = world.x - state.dragOffset.x;
    const dy = world.y - state.dragOffset.y;
    const startWorld = screenToWorld({ x: state.dragStart.x, y: state.dragStart.y }, context.state, canvas);
    const moveX = world.x - startWorld.x;
    const moveY = world.y - startWorld.y;
    state.selectedNodes.forEach(node => {
      node.x += moveX;
      node.y += moveY;
    });
    state.dragStart = { x, y };
    render();
  } else {
    state.offset.x += e.clientX - state.dragStart.x;
    state.offset.y += e.clientY - state.dragStart.y;
    state.dragStart = { x: e.clientX, y: e.clientY };
    render();
  }
}

function handleMouseUp(context: Context): void {
  const { state } = context;
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

function updatePropertiesPanel(state: State, app: App): void {
  const { document } = app;
  const nodeProps = document.getElementById('node-props') as HTMLElement;
  const edgeProps = document.getElementById('edge-props') as HTMLElement;
  const bgTransparentOpt = document.querySelector('.transparent-option') as HTMLElement;
  const strokeTransparentOpt = document.querySelectorAll('.transparent-option')[1] as HTMLElement;

  updatePaletteDisplay('bg-palette', context);
  updatePaletteDisplay('stroke-palette', context);

  if (state.selectedNode) {
    nodeProps.style.display = 'flex';
    edgeProps.style.display = 'none';
    (document.getElementById('prop-text') as HTMLInputElement).value = state.selectedNode.text || '';
    (document.getElementById('prop-text-halign') as HTMLSelectElement).value = state.selectedNode.textAlign || 'left';
    (document.getElementById('prop-text-valign') as HTMLSelectElement).value = state.selectedNode.textValign || 'top';
    (document.getElementById('prop-bg-transparent') as HTMLInputElement).checked = state.selectedNode.bgTransparent || false;
    (document.getElementById('prop-stroke-transparent') as HTMLInputElement).checked = state.selectedNode.strokeTransparent || false;
    (document.getElementById('prop-auto-resize') as HTMLInputElement).checked = state.selectedNode.autoResize !== false;

    const isText = state.selectedNode.type === 'text';
    bgTransparentOpt.style.display = isText ? 'inline' : 'none';
    strokeTransparentOpt.style.display = isText ? 'inline' : 'none';
  } else if (state.selectedEdge) {
    nodeProps.style.display = 'none';
    edgeProps.style.display = 'flex';
    (document.getElementById('prop-arrow-start') as HTMLInputElement).checked = state.selectedEdge.arrowStart || false;
    (document.getElementById('prop-arrow-end') as HTMLInputElement).checked = state.selectedEdge.arrowEnd || false;
  }
}

function updatePaletteDisplay(containerId: string, context: Context): void {
  const { state, app } = context;
  const { document } = app;
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const palettes = containerId === 'stroke-palette' ? state.strokePalettes : state.colorPalettes;
  const selectedIdx = containerId === 'stroke-palette' ? state.selectedNode?.strokePaletteIndex : state.selectedNode?.bgPaletteIndex;
  const propName = containerId === 'stroke-palette' ? 'strokePaletteIndex' : 'bgPaletteIndex';
  palettes.forEach((color, idx) => {
    const swatch = document.createElement('div');
    swatch.className = 'palette-swatch';
    swatch.style.backgroundColor = color;
    if (selectedIdx === idx) {
      swatch.classList.add('selected');
    }
    swatch.addEventListener('click', () => {
      if (state.selectedNode) {
        (state.selectedNode as any)[propName] = idx;
        render();
        updatePaletteDisplay('bg-palette', context);
        updatePaletteDisplay('stroke-palette', context);
        state.historyManager.save(state);
      }
    });
    swatch.addEventListener('dblclick', () => {
      state.editingPaletteIndex = idx;
      state.editingPaletteType = containerId;
      (document.getElementById('palette-color-picker') as HTMLInputElement).click();
    });
    container.appendChild(swatch);
  });
}

function initApp(context: Context): void {
  const { app } = context;
  const { canvas, fileInput } = app;

  canvas.addEventListener('mousedown', (e) => handleMouseDown(e, context));
  canvas.addEventListener('mousemove', (e) => handleMouseMove(e, context));
  canvas.addEventListener('mouseup', () => handleMouseUp(context));
  canvas.addEventListener('wheel', (e) => handleWheel(e, context));

  app.document.getElementById('btn-add-text')!.addEventListener('click', () => addTextNode(_state));
  app.document.getElementById('btn-add-circle')!.addEventListener('click', () => addCircleNode(_state));
  app.document.getElementById('btn-add-edge')!.addEventListener('click', () => addEdgeNode(_state));
  app.document.getElementById('btn-undo')!.addEventListener('click', () => undo(_state));
  app.document.getElementById('btn-redo')!.addEventListener('click', () => redo(_state));
  app.document.getElementById('btn-zoom-in')!.addEventListener('click', () => {
    _state.zoom = Math.min(5, _state.zoom * 1.2);
    render();
  });
  app.document.getElementById('btn-zoom-out')!.addEventListener('click', () => {
    _state.zoom = Math.max(0.1, _state.zoom / 1.2);
    render();
  });
  app.document.getElementById('btn-front')!.addEventListener('click', () => bringToFront(_state));
  app.document.getElementById('btn-back')!.addEventListener('click', () => sendToBack(_state));
  app.document.getElementById('btn-save')!.addEventListener('click', () => saveToFile(context));
  app.document.getElementById('btn-load')!.addEventListener('click', () => fileInput.click());
  app.document.getElementById('btn-log')!.addEventListener('click', () => {
    const data = exportToObsidianCanvas(context.state);
    console.log(data);
  });
  app.document.getElementById('btn-export-png')!.addEventListener('click', () => {
    exportToPng(context);
  });
  fileInput.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files[0]) loadFromFile(target.files[0], context);
  });

  app.document.addEventListener('keydown', (e) => handleKeyDown(e, context));

  window.addEventListener('resize', () => resizeCanvasWithRender(_app));

  app.document.getElementById('prop-arrow-start')!.addEventListener('change', (e) => {
    if (context.state.selectedEdge) {
      context.state.selectedEdge.arrowStart = (e.target as HTMLInputElement).checked;
      render();
      context.state.historyManager.save(context.state);
    }
  });

  app.document.getElementById('prop-arrow-end')!.addEventListener('change', (e) => {
    if (context.state.selectedEdge) {
      context.state.selectedEdge.arrowEnd = (e.target as HTMLInputElement).checked;
      render();
      context.state.historyManager.save(context.state);
    }
  });

  app.document.getElementById('prop-bg-transparent')!.addEventListener('change', (e) => {
    if (context.state.selectedNode) {
      context.state.selectedNode.bgTransparent = (e.target as HTMLInputElement).checked;
      render();
      context.state.historyManager.save(context.state);
    }
  });

  app.document.getElementById('prop-stroke-transparent')!.addEventListener('change', (e) => {
    if (context.state.selectedNode) {
      context.state.selectedNode.strokeTransparent = (e.target as HTMLInputElement).checked;
      render();
      context.state.historyManager.save(context.state);
    }
  });

  app.document.getElementById('prop-auto-resize')!.addEventListener('change', (e) => {
    if (context.state.selectedNode) {
      context.state.selectedNode.autoResize = (e.target as HTMLInputElement).checked;
      if ((e.target as HTMLInputElement).checked && context.state.selectedNode.text) {
        autoResizeNode(context.state.selectedNode, context);
      }
      render();
      context.state.historyManager.save(context.state);
    }
  });

  app.document.getElementById('prop-text')!.addEventListener('input', (e) => {
    if (context.state.selectedNode) {
      context.state.selectedNode.text = (e.target as HTMLInputElement).value;
      if (context.state.selectedNode.autoResize !== false) {
        autoResizeNode(context.state.selectedNode, context);
      }
      render();
      context.state.historyManager.save(context.state);
    }
  });

  app.document.getElementById('prop-text-halign')!.addEventListener('change', (e) => {
    if (context.state.selectedNode) {
      context.state.selectedNode.textAlign = (e.target as HTMLSelectElement).value as 'left' | 'center' | 'right';
      render();
      context.state.historyManager.save(context.state);
    }
  });

  app.document.getElementById('prop-text-valign')!.addEventListener('change', (e) => {
    if (context.state.selectedNode) {
      context.state.selectedNode.textValign = (e.target as HTMLSelectElement).value as 'top' | 'middle' | 'bottom';
      render();
      context.state.historyManager.save(context.state);
    }
  });

  app.document.getElementById('palette-color-picker')!.addEventListener('input', (e) => {
    if (context.state.editingPaletteIndex !== undefined) {
      const palettes = context.state.editingPaletteType === 'stroke-palette' ? context.state.strokePalettes : context.state.colorPalettes;
      palettes[context.state.editingPaletteIndex] = hexToRgba((e.target as HTMLInputElement).value);
      if (context.state.selectedNode) {
        updatePaletteDisplay('bg-palette', context);
        updatePaletteDisplay('stroke-palette', context);
      }
      render();
      context.state.historyManager.save(context.state);
    }
  });

  resizeCanvasWithRender(_app);
  loadFromLocalStorage(context.state);
  context.state.historyManager.save(context.state);
  render();
  updatePropertiesPanel(_state, _app);

  const isDev = localStorage.getItem(STORAGE_KEYS.DEV_MODE) === 'true' || new URLSearchParams(window.location.search).get('dev') === 'true';
  if (isDev) {
    (app.document.getElementById('btn-clear-storage') as HTMLElement).style.display = 'inline-block';
  }

  app.document.getElementById('btn-clear-storage')!.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEYS.AUTOSAVE);
    localStorage.removeItem(STORAGE_KEYS.DEV_MODE);
    location.reload();
  });
}

initApp(context);