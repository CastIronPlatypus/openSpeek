import { useApp } from '../appModel';
import { VoiceIcon } from '../common/icons';
import { Popover } from '../common/Popover';
import { engineLabel } from '../engines';
import { useStore } from '../store';
import { EnginePicker } from '../voice/EnginePicker';
import { VoiceList } from '../voice/VoiceList';

export function VoiceControl() {
  const model = useApp();
  const engine = useStore(model.activeEngine);

  return (
    <Popover
      label={`Voice and engine (${engineLabel(engine)})`}
      buttonContent={<VoiceIcon />}
      title="Voice"
      align="end"
      panelClassName="voice-panel"
      onOpen={() => void model.refreshServerStatus()}
    >
      {() => (
        <>
          <EnginePicker compact />
          <VoiceList engine={engine} />
        </>
      )}
    </Popover>
  );
}
