import { useQuery } from '@tanstack/react-query';
import { History, Plus, Rocket, RotateCcw } from 'lucide-react';
import { useId, useState } from 'react';
import { Alert } from '@/components/feedback/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { SectionType } from '@/domain/content/sections';
import { ADDABLE_TYPES, defaultSectionProps, type SectionRefs } from '@/domain/siteEditor/defaults';
import { diffLayouts, type LayoutChange } from '@/domain/siteEditor/layout';
import type { EditablePage, LayoutSection } from '@/domain/siteEditor/schemas';
import { useI18n } from '@/i18n/context';
import { useRuntime } from '@/runtime/context';
import { useAdminI18n, type AdminMessageKey } from '../../i18n/context';
import { Dialog } from '../../ui/Dialog';
import { CheckboxField, SelectField, TextareaField } from '../../ui/fields';
import { QueryState } from '../../ui/QueryState';
import ui from '../../ui/adminUi.module.css';
import type { Outcome, PublishItem } from './useSiteEditor';
import styles from './siteEditor.module.css';

export type AddPosition = 'end' | 'top' | 'after';

/** Pick a section type (only types the page supports, only when its references exist). */
export function AddSectionDialog({
  page,
  refs,
  hasSelection,
  onClose,
  onAdd,
}: {
  page: EditablePage;
  refs: SectionRefs;
  hasSelection: boolean;
  onClose: () => void;
  onAdd: (type: SectionType, position: AddPosition) => void;
}) {
  const { at } = useAdminI18n();
  const name = useId();
  const types = ADDABLE_TYPES[page];
  const available = (t: SectionType) => defaultSectionProps(t, refs) !== null;
  const [type, setType] = useState<SectionType | null>(types.find(available) ?? null);
  const [position, setPosition] = useState<AddPosition>(hasSelection ? 'after' : 'end');
  return (
    <Dialog open onClose={onClose} title={at('siteEditor.add.title')} icon={<Plus />} wide>
      <form
        className={ui.stack}
        onSubmit={(e) => {
          e.preventDefault();
          if (type) onAdd(type, position);
        }}
      >
        <fieldset className={styles.typeGrid}>
          <legend>{at('siteEditor.add.type')}</legend>
          {types.map((t) => (
            <label
              key={t}
              className={[styles.typeOption, !available(t) && styles.typeOptionOff]
                .filter(Boolean)
                .join(' ')}
            >
              <input
                type="radio"
                name={name}
                value={t}
                disabled={!available(t)}
                checked={type === t}
                onChange={() => setType(t)}
              />
              <span>
                <strong>{at(`sectionsAdmin.type.${t}` as AdminMessageKey)}</strong>
                <span className={ui.hint}>
                  {available(t)
                    ? at(`siteEditor.typeHint.${t}` as AdminMessageKey)
                    : at('siteEditor.add.needsRefs')}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
        <SelectField
          label={at('siteEditor.add.position')}
          value={position}
          onChange={(e) => setPosition(e.target.value as AddPosition)}
          options={[
            ...(hasSelection ? [{ value: 'after', label: at('siteEditor.add.after') }] : []),
            { value: 'top', label: at('siteEditor.add.top') },
            { value: 'end', label: at('siteEditor.add.end') },
          ]}
        />
        <p className={ui.hint}>{at('siteEditor.add.placeholderNote')}</p>
        <div className={ui.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            {at('ui.cancel')}
          </Button>
          <Button type="submit" disabled={!type} icon={<Plus aria-hidden="true" />}>
            {at('siteEditor.add.confirm')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Publish: choose which drafts go live (pages and design settings), add a note, confirm. Items the
 * signed-in user may not publish are listed but locked (the database refuses them anyway).
 * A draft based on an older version asks before overwriting (force).
 */
export function PublishDialog({
  items,
  itemLabel,
  canPublish,
  invalid,
  busy,
  onClose,
  onPublish,
}: {
  items: PublishItem[];
  itemLabel: (item: PublishItem) => string;
  canPublish: (item: PublishItem) => boolean;
  invalid: (item: PublishItem) => boolean;
  busy: boolean;
  onClose: () => void;
  onPublish: (items: PublishItem[], note: string | null, force: boolean) => Promise<Outcome[]>;
}) {
  const { at } = useAdminI18n();
  const id = (i: PublishItem) => `${i.kind}:${i.key}`;
  const [selected, setSelected] = useState(
    () => new Set(items.filter((i) => canPublish(i) && !invalid(i)).map(id)),
  );
  const [note, setNote] = useState('');
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null);
  const conflicts = (outcomes ?? []).filter((o) => o.code === 'draft_conflict' && o.item);
  const chosen = items.filter((i) => selected.has(id(i)));
  const done = outcomes !== null && outcomes.every((o) => o.ok);

  const run = async (list: PublishItem[], force: boolean) => {
    const result = await onPublish(list, note.trim() || null, force);
    setOutcomes(result);
  };

  return (
    <Dialog open onClose={onClose} title={at('siteEditor.publish.title')} icon={<Rocket />} wide>
      <div className={ui.stack}>
        {items.length === 0 ? (
          <Alert tone="info">{at('siteEditor.publish.nothing')}</Alert>
        ) : (
          <fieldset className={ui.group} disabled={busy || done}>
            <legend>{at('siteEditor.publish.items')}</legend>
            {items.map((item) => (
              <CheckboxField
                key={id(item)}
                label={
                  <span>
                    {itemLabel(item)}{' '}
                    {!canPublish(item) && <Badge>{at('siteEditor.publish.noPermission')}</Badge>}
                    {invalid(item) && <Badge tone="danger">{at('siteEditor.tree.invalid')}</Badge>}
                  </span>
                }
                checked={selected.has(id(item))}
                disabled={!canPublish(item) || invalid(item)}
                onChange={(on) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(id(item));
                    else next.delete(id(item));
                    return next;
                  })
                }
              />
            ))}
          </fieldset>
        )}
        <TextareaField
          label={at('siteEditor.publish.note')}
          hint={at('siteEditor.publish.noteHint')}
          value={note}
          maxLength={500}
          rows={2}
          onChange={setNote}
        />
        <Alert tone="warning">{at('siteEditor.publish.warning')}</Alert>
        {outcomes && (
          <div role="status" aria-live="polite" className={ui.stack}>
            {outcomes.map((o, index) => (
              <Alert key={index} tone={o.ok ? 'success' : 'danger'}>
                {o.item ? `${itemLabel(o.item)}: ` : ''}
                {o.ok ? at('siteEditor.publish.done') : (o.message ?? at('problems.generic'))}
              </Alert>
            ))}
          </div>
        )}
        {conflicts.length > 0 && (
          <Alert tone="warning">
            {at('siteEditor.publish.conflict')}
            <div className={ui.actions}>
              <Button
                variant="danger"
                loading={busy}
                onClick={() =>
                  void run(
                    conflicts.map((c) => c.item as PublishItem),
                    true,
                  )
                }
              >
                {at('siteEditor.publish.force')}
              </Button>
            </div>
          </Alert>
        )}
        <div className={ui.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            {done ? at('ui.close') : at('ui.cancel')}
          </Button>
          {!done && (
            <Button
              icon={<Rocket aria-hidden="true" />}
              loading={busy}
              disabled={chosen.length === 0}
              onClick={() => void run(chosen, false)}
            >
              {at('siteEditor.publish.confirm', { count: chosen.length })}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

const CHANGE_TONE: Record<LayoutChange, 'success' | 'danger' | 'warning' | 'neutral'> = {
  added: 'success',
  removed: 'danger',
  moved: 'warning',
  edited: 'warning',
  hidden: 'neutral',
  shown: 'neutral',
};

/** Layout history for one page: compare any version with the live layout and restore it. */
export function VersionsDialog({
  page,
  pageLabel,
  live,
  canPublish,
  busy,
  titleOf,
  onClose,
  onRollback,
}: {
  page: EditablePage;
  pageLabel: string;
  live: LayoutSection[];
  canPublish: boolean;
  busy: boolean;
  titleOf: (s: { key: string; type: string; props?: Record<string, unknown> }) => string;
  onClose: () => void;
  onRollback: (version: number) => Promise<Outcome>;
}) {
  const { at } = useAdminI18n();
  const { format } = useI18n();
  const { repositories } = useRuntime();
  const [comparing, setComparing] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [result, setResult] = useState<Outcome | null>(null);
  const versions = useQuery({
    queryKey: ['admin', 'site-editor', 'versions', page],
    queryFn: () => repositories.siteEditor.versions(page, 50),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={at('siteEditor.versions.title', { page: pageLabel })}
      icon={<History />}
      wide
    >
      <div className={ui.stack}>
        <p className={ui.hint}>{at('siteEditor.versions.hint')}</p>
        {result && (
          <Alert tone={result.ok ? 'success' : 'danger'} live>
            {result.ok ? at('siteEditor.versions.restored') : result.message}
          </Alert>
        )}
        <QueryState query={versions} isEmpty={(d) => d.length === 0}>
          {(list) => (
            <ol className={styles.versionList}>
              {list.map((v, index) => {
                const rows = comparing === v.version ? diffLayouts(v.sections, live) : [];
                const changed = rows.filter((r) => r.changes.length > 0);
                return (
                  <li key={v.version} className={styles.version}>
                    <div className={styles.versionHead}>
                      <strong>{at('siteEditor.versions.version', { n: v.version })}</strong>
                      {index === 0 && (
                        <Badge tone="success">{at('siteEditor.versions.live')}</Badge>
                      )}
                      <span className={ui.small}>
                        {format.dateTime(v.publishedAt)}
                        {v.publishedBy ? ` · ${at('ui.by', { name: v.publishedBy })}` : ''}
                      </span>
                    </div>
                    {v.note && <p className={ui.small}>{v.note}</p>}
                    <div className={ui.actions}>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-expanded={comparing === v.version}
                        onClick={() => setComparing(comparing === v.version ? null : v.version)}
                      >
                        {at('siteEditor.versions.compare')}
                        <span className="visually-hidden">
                          : {at('siteEditor.versions.version', { n: v.version })}
                        </span>
                      </Button>
                      {canPublish && index > 0 && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<RotateCcw aria-hidden="true" />}
                          onClick={() => setConfirming(v.version)}
                        >
                          {at('siteEditor.versions.restore')}
                          <span className="visually-hidden">
                            : {at('siteEditor.versions.version', { n: v.version })}
                          </span>
                        </Button>
                      )}
                    </div>
                    {confirming === v.version && (
                      <Alert tone="warning">
                        {at('siteEditor.versions.confirm', { n: v.version })}
                        <div className={ui.actions}>
                          <Button size="sm" variant="secondary" onClick={() => setConfirming(null)}>
                            {at('ui.cancel')}
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            loading={busy}
                            onClick={() =>
                              void onRollback(v.version).then((r) => {
                                setResult(r);
                                setConfirming(null);
                                if (r.ok) void versions.refetch();
                              })
                            }
                          >
                            {at('siteEditor.versions.restoreConfirm', { n: v.version })}
                          </Button>
                        </div>
                      </Alert>
                    )}
                    {comparing === v.version && (
                      <div className={ui.tableWrap}>
                        {changed.length === 0 ? (
                          <p className={ui.small}>{at('siteEditor.versions.same')}</p>
                        ) : (
                          <table className={ui.table}>
                            <caption className="visually-hidden">
                              {at('siteEditor.versions.diffCaption', { n: v.version })}
                            </caption>
                            <thead>
                              <tr>
                                <th scope="col">{at('siteEditor.versions.section')}</th>
                                <th scope="col">{at('siteEditor.versions.inVersion')}</th>
                                <th scope="col">{at('siteEditor.versions.now')}</th>
                                <th scope="col">{at('siteEditor.versions.change')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {changed.map((r) => (
                                <tr key={r.key}>
                                  <td>
                                    {titleOf(
                                      v.sections.find((s) => s.key === r.key) ??
                                        live.find((s) => s.key === r.key) ??
                                        r,
                                    )}
                                  </td>
                                  <td className="num">{r.from ?? '—'}</td>
                                  <td className="num">{r.to ?? '—'}</td>
                                  <td>
                                    {r.changes.map((c) => (
                                      <Badge key={c} tone={CHANGE_TONE[c]}>
                                        {at(`siteEditor.change.${c}` as AdminMessageKey)}
                                      </Badge>
                                    ))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </QueryState>
        <div className={ui.dialogActions}>
          <Button variant="secondary" onClick={onClose}>
            {at('ui.close')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
