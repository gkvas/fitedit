import { useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import { shiftTime } from '../fit/operations/shiftTime';

export function ShiftTimeForm({ onClose }: { onClose: () => void }) {
  const model = useEditorStore((s) => s.model);
  const setModel = useEditorStore((s) => s.setModel);
  const [seconds, setSeconds] = useState(60);

  if (!model) return null;

  function apply() {
    if (!model || !Number.isFinite(seconds) || seconds === 0) return;
    setModel(shiftTime(model, seconds));
    onClose();
  }

  return (
    <div className="device-form-backdrop" onClick={onClose}>
      <div className="device-form" onClick={(e) => e.stopPropagation()}>
        <h2>Shift time</h2>
        <p>
          Moves every timestamp in the file by the same amount, keeping all lap boundaries and durations unchanged.
          Useful to dodge Garmin Connect's duplicate-activity check when re-uploading an edited copy of a deleted
          activity.
        </p>
        <label className="device-form-field">
          Offset (seconds)
          <input
            type="number"
            value={seconds}
            onChange={(e) => setSeconds(e.target.valueAsNumber)}
            step={1}
          />
        </label>
        <div className="device-form-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
