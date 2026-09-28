import { useRef, type ReactNode } from 'react';
import styles from './adminUi.module.css';

export interface TabItem<K extends string> {
  id: K;
  label: ReactNode;
  count?: number;
}

/** WAI-ARIA tabs: arrow keys / Home / End move between tabs (automatic activation). */
export function Tabs<K extends string>({
  tabs,
  active,
  onChange,
  idBase,
  label,
}: {
  tabs: TabItem<K>[];
  active: K;
  onChange: (id: K) => void;
  idBase: string;
  label: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const focus = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (!tab) return;
    onChange(tab.id);
    refs.current[tab.id]?.focus();
  };
  return (
    <div className={styles.tabList} role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(el) => {
            refs.current[tab.id] = el;
          }}
          type="button"
          role="tab"
          id={`${idBase}-tab-${tab.id}`}
          aria-selected={tab.id === active}
          aria-controls={`${idBase}-panel`}
          tabIndex={tab.id === active ? 0 : -1}
          className={styles.tab}
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => {
            const rtl = document.documentElement.dir === 'rtl';
            if (e.key === 'ArrowRight') focus(index + (rtl ? -1 : 1));
            else if (e.key === 'ArrowLeft') focus(index + (rtl ? 1 : -1));
            else if (e.key === 'Home') focus(0);
            else if (e.key === 'End') focus(tabs.length - 1);
            else return;
            e.preventDefault();
          }}
        >
          {tab.label}
          {tab.count !== undefined && <span className={styles.tabCount}>{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  idBase,
  active,
  children,
}: {
  idBase: string;
  active: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idBase}-panel`}
      aria-labelledby={`${idBase}-tab-${active}`}
      className={styles.tabPanel}
      // Panels without focusable content still need to be reachable after the tab list.
      // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
      tabIndex={0}
    >
      {children}
    </div>
  );
}
