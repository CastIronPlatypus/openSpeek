import type { Ref } from 'react';
import { ChevronUpIcon, ContentsIcon } from '../common/icons';
import type { SectionHub } from '../reader/sectionHub';
import { sectionTitle, useCurrentSection } from '../reader/useSections';

interface SectionButtonProps {
  hub: SectionHub;
  expanded: boolean;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
}

/** The current section's title, always in view above the scrubber; opens the contents. */
export function SectionButton({ hub, expanded, onClick, ref }: SectionButtonProps) {
  const current = useCurrentSection(hub);
  const title = current >= 0 ? sectionTitle(hub.sections[current]) : 'Contents';
  return (
    <div className="player-section">
      <button
        ref={ref}
        type="button"
        className="section-btn"
        aria-label={`Contents. Current section: ${title}`}
        title="Contents (C)"
        aria-expanded={expanded}
        onClick={onClick}
      >
        <ContentsIcon size={18} />
        <span className="section-btn-title">{title}</span>
        <span className="section-btn-chevron">
          <ChevronUpIcon size={16} />
        </span>
      </button>
    </div>
  );
}
