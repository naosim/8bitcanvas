

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
  selectedPaletteIndex: 0,
  editingPaletteIndex: undefined,
  editingPaletteType: undefined
};

const context: Context = { state: _state, app: _app };




const HORIZONTAL_PADDING = 18;
const VERTICAL_PADDING = 16;
const LINE_HEIGHT = 18;
const PIXEL_SIZE = 4;

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

function snapToPixel(val: number, pixelSize: number): number {
  return Math.round(val / pixelSize) * pixelSize;
}

function drawPixelRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pixelSize: number, cornerSize: number = 0): void {
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

function fillPixelRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pixelSize: number, cornerSize: number = 0): void {
  if (cornerSize > 0) {
    for (let py = 0; py < h; py += pixelSize) {
      for (let px = 0; px < w; px += pixelSize) {
        const skipCorner = (px < cornerSize && py < cornerSize) ||
                          (px >= w - cornerSize && py < cornerSize) ||
                          (px < cornerSize && py >= h - cornerSize) ||
                          (px >= w - cornerSize && py >= h - cornerSize);
        if (skipCorner) continue;
        ctx.fillRect(x + px, y + py, pixelSize, pixelSize);
      }
    }
  } else {
    ctx.fillRect(x, y, w, h);
  }
}

function drawPixelArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point, pixelSize: number): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const angle = Math.atan2(dy, dx);
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.floor(len / pixelSize);

  ctx.fillRect(snapToPixel(from.x, pixelSize), snapToPixel(from.y, pixelSize), pixelSize, pixelSize);

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = snapToPixel(from.x + dx * t, pixelSize);
    const y = snapToPixel(from.y + dy * t, pixelSize);
    ctx.fillRect(x, y, pixelSize, pixelSize);
  }

  const arrowLen = pixelSize * 3;
  const arrowAngle = Math.PI / 6;
  const tipX = snapToPixel(to.x, pixelSize);
  const tipY = snapToPixel(to.y, pixelSize);
  const baseX = to.x - arrowLen * Math.cos(angle);
  const baseY = to.y - arrowLen * Math.sin(angle);
  const leftX = to.x - arrowLen * Math.cos(angle - arrowAngle);
  const leftY = to.y - arrowLen * Math.sin(angle - arrowAngle);
  const rightX = to.x - arrowLen * Math.cos(angle + arrowAngle);
  const rightY = to.y - arrowLen * Math.sin(angle + arrowAngle);

  for (let t = 0; t <= 1; t += 0.2) {
    ctx.fillRect(snapToPixel(baseX + (leftX - baseX) * t, pixelSize), snapToPixel(baseY + (leftY - baseY) * t, pixelSize), pixelSize, pixelSize);
    ctx.fillRect(snapToPixel(baseX + (rightX - baseX) * t, pixelSize), snapToPixel(baseY + (rightY - baseY) * t, pixelSize), pixelSize, pixelSize);
  }
}

function drawNode(node: CanvasNode, context: Context): void {
  const { state, app } = context;
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

  if (node.type === 'text') {
    const bgHex = state.colorPalettes[node.bgPaletteIndex] || '#4444aa';
    const bgTransparent = node.bgTransparent;
    const strokeTransparent = node.strokeTransparent;

    if (!bgTransparent) {
      ctx.fillStyle = bgHex;
      ctx.fillRect(snappedX, snappedY, w, h);
    }

    const strokeColor = isSelected ? '#ffff00' : '#ffffff';
    if (isSelected || !strokeTransparent) {
      ctx.fillStyle = strokeColor;
      drawPixelRect(ctx, snappedX, snappedY, w, h, pixelSize, pixelSize);
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
      const startY = snappedY + textY;

      lines.forEach((line, i) => {
        let x = snappedX + HORIZONTAL_PADDING / 2;
        if (align === 'center') {
          x = snappedX + w / 2;
        } else if (align === 'right') {
          x = snappedX + w - HORIZONTAL_PADDING / 2;
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
  } else if (node.type === 'dot' || node.type === 'circle') {
    const bgHex = state.colorPalettes[node.bgPaletteIndex] || '#44aa44';
    const bgTransparent = node.bgTransparent;
    const strokeColor = isSelected ? '#ffff00' : '#ffffff';

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

  const pixelSize = PIXEL_SIZE * state.zoom;
  const strokeColor = state.selectedEdge?.id === edge.id ? '#ffff00' : '#ffffff';

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

  function drawPixelArrowHead(from: Point, to: Point, pixelSize: number): void {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.atan2(dy, dx);
    const arrowOffset = pixelSize * 5;
    const arrowTip = { x: to.x - arrowOffset * Math.cos(angle), y: to.y - arrowOffset * Math.sin(angle) };

    const pattern = [[1], [1, 2], [1, 2, 3], [1, 2], [1]];
    pattern.forEach((col, i) => {
      col.forEach((j) => {
        const px = j * pixelSize;
        const py = (i - 2) * pixelSize;
        const rx = px * Math.cos(angle) - py * Math.sin(angle) + arrowTip.x;
        const ry = px * Math.sin(angle) + py * Math.cos(angle) + arrowTip.y;
        ctx.fillRect(rx, ry, pixelSize, pixelSize);
      });
    });
  }

  if (edge.arrowStart) {
    drawPixelArrowHead(to, from, pixelSize);
  }
  if (edge.arrowEnd) {
    drawPixelArrowHead(from, to, pixelSize);
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

function createNew(state: State): void {
  state.nodes = [];
  state.edges = [];
  state.selectedNode = null;
  state.selectedNodes = [];
  state.selectedEdge = null;
  state.lastSelectedNode = null;
  state.mode = 'select';
  state.zoom = 1;
  state.offset = { x: 0, y: 0 };

  const textA: CanvasNode = {
    id: 'node-start',
    type: 'text',
    x: -150,
    y: -30,
    width: 120,
    height: 60,
    text: 'テキストA',
    textAlign: 'center',
    textValign: 'middle',
    bgPaletteIndex: 1,
    bgTransparent: false,
    strokeTransparent: false,
    autoResize: true
  };
  const textB: CanvasNode = {
    id: 'node-end',
    type: 'text',
    x: 30,
    y: -30,
    width: 120,
    height: 60,
    text: 'テキストB',
    textAlign: 'center',
    textValign: 'middle',
    bgPaletteIndex: 1,
    bgTransparent: false,
    strokeTransparent: false,
    autoResize: true
  };
  const edge: Edge = {
    id: 'edge-init',
    fromNode: 'node-start',
    toNode: 'node-end',
    fromSide: 'right',
    toSide: 'left',
    arrowStart: false,
    arrowEnd: true
  };

  state.nodes.push(textA, textB);
  state.edges.push(edge);
  state.selectedNode = textB;
  state.lastSelectedNode = textA;
  state.historyManager.save(state);
  render();
  updatePropertiesPanel(state, _app);
}

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

function addDotNode(state: State): void {
  const id = 'node-' + Date.now();
  const size = PIXEL_SIZE * 3;
  const node: CanvasNode = {
    id,
    type: 'dot',
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
  state.mode = 'select';
  updatePropertiesPanel(state, _app);
  state.historyManager.save(state);
  render();
}

function addDotAtEdge(state: State): void {
  if (!state.selectedEdge) return;
  const edge = state.selectedEdge;
  const fromNode = state.nodes.find(n => n.id === edge.fromNode);
  const toNode = state.nodes.find(n => n.id === edge.toNode);
  if (!fromNode || !toNode) return;

  const fromEdgePoint = getRectEdgePoint(fromNode, toNode);
  const toEdgePoint = getRectEdgePoint(toNode, fromNode);
  const midX = (fromEdgePoint.x + toEdgePoint.x) / 2;
  const midY = (fromEdgePoint.y + toEdgePoint.y) / 2;

  const id = 'node-' + Date.now();
  const size = PIXEL_SIZE * 3;
  const node: CanvasNode = {
    id,
    type: 'dot',
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

  state.edges = state.edges.filter(e => e.id !== edge.id);

  const edge1: Edge = {
    id: 'edge-' + Date.now(),
    fromNode: fromNode.id,
    toNode: node.id,
    fromSide: 'bottom',
    toSide: 'top',
    arrowStart: false,
    arrowEnd: false
  };
  const edge2: Edge = {
    id: 'edge-' + (Date.now() + 1),
    fromNode: node.id,
    toNode: toNode.id,
    fromSide: 'bottom',
    toSide: 'top',
    arrowStart: false,
    arrowEnd: edge.arrowEnd
  };
  state.edges.push(edge1, edge2);

  state.selectedNode = node;
  state.selectedEdge = null;
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
      type: n.type === 'dot' ? 'text' : n.type,
      x: Math.round(n.x),
      y: Math.round(n.y),
      width: n.width,
      height: n.height,
      text: n.text || '',
      bg: state.colorPalettes[n.bgPaletteIndex] || '#000000',
      color: '#ffffff',
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
            node.type = 'dot';
            const oldSize = PIXEL_SIZE * 3;
            node.width = oldSize;
            node.height = oldSize;
            node.bgPaletteIndex = findPaletteIndex(state.colorPalettes, n.bg);
          } else {
            node.type = n.type || 'text';
            node.bgPaletteIndex = findPaletteIndex(state.colorPalettes, n.bg);
          }
          node.bgTransparent = n.bgTransparent || false;
          node.autoResize = n.autoResize !== undefined ? n.autoResize : true;
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
    addDotNode(state);
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

  updatePaletteDisplay('bg-palette', context);

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
  let palettes = state.colorPalettes;
  let selectedIdx = state.selectedNode?.bgPaletteIndex;
  if (state.selectedNode?.type === 'dot') {
    palettes = state.colorPalettes.slice(0, 3);
    if (selectedIdx !== undefined && selectedIdx >= 3) {
      selectedIdx = 0;
      state.selectedNode.bgPaletteIndex = 0;
    }
  }
  palettes.forEach((color, idx) => {
    const swatch = document.createElement('div');
    swatch.className = 'palette-swatch';
    swatch.style.backgroundColor = color;
    if (selectedIdx === idx) {
      swatch.classList.add('selected');
    }
    swatch.addEventListener('click', () => {
      if (state.selectedNode) {
        if (state.selectedNode.type === 'dot') {
          state.selectedNode.bgPaletteIndex = idx;
        } else {
          state.selectedNode.bgPaletteIndex = idx;
        }
        render();
        updatePaletteDisplay('bg-palette', context);
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

  app.document.getElementById('btn-new')!.addEventListener('click', () => createNew(_state));
  app.document.getElementById('btn-add-text')!.addEventListener('click', () => addTextNode(_state));
  app.document.getElementById('btn-add-dot')!.addEventListener('click', () => addDotNode(_state));
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
  app.document.getElementById('btn-add-dot-to-edge')!.addEventListener('click', () => addDotAtEdge(_state));
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
      context.state.colorPalettes[context.state.editingPaletteIndex] = hexToRgba((e.target as HTMLInputElement).value);
      if (context.state.selectedNode) {
        updatePaletteDisplay('bg-palette', context);
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