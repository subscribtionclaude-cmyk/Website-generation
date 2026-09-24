/** Route `handle` metadata for storefront sections that are scheduled for a later phase. */
export interface SectionHandle {
  /** Matches a navigation item id (e.g. "trade-in") so the page title follows admin-edited labels. */
  section: string;
  phase: number;
}
