import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, Trash2 } from 'lucide-react';
import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { moveSection } from '@/domain/siteEditor/layout';
import type { LayoutSection } from '@/domain/siteEditor/schemas';
import { useAdminI18n } from '../../i18n/context';
import styles from './siteEditor.module.css';

/**
 * Page structure: ordered sections with select, show/hide, duplicate, remove and reorder.
 * Reordering works three ways — drag and drop (mouse), move up / down buttons, and a keyboard
 * "pick up" on the handle (Space or Enter, then arrow keys, Space / Enter to drop, Escape to
 * cancel) announced through a live region. No action is mouse-only.
 */
export function SectionTree({
  label,
  sections,
  selectedKey,
  invalidKeys,
  readOnly,
  titleOf,
  typeOf,
  onSelect,
  onChange,
  onDuplicate,
  onRemove,
}: {
  label: string;
  sections: LayoutSection[];
  selectedKey: string | null;
  invalidKeys: Set<string>;
  readOnly: boolean;
  titleOf: (s: LayoutSection) => string;
  typeOf: (s: LayoutSection) => string;
  onSelect: (key: string) => void;
  onChange: (next: LayoutSection[], tag?: string) => void;
  onDuplicate: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  const { at } = useAdminI18n();
  const helpId = useId();
  const [announcement, setAnnouncement] = useState('');
  const [grabbed, setGrabbed] = useState<{ key: string; from: number } | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const handles = useRef<Record<string, HTMLButtonElement | null>>({});
  const listRef = useRef<HTMLOListElement>(null);

  const move = (from: number, to: number, focusKey?: string) => {
    if (to < 0 || to >= sections.length || from === to) return;
    const next = moveSection(sections, from, to);
    onChange(next);
    const moved = next[to];
    if (moved)
      setAnnouncement(
        at('siteEditor.tree.moved', { name: titleOf(moved), position: to + 1, total: next.length }),
      );
    if (focusKey) requestAnimationFrame(() => handles.current[focusKey]?.focus());
  };

  // Mouse drag and drop (native DnD on the list; the keyboard and buttons cover everything else).
  const indexOf = (target: EventTarget | null) => {
    const item =
      target instanceof Element ? target.closest<HTMLElement>('[data-section-key]') : null;
    const key = item?.dataset.sectionKey;
    return key ? sections.findIndex((x) => x.key === key) : -1;
  };
  const onDragEvent = useEffectEvent((event: DragEvent) => {
    if (event.type === 'dragstart') {
      const index = indexOf(event.target);
      const section = sections[index];
      if (!section || !event.dataTransfer) return;
      setDragKey(section.key);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', section.key);
    } else if (event.type === 'dragover') {
      if (!dragKey) return;
      event.preventDefault();
      setDropIndex(indexOf(event.target));
    } else if (event.type === 'drop') {
      event.preventDefault();
      const from = sections.findIndex((x) => x.key === dragKey);
      const to = indexOf(event.target);
      if (from >= 0 && to >= 0) move(from, to);
      setDragKey(null);
      setDropIndex(null);
    } else if (event.type === 'dragend') {
      setDragKey(null);
      setDropIndex(null);
    }
  });
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const handler = (event: DragEvent) => onDragEvent(event);
    const types = ['dragstart', 'dragover', 'drop', 'dragend'] as const;
    for (const type of types) list.addEventListener(type, handler);
    return () => {
      for (const type of types) list.removeEventListener(type, handler);
    };
  }, []);

  return (
    <div className={styles.tree}>
      <p id={helpId} className="visually-hidden">
        {at('siteEditor.tree.keyboardHelp')}
      </p>
      <p className="visually-hidden" role="status" aria-live="assertive">
        {announcement}
      </p>
      {sections.length === 0 && <p className={styles.muted}>{at('siteEditor.tree.empty')}</p>}
      <ol ref={listRef} className={styles.treeList} aria-label={label}>
        {sections.map((s, index) => {
          const title = titleOf(s);
          const selected = s.key === selectedKey;
          const isGrabbed = grabbed?.key === s.key;
          return (
            <li
              key={s.key}
              className={[
                styles.treeItem,
                selected && styles.treeItemSelected,
                !s.isVisible && styles.treeItemHidden,
                isGrabbed && styles.treeItemGrabbed,
                dropIndex === index && dragKey !== s.key && styles.treeItemDrop,
              ]
                .filter(Boolean)
                .join(' ')}
              draggable={!readOnly}
              data-section-key={s.key}
            >
              <div className={styles.treeRow}>
                {!readOnly && (
                  <button
                    ref={(el) => {
                      handles.current[s.key] = el;
                    }}
                    type="button"
                    className={styles.handle}
                    aria-label={at('siteEditor.tree.reorder', { name: title })}
                    aria-describedby={helpId}
                    aria-pressed={isGrabbed}
                    onBlur={() => {
                      if (isGrabbed) setGrabbed(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        if (isGrabbed) {
                          setGrabbed(null);
                          setAnnouncement(
                            at('siteEditor.tree.dropped', { name: title, position: index + 1 }),
                          );
                        } else {
                          setGrabbed({ key: s.key, from: index });
                          setAnnouncement(at('siteEditor.tree.grabbed', { name: title }));
                        }
                      } else if (isGrabbed && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                        e.preventDefault();
                        move(index, index + (e.key === 'ArrowUp' ? -1 : 1), s.key);
                      } else if (isGrabbed && e.key === 'Escape') {
                        e.preventDefault();
                        move(index, grabbed.from, s.key);
                        setGrabbed(null);
                        setAnnouncement(at('siteEditor.tree.cancelled', { name: title }));
                      }
                    }}
                  >
                    <GripVertical aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className={styles.treeSelect}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(s.key)}
                >
                  <span className={styles.treeTitle}>
                    <span className={styles.treeIndex}>{index + 1}.</span> {title}
                  </span>
                  <span className={styles.treeMeta}>{typeOf(s)}</span>
                </button>
                <span className={styles.treeBadges}>
                  {!s.isVisible && <Badge>{at('siteEditor.tree.hidden')}</Badge>}
                  {invalidKeys.has(s.key) && (
                    <Badge tone="danger">{at('siteEditor.tree.invalid')}</Badge>
                  )}
                </span>
              </div>
              {!readOnly && (
                <div className={styles.treeActions}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label={`${at('ui.moveUp')}: ${title}`}
                    disabled={index === 0}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label={`${at('ui.moveDown')}: ${title}`}
                    disabled={index === sections.length - 1}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown aria-hidden="true" />
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={s.isVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                    onClick={() =>
                      onChange(
                        sections.map((x) =>
                          x.key === s.key ? { ...x, isVisible: !x.isVisible } : x,
                        ),
                      )
                    }
                  >
                    {s.isVisible ? at('siteEditor.tree.hide') : at('siteEditor.tree.show')}
                    <span className="visually-hidden">: {title}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Copy aria-hidden="true" />}
                    onClick={() => onDuplicate(s.key)}
                  >
                    {at('siteEditor.tree.duplicate')}
                    <span className="visually-hidden">: {title}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 aria-hidden="true" />}
                    onClick={() => onRemove(s.key)}
                  >
                    {at('siteEditor.tree.remove')}
                    <span className="visually-hidden">: {title}</span>
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
