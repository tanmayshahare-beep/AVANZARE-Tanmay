import ExcelJS from 'exceljs';
import { asAppError } from '../errors';
import type { CandidateRecord } from '../db/database';
import type { ApplicationRow, AuditEntry } from '../types';

function cvLinkCell(cvPath: string) {
  return { text: cvPath, hyperlink: `file:///${cvPath.replace(/\\/g, '/')}` };
}

async function save(wb: ExcelJS.Workbook, outPath: string): Promise<void> {
  try {
    await wb.xlsx.writeFile(outPath);
  } catch (err) {
    throw asAppError(err, 'AVZ-EXP-701', outPath);
  }
}

function styleHeader(ws: ExcelJS.Worksheet) {
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/** Export the rejection-review or LLM-results table, decision state included. */
export async function exportApplications(
  rows: ApplicationRow[],
  decisions: Map<number, string>,
  outPath: string,
  withScores: boolean,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(withScores ? 'LLM results' : 'Rejection review');
  ws.columns = [
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Phone', key: 'phone', width: 18 },
    { header: 'Tier', key: 'tier', width: 14 },
    ...(withScores ? [
      { header: 'Score /100', key: 'score', width: 10 },
      { header: 'Highest degree', key: 'degree', width: 16 },
      { header: 'CGPA', key: 'cgpa', width: 12 },
      { header: '12th %', key: 'twelfth', width: 10 },
      { header: '10th %', key: 'tenth', width: 10 },
      { header: 'Education /100', key: 'eduscore', width: 13 },
      { header: 'Certifications', key: 'certs', width: 14 },
      { header: 'Experience', key: 'exp', width: 14 },
      { header: 'Publications', key: 'pubs', width: 14 },
      { header: 'Reasoning', key: 'reasoning', width: 80 },
    ] : [
      { header: 'Keyword score /5', key: 'kwscore', width: 14 },
      { header: 'Matched mandatory', key: 'mm', width: 30 },
      { header: 'Matched optional', key: 'mo', width: 30 },
    ]),
    { header: 'Decision', key: 'decision', width: 22 },
    { header: 'CV', key: 'cv', width: 60 },
  ];
  const mark = (v: boolean | null) => v === null ? '' : v ? 'yes' : 'no';
  const edu = (r: ApplicationRow) => r.education;
  for (const r of rows) {
    const e = edu(r);
    ws.addRow({
      name: r.name,
      email: r.email ?? '(no email found)',
      phone: r.phone ?? '',
      tier: r.tier,
      score: r.score ?? '',
      degree: e?.highestDegree ?? '',
      cgpa: e?.cgpa != null ? (e.cgpaScale != null ? `${e.cgpa}/${e.cgpaScale}` : `${e.cgpa}`) : '',
      twelfth: e?.twelfthPercentage ?? '',
      tenth: e?.tenthPercentage ?? '',
      eduscore: e?.educationScore ?? '',
      certs: mark(r.criteria?.certificationsMet ?? null),
      exp: r.criteria?.experienceInRange !== null && r.criteria?.experienceInRange !== undefined
        ? `${r.criteria.experienceYears ?? '?'}y — ${r.criteria.experienceInRange ? 'in range' : 'out of range'}`
        : '',
      pubs: mark(r.criteria?.publicationsMatch ?? null),
      reasoning: r.reasoning ?? '',
      kwscore: r.keywordScore !== null ? Math.round(r.keywordScore * 10) / 10 : '',
      mm: r.matchedMandatory.join(', '),
      mo: r.matchedOptional.join(', '),
      decision: decisions.get(r.id) ?? r.status,
      cv: cvLinkCell(r.cvPath),
    });
  }
  styleHeader(ws);
  await save(wb, outPath);
}

/** Export the audit trail (GDPR/EEOC discovery). */
export async function exportAudit(rows: AuditEntry[], outPath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Audit log');
  ws.columns = [
    { header: 'Time', key: 'time', width: 24 },
    { header: 'Actor', key: 'actor', width: 18 },
    { header: 'Action', key: 'action', width: 20 },
    { header: 'Candidate ID', key: 'cid', width: 12 },
    { header: 'Application ID', key: 'aid', width: 14 },
    { header: 'Detail', key: 'detail', width: 100 },
  ];
  for (const r of rows) {
    ws.addRow({ time: r.time, actor: r.actor, action: r.action, cid: r.candidateId ?? '', aid: r.applicationId ?? '', detail: r.detail });
  }
  styleHeader(ws);
  await save(wb, outPath);
}

/** Export the persistent candidates database. */
export async function exportCandidates(rows: CandidateRecord[], outPath: string): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Candidates');
  ws.columns = [
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Phone', key: 'phone', width: 18 },
    { header: 'First seen', key: 'first', width: 22 },
    { header: 'Last seen', key: 'last', width: 22 },
    { header: 'Applications', key: 'apps', width: 12 },
    { header: 'Notes', key: 'notes', width: 60 },
    { header: 'Last CV', key: 'cv', width: 60 },
  ];
  for (const c of rows) {
    ws.addRow({
      name: c.name,
      email: c.email ?? '',
      phone: c.phone ?? '',
      first: c.firstSeen,
      last: c.lastSeen,
      apps: c.applicationCount,
      notes: c.notes,
      cv: c.lastCvPath ? cvLinkCell(c.lastCvPath) : '',
    });
  }
  styleHeader(ws);
  await save(wb, outPath);
}
