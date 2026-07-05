import { create } from 'zustand';
import { decodeFitFile, InvalidFitFileError } from '../fit/decode';
import type { FitModel } from '../fit/model';

// Cap history depth so a long editing session doesn't accumulate an unbounded
// number of full-model snapshots in memory.
const MAX_HISTORY = 50;

interface EditorState {
  fileName: string | null;
  model: FitModel | null;
  /** The unmodified bytes of the loaded file — the base for byte-level export. */
  originalBytes: Uint8Array | null;
  /** The model as decoded at load time, used to derive what changed at export. */
  originalModel: FitModel | null;
  error: string | null;
  loading: boolean;
  past: FitModel[];
  future: FitModel[];
  loadFile: (file: File) => Promise<void>;
  setModel: (model: FitModel) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  fileName: null,
  model: null,
  originalBytes: null,
  originalModel: null,
  error: null,
  loading: false,
  past: [],
  future: [],

  async loadFile(file: File) {
    set({ loading: true, error: null });
    try {
      const buffer = await file.arrayBuffer();
      const { model, errors } = decodeFitFile(buffer);
      if (errors.length > 0) {
        set({ loading: false, error: `Decoded with errors: ${errors.map((e) => e.message).join(', ')}` });
        return;
      }
      set({
        model,
        originalBytes: new Uint8Array(buffer),
        originalModel: model,
        fileName: file.name,
        loading: false,
        error: null,
        past: [],
        future: [],
      });
    } catch (err) {
      const message = err instanceof InvalidFitFileError ? err.message : `Failed to read file: ${String(err)}`;
      set({ loading: false, error: message });
    }
  },

  setModel(model: FitModel) {
    const { model: current, past } = get();
    set({
      model,
      past: current ? [...past, current].slice(-MAX_HISTORY) : past,
      future: [],
    });
  },

  undo() {
    const { past, model, future } = get();
    if (past.length === 0 || !model) return;
    const previous = past[past.length - 1];
    set({ model: previous, past: past.slice(0, -1), future: [model, ...future] });
  },

  redo() {
    const { future, model, past } = get();
    if (future.length === 0 || !model) return;
    const next = future[0];
    set({ model: next, past: [...past, model], future: future.slice(1) });
  },

  clear() {
    set({ model: null, originalBytes: null, originalModel: null, fileName: null, error: null, past: [], future: [] });
  },
}));
