import { useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import { exportEditedFit } from '../fit/raw/export';
import { downloadBytes } from '../lib/download';
import { DeviceForm } from './DeviceForm';
import { ShiftTimeForm } from './ShiftTimeForm';

export function Toolbar() {
  const model = useEditorStore((s) => s.model);
  const originalBytes = useEditorStore((s) => s.originalBytes);
  const originalModel = useEditorStore((s) => s.originalModel);
  const fileName = useEditorStore((s) => s.fileName);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const [showDeviceForm, setShowDeviceForm] = useState(false);
  const [showShiftTimeForm, setShowShiftTimeForm] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  function download() {
    if (!model || !originalBytes || !originalModel) return;
    try {
      const bytes = exportEditedFit(originalBytes, originalModel, model);
      downloadBytes(bytes, fileName ?? 'edited.fit');
      setDownloadError(null);
    } catch (err) {
      setDownloadError(`Couldn't export this file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div className="toolbar">
      <button type="button" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
        Undo
      </button>
      <button type="button" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
        Redo
      </button>
      <button type="button" onClick={() => setShowDeviceForm(true)}>
        Change device
      </button>
      <button type="button" onClick={() => setShowShiftTimeForm(true)}>
        Shift time
      </button>
      <button type="button" onClick={download}>
        Download
      </button>
      {downloadError && <span className="toolbar-error">{downloadError}</span>}
      {showDeviceForm && <DeviceForm onClose={() => setShowDeviceForm(false)} />}
      {showShiftTimeForm && <ShiftTimeForm onClose={() => setShowShiftTimeForm(false)} />}
    </div>
  );
}
