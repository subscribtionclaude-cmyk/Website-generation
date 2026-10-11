import { currentLang, t } from './i18n';
import { label, CONFIRMATION, FORM_STATUS, NOT_ATTENDED_REASONS, PROPOSAL_STATUS, RESPONSE_OUTCOME, STAGE_LABEL, TEMP_LABEL } from './labels';

// Timeline summaries are written in English by the database triggers (supabase/migrations/*_triggers.sql) and are
// never modified. For the Arabic UI they are localised at display time by matching those fixed trigger templates;
// free text inside them (notes) is shown as entered. Anything unrecognised is shown unchanged.
type Rule = [RegExp, (m: RegExpExecArray) => string];
const note = (s?: string) => (s ? ` — ${s}` : '');
const RULES: Rule[] = [
  [/^Follow-up due (\S+)(?: — ([\s\S]*))?$/, (m) => t('Follow-up due {date}', { date: m[1] }) + note(m[2])],
  [/^Follow-up completed \(was due (\S+)\)$/, (m) => t('Follow-up completed (was due {date})', { date: m[1] })],
  [/^Follow-up moved (\S+) → (\S+)$/, (m) => t('Follow-up moved {from} → {to}', { from: m[1], to: m[2] })],
  [/^Information form — (\w+) → (\w+)$/, (m) => `${t('Information form')} — ${label(FORM_STATUS, m[1])} → ${label(FORM_STATUS, m[2])}`],
  [/^Information form — (\w+)$/, (m) => `${t('Information form')} — ${label(FORM_STATUS, m[1])}`],
  [/^Meeting not attended — (.+)$/, (m) => `${t('Meeting not attended')} — ${m[1] === 'no reason' ? t('no reason') : label(NOT_ATTENDED_REASONS, m[1])}`],
  [/^Meeting scheduled for (\S+ \S+)(?: \((\w+)\))?$/, (m) => t('Meeting scheduled for {when}', { when: m[1] }) + (m[2] ? ` (${label(CONFIRMATION, m[2])})` : '')],
  [/^Pipeline: (\w+) → (\w+)$/, (m) => `${t('Pipeline')}: ${STAGE_LABEL[m[1]] ?? m[1]} → ${STAGE_LABEL[m[2]] ?? m[2]}`],
  [/^Temperature: (\w+) → (\w+)$/, (m) => `${t('Temperature')}: ${TEMP_LABEL[m[1]] ?? m[1]} → ${TEMP_LABEL[m[2]] ?? m[2]}`],
  [/^Proposal status: (\w+) → (\w+)$/, (m) => `${t('Proposal status')}: ${label(PROPOSAL_STATUS, m[1])} → ${label(PROPOSAL_STATUS, m[2])}`],
  [/^Proposal (PR-\d+) — (\w+)$/, (m) => `${t('Proposal')} ${m[1]} — ${label(PROPOSAL_STATUS, m[2])}`],
  [/^Client response: (\w+)$/, (m) => `${t('Client response')}: ${label(RESPONSE_OUTCOME, m[1])}`],
];

export function activityText(summary: string | null | undefined, type: string): string {
  const s = summary ?? type;
  if (currentLang() === 'en') return s;
  for (const [re, fn] of RULES) { const m = re.exec(s); if (m) return fn(m); }
  if (type === 'call') { const m = /^(.+?)(?: — ([\s\S]*))?$/.exec(s); if (m) return t(m[1]) + note(m[2]); }
  return t(s);
}
