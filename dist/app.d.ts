interface Point {
    x: number;
    y: number;
}
interface CanvasNode {
    id: string;
    type: 'text' | 'circle';
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
    textAlign?: 'left' | 'center' | 'right';
    textValign?: 'top' | 'center' | 'bottom';
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
    mode: string;
    zoom: number;
    offset: Point;
    isDragging: boolean;
    isResizing: boolean;
    dragStart: Point;
    resizeNode: CanvasNode | null;
    resizeStart: Point | null;
    resizeStartSize: {
        width: number;
        height: number;
    } | null;
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
declare const _app: App;
declare function getStrokeWidth(zoom: number): number;
declare class HistoryManager {
    private history;
    private historyIndex;
    private maxSize;
    constructor(maxSize?: number);
    save(state: State): void;
    undo(state: State): boolean;
    redo(state: State): boolean;
    private restore;
    canUndo(): boolean;
    canRedo(): boolean;
}
declare const _state: State;
declare const context: Context;
declare function rgbaToHex(rgba: string): string;
declare function hexToRgba(hex: string, alpha?: number): string;
declare function resizeCanvas(app: App): void;
declare const HORIZONTAL_PADDING = 18;
declare const VERTICAL_PADDING = 32;
declare const LINE_HEIGHT = 18;
declare function autoResizeNode(node: CanvasNode, context: Context): void;
declare function undo(state: State): void;
declare function redo(state: State): void;
declare function screenToWorld(point: Point, state: State, canvas: HTMLCanvasElement): Point;
declare function worldToScreen(point: Point, state: State, canvas: HTMLCanvasElement): Point;
declare function drawGrid(app: App, state: State): void;
declare function drawNode(node: CanvasNode, context: Context): void;
declare function drawEdge(edge: Edge, context: Context): void;
declare function getRectEdgePoint(node: CanvasNode, toNode: CanvasNode): Point;
declare function renderFull(context: Context): void;
declare const render: () => void;
declare function findNodeAt(point: Point, context: Context): CanvasNode | null;
declare function findEdgeAt(point: Point, context: Context): Edge | null;
declare function pointToLineDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number;
declare function addTextNode(state: State, x?: number, y?: number): void;
declare function addCircleNode(state: State): void;
declare function deleteSelected(state: State): void;
declare function addEdgeNode(state: State): void;
declare function exportToObsidianCanvas(state: State): string;
declare function saveToFile(context: Context): void;
declare function loadFromFile(file: File, context: Context): void;
declare function findPaletteIndex(palettes: string[], color: string | undefined): number;
declare function loadFromLocalStorage(state: State): void;
declare function bringToFront(state: State): void;
declare function sendToBack(state: State): void;
declare function handleKeyDown(e: KeyboardEvent, context: Context): void;
declare function handleWheel(e: WheelEvent, context: Context): void;
declare function handleMouseDown(e: MouseEvent, context: Context): void;
declare function handleMouseMove(e: MouseEvent, context: Context): void;
declare function handleMouseUp(context: Context): void;
declare function updatePropertiesPanel(state: State, app: App): void;
declare function updatePaletteDisplay(containerId: string, context: Context): void;
declare function initApp(context: Context): void;
