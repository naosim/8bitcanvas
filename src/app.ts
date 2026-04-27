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

const TEXT_NODE_DEFAULT = {
  width: 120,
  height: 60
} as const;

const HORIZONTAL_PADDING = 18;
const VERTICAL_PADDING = 16;
const LINE_HEIGHT = 18;
const PIXEL_SIZE = 4;

/** 新規作成時の2つのテキストノードを中央から左右に離すオフセット */
const NEW_CANVAS_INITIAL_OFFSET = PIXEL_SIZE * 16;

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
  edgeAnimation: { fromNode: string, toNode: string, progress: number } | null;
  edgeDeleteAnimation: { fromNode: string, toNode: string, progress: number, dots: { x: number, y: number, vx: number, vy: number }[] } | null;
  nodeDeleteAnimation: { node: CanvasNode, progress: number, dots: { x: number, y: number, vx: number, vy: number }[] } | null;
  nodeCreateAnimation: { nodeId: string, progress: number } | null;
  fileHandle: FileSystemFileHandle | null;
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
  editingPaletteType: undefined,
  edgeAnimation: null,
  edgeDeleteAnimation: null,
  nodeDeleteAnimation: null,
  nodeCreateAnimation: null,
  fileHandle: null
};

const context: Context = { state: _state, app: _app };

function findFreePosition(state: State, x: number, y: number, width: number, height: number): Point {
  const offset = PIXEL_SIZE * 8;
  const maxAttempts = 20;
  
  for (let i = 0; i < maxAttempts; i++) {
    const checkX = x - width / 2 + (i % 5) * offset * Math.floor(i / 5);
    const checkY = y - height / 2 + Math.floor(i / 5) * offset;
    
    const occupied = state.nodes.some(n => {
      return !(checkX + width < n.x || checkX > n.x + n.width ||
               checkY + height < n.y || checkY > n.y + n.height);
    });
    
    if (!occupied) {
      return { x: checkX, y: checkY };
    }
  }
  
  return { x: x - width / 2, y: y - height / 2 };
}

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

function drawGrid(app: App, state: State): void {
  const { ctx, canvas } = app;
  const gridSize = 32 * state.zoom;
  const offsetX = state.offset.x % gridSize;
  const offsetY = state.offset.y % gridSize;
  const pixelSize = PIXEL_SIZE * state.zoom;

  ctx.fillStyle = '#333333';
  for (let x = offsetX; x < canvas.width; x += gridSize) {
    for (let y = offsetY; y < canvas.height; y += gridSize) {
      ctx.fillRect(x, y, pixelSize, pixelSize);
    }
  }

  const origin = worldToScreen({ x: 0, y: 0 }, state, canvas);
  ctx.strokeStyle = '#666666';
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
  if (cornerSize > 0) {
    const cs = cornerSize;
    ctx.fillRect(x + cs, y, w - cs * 2, pixelSize);
    ctx.fillRect(x + cs, y + h - pixelSize, w - cs * 2, pixelSize);
    ctx.fillRect(x, y + cs, pixelSize, h - cs * 2);
    ctx.fillRect(x + w - pixelSize, y + cs, pixelSize, h - cs * 2);
    ctx.fillRect(x + pixelSize, y + pixelSize, pixelSize, pixelSize);
    ctx.fillRect(x + w - pixelSize * 2, y + pixelSize, pixelSize, pixelSize);
    ctx.fillRect(x + pixelSize, y + h - pixelSize * 2, pixelSize, pixelSize);
    ctx.fillRect(x + w - pixelSize * 2, y + h - pixelSize * 2, pixelSize, pixelSize);
  } else {
    ctx.fillRect(x, y, w, pixelSize);
    ctx.fillRect(x, y + h - pixelSize, w, pixelSize);
    ctx.fillRect(x, y, pixelSize, h);
    ctx.fillRect(x + w - pixelSize, y, pixelSize, h);
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
    drawTextNode(ctx, node, snappedX, snappedY, w, h, pixelSize, isSelected, state.zoom, state.colorPalettes, state);
  } else if (node.type === 'dot' || node.type === 'circle') {
    drawDotNode(ctx, node, snappedX, snappedY, w, h, pixelSize, isSelected, state.zoom, state.colorPalettes);
  }
}

function drawTextNode(ctx: CanvasRenderingContext2D, node: CanvasNode, x: number, y: number, w: number, h: number, pixelSize: number, isSelected: boolean, zoom: number, colorPalettes: string[], state: State): void {
  let scale = 1;
  if (state.nodeCreateAnimation && state.nodeCreateAnimation.nodeId === node.id) {
    const p = state.nodeCreateAnimation.progress;
    if (p < 0.7) {
      scale = 1 - Math.pow(1 - p / 0.7, 3);
    } else {
      scale = 1;
    }
  }

  const centerX = x + w / 2;
  const centerY = y + h / 2;
  const scaledW = w * scale;
  const scaledH = h * scale;
  const drawX = centerX - scaledW / 2;
  const drawY = centerY - scaledH / 2;

  const bgHex = colorPalettes[node.bgPaletteIndex] || '#4444aa';
  const bgTransparent = node.bgTransparent;
  const strokeTransparent = node.strokeTransparent;

  if (!bgTransparent) {
    ctx.fillStyle = bgHex;
    ctx.fillRect(drawX, drawY, scaledW, scaledH);
  }

  const strokeColor = isSelected ? '#ffff00' : '#ffffff';
  if (isSelected || !strokeTransparent) {
    ctx.fillStyle = strokeColor;
    drawPixelRect(ctx, drawX, drawY, scaledW, scaledH, pixelSize, pixelSize);
  }

  if (node.text && zoom > 0.3 && scale > 0.1) {
    const lines = node.text.split('\n');
    const lineHeight = 18 * zoom;
    const align = node.textAlign || 'left';
    const valign = node.textValign || 'top';
    ctx.fillStyle = '#ffffff';
    ctx.font = `${14 * zoom}px 'DotGothic16'`;

    const verticalPadding = VERTICAL_PADDING * zoom;
    const verticalPaddingTop = verticalPadding / 2;

    const totalTextHeight = lines.length * lineHeight;

    const fontSize = 14 * zoom;
    const baselineOffset = fontSize * 0.75;

    let textY = 0;
    if (valign === 'top') {
      textY = baselineOffset + verticalPaddingTop;
    } else if (valign === 'middle') {
      textY = (scaledH - totalTextHeight) / 2 + baselineOffset;
    } else if (valign === 'bottom') {
      textY = scaledH - totalTextHeight + baselineOffset;
    }
    const startY = drawY + textY;

    lines.forEach((line, i) => {
      let px = drawX + HORIZONTAL_PADDING / 2;
      if (align === 'center') {
        px = drawX + scaledW / 2;
      } else if (align === 'right') {
        px = drawX + scaledW - HORIZONTAL_PADDING / 2;
      }
      const py = startY + i * lineHeight;

      if (align === 'center') {
        ctx.textAlign = 'center';
        ctx.fillText(line, px, py);
      } else if (align === 'right') {
        ctx.textAlign = 'right';
        ctx.fillText(line, px, py);
      } else {
        ctx.textAlign = 'left';
        ctx.fillText(line, px, py);
      }
    });
    ctx.textAlign = 'left';
  }
}

function drawDotNode(ctx: CanvasRenderingContext2D, node: CanvasNode, x: number, y: number, w: number, h: number, pixelSize: number, isSelected: boolean, zoom: number, colorPalettes: string[]): void {
  const bgHex = colorPalettes[node.bgPaletteIndex] || '#44aa44';
  const bgTransparent = node.bgTransparent;
  const strokeColor = isSelected ? '#ffff00' : '#ffffff';

  if (!bgTransparent) {
    ctx.fillStyle = bgHex;
    ctx.fillRect(x, y, w, h);
  }
  ctx.fillStyle = strokeColor;
  drawPixelRect(ctx, x, y, w, h, pixelSize);
}

function drawEdge(edge: Edge, context: Context): void {
  const { state, app } = context;
  const { ctx, canvas } = app;
  const fromNode = state.nodes.find(n => n.id === edge.fromNode);
  const toNode = state.nodes.find(n => n.id === edge.toNode);
  if (!fromNode || !toNode) return;

  const fromEdgePoint = getRectEdgePoint(fromNode, toNode);
  const toEdgePoint = getRectEdgePoint(toNode, fromNode);

  const from = worldToScreen({ x: fromEdgePoint.x, y: fromEdgePoint.y }, context.state, canvas);
  const to = worldToScreen({ x: toEdgePoint.x, y: toEdgePoint.y }, context.state, canvas);

  if (from.x === to.x && from.y === to.y) return;

  const minX = Math.min(from.x, to.x);
  const maxX = Math.max(from.x, to.x);
  const minY = Math.min(from.y, to.y);
  const maxY = Math.max(from.y, to.y);

  if (maxX < 0 || minX > canvas.width || maxY < 0 || minY > canvas.height) {
    return;
  }

  const pixelSize = PIXEL_SIZE * state.zoom;
  const strokeColor = state.selectedEdge?.id === edge.id ? '#ffff00' : '#ffffff';
  const dist = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
  const steps = Math.max(1, Math.floor(dist / pixelSize));

  ctx.fillStyle = strokeColor;
  const dx = to.x - from.x;
  const dy = to.y - from.y;

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

function renderFull(context: Context): void {
  const { state, app } = context;
  const { ctx, canvas } = app;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(context.app, context.state);

  state.nodes.forEach(node => drawNode(node, context));

  const animatingFrom = state.edgeAnimation?.fromNode;
  const animatingTo = state.edgeAnimation?.toNode;

  state.edges.forEach(edge => {
    if (animatingFrom === edge.fromNode && animatingTo === edge.toNode) {
      return;
    }
    drawEdge(edge, context);
  });

  if (animatingFrom && animatingTo && state.edgeAnimation) {
    const from = state.nodes.find(n => n.id === animatingFrom);
    const to = state.nodes.find(n => n.id === animatingTo);
    if (from && to) {
      drawPartialEdge(context, from, to, state.edgeAnimation.progress);
    }
  } else {
    const edge = state.edges.find(e => e.fromNode === animatingFrom && e.toNode === animatingTo);
    if (edge) {
      drawEdge(edge, context);
    }
  }

  if (state.edgeDeleteAnimation) {
    if (state.edgeDeleteAnimation.progress >= 1) return;
    const pixelSize = PIXEL_SIZE * state.zoom;
    const alpha = 1 - state.edgeDeleteAnimation.progress;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    state.edgeDeleteAnimation.dots.forEach(dot => {
      ctx.fillRect(snapToPixel(dot.x, pixelSize), snapToPixel(dot.y, pixelSize), pixelSize, pixelSize);
    });
    ctx.globalAlpha = 1;
  }

  if (state.nodeDeleteAnimation) {
    if (state.nodeDeleteAnimation.progress >= 1) return;
    const pixelSize = PIXEL_SIZE * state.zoom;
    const alpha = 1 - state.nodeDeleteAnimation.progress;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    state.nodeDeleteAnimation.dots.forEach(dot => {
      ctx.fillRect(snapToPixel(dot.x, pixelSize), snapToPixel(dot.y, pixelSize), pixelSize, pixelSize);
    });
    ctx.globalAlpha = 1;
  }
}

const render = () => renderFull(context);

function drawPartialEdge(context: Context, fromNode: CanvasNode, toNode: CanvasNode, progress: number): void {
  const { state, app } = context;
  const { ctx, canvas } = app;
  const fromPos = getRectEdgePoint(fromNode, toNode);
  const toPos = getRectEdgePoint(toNode, fromNode);
  const from = worldToScreen(fromPos, state, canvas);
  const to = worldToScreen(toPos, state, canvas);
  if (from.x === to.x && from.y === to.y) return;
  const pixelSize = PIXEL_SIZE * state.zoom;
  const dist = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
  const steps = Math.max(1, Math.floor(dist / pixelSize));
  const currentSteps = Math.floor(steps * progress);
  ctx.fillStyle = '#ffffff';
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  for (let i = 0; i <= currentSteps; i++) {
    const t = i / steps;
    const x = snapToPixel(from.x + dx * t, pixelSize);
    const y = snapToPixel(from.y + dy * t, pixelSize);
    ctx.fillRect(x, y, pixelSize, pixelSize);
  }
}

function drawEdgeAnimation(context: Context): void {
  const { state, app } = context;
  const { ctx, canvas } = app;
  if (!state.edgeAnimation) return;
  const { fromNode, toNode, progress } = state.edgeAnimation;
  const from = state.nodes.find(n => n.id === fromNode);
  const to = state.nodes.find(n => n.id === toNode);
  if (!from || !to) return;
  if (progress >= 1) {
    state.edgeAnimation = null;
    return;
  }
  const fromPos = getRectEdgePoint(from, to);
  const toPos = getRectEdgePoint(to, from);
  const fromScreen = worldToScreen(fromPos, state, canvas);
  const toScreen = worldToScreen(toPos, state, canvas);
  const pixelSize = PIXEL_SIZE * state.zoom;
  const dx = toScreen.x - fromScreen.x;
  const dy = toScreen.y - fromScreen.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.floor(dist / pixelSize));
  const currentSteps = Math.floor(steps * progress);
  for (let i = 0; i <= currentSteps; i++) {
    const t = i / steps;
    const x = snapToPixel(fromScreen.x + dx * t, pixelSize);
    const y = snapToPixel(fromScreen.y + dy * t, pixelSize);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, pixelSize, pixelSize);
  }
}

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

let recognition: any = null;
let recognitionContinuous = false;

function startVoiceInput(context: Context): void {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    alert('このブラウザは音声認識に対応していません');
    return;
  }

  const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!recognition) {
    recognition = new SpeechRecognitionClass();
    recognition.lang = 'ja-JP';
    recognition.continuous = recognitionContinuous;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      if (!context.state.selectedNode) return;
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      if (event.results[event.resultIndex].isFinal) {
        const textField = document.getElementById('prop-text') as HTMLTextAreaElement;
        textField.value += transcript;
        context.state.selectedNode.text = textField.value;
        if (context.state.selectedNode.autoResize !== false) {
          autoResizeNode(context.state.selectedNode, context);
        }
        render();
        context.state.historyManager.save(context.state);
      }
    };

    recognition.onend = () => {
      if (recognitionContinuous) {
        recognition?.start();
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error', event.error);
    };
  }

  recognitionContinuous = !recognitionContinuous;
  if (recognitionContinuous) {
    (document.getElementById('btn-voice') as HTMLButtonElement).style.background = '#ff0000';
    (document.getElementById('btn-voice') as HTMLButtonElement).style.animation = 'pulse 1s infinite';
    try {
      recognition.start();
    } catch (e) {
      console.error('Recognition already started');
    }
  } else {
    recognition.stop();
    (document.getElementById('btn-voice') as HTMLButtonElement).style.background = '';
    (document.getElementById('btn-voice') as HTMLButtonElement).style.animation = '';
  }
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
  state.fileHandle = null;

  const textA: CanvasNode = {
    id: 'node-start',
    type: 'text',
    x: -TEXT_NODE_DEFAULT.width / 2 - NEW_CANVAS_INITIAL_OFFSET,
    y: -TEXT_NODE_DEFAULT.height / 2,
    width: TEXT_NODE_DEFAULT.width,
    height: TEXT_NODE_DEFAULT.height,
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
    x: TEXT_NODE_DEFAULT.width / 2 + NEW_CANVAS_INITIAL_OFFSET,
    y: -TEXT_NODE_DEFAULT.height / 2,
    width: TEXT_NODE_DEFAULT.width,
    height: TEXT_NODE_DEFAULT.height,
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

function addTextNode(state: State, x?: number, y?: number, app?: App): void {
  const id = 'node-' + Date.now();
  let nodeX = 0;
  let nodeY = 0;
  if (x !== undefined && y !== undefined) {
    nodeX = x;
    nodeY = y;
  } else if (app) {
    const world = screenToWorld({ x: app.canvas.width / 2, y: app.canvas.height / 2 }, state, app.canvas);
    nodeX = world.x;
    nodeY = world.y;
  }
  const pos = findFreePosition(state, nodeX, nodeY, TEXT_NODE_DEFAULT.width, TEXT_NODE_DEFAULT.height);
  nodeX = snapToPixel(pos.x, PIXEL_SIZE);
  nodeY = snapToPixel(pos.y, PIXEL_SIZE);
  const node: CanvasNode = {
    id,
    type: 'text',
    x: nodeX - TEXT_NODE_DEFAULT.width / 2,
    y: nodeY - TEXT_NODE_DEFAULT.height / 2,
    width: TEXT_NODE_DEFAULT.width,
    height: TEXT_NODE_DEFAULT.height,
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
  state.nodeCreateAnimation = { nodeId: id, progress: 0 };
  startNodeCreateAnimation();
  updatePropertiesPanel(state, _app);
  state.historyManager.save(state);
  render();
}

function splitNodeToMultipleNodes(context: Context): void {
  const { state } = context;
  if (!state.selectedNode || state.selectedNode.type !== 'text') return;
  const text = state.selectedNode.text;
  if (!text) return;

  const parts = text.split('\n').filter(s => s.trim().length > 0);
  if (parts.length <= 1) return;

  const baseNode = state.selectedNode;
  const baseX = baseNode.x;
  const baseY = baseNode.y;
  const spacing = baseNode.height;

  const incomingEdges = state.edges.filter(e => e.toNode === baseNode.id);
  const outgoingEdges = state.edges.filter(e => e.fromNode === baseNode.id);

  state.nodes = state.nodes.filter(n => n.id !== baseNode.id);
  state.edges = state.edges.filter(e => e.fromNode !== baseNode.id && e.toNode !== baseNode.id);

  const newNodes: CanvasNode[] = [];

  parts.forEach((part, i) => {
    const id = 'node-' + Date.now() + i;
    const node: CanvasNode = {
      id,
      type: 'text',
      x: baseX,
      y: baseY + i * spacing,
      width: baseNode.width,
      height: baseNode.height,
      text: part,
      textAlign: baseNode.textAlign,
      textValign: baseNode.textValign,
      bgPaletteIndex: baseNode.bgPaletteIndex,
      bgTransparent: baseNode.bgTransparent,
      strokeTransparent: baseNode.strokeTransparent,
      autoResize: baseNode.autoResize
    };
    if (node.autoResize !== false) {
      autoResizeNode(node, context);
    }
    state.nodes.push(node);
    newNodes.push(node);
  });

  const newNodeIds = newNodes.map(n => n.id);

  incomingEdges.forEach(edge => {
    newNodeIds.forEach(newId => {
      const newEdge: Edge = {
        id: 'edge-' + Date.now() + '-' + newId,
        fromNode: edge.fromNode,
        toNode: newId,
        fromSide: edge.fromSide || 'bottom',
        toSide: edge.toSide || 'top',
        arrowStart: edge.arrowStart,
        arrowEnd: edge.arrowEnd
      };
      state.edges.push(newEdge);
    });
  });

  outgoingEdges.forEach(edge => {
    newNodeIds.forEach(newId => {
      const newEdge: Edge = {
        id: 'edge-' + Date.now() + '-' + newId,
        fromNode: newId,
        toNode: edge.toNode,
        fromSide: edge.fromSide || 'bottom',
        toSide: edge.toSide || 'top',
        arrowStart: edge.arrowStart,
        arrowEnd: edge.arrowEnd
      };
      state.edges.push(newEdge);
    });
  });

  state.selectedNode = null;
  state.historyManager.save(state);
  updatePropertiesPanel(state, _app);
  render();
}

function addDotNode(state: State, x?: number, y?: number, app?: App): void {
  const id = 'node-' + Date.now();
  const size = PIXEL_SIZE * 3;
  let nodeX = 0;
  let nodeY = 0;
  if (x !== undefined && y !== undefined) {
    nodeX = x;
    nodeY = y;
  } else if (app) {
    const world = screenToWorld({ x: app.canvas.width / 2, y: app.canvas.height / 2 }, state, app.canvas);
    nodeX = world.x;
    nodeY = world.y;
  }
  const pos = findFreePosition(state, nodeX, nodeY, size, size);
  nodeX = snapToPixel(pos.x, PIXEL_SIZE);
  nodeY = snapToPixel(pos.y, PIXEL_SIZE);
  const node: CanvasNode = {
    id,
    type: 'dot',
    x: nodeX - size / 2,
    y: nodeY - size / 2,
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
    const node = state.selectedNode;
    const world = worldToScreen({ x: node.x, y: node.y }, state, _app.canvas);
    const pixelSize = PIXEL_SIZE * state.zoom;
    const dots: { x: number, y: number, vx: number, vy: number }[] = [];
    for (let py = 0; py < node.height * state.zoom; py += pixelSize * 2) {
      for (let px = 0; px < node.width * state.zoom; px += pixelSize * 2) {
        if (Math.random() > 0.7) {
          dots.push({
            x: world.x + px,
            y: world.y + py,
            vx: (Math.random() - 0.5) * 3,
            vy: (Math.random() - 0.5) * 3 - 2
          });
        }
      }
    }
    state.nodeDeleteAnimation = { node, progress: 0, dots };
    startNodeDeleteAnimation();
    state.edges = state.edges.filter(e => e.fromNode !== node.id && e.toNode !== node.id);
    state.nodes = state.nodes.filter(n => n.id !== node.id);
    state.selectedNode = null;
    state.historyManager.save(state);
    updatePropertiesPanel(state, _app);
    render();
  } else if (state.selectedEdge) {
    const edge = state.selectedEdge;
    state.edges = state.edges.filter(e => e.id !== edge.id);
    state.edgeDeleteAnimation = {
      fromNode: edge.fromNode,
      toNode: edge.toNode,
      progress: 0,
      dots: []
    };
    startEdgeDeleteAnimation();
    state.selectedEdge = null;
    state.historyManager.save(state);
    updatePropertiesPanel(state, _app);
    render();
  } else if (state.selectedNodes.length > 0) {
    state.selectedNodes.forEach(node => {
      state.edges = state.edges.filter(e => e.fromNode !== node.id && e.toNode !== node.id);
    });
    state.nodes = state.nodes.filter(n => !state.selectedNodes.includes(n));
    state.selectedNodes = [];
    state.selectedNode = null;
    state.historyManager.save(state);
    updatePropertiesPanel(state, _app);
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
    state.edgeAnimation = { fromNode: fromNode.id, toNode: toNode.id, progress: 0 };
    state.selectedNodes = [];
    state.historyManager.save(state);
    startEdgeAnimation();
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

async function saveToFile(context: Context): Promise<void> {
  const { state } = context;
  const data = exportToObsidianCanvas(state);

  if ('showSaveFilePicker' in window) {
    try {
      if (state.fileHandle) {
        const writable = await state.fileHandle.createWritable();
        await writable.write(data);
        await writable.close();
        localStorage.setItem(STORAGE_KEYS.AUTOSAVE, data);
        return;
      }
      const handle = await (window as any).showSaveFilePicker({
        types: [{
          description: 'Canvas File',
          accept: { 'application/json': ['.json', '.canvas'] }
        }]
      });
      state.fileHandle = handle;
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      localStorage.setItem(STORAGE_KEYS.AUTOSAVE, data);
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }

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
    editingPaletteType: undefined,
    edgeAnimation: null,
    edgeDeleteAnimation: null,
    nodeDeleteAnimation: null,
    nodeCreateAnimation: null,
    fileHandle: null
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

async function loadFromFile(context: Context): Promise<void> {
  const { state } = context;

  if ('showOpenFilePicker' in window) {
    try {
      const [handle] = await (window as any).showOpenFilePicker({
        types: [{
          description: 'Canvas File',
          accept: { 'application/json': ['.json', '.canvas'] }
        }]
      });
      state.fileHandle = handle;
      const f = await handle.getFile();
      const data = await f.text();
      const parsed = JSON.parse(data);
      loadFromJson(parsed, context);
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }

  (_app.fileInput as HTMLInputElement).click();
}

function loadFromJson(data: any, context: Context): void {
  const { state } = context;
  if (data.nodes) {
    state.nodes = data.nodes.map((n: any) => {
      const node: CanvasNode = { ...n };
      if (n.width <= 20 && n.height <= 20) {
        node.type = 'dot';
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
}

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

  const isInputFocused = document.activeElement && 
    (document.activeElement.tagName === 'INPUT' || 
     document.activeElement.tagName === 'TEXTAREA' || 
     document.activeElement.tagName === 'SELECT');

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
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    if (isInputFocused) return;
    const nodes = state.selectedNode ? [state.selectedNode] : state.selectedNodes;
    if (nodes.length > 0) {
      e.preventDefault();
      const moveAmount = PIXEL_SIZE * 8;
      if (e.key === 'ArrowUp') nodes.forEach(n => n.y -= moveAmount);
      else if (e.key === 'ArrowDown') nodes.forEach(n => n.y += moveAmount);
      else if (e.key === 'ArrowLeft') nodes.forEach(n => n.x -= moveAmount);
      else if (e.key === 'ArrowRight') nodes.forEach(n => n.x += moveAmount);
      nodes.forEach(n => {
        n.x = snapToPixel(n.x, PIXEL_SIZE);
        n.y = snapToPixel(n.y, PIXEL_SIZE);
      });
      state.historyManager.save(state);
      render();
    }
  }
  if (e.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    if (isInputFocused) return;
    e.preventDefault();
    const panAmount = PIXEL_SIZE * 8;
    if (e.key === 'ArrowUp') state.offset.y += panAmount;
    else if (e.key === 'ArrowDown') state.offset.y -= panAmount;
    else if (e.key === 'ArrowLeft') state.offset.x += panAmount;
    else if (e.key === 'ArrowRight') state.offset.x -= panAmount;
    render();
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
    if (isInputFocused) {
      return;
    }
    e.preventDefault();
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
  const textProps = document.getElementById('text-props') as HTMLElement;

  updatePaletteDisplay('bg-palette', context);

  if (state.selectedNode) {
    nodeProps.style.display = 'flex';
    edgeProps.style.display = 'none';

    const isText = state.selectedNode.type === 'text';
    textProps.style.display = isText ? 'contents' : 'none';
    bgTransparentOpt.style.display = isText ? 'inline' : 'none';

    if (isText) {
      (document.getElementById('prop-text') as HTMLInputElement).value = state.selectedNode.text || '';
      (document.getElementById('prop-text-halign') as HTMLSelectElement).value = state.selectedNode.textAlign || 'left';
      (document.getElementById('prop-text-valign') as HTMLSelectElement).value = state.selectedNode.textValign || 'top';
      (document.getElementById('prop-auto-resize') as HTMLInputElement).checked = state.selectedNode.autoResize !== false;
    }
    (document.getElementById('prop-bg-transparent') as HTMLInputElement).checked = state.selectedNode.bgTransparent || false;
    (document.getElementById('prop-stroke-transparent') as HTMLInputElement).checked = state.selectedNode.strokeTransparent || false;
  } else if (state.selectedEdge) {
    nodeProps.style.display = 'none';
    edgeProps.style.display = 'flex';
    (document.getElementById('prop-arrow-start') as HTMLInputElement).checked = state.selectedEdge.arrowStart || false;
    (document.getElementById('prop-arrow-end') as HTMLInputElement).checked = state.selectedEdge.arrowEnd || false;
  } else {
    nodeProps.style.display = 'none';
    edgeProps.style.display = 'none';
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
  app.document.getElementById('btn-add-text')!.addEventListener('click', () => addTextNode(_state, undefined, undefined, _app));
  app.document.getElementById('btn-add-dot')!.addEventListener('click', () => addDotNode(_state, undefined, undefined, _app));
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
  app.document.getElementById('btn-load')!.addEventListener('click', () => loadFromFile(context));
  app.document.getElementById('btn-log')!.addEventListener('click', () => {
    const data = exportToObsidianCanvas(context.state);
    console.log(data);
  });
  app.document.getElementById('btn-voice')!.addEventListener('click', () => {
    startVoiceInput(context);
  });
  app.document.getElementById('btn-split')!.addEventListener('click', () => {
    splitNodeToMultipleNodes(context);
  });
  app.document.getElementById('btn-export-png')!.addEventListener('click', () => {
    exportToPng(context);
  });
  fileInput.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      const file = target.files[0];
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(reader.result as string);
          loadFromJson(parsed, context);
        } catch (err) {
          alert('ファイルの形式が正しくありません');
        }
      };
      reader.readAsText(file);
    }
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

function startEdgeAnimation(): void {
  if (!_state.edgeAnimation) return;
  const animate = () => {
    if (!_state.edgeAnimation) return;
    _state.edgeAnimation.progress += 0.1;
    if (_state.edgeAnimation.progress > 1) _state.edgeAnimation.progress = 1;
    render();
    if (_state.edgeAnimation && _state.edgeAnimation.progress < 1) {
      requestAnimationFrame(animate);
    } else {
      _state.edgeAnimation = null;
    }
  };
  requestAnimationFrame(animate);
}

function startEdgeDeleteAnimation(): void {
  if (!_state.edgeDeleteAnimation) return;
  const fromNode = _state.nodes.find(n => n.id === _state.edgeDeleteAnimation?.fromNode);
  const toNode = _state.nodes.find(n => n.id === _state.edgeDeleteAnimation?.toNode);
  if (!fromNode || !toNode) return;
  const fromPos = getRectEdgePoint(fromNode, toNode);
  const toPos = getRectEdgePoint(toNode, fromNode);
  const from = worldToScreen(fromPos, _state, _app.canvas);
  const to = worldToScreen(toPos, _state, _app.canvas);
  const pixelSize = PIXEL_SIZE * _state.zoom;
  const dist = Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2);
  const steps = Math.max(1, Math.floor(dist / pixelSize));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    _state.edgeDeleteAnimation.dots.push({
      x: from.x + dx * t,
      y: from.y + dy * t,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2
    });
  }

  const animate = () => {
    if (!_state.edgeDeleteAnimation) return;
    _state.edgeDeleteAnimation.progress += 0.025;
    _state.edgeDeleteAnimation.dots.forEach(dot => {
      dot.x += dot.vx;
      dot.y += dot.vy;
      dot.vy += 0.1;
    });
    render();
    if (_state.edgeDeleteAnimation.progress < 1) {
      requestAnimationFrame(animate);
    } else {
      _state.edgeDeleteAnimation = null;
    }
  };
  requestAnimationFrame(animate);
}

function startNodeDeleteAnimation(): void {
  if (!_state.nodeDeleteAnimation) return;
  const animate = () => {
    if (!_state.nodeDeleteAnimation) return;
    _state.nodeDeleteAnimation.progress += 0.025;
    _state.nodeDeleteAnimation.dots.forEach(dot => {
      dot.x += dot.vx;
      dot.y += dot.vy;
      dot.vy += 0.15;
    });
    render();
    if (_state.nodeDeleteAnimation.progress < 1) {
      requestAnimationFrame(animate);
    } else {
      _state.nodeDeleteAnimation = null;
    }
  };
  requestAnimationFrame(animate);
}

function startNodeCreateAnimation(): void {
  if (!_state.nodeCreateAnimation) return;
  const animate = () => {
    if (!_state.nodeCreateAnimation) return;
    _state.nodeCreateAnimation.progress += 0.04;
    render();
    if (_state.nodeCreateAnimation.progress < 1) {
      requestAnimationFrame(animate);
    } else {
      _state.nodeCreateAnimation = null;
    }
  };
  requestAnimationFrame(animate);
}

initApp(context);