import { useMemo, useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import { changeDevice } from '../fit/operations/device';
import { curatedManufacturerOptions, garminProductOptions } from '../fit/deviceOptions';
import { deviceIdentityOf } from '../fit/display';

export function DeviceForm({ onClose }: { onClose: () => void }) {
  const model = useEditorStore((s) => s.model);
  const setModel = useEditorStore((s) => s.setModel);
  const current = model ? deviceIdentityOf(model) : { manufacturer: null, productLabel: null };

  const manufacturerOptions = useMemo(() => curatedManufacturerOptions(), []);
  const productOptions = useMemo(() => garminProductOptions(), []);

  const [manufacturer, setManufacturer] = useState(current.manufacturer ?? manufacturerOptions[0]?.value ?? 'garmin');
  const [productLabel, setProductLabel] = useState(
    current.manufacturer === 'garmin' && current.productLabel
      ? (productOptions.find((p) => p.label.toLowerCase().replace(/\s+/g, '') === current.productLabel?.toLowerCase())
          ?.label ?? '')
      : '',
  );

  if (!model) return null;

  function apply() {
    if (!model) return;
    const match = productOptions.find((p) => p.label.toLowerCase() === productLabel.trim().toLowerCase());
    const result = changeDevice(model, {
      manufacturer,
      product: manufacturer === 'garmin' ? match?.value : undefined,
    });
    setModel(result);
    onClose();
  }

  return (
    <div className="device-form-backdrop" onClick={onClose}>
      <div className="device-form" onClick={(e) => e.stopPropagation()}>
        <h2>Change device</h2>
        <label className="device-form-field">
          Manufacturer
          <select value={manufacturer} onChange={(e) => setManufacturer(e.target.value)}>
            {manufacturerOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {manufacturer === 'garmin' && (
          <label className="device-form-field">
            Device model
            <input
              list="garmin-product-options"
              value={productLabel}
              onChange={(e) => setProductLabel(e.target.value)}
              placeholder="Start typing, e.g. Edge 530"
            />
            <datalist id="garmin-product-options">
              {productOptions.map((opt) => (
                <option key={opt.value} value={opt.label} />
              ))}
            </datalist>
          </label>
        )}
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
