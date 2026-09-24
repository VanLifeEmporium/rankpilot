import {useId} from 'react';

type Props = {
  blockers: string[];
  busy: boolean;
  accepting: boolean;
  demo: boolean;
  onReject: () => void;
  onAccept: () => void;
  onReplace: () => void;
  onEditFacts?: () => void;
};

// Keep the explanation and recovery action with the decision buttons, even
// while the merchant scrolls through a long preview.
export function ReviewActions({blockers,busy,accepting,demo,onReject,onAccept,onReplace,onEditFacts}: Props) {
  const messageId=useId();
  const blocked=blockers.length>0;
  return <>
    {blocked && <div className="review-blocker" id={messageId}>
      <strong>Why accepting is unavailable</strong>
      <p>{blockers[0]}</p>
      {blockers.length>1 && <details><summary>Other checks to resolve</summary><ul>{blockers.slice(1).map(b=><li key={b}>{b}</li>)}</ul></details>}
      <p>Generate a replacement, then review it here before accepting. This draft has not been published.</p>
    </div>}
    {busy && <p role="status">{accepting ? 'Applying and checking the saved change in Shopify…' : 'Finishing your current request…'}</p>}
    <div className="dialog-actions">
      <button type="button" className="button" disabled={busy} onClick={onReject}>Reject</button>
      {blocked && <button type="button" className="button primary" disabled={busy} onClick={onReplace}>Generate reviewed replacement</button>}
      {blocked && onEditFacts && <button type="button" className="button" disabled={busy} onClick={onEditFacts}>Check product facts</button>}
      <button type="button" className={blocked ? 'button' : 'button primary'} disabled={busy || blocked} aria-describedby={blocked ? messageId : undefined} onClick={onAccept}>
        {busy && accepting ? 'Applying…' : demo ? 'Approve demo change' : 'Accept and apply'}
      </button>
    </div>
  </>;
}
