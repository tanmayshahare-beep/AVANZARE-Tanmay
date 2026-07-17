import nodemailer from 'nodemailer';
import { AppError, asAppError } from '../errors';
import type { Database } from '../db/database';
import type { ApplicationRow, EmailSendReport, EmailTemplates, SmtpSettings } from '../types';

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new AppError('AVZ-MAIL-305', 'template', `unknown placeholder {{${key}}}`);
    return vars[key];
  });
}

function makeTransport(smtp: SmtpSettings) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
}

export async function testSmtpConnection(smtp: SmtpSettings): Promise<void> {
  try {
    await makeTransport(smtp).verify();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = /auth|credentials|535/i.test(msg) ? 'AVZ-MAIL-302' : 'AVZ-MAIL-301';
    throw new AppError(code, `${smtp.host}:${smtp.port}`, msg, err);
  }
}

export type EmailKind = 'rejection' | 'acceptance';

/**
 * Send one kind of decision email to a set of applications and update their
 * status. Per-recipient failures are collected, never thrown — the recruiter
 * sees a full report at the end.
 */
export async function sendDecisionEmails(
  smtp: SmtpSettings,
  templates: EmailTemplates,
  jobTitle: string,
  applications: ApplicationRow[],
  kind: EmailKind,
  db: Database,
): Promise<EmailSendReport> {
  const transport = makeTransport(smtp);
  const subjectTpl = kind === 'rejection' ? templates.rejectionSubject : templates.acceptanceSubject;
  const bodyTpl = kind === 'rejection' ? templates.rejectionBody : templates.acceptanceBody;
  const finalStatus = kind === 'rejection'
    ? 'rejected_notified' as const
    : 'accepted' as const;

  const report: EmailSendReport = { sent: 0, failed: [], noEmail: [] };

  for (const app of applications) {
    if (!app.email) {
      report.noEmail.push({ applicationId: app.id, name: app.name });
      db.logEmail(app.id, kind, null, 'skipped_no_email', 'AVZ-MAIL-304');
      // Decision still recorded even though nobody could be notified.
      db.setApplicationStatus(app.id, kind === 'rejection' ? 'rejected_final' : 'accepted');
      continue;
    }
    const vars = { name: app.name, job_title: jobTitle };
    const cv = db.getCvInfo(app.id);
    try {
      await transport.sendMail({
        from: smtp.fromName ? `"${smtp.fromName}" <${smtp.fromAddress}>` : smtp.fromAddress,
        to: app.email,
        subject: renderTemplate(subjectTpl, vars),
        text: renderTemplate(bodyTpl, vars),
      });
      report.sent += 1;
      db.logEmail(app.id, kind, app.email, 'sent');
      db.setApplicationStatus(app.id, finalStatus);
      db.audit('email_sent',
        `${kind} to ${app.email} for job "${jobTitle}" (CV ${cv.path}, sha256 ${cv.hash.slice(0, 16)}…)`,
        app.candidateId, app.id);
    } catch (err) {
      const appErr = asAppError(err, 'AVZ-MAIL-303', app.email);
      report.failed.push({ applicationId: app.id, name: app.name, code: appErr.code, message: appErr.message });
      db.logEmail(app.id, kind, app.email, 'failed', appErr.code);
      db.audit('email_failed', `${kind} to ${app.email}: ${appErr.code}`, app.candidateId, app.id);
    }
  }

  transport.close();
  return report;
}
