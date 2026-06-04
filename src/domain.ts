import { Point, Figure } from './util';

// --- Types ---

export interface CanvasNode extends Figure {
  id: string;
  text?: string;
  note?: string;
  textAlign?: 'left' | 'center' | 'right';
  textValign?: 'top' | 'middle' | 'bottom';
  bgPaletteIndex: number;
  bgTransparent: boolean;
  strokeTransparent: boolean;
  autoResize: boolean;
}

export interface Edge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide: string;
  toSide: string;
  arrowStart: boolean;
  arrowEnd: boolean;
}

export interface AnimationState {
  fromNode: string;
  toNode: string;
  progress: number;
  dots?: { x: number; y: number; vx: number; vy: number }[];
}

export interface NodeDeleteAnimation {
  node: CanvasNode;
  progress: number;
  dots: { x: number; y: number; vx: number; vy: number }[];
}

export interface NodeCreateAnimation {
  nodeId: string;
  progress: number;
}

// --- Constants ---

export const TEXT_NODE_DEFAULT = {
  width: 120,
  height: 60
} as const;

export const HORIZONTAL_PADDING = 18;
export const VERTICAL_PADDING = 16;
export const LINE_HEIGHT = 18;
export const PIXEL_SIZE = 4;
export const NEW_CANVAS_INITIAL_OFFSET = PIXEL_SIZE * 16;

// --- HistoryManager ---

export class HistoryManager {
  private history: string[] = [];
  private historyIndex: number = -1;
  private maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  save(state: CoreState, extra?: Record<string, unknown>): void {
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
  }

  undo(state: CoreState): boolean {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.restore(state);
      return true;
    }
    return false;
  }

  redo(state: CoreState): boolean {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.restore(state);
      return true;
    }
    return false;
  }

  private restore(state: CoreState): void {
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

// --- Core State (platform-independent) ---

export interface CoreState {
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
  edgeAnimation: AnimationState | null;
  edgeDeleteAnimation: AnimationState | null;
  nodeDeleteAnimation: NodeDeleteAnimation | null;
  nodeCreateAnimation: NodeCreateAnimation | null;
}

// --- App ---

export interface App {
  document: Document;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  fileInput: HTMLInputElement;
}

// --- Pure Domain Functions ---

export function findFreePosition(state: CoreState, x: number, y: number, width: number, height: number): Point {
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

export function snapToPixel(val: number, pixelSize: number): number {
  return Math.round(val / pixelSize) * pixelSize;
}

export function exportToObsidianCanvas(state: CoreState): string {
  const data = {
    nodes: state.nodes.map(n => ({
      id: n.id,
      type: n.type,
      x: n.x,
      y: n.y,
      width: n.width,
      height: n.height,
      text: n.text,
      note: n.note,
      textAlign: n.textAlign,
      textValign: n.textValign,
      color: n.type === 'dot' ? undefined : state.colorPalettes[n.bgPaletteIndex],
      bgTransparent: n.bgTransparent,
      strokeTransparent: n.strokeTransparent
    })),
    edges: state.edges.map(e => ({
      id: e.id,
      fromNode: e.fromNode,
      toNode: e.toNode,
      fromSide: e.fromSide,
      toSide: e.toSide,
      arrowStart: e.arrowStart,
      arrowEnd: e.arrowEnd
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

export function loadFromJson(data: any, state: CoreState): void {
  if (data.nodes) {
    state.nodes = data.nodes.map((n: any) => {
      const node: CanvasNode = { ...n };
      if (n.width <= 20 && n.height <= 20) {
        node.type = 'dot';
      }
      return node;
    });
  }
  if (data.edges) {
    state.edges = data.edges;
  }
  if (data.colorPalettes) {
    state.colorPalettes = data.colorPalettes;
  }
}
