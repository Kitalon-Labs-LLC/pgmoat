import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildDoctorReport, renderDoctorHuman } from '../src/commands/doctor.js';
import { resetOutputConfig } from '../src/output.js';
import type { DoctorFinding } from '@pgmoat/core';

describe('CLI doctor command (P8.3)', () => {
  beforeEach(() => {
    resetOutputConfig();
  });

  afterEach(() => {
    resetOutputConfig();
  });

  it('renders exact doctor output matching spec/06 section 2.9', () => {
    const findings: DoctorFinding[] = [
      {
        code: 'PGM-705',
        severity: 'warn',
        subject: 'role readonly_agent',
        message: 'can SELECT 2 hidden columns',
        fix: 'REVOKE SELECT (password_hash) ON public.users FROM readonly_agent;\nREVOKE SELECT (mfa_secret) ON public.users FROM readonly_agent;',
      },
    ];

    const report = buildDoctorReport(
      'readonly_agent',
      'db.internal',
      5432,
      'app',
      '17.6',
      ['orders', 'tickets', 'customers'],
      findings,
    );

    const rendered = renderDoctorHuman(report);

    const expected = `pgmoat doctor  role readonly_agent on db.internal:5432/app (Postgres 17.6)

ok PGM-701  not a superuser
ok PGM-702  no BYPASSRLS
ok PGM-703  does not own protected tables (orders, tickets, customers)
ok PGM-704  RLS enabled on all protected tables
!  PGM-705  can SELECT 2 hidden columns
     REVOKE SELECT (password_hash) ON public.users FROM readonly_agent;
     REVOKE SELECT (mfa_secret) ON public.users FROM readonly_agent;
ok PGM-706  no write privileges
ok PGM-707  Postgres 17 is supported

Result: 0 failures, 1 warning.`;

    expect(rendered).toBe(expected);
    expect(report.failuresCount).toBe(0);
    expect(report.warningsCount).toBe(1);
  });

  it('renders failures with x marker and counts accurately', () => {
    const findings: DoctorFinding[] = [
      {
        code: 'PGM-701',
        severity: 'fail',
        subject: 'role admin_agent',
        message: 'Role "admin_agent" is a superuser',
        fix: 'ALTER ROLE "admin_agent" NOSUPERUSER;',
      },
      {
        code: 'PGM-706',
        severity: 'fail',
        subject: 'role admin_agent',
        message: 'Role can write to tables',
        fix: 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM admin_agent;',
      },
    ];

    const report = buildDoctorReport(
      'admin_agent',
      'localhost',
      5432,
      'devdb',
      '16.2',
      [],
      findings,
    );

    const rendered = renderDoctorHuman(report);

    expect(rendered).toContain('x  PGM-701  Role "admin_agent" is a superuser');
    expect(rendered).toContain('     ALTER ROLE "admin_agent" NOSUPERUSER;');
    expect(rendered).toContain('x  PGM-706  Role can write to tables');
    expect(rendered).toContain('Result: 2 failures, 0 warnings.');
    expect(report.failuresCount).toBe(2);
    expect(report.warningsCount).toBe(0);
  });
});
