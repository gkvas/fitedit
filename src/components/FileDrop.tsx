import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useEditorStore } from '../state/editorStore';

export function FileDrop() {
  const loadFile = useEditorStore((s) => s.loadFile);
  const loading = useEditorStore((s) => s.loading);
  const error = useEditorStore((s) => s.error);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) void loadFile(file);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div className="file-drop-wrapper">
      <div
        className={`file-drop${dragging ? ' file-drop--active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <p>{loading ? 'Loading…' : 'Drop a .fit file here, or click to choose one'}</p>
        <input
          ref={inputRef}
          type="file"
          accept=".fit"
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {error && <p className="file-drop-error">{error}</p>}
    </div>
  );
}
