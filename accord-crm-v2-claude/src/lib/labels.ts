import { locPairs, locRecord, t } from './i18n';

// Canonical keys are stored in the database; only the display labels are localised (on access, via i18n).
export const TEMPERATURES = ['cold', 'warm', 'hot', 'lost', 'closed'] as const;
export const TEMP_LABEL: Record<string, string> = locRecord({ cold: 'Cold', warm: 'Warm', hot: 'Hot', lost: 'Lost', closed: 'Closed' });

export const STAGES = ['research', 'outreach', 'qualified', 'meeting', 'proposal', 'negotiation', 'won', 'lost'] as const;
export const STAGE_LABEL: Record<string, string> = locRecord({
  research: 'Research', outreach: 'Outreach', qualified: 'Qualified', meeting: 'Meeting', proposal: 'Proposal',
  negotiation: 'Negotiation', won: 'Won', lost: 'Lost',
});

export const OUTCOME_LABEL: Record<string, string> = locRecord({
  responded: 'Responded', did_not_respond: "Didn't Respond", busy: 'Busy', callback_requested: 'Callback Requested',
  voicemail: 'Voicemail', wrong_number: 'Wrong Number', number_unavailable: 'Number Unavailable',
});
export const RESPONDED_SUBS: [string, string][] = locPairs([
  ['interested', 'Interested'], ['follow_up_needed', 'Follow-up Needed'], ['meeting_requested', 'Meeting Requested'],
  ['meeting_scheduled', 'Meeting Scheduled'], ['proposal_discussion', 'Proposal Discussion'], ['not_interested', 'Not Interested'], ['other', 'Other'],
]);
export const NO_RESPONSE_SUBS: [string, string][] = locPairs([
  ['retry_later_today', 'Retry Later Today'], ['tomorrow', 'Tomorrow'], ['select_date', 'Select Date'], ['no_retry', 'No Retry'],
]);

export const MEETING_TYPES: [string, string][] = locPairs([['physical', 'Physical'], ['online', 'Online'], ['phone', 'Phone / Conference']]);
export const CONFIRMATION: [string, string][] = locPairs([['confirmed', 'Confirmed'], ['unconfirmed', 'Unconfirmed'], ['tentative', 'Tentative']]);
export const NOT_ATTENDED_REASONS: [string, string][] = locPairs([
  ['client_did_not_attend', 'Client Did Not Attend'], ['accord_did_not_attend', 'ACCORD Did Not Attend'], ['client_cancelled', 'Client Cancelled'],
  ['rescheduled', 'Rescheduled'], ['unable_to_reach_client', 'Unable to Reach Client'], ['timing_conflict', 'Timing Conflict'], ['other', 'Other'],
]);
export const MEETING_OUTCOMES: [string, string][] = locPairs([
  ['positive', 'Positive'], ['neutral', 'Neutral'], ['negative', 'Negative'], ['more_information_required', 'More Information Required'],
  ['form_required', 'Form Required'], ['proposal_requested', 'Proposal Requested'], ['second_meeting_required', 'Second Meeting Required'],
  ['negotiation', 'Negotiation'], ['no_opportunity', 'No Opportunity'], ['other', 'Other'],
]);
export const NEXT_STEPS: [string, string][] = locPairs([
  ['send_requirement_form', 'Send Requirement Form'], ['wait_for_completed_form', 'Wait for Completed Form'], ['prepare_proposal', 'Prepare Proposal'],
  ['send_proposal', 'Send Proposal'], ['follow_up', 'Follow Up'], ['schedule_second_meeting', 'Schedule Second Meeting'],
  ['provide_technical_information', 'Provide Technical Information'], ['commercial_negotiation', 'Commercial Negotiation'],
  ['close_opportunity', 'Close Opportunity'], ['other', 'Other'],
]);
export const FORM_STATUS: [string, string][] = locPairs([
  ['not_required', 'Not Required'], ['not_sent', 'Not Sent'], ['sent', 'Sent'], ['partially_completed', 'Partially Completed'], ['completed', 'Completed'],
]);
export const PROPOSAL_STATUS: [string, string][] = locPairs([
  ['not_started', 'Not Started'], ['preparing', 'Preparing'], ['ready', 'Ready'], ['sent', 'Sent'], ['under_review', 'Under Review'],
  ['revision_requested', 'Revision Requested'], ['accepted', 'Accepted'], ['rejected', 'Rejected'], ['closed', 'Closed'],
]);
export const RESPONSE_STATE: [string, string][] = locPairs([['awaiting_response', 'Awaiting Response'], ['responded', 'Responded'], ['no_response_yet', 'No Response Yet']]);
export const RESPONSE_OUTCOME: [string, string][] = locPairs([
  ['positive', 'Positive'], ['needs_revision', 'Needs Revision'], ['needs_meeting', 'Needs Meeting'], ['negotiation', 'Negotiation'],
  ['rejected', 'Rejected'], ['accepted', 'Accepted'], ['other', 'Other'],
]);
export const ROLE_LABEL: Record<string, string> = locRecord({ admin: 'Admin', bd_executive: 'BD Executive', viewer: 'Viewer' });

export function label(map: [string, string][] | Record<string, string>, key?: string | null): string {
  if (!key) return '—';
  const m = Array.isArray(map) ? Object.fromEntries(map) : map;
  const v = m[key];
  return v ? t(v) : t(key.replace(/_/g, ' ')); // t() also covers inline [key, English] pairs
}
export const proposalCode = (n?: number | null) => (n ? `PR-${String(n).padStart(5, '0')}` : '—');
