import { describe, expect, it, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';
import type { FitModel } from '../fit/model';

function modelWith(tag: string): FitModel {
  return { entries: [{ mesgNum: 0, mesg: { tag } }] };
}

beforeEach(() => {
  useEditorStore.setState({ fileName: 'test.fit', model: modelWith('a'), error: null, loading: false, past: [], future: [] });
});

describe('editorStore undo/redo', () => {
  it('setModel pushes the previous model onto past and clears future', () => {
    useEditorStore.getState().setModel(modelWith('b'));
    const state = useEditorStore.getState();
    expect(state.model).toEqual(modelWith('b'));
    expect(state.past).toEqual([modelWith('a')]);
    expect(state.future).toEqual([]);
  });

  it('undo restores the previous model and pushes the current one onto future', () => {
    useEditorStore.getState().setModel(modelWith('b'));
    useEditorStore.getState().undo();
    const state = useEditorStore.getState();
    expect(state.model).toEqual(modelWith('a'));
    expect(state.past).toEqual([]);
    expect(state.future).toEqual([modelWith('b')]);
  });

  it('redo re-applies an undone model', () => {
    useEditorStore.getState().setModel(modelWith('b'));
    useEditorStore.getState().undo();
    useEditorStore.getState().redo();
    const state = useEditorStore.getState();
    expect(state.model).toEqual(modelWith('b'));
    expect(state.past).toEqual([modelWith('a')]);
    expect(state.future).toEqual([]);
  });

  it('a new edit after undo discards the redo-able future', () => {
    useEditorStore.getState().setModel(modelWith('b'));
    useEditorStore.getState().undo();
    useEditorStore.getState().setModel(modelWith('c'));
    const state = useEditorStore.getState();
    expect(state.model).toEqual(modelWith('c'));
    expect(state.future).toEqual([]);
  });

  it('undo is a no-op with no history', () => {
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().model).toEqual(modelWith('a'));
  });

  it('redo is a no-op with nothing to redo', () => {
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().model).toEqual(modelWith('a'));
  });

  it('caps history depth so it does not grow unbounded', () => {
    for (let i = 0; i < 60; i++) {
      useEditorStore.getState().setModel(modelWith(`step-${i}`));
    }
    expect(useEditorStore.getState().past.length).toBeLessThanOrEqual(50);
  });
});
