import { describe, expect, it } from 'vitest';
import { parseEmails, parsePhones, parseLinkedIn, parseContacts, parseDate, parseBool, parseLeadSheet, parseProjectSheet, parseLeadId } from '../../supabase/functions/_shared/sheet-core';

describe('legacy sheet parsing (real-world samples from Accord New Data)', () => {
  it('splits emails on newlines, literal \\n and spaces; lowercases; dedupes', () => {
    expect(parseEmails('info@ilcazar.com\nmarieelwy@gmail.com')).toEqual(['info@ilcazar.com', 'marieelwy@gmail.com']);
    expect(parseEmails('info@aayandevelopments.com\\nA.hegazi@aayandevelopments.com')).toEqual(['info@aayandevelopments.com', 'a.hegazi@aayandevelopments.com']);
    expect(parseEmails('ZAYA.INFO@GMAIL.COM')).toEqual(['zaya.info@gmail.com']);
    expect(parseEmails('a@x.com a@x.com')).toEqual(['a@x.com']);
    expect(parseEmails('')).toEqual([]);
  });
  it('splits phones per line but keeps a number that contains a space', () => {
    expect(parsePhones('01025408565\n01287777850\n01000774338')).toEqual(['01025408565', '01287777850', '01000774338']);
    expect(parsePhones('01273354613\n0100 4417177\u202C ')).toEqual(['01273354613', '01004417177']);
    expect(parsePhones('01117456677 01110124469 01004418481')).toEqual(['01117456677', '01110124469', '01004418481']);
    expect(parsePhones('+20 100 123 4567')).toEqual(['+201001234567']);
  });
  it('extracts clean LinkedIn profile URLs from concatenated, truncated cells', () => {
    const cell = 'https://www.linkedin.com/in/mohamed-el-beshry/?lipi=urn%3Ali%3Apage%3Ad_flagship3%3B2hI0nckhT1%3D%3Dhttps://www.linkedin.com/in/kareem-azab-21146a185/?lipi=abc\nhttps://www.linkedin.com/in/mohamed-el-beshry/?lipi=zzz\n://www.linkedin.com/in/haroun-abdelghany-1981a5280/?lipi=q';
    expect(parseLinkedIn(cell)).toEqual([
      'https://www.linkedin.com/in/mohamed-el-beshry', 'https://www.linkedin.com/in/kareem-azab-21146a185', 'https://www.linkedin.com/in/haroun-abdelghany-1981a5280']);
  });
  it('parses "Name | Title" contacts, one per line or squeezed on one line', () => {
    expect(parseContacts('Ahmed Elwy | CDO\nAhmed Morsi | Sales Director')).toEqual([{ name: 'Ahmed Elwy', title: 'CDO' }, { name: 'Ahmed Morsi', title: 'Sales Director' }]);
    expect(parseContacts('Hossam Abu Elmagd | commercial Director  Mohamed ElBeshry | Head of Operations  Kareem Azab | Sales Director')).toEqual([
      { name: 'Hossam Abu Elmagd', title: 'commercial Director' }, { name: 'Mohamed ElBeshry', title: 'Head of Operations' }, { name: 'Kareem Azab', title: 'Sales Director' }]);
    expect(parseContacts('Solo Name')).toEqual([{ name: 'Solo Name', title: '' }]);
    expect(parseContacts('')).toEqual([]);
  });
  it('never guesses ambiguous dates', () => {
    expect(parseDate('2026-10-06')).toBe('2026-10-06');
    expect(parseDate(46301)).toBe('2026-10-06'); // Google serial
    expect(parseDate('')).toBeNull();
    expect(parseDate('06/10/2026')).toBeUndefined();
    expect(parseDate('2026-02-31')).toBeUndefined();
  });
  it('parses booleans and lead ids', () => {
    expect(parseBool('TRUE')).toBe(true); expect(parseBool(false)).toBe(false); expect(parseBool('')).toBeNull();
    expect(parseLeadId(24)).toBe('24'); expect(parseLeadId('7.0')).toBe('7'); expect(parseLeadId('')).toBeNull();
  });
  it('maps Sheet1 headers dynamically and skips blank rows', () => {
    const values = [
      ['Company', 'Email', 'Sent', 'Contact', 'Linkedin', 'Contacted', 'Phone No.', 'Called', 'Status', 'Next Step', 'Lead ID', 'Last Activity', 'Follow-up Date', 'Notes', 'Column 1'],
      ['IL Cazar Developments', 'info@ilcazar.com\nmarieelwy@gmail.com', true, 'Ahmed Elwy | CDO', '', false, '01025408565', true, 'Warm', 'Follow up', 2, '2026-10-06', '2026-10-11', 'x', 'didnt respond'],
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
      ['Eliwah Group', 'info@eliwahgroup.com', true, '', '', false, '', false, 'Cold', 'Searching for contact', 1],
    ];
    const r = parseLeadSheet(values);
    expect(r.headerRow).toBe(1);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ row_number: 2, company: 'IL Cazar Developments', external_lead_id: '2', status: 'Warm', follow_up_date: '2026-10-11', called: true, extra_notes: ['didnt respond'] });
    expect(r.rows[1]).toMatchObject({ row_number: 4, external_lead_id: '1', emails: ['info@eliwahgroup.com'] });
    expect(r.columns.company).toBe(0);
  });
  it('parses Sheet2 (blank first/last headers ignored) incl. Arabic names', () => {
    const r = parseProjectSheet([['', 'DEVELOPER', 'PROJECT', ''], [1, 'ERG', 'Diamond 1', 1], [11, 'شركة مصر افريقيا', 'sc-1 school', 1]]);
    expect(r.rows).toEqual([
      { row_number: 2, developer: 'ERG', project: 'Diamond 1', attributes: {} },
      { row_number: 3, developer: 'شركة مصر افريقيا', project: 'sc-1 school', attributes: {} }]);
  });
  it('fails clearly when headers are missing', () => {
    expect(() => parseLeadSheet([['foo', 'bar']])).toThrow(/Company/);
    expect(() => parseProjectSheet([['foo']])).toThrow(/DEVELOPER/);
  });
});
