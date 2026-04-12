// Utility functions and types extracted from app.ts

export interface Point {
  x: number;
  y: number;
}

export interface Figure {
  type: 'text' | 'circle';
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rgbaToHex(rgba: string): string {
  const match = rgba.match(/rgba?\((\d+),(\d+),(\d+),?([\d.]+)?\)/);
  if (!match) return '#000000';
  const r = parseInt(match[1]).toString(16).padStart(2, '0');
  const g = parseInt(match[2]).toString(16).padStart(2, '0');
  const b = parseInt(match[3]).toString(16).padStart(2, '0');
  return '#' + r + g + b;
}

export function hexToRgba(hex: string, alpha: number = 1): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function resizeCanvas(app: { document: Document, canvas: HTMLCanvasElement }): void {
  const { canvas } = app;
  const container = app.document.getElementById('canvas-container') as HTMLElement;
  canvas.width = container.offsetWidth;
  canvas.height = container.offsetHeight;
}

export function calcTextRectSize(text: string, font: string, lineHeight: number, ctx: CanvasRenderingContext2D) {
  const lines = text.split('\n');
  const minWidth = 80;
  const minHeight = 40;
  ctx.font = font;
  let maxWidth = 0;
  lines.forEach(line => {
    const metrics = ctx.measureText(line);
    if (metrics.width > maxWidth) maxWidth = metrics.width;
  });
  return {
    width: Math.max(minWidth, maxWidth + 22),
    height: Math.max(minHeight, lines.length * lineHeight + 22)
  };
}

export function screenToWorld(point: Point, state: { offset: Point, zoom: number }, canvas: HTMLCanvasElement): Point {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  return {
    x: (point.x - centerX - state.offset.x) / state.zoom,
    y: (point.y - centerY - state.offset.y) / state.zoom
  };
}

export function worldToScreen(point: Point, state: { offset: Point, zoom: number }, canvas: HTMLCanvasElement): Point {
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  return {
    x: point.x * state.zoom + state.offset.x + centerX,
    y: point.y * state.zoom + state.offset.y + centerY
  };
}

export function getRectEdgePoint(node: Figure, toNode: Figure): Point {
  const from: Point = {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2
  };
  const to: Point = {
    x: toNode.x + toNode.width / 2,
    y: toNode.y + toNode.height / 2
  };

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

export function pointToLineDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;
  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) param = dot / lenSq;
  let xx: number, yy: number;
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

export function findPaletteIndex(palettes: string[], color: string | undefined): number {
  if (!color) return 0;
  const idx = palettes.indexOf(color);
  return idx >= 0 ? idx : 0;
}