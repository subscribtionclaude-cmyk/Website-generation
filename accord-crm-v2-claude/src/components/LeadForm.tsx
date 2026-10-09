import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase, unwrap } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { useToast } from '../lib/toast';
import { Modal, Field, Select, ErrorNote, UserSelect } from './ui';
import { TEMPERATURES, TEMP_LABEL, STAGES, STAGE_LABEL } from '../lib/labels';
import type { LeadRow } from '../lib/types';
import { t } from '../lib/i18n';

const splitList = (s: string) => [...new Set(s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean))];

export function LeadFormDialog({ lead, onClose, onSaved }: { lead?: Partial<LeadRow> & { website?: string | null; notes?: string | null; address?: string | null }; onClose: () => void; onSaved?: (id: string) => void }) {
  const { profile, isAdmin } = useAuth();
  const qc = useQueryClient(); const toast = useToast();
  const [name, setName] = useState(lead?.name ?? '');
  const [temp, setTemp] = useState(lead?.temperature ?? 'cold');
  const [stage, setStage] = useState(lead?.pipeline_stage ?? 'research');
  const [owner, setOwner] = useState(lead ? lead.owner_id ?? '' : profile!.id);
  const [city, setCity] = useState(lead?.city ?? '');
  const [industry, setIndustry] = useState(lead?.industry ?? '');
  const [website, setWebsite] = useState(lead?.website ?? '');
  const [notes, setNotes] = useState(lead?.notes ?? '');
  const [cName, setCName] = useState(''); const [cTitle, setCTitle] = useState(''); const [cEmail, setCEmail] = useState(''); const [cPhone, setCPhone] = useState('');
  const [dupe, setDupe] = useState<{ id: string; name: string } | null>(null);
  const [err, setErr] = useState<unknown>(null); const [busy, setBusy] = useState(false);

  async function save(force = false) {
    setErr(null);
    if (!name.trim()) { setErr(new Error('Company name is required')); return; }
    setBusy(true);
    try {
      if (!lead && !force) {
        const norm = name.trim().toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ');
        const { data } = await supabase.from('leads').select('id,name').eq('name_norm', norm).limit(1);
        if (data && data.length) { setDupe(data[0] as { id: string; name: string }); setBusy(false); return; }
      }
      const row = { name: name.trim(), temperature: temp, pipeline_stage: stage, owner_id: owner || null, city: city.trim() || null, industry: industry.trim() || null, website: website.trim() || null, notes: notes.trim() || null };
      let id = lead?.id;
      if (lead?.id) {
        unwrap(await supabase.from('leads').update(row).eq('id', lead.id).select('id'));
      } else {
        const r = unwrap(await supabase.from('leads').insert({ ...row, created_by: profile!.id }).select('id').single()) as { id: string };
        id = r.id;
        if (cName.trim() || cEmail.trim() || cPhone.trim()) {
          unwrap(await supabase.from('contacts').insert({ lead_id: id, full_name: cName.trim(), job_title: cTitle.trim() || null, emails: splitList(cEmail.toLowerCase()), phones: splitList(cPhone), is_primary: Boolean(cName.trim()), source: 'manual' }).select('id'));
        }
      }
      for (const k of [['leads'], ['lead', id], ['pipeline']]) qc.invalidateQueries({ queryKey: k as string[] });
      toast(lead ? 'Lead updated' : 'Lead created', 'ok');
      onSaved?.(id!); onClose();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  }

  return (
    <Modal wide side title={lead ? `Edit lead · ${lead.name}` : 'New lead'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" disabled={busy} onClick={() => save()}>{lead ? 'Save changes' : 'Create lead'}</button></>}>
      <ErrorNote error={err} />
      {dupe && <div className="notice warn">{t('A lead named')} <b>{dupe.name}</b> {t('already exists.')} <Link to={`/leads/view/?id=${dupe.id}`}>{t('Open it')}</Link> {t('or')} <button className="btn sm" onClick={() => save(true)}>{t('create anyway')}</button></div>}
      <div className="form-grid">
        <Field label={t('Company *')} full><input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label={t('Temperature')}><Select value={temp} onChange={setTemp} options={TEMPERATURES.map((t) => [t, TEMP_LABEL[t]])} /></Field>
        <Field label={t('Pipeline stage')}><Select value={stage} onChange={setStage} options={STAGES.map((t) => [t, STAGE_LABEL[t]])} /></Field>
        <Field label={t('Owner')}>{isAdmin ? <UserSelect value={owner} onChange={setOwner} includeAll allLabel={t('Unassigned')} /> : <select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">{t('Unassigned')}</option><option value={profile!.id}>{t('Me')}</option></select>}</Field>
        <Field label={t('City')}><input value={city} onChange={(e) => setCity(e.target.value)} /></Field>
        <Field label={t('Industry')}><input value={industry} onChange={(e) => setIndustry(e.target.value)} /></Field>
        <Field label={t('Website')}><input value={website} onChange={(e) => setWebsite(e.target.value)} /></Field>
        <Field label={t('Notes')} full><textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {!lead && (
        <>
          <h3>{t('First contact (optional)')}</h3>
          <div className="form-grid">
            <Field label={t('Name')}><input value={cName} onChange={(e) => setCName(e.target.value)} /></Field>
            <Field label={t('Job title')}><input value={cTitle} onChange={(e) => setCTitle(e.target.value)} /></Field>
            <Field label={t('Email(s)')}><input value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder={t('comma separated')} /></Field>
            <Field label={t('Phone(s)')}><input value={cPhone} onChange={(e) => setCPhone(e.target.value)} placeholder={t('comma separated')} inputMode="tel" /></Field>
          </div>
        </>
      )}
    </Modal>
  );
}
