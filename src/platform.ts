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
      await storageSet(STORAGE_KEYS.AUTOSAVE, data);
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
    await storageSet(STORAGE_KEYS.AUTOSAVE, data);
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
