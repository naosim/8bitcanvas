import { CoreState, App, exportToObsidianCanvas, loadFromJson } from './domain';

// --- NeutralinoJS type declarations ---

declare const Neutralino: {
  init: () => void;
  filesystem: {
    writeFile: (filename: string, data: string) => Promise<void>;
    readFile: (filename: string) => Promise<string>;
    createWatcher: (path: string) => Promise<number>;
    removeWatcher: (watcherId: number) => Promise<void>;
    getPathParts: (path: string) => Promise<{ parentPath: string; filename: string; stem: string; extension: string }>;
  };
  os: {
    showSaveDialog: (title: string, options?: { filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
    showOpenDialog: (title: string, options?: { filters?: { name: string; extensions: string[] }[]; multiple?: boolean }) => Promise<string[] | null>;
  };
  storage: {
    setData: (key: string, data: string) => Promise<void>;
    getData: (key: string) => Promise<string>;
  };
  window: {
    setTitle: (title: string) => Promise<void>;
  };
  events: {
    on: (eventName: string, callback: (event: any) => void) => void;
  };
};

// --- Platform State (extends CoreState with platform-specific fields) ---

export interface PlatformState extends CoreState {
  fileHandle: FileSystemFileHandle | null;
  neutralinoFilePath: string | null;
  neutralinoWatcherId: number | null;
}

// Helper to cast Context to PlatformState
function asPlatformState(state: CoreState): PlatformState {
  return state as PlatformState;
}

// --- Storage Keys ---

export const STORAGE_KEYS = {
  AUTOSAVE: 'tinytidycanvas-autosave',
  DEV_MODE: 'tinytidycanvas-dev'
} as const;

// --- Context (platform-specific) ---

export interface Context {
  state: PlatformState;
  app: App;
}

// --- Environment Detection ---

export function isNeutralino(): boolean {
  try {
    return typeof Neutralino !== 'undefined' && Neutralino !== null && typeof Neutralino.init === 'function';
  } catch {
    return false;
  }
}

// --- Storage Abstraction ---

export async function storageSet(key: string, value: string): Promise<void> {
  if (isNeutralino()) {
    await Neutralino.storage.setData(key, value);
  } else {
    localStorage.setItem(key, value);
  }
}

export async function storageGet(key: string): Promise<string | null> {
  if (isNeutralino()) {
    try {
      const value = await Neutralino.storage.getData(key);
      return value || null;
    } catch {
      return null;
    }
  } else {
    return localStorage.getItem(key);
  }
}

export async function storageRemove(key: string): Promise<void> {
  if (isNeutralino()) {
    // NeutralinoJSのstorage APIにはremoveItemがないため空文字を保存
    // storageGetでは空文字をnullとして扱う
    await Neutralino.storage.setData(key, '');
  } else {
    localStorage.removeItem(key);
  }
}

// --- Autosave Key Management ---

const MAX_AUTOSAVE_FILES = 10;

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function getAutosaveKey(state: PlatformState): string {
  if (state.neutralinoFilePath) {
    return `${STORAGE_KEYS.AUTOSAVE}-${hashString(state.neutralinoFilePath)}`;
  }
  if (state.fileHandle) {
    return `${STORAGE_KEYS.AUTOSAVE}-${hashString(state.fileHandle.name)}`;
  }
  // 新規ファイルは固定キーで復元可能に
  return `${STORAGE_KEYS.AUTOSAVE}-new`;
}

export interface AutosaveEntry {
  key: string;
  fileName: string;
  savedAt: string;
  nodeCount: number;
}

export async function getAutosaveIndex(): Promise<AutosaveEntry[]> {
  const entries: AutosaveEntry[] = [];
  const prefix = `${STORAGE_KEYS.AUTOSAVE}-`;

  if (isNeutralino()) {
    // NeutralinoJS: storage APIはキー一覧を取得できないため空配列を返す
    return entries;
  }

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix) && key !== STORAGE_KEYS.DEV_MODE) {
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        entries.push({
          key,
          fileName: data.neutralinoFilePath?.split(/[/\\]/).pop() || data._fileName || '新規',
          savedAt: data._savedAt || '',
          nodeCount: data.nodes?.length || 0
        });
      } catch {}
    }
  }

  return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function cleanupOldAutosaves(): Promise<void> {
  const entries = await getAutosaveIndex();
  if (entries.length <= MAX_AUTOSAVE_FILES) return;

  const toDelete = entries.slice(MAX_AUTOSAVE_FILES);
  for (const entry of toDelete) {
    await storageRemove(entry.key);
  }
}

export async function saveAutosave(key: string, data: string): Promise<void> {
  const parsed = JSON.parse(data);
  parsed._savedAt = new Date().toISOString();
  await storageSet(key, JSON.stringify(parsed));
  await cleanupOldAutosaves();
}

export async function removeAllAutosaves(): Promise<void> {
  const entries = await getAutosaveIndex();
  for (const entry of entries) {
    await storageRemove(entry.key);
  }
}

// --- Callbacks (to avoid circular dependencies) ---

let updateFileNameCallback: ((state: CoreState, fileName?: string) => void) | null = null;
let applyLoadedDataCallback: ((data: string, context: Context, options?: { fileName?: string; neutralinoFilePath?: string | null }) => void) | null = null;

export function setUpdateFileNameCallback(cb: (state: CoreState, fileName?: string) => void): void {
  updateFileNameCallback = cb;
}

export function setApplyLoadedDataCallback(cb: (data: string, context: Context, options?: { fileName?: string; neutralinoFilePath?: string | null }) => void): void {
  applyLoadedDataCallback = cb;
}

// --- Neutralino-specific File Operations ---

export async function saveToNeutralino(context: Context): Promise<void> {
  const { state } = context;
  const platformState = asPlatformState(state);
  const data = exportToObsidianCanvas(state);

  try {
    const filePath = await Neutralino.os.showSaveDialog('Canvasファイルを保存', {
      filters: [{ name: 'Canvas File', extensions: ['json', '8bc'] }]
    });

    if (filePath) {
      await Neutralino.filesystem.writeFile(filePath, data);
      platformState.neutralinoFilePath = filePath;
      await saveAutosave(getAutosaveKey(platformState), data);
      updateFileNameCallback?.(state);
      await startFileWatcher(context);
    }
  } catch (err) {
    console.error('NeutralinoJS save error:', err);
  }
}

export async function saveToOverwriteNeutralino(context: Context): Promise<void> {
  const { state } = context;
  const platformState = asPlatformState(state);
  if (!platformState.neutralinoFilePath) {
    await saveToNeutralino(context);
    return;
  }
  const data = exportToObsidianCanvas(state);
  try {
    await Neutralino.filesystem.writeFile(platformState.neutralinoFilePath, data);
    await saveAutosave(getAutosaveKey(platformState), data);
    await startFileWatcher(context);
  } catch (err) {
    console.error('NeutralinoJS overwrite error:', err);
  }
}

export async function loadFromNeutralino(context: Context): Promise<void> {
  try {
    const filePaths = await Neutralino.os.showOpenDialog('Canvasファイルを開く', {
      filters: [{ name: 'Canvas File', extensions: ['json', '8bc'] }],
      multiple: false
    });

    if (filePaths && filePaths.length > 0) {
      const filePath = filePaths[0];
      const data = await Neutralino.filesystem.readFile(filePath);
      applyLoadedDataCallback?.(data, context, { neutralinoFilePath: filePath });
    }
  } catch (err) {
    console.error('NeutralinoJS load error:', err);
  }
}

// --- File Watcher ---

export async function startFileWatcher(context: Context): Promise<void> {
  const { state } = context;
  const platformState = asPlatformState(state);
  if (!isNeutralino() || !platformState.neutralinoFilePath) return;

  await stopFileWatcher(context);

  try {
    const pathParts = await Neutralino.filesystem.getPathParts(platformState.neutralinoFilePath);
    const dirPath = pathParts.parentPath;
    const fileName = pathParts.filename;

    const watcherId = await Neutralino.filesystem.createWatcher(dirPath);
    platformState.neutralinoWatcherId = watcherId;

    Neutralino.events.on('watchFile', (event: any) => {
      if (event.detail.id === watcherId && event.detail.action === 'modified') {
        const changedFile = event.detail.filename;
        if (changedFile === fileName) {
          reloadCurrentFile(context);
        }
      }
    });

    console.log('File watcher started for directory:', dirPath, '(watching:', fileName, ')');
  } catch (err) {
    console.warn('File watcher not available:', (err as any).message || err);
  }
}

export async function stopFileWatcher(context: Context): Promise<void> {
  const { state } = context;
  const platformState = asPlatformState(state);
  if (!isNeutralino() || platformState.neutralinoWatcherId === null) return;

  try {
    await Neutralino.filesystem.removeWatcher(platformState.neutralinoWatcherId);
    platformState.neutralinoWatcherId = null;
    console.log('File watcher stopped');
  } catch (err) {
    console.error('Stop file watcher error:', err);
  }
}

async function reloadCurrentFile(context: Context): Promise<void> {
  const { state } = context;
  const platformState = asPlatformState(state);
  if (!isNeutralino() || !platformState.neutralinoFilePath) return;

  try {
    const data = await Neutralino.filesystem.readFile(platformState.neutralinoFilePath);
    const parsed = JSON.parse(data);
    loadFromJson(parsed, state);
    updateFileNameCallback?.(state);
  } catch (err) {
    console.error('Reload file error:', err);
  }
}

// --- Neutralino Initialization ---

export function initNeutralino(context: Context): void {
  if (!isNeutralino()) return;

  Neutralino.init();
  Neutralino.events.on('ready', () => {
    console.log('NeutralinoJS initialized');
    Neutralino.window.setTitle('TinyTidyCanvas');
    const platformState = context.state as PlatformState;
    if (platformState.neutralinoFilePath) {
      startFileWatcher(context);
    }
  });
}
