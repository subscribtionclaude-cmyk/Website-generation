export interface LeadRow {
  id: string; name: string; external_lead_id: string | null; temperature: string; pipeline_stage: string; owner_id: string | null;
  owner_name: string | null; city: string | null; industry: string | null; source: string; archived: boolean; created_at: string; legacy: Record<string, unknown>;
  contacts_count: number | null; primary_contact: string | null; total_calls: number | null; responded_calls: number | null;
  last_call_at: string | null; last_call_outcome: string | null; open_follow_ups: number | null; next_follow_up_date: string | null;
  next_meeting_at: string | null; next_meeting_confirmation: string | null; meetings_total: number | null; meetings_attended: number | null;
  last_meeting_outcome: string | null; form_status: string | null; proposal_status: string | null; proposal_response: string | null;
  negotiation_recorded: boolean | null; last_activity_at: string | null; suggested_stage: string | null;
}
export interface Contact {
  id: string; lead_id: string; full_name: string; job_title: string | null; emails: string[]; phones: string[]; linkedin: string[];
  is_primary: boolean; notes: string | null;
}
export interface Meeting {
  id: string; lead_id: string; contact_id: string | null; owner_id: string | null; status: string; scheduled_at: string | null;
  meeting_type: string; location: string | null; online_link: string | null; confirmation_status: string; attendance_status: string;
  meeting_with: string | null; purpose: string | null; agenda: string | null; internal_attendees: string | null; external_attendees: string | null;
  notes: string | null; summary: string | null; minutes_of_meeting: string | null; discussion_points: string | null; client_requirements: string | null;
  agreements: string | null; commitments: string | null; requested_documents: string | null; commercial_notes: string | null;
  meeting_outcome: string | null; next_step: string | null; next_step_detail: string | null; next_follow_up_at: string | null;
  next_meeting_required: boolean | null; next_meeting_id: string | null; not_attended_reason: string | null; not_attended_notes: string | null;
  rescheduled_from_id: string | null; follows_meeting_id: string | null; proposal_id: string | null; created_from_call_id: string | null;
  leads?: { name: string } | null;
}
export interface FollowUp {
  id: string; lead_id: string; owner_id: string | null; title: string; notes: string | null; due_date: string; due_time: string | null;
  status: string; origin: string; completed_at: string | null; leads?: { name: string } | null; contact_id: string | null;
}
export interface CallAttempt {
  id: string; lead_id: string; user_id: string; outcome: string; sub_outcome: string | null; called_at: string; notes: string | null;
  duration_seconds: number | null; call_session_id: string | null; leads?: { name: string } | null; profiles?: { full_name: string } | null;
}
export interface Proposal {
  id: string; proposal_no: number; lead_id: string; title: string; owner_id: string | null; value: number | null; currency: string; status: string;
  prepared_on: string | null; sent_on: string | null; file_path: string | null; notes: string | null; next_follow_up_date: string | null;
  response_state: string | null; response_outcome: string | null; response_on: string | null; response_notes: string | null; form_id: string | null;
  contact_ids: string[]; leads?: { name: string } | null;
}
export interface Form {
  id: string; lead_id: string; meeting_id: string | null; owner_id: string | null; required: boolean; status: string; sent_on: string | null;
  completed_on: string | null; link: string | null; file_path: string | null; notes: string | null; leads?: { name: string } | null;
}
export interface Activity {
  id: string; lead_id: string; actor_id: string | null; type: string; occurred_at: string; summary: string | null; data: Record<string, unknown>;
  profiles?: { full_name: string } | null;
}
export interface ProfileLite { id: string; full_name: string; email: string; role: string; active: boolean }
