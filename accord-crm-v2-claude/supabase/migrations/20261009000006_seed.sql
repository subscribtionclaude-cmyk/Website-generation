-- Reference data and default configuration (no business data, no users)
insert into public.pipeline_stages (key, label, position, is_terminal) values
  ('research', 'Research', 1, false), ('outreach', 'Outreach', 2, false), ('qualified', 'Qualified', 3, false),
  ('meeting', 'Meeting', 4, false), ('proposal', 'Proposal', 5, false), ('negotiation', 'Negotiation', 6, false),
  ('won', 'Won', 7, true), ('lost', 'Lost', 8, true)
on conflict (key) do nothing;

insert into public.call_outcomes (key, label, kind, position, active) values
  ('responded', 'Responded', 'responded', 1, true),
  ('did_not_respond', 'Didn''t Respond', 'did_not_respond', 2, true),
  ('busy', 'Busy', 'did_not_respond', 3, false),
  ('callback_requested', 'Callback Requested', 'responded', 4, false),
  ('voicemail', 'Voicemail', 'did_not_respond', 5, false),
  ('wrong_number', 'Wrong Number', 'did_not_respond', 6, false),
  ('number_unavailable', 'Number Unavailable', 'did_not_respond', 7, false)
on conflict (key) do nothing;

insert into public.activity_types (key, label, icon) values
  ('lead_created', 'Lead created', 'plus-circle'), ('call', 'Call', 'phone'),
  ('follow_up_created', 'Follow-up scheduled', 'calendar-clock'), ('follow_up_completed', 'Follow-up completed', 'check-circle'),
  ('follow_up_rescheduled', 'Follow-up moved', 'calendar-clock'),
  ('meeting_requested', 'Meeting requested', 'handshake'), ('meeting_scheduled', 'Meeting scheduled', 'calendar'),
  ('meeting_confirmed', 'Meeting confirmed', 'badge-check'), ('meeting_attended', 'Meeting attended', 'users'),
  ('meeting_not_attended', 'Meeting not attended', 'user-x'), ('meeting_rescheduled', 'Meeting rescheduled', 'calendar-sync'),
  ('meeting_cancelled', 'Meeting cancelled', 'calendar-x'), ('minutes_added', 'Minutes added', 'file-text'),
  ('form_required', 'Form required', 'clipboard-list'), ('form_sent', 'Form sent', 'send'),
  ('form_completed', 'Form completed', 'clipboard-check'), ('form_updated', 'Form updated', 'clipboard'),
  ('proposal_prepared', 'Proposal prepared', 'file-pen'), ('proposal_sent', 'Proposal sent', 'send'),
  ('proposal_status_changed', 'Proposal status', 'file-check'), ('proposal_response', 'Proposal response', 'message-square'),
  ('negotiation', 'Negotiation', 'scale'), ('pipeline_change', 'Pipeline change', 'git-branch'),
  ('temperature_change', 'Temperature change', 'thermometer')
on conflict (key) do nothing;

insert into public.settings (key, value, description) values
  ('timezone', '"Africa/Cairo"', 'Business timezone (informational; logic is fixed to Africa/Cairo)'),
  ('working_days', '[0,1,2,3,4]', 'Days counted for period targets (0 = Sunday). Default Sun–Thu.'),
  ('company_name', '"ACCORD Property & Facility Management"', 'Display name')
on conflict (key) do nothing;
