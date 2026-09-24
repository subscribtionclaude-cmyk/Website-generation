import { Fragment } from 'react';
import { splitBidiRuns } from '@/lib/bidi';

/**
 * Renders mixed Arabic/Latin text (e.g. "iPhone 18 Pro و iPhone 18 Pro Max") with each Latin run
 * isolated in <bdi>, so product names keep their order inside right-to-left sentences.
 */
export function BidiText({ text }: { text: string }) {
  const runs = splitBidiRuns(text);
  if (runs.length === 1) return <>{text}</>;
  return (
    <>
      {runs.map((run, index) =>
        run.latin ? <bdi key={index}>{run.text}</bdi> : <Fragment key={index}>{run.text}</Fragment>,
      )}
    </>
  );
}
