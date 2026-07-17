import ExcelJS from 'exceljs';
import { asAppError } from '../errors';
import type { CandidateRecord } from '../db/database';
import type { ApplicationRow } from '../types';

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
      { header: 'Score /10', key: 'score', width: 10 },
      { header: 'Reasoning', key: 'reasoning', width: 80 },
    ] : [
      { header: 'Matched mandatory', key: 'mm', width: 30 },
      { header: 'Matched optional', key: 'mo', width: 30 },
    ]),
    { header: 'Decision', key: 'decision', width: 22 },
    { header: 'CV', key: 'cv', width: 60 },
  ];
  for (const r of rows) {
    ws.addRow({
      name: r.name,
      email: r.email ?? '(no email found)',
      phone: r.phone ?? '',
      tier: r.tier,
      score: r.score ?? '',
      reasoning: r.reasoning ?? '',
      mm: r.matchedMandatory.join(', '),
      mo: r.matchedOptional.join(', '),
      decision: decisions.get(r.id) ?? r.status,
      cv: cvLinkCell(r.cvPath),
    });
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
    { header: 'Last CV', key: 'cv', width: 60 },
  ];
  for (const c of rows) {
    ws.addRow({
      name: c.name,
      email: c.email ?? '',
      phone: c.phone ?? '',
      first: c.firstSeen,
      last: c.lastSeen,
      cv: c.lastCvPath ? cvLinkCell(c.lastCvPath) : '',
    });
  }
  styleHeader(ws);
  await save(wb, outPath);
}
