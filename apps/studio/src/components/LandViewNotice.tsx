// LandViewNotice.tsx — the mounted 3D map's loading / unsupported / failure message, in the HOST's
// accessible layer (ADR-0608 D5). The land layer is `aria-hidden`, so a message placed there would
// reach nobody using assistive technology; this sits in the map frame beside the viewport instead.
// Loading is a polite `status`; unsupported and failed are an `alert`. Ready says nothing.

import type { LandMountStatus } from '../lib/landViewStatus.js';

export function LandViewNotice({ status }: { status: LandMountStatus }): React.JSX.Element | null {
  if (status.kind === 'ready') return null;
  const urgent = status.kind !== 'loading';
  return (
    <div
      className={`land-view-notice is-${status.kind}`}
      data-testid="land-view-notice"
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
    >
      {status.message}
    </div>
  );
}
