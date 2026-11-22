import { useId } from 'react';
import { ENGINE_IDS } from '../../types';
import { useApp } from '../appModel';
import { ENGINE_INFO, serverEnginesHint, unavailableReason } from '../engines';
import { useStore } from '../store';

/**
 * Radio cards for the three speech engines; server engines are disabled with a reason when
 * unavailable. The compact variant (player bar) is a three-column row with one line of detail below.
 */
export function EnginePicker({ compact = false }: { compact?: boolean }) {
  const model = useApp();
  const active = useStore(model.activeEngine);
  const status = useStore(model.serverStatus);
  const name = useId();
  const hint = serverEnginesHint(status);

  return (
    <fieldset className={`engine-picker${compact ? ' engine-picker--compact' : ''}`}>
      <legend className={compact ? 'visually-hidden' : 'field-label'}>Speech engine</legend>
      <div className="engine-options">
        {ENGINE_IDS.map((id) => {
          const info = ENGINE_INFO[id];
          const reason = unavailableReason(id, status);
          return (
            <label key={id} className="engine-option" data-disabled={reason ? '' : undefined}>
              <input
                type="radio"
                name={name}
                value={id}
                checked={active === id}
                disabled={reason !== null}
                onChange={() => model.selectEngine(id)}
              />
              <span className="engine-option-text">
                <span className="engine-option-name">
                  {info.name} <span className="engine-option-where">{compact ? info.where : `· ${info.where}`}</span>
                </span>
                {!compact && <span className={`small ${reason ? 'engine-option-reason' : 'muted'}`}>{reason ?? info.blurb}</span>}
                {compact && reason && <span className="visually-hidden">{reason}</span>}
              </span>
            </label>
          );
        })}
      </div>
      {compact && (
        <p className="small muted engine-detail">
          {ENGINE_INFO[active].blurb}
          {hint && <span className="engine-hint block">{hint}</span>}
        </p>
      )}
    </fieldset>
  );
}
