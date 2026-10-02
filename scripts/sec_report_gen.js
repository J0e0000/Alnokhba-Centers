/* eslint-disable */
/** Security Audit Report body content + assembly (uses sec_report_lib.js) */
const L = require("./sec_report_lib.js");
const {
  PAL, BODY, FONT, run, bodyP, h1, h2, noteP, tableTitle, dataTable, buildCoverR1, pageNumFooter, docHeader,
  Document, Packer, Paragraph, TextRun, PageBreak, TableOfContents, SectionType, NumberFormat, AlignmentType, fs,
} = L;

// ============================= content tables =============================
const archTable = {
  headers: ["Layer", "What was audited", "Assessment"],
  widths: [16, 46, 38],
  rows: [
    ["Frontend", "Next.js 16 App Router, React 19, 58 client components, service worker", "No XSS sinks; React auto-escaping everywhere; 2 benign dangerouslySetInnerHTML (code-defined CSS vars, static theme script); no markdown/HTML rendering of user content"],
    ["Backend / API", "79 route handlers across staff, student portal, teacher portal, academia, admin", "Per-route server-side guards (no middleware); central error wrapper returns friendly Arabic messages only - no stack traces reach clients"],
    ["Database", "Prisma ORM on Supabase Postgres (production) / SQLite (dev)", "All queries parameterized by Prisma; raw SQL confined to the backup library with filename allowlists and escaped identifiers; row scoping enforced in application code (RLS not applicable over the single service connection)"],
    ["Authentication", "3 session systems: staff (username + scrypt password), student portal (5-digit code + phone), teacher portal (4-digit code + phone), plus academia RBAC and admin support-impersonation", "Session tokens are 256-bit random, DB-backed, expiry-checked; passwords scrypt-hashed with timing-safe comparison; impersonation is audited with a 30-minute cap"],
    ["Storage / uploads", "No file-upload endpoints exist; center logo stored as validated data-URL in DB; backups written to server disk", "No executable-upload surface; backup download/preview paths basename-checked and allowlisted"],
    ["Secrets & env", ".env files, git history, client bundles, NEXT_PUBLIC_* variables", ".env never committed; production secrets live only in Vercel env; VAPID push keys are server-side per-center; one finding: demo credentials were compiled into the client bundle (removed in this audit)"],
    ["Third-party", "Outbound web-push only; no inbound webhooks; no server-side external fetch calls", "Nothing to signature-verify; no data leaves the platform except push notifications to browser endpoints"],
  ],
};

const vulnTable = {
  headers: ["ID", "Severity", "Location", "Issue", "Status"],
  widths: [8, 12, 26, 42, 12],
  rows: [
    ["V-01", "High", "api/payments + lib/auth.ts", "Payment recording had no server-side permission check, and the TEACHER staff role was silently resolved as RECEPTIONIST - exam-only staff accounts could record cash payments", "Fixed"],
    ["V-02", "High", "api/academia/sessions/[id]", "An enrolled student could fetch the full session workspace: classmates' attendance, interaction ratings and homework scores", "Fixed"],
    ["V-03", "High", "api/academia/exams (PUT)", "An enrolled student could fetch the full roster and every classmate's exam score and note", "Fixed"],
    ["V-04", "Medium", "api/accounting", "Financial reports (P&L, expected cash, teacher settlements, journal) were readable by every center staff member, not just the manager", "Fixed"],
    ["V-05", "Medium", "api/academia/students", "Teacher scope (own-group students only) was promised but not enforced in the query - any teacher could enumerate up to 200 student profiles", "Fixed"],
    ["V-06", "Medium", "api/portal/exams/[id]", "Exam detail metadata (titles, instructions, question counts, review links) leaked for exams of groups the student is not in", "Fixed"],
    ["V-07", "Medium", "All session cookies (7 set-sites)", "Cookies set with Secure=false - bearer cookies could travel over plain HTTP after any proxy misconfiguration", "Fixed"],
    ["V-08", "Medium", "Global", "No security headers at all: no CSP, no clickjacking protection, no HSTS, no nosniff", "Fixed"],
    ["V-09", "Medium", "components/nokhba/login.tsx", "Demo accounts with literal passwords were compiled into the client bundle even when hidden behind a build flag", "Fixed"],
    ["V-10", "Medium", "next.config.ts", "The dev SQLite database (seed password hashes, test data) was force-bundled into every serverless function", "Fixed"],
    ["V-11", "Low", "api/attendance/mark (PATCH)", "Changing attendance to EXCUSED did not reverse the session charge - money-affecting state change without a ledger entry", "Fixed"],
    ["V-12", "Low", "api/academics", "Teacher 4-digit portal login codes were returned to all center staff, not just the manager", "Fixed"],
    ["V-13", "Low", "api/audit", "Audit trail was blocked for receptionists but not for TEACHER staff (post-coercion artefact)", "Fixed"],
    ["V-14", "Low", "api/portal/push", "Push subscription upsert reassigned the student but kept the original center ID - cross-center routing corruption on shared devices", "Fixed"],
    ["V-15", "Low", "lib/teacher-auth.ts", "Teacher codes generated with Math.random (predictable) instead of a cryptographic generator", "Fixed"],
    ["V-16", "Low", "Portal / teacher logins", "Brute-force throttling was per-IP only; a targeted account could be attacked from rotating IPs", "Mitigated"],
  ],
};

const fixTable = {
  headers: ["Area", "What changed", "Key files"],
  widths: [20, 52, 28],
  rows: [
    ["Authorization", "RECORD_PAYMENT permission enforced on every payment; accounting reads raised to manager-only; audit trail restricted to manager/admin; attendance editing gated by EDIT_ATTENDANCE", "payments, accounting, audit, attendance/mark"],
    ["Role model", "TEACHER staff accounts now resolve as TEACHER end-to-end (no silent receptionist coercion) - exams access kept, financial defaults removed", "lib/auth.ts"],
    ["Data isolation", "Academia session workspace and exam results locked to staff with grades.view; teacher student-lists filtered in the WHERE clause by own-group enrollment; portal exam details require group membership", "academia sessions/exams/students, portal exams"],
    ["Money integrity", "EXCUSED attendance now reverses the charge with a compensating ledger entry, and un-excusing re-charges at the current session price - both inside one transaction with audit records", "api/attendance/mark"],
    ["Transport security", "Full header set: CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy (camera self only, for QR scanning), HSTS; all session cookies now Secure on the HTTPS deployment", "next.config.ts, lib/auth.ts, lib/portal-auth.ts, lib/teacher-auth.ts"],
    ["Authentication hardening", "Per-code login throttling added on top of per-IP limits for both portals; teacher codes now generated with crypto.randomInt; expired session rows cleaned up on every login", "portal route, teacher-portal route, teacher-auth, auth"],
    ["Secrets & supply chain", "Demo credentials purged from the login screen; 16 unused dependencies removed (next-auth, zod, zustand, dnd-kit, markdown editors, etc.); npm audit fix applied - vulnerabilities down from 22 to 2 moderate", "login.tsx, package.json"],
    ["Input validation", "Logo upload restricted to PNG/JPEG/WEBP data-URLs; backup preview restricted to known backup filename patterns", "api/settings, lib/backup"],
    ["Bug fixes", "Emergency-recovery date regex never matched real dates (doubled backslashes) - repaired; push subscription rebind now rewrites center and student together", "lib/emergency-recovery, api/portal/push"],
  ],
};

const verifyTable = {
  headers: ["Suite", "Scope", "Result"],
  widths: [30, 46, 24],
  rows: [
    ["Functional E2E (existing suite)", "Exams, assignments, QR attendance, charging, duplicate/replay protection - full student and staff journeys on a production build", "38 / 38 PASS"],
    ["Security regression (new)", "Role model: teacher blocked from payments/accounting/audit/attendance-edit/loginCodes while keeping exams access; receptionist workflow preserved; headers present", "16 / 16 PASS"],
    ["Production verification", "Security headers live; 10 sensitive endpoints return 401 unauthenticated; prod teacher account blocked from all money endpoints (403) with exams still allowed; real student portal journey intact; cookies carry Secure + HttpOnly + SameSite", "30 / 30 PASS"],
    ["Browser check (real Chromium)", "/login and /portal rendered with zero console errors under the new CSP; no CSP violations", "CLEAN"],
    ["Type check / lint / build", "TypeScript, ESLint, production build", "CLEAN"],
  ],
};

const riskTable = {
  headers: ["#", "Remaining risk", "Level", "Recommended action"],
  widths: [6, 42, 12, 40],
  rows: [
    ["R1", "The production manager password is the default used by seeds and test scripts (nokhba123), and the teacher1 account shares it", "High (operational)", "Rotate all staff passwords now - from the staff management screen (manager) and via platform admin for the manager account. This is the single most important action left."],
    ["R2", "A GitHub personal-access token is embedded in the local git remote URL on this machine", "Medium", "Revoke/rotate the PAT in GitHub settings and switch the remote to a credential helper or SSH"],
    ["R3", "Credentials flagged during earlier sessions (Vercel token / Supabase password) - rotation was advised but not confirmed", "Medium", "Rotate in the respective dashboards if not already done"],
    ["R4", "Rate limiting lives in server memory; on serverless each instance counts separately", "Low", "Acceptable today; if abuse is ever observed, move counters to a shared store (database table or Upstash)"],
    ["R5", "The offline emergency package contains student QR attendance tokens in plaintext (required by the offline QR feature)", "Low", "Keep issued emergency files physically secure; on import, recovered students receive fresh tokens"],
    ["R6", "exceljs pulls a transitive uuid version with a moderate advisory; the safe fix is a breaking downgrade", "Low", "Await upstream fix; no untrusted input reaches the vulnerable code path"],
    ["R7", "Signup reveals whether a username is taken (standard trade-off)", "Low", "Already throttled to 5 requests/hour per IP; acceptable"],
  ],
};

const checklistTable = {
  headers: ["Item", "Status"],
  widths: [78, 22],
  rows: [
    ["Server-side authorization on every sensitive endpoint (verified on production, not by UI hiding)", "DONE - 30/30"],
    ["Passwords never stored in plain text (scrypt + timing-safe compare)", "DONE"],
    ["Session cookies: HttpOnly + Secure + SameSite (verified on the live response)", "DONE"],
    ["Security headers: CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy", "DONE - live"],
    ["Secrets only server-side; .env untracked; VAPID keys in DB; demo creds removed from bundle", "DONE"],
    ["SQL injection: parameterized Prisma queries only; raw SQL allowlisted", "DONE"],
    ["XSS: no HTML rendering of user content; CSP blocks external script sources", "DONE"],
    ["File uploads: none exist; logo data-URL validated (MIME + size)", "DONE"],
    ["Error handling: no stack traces or internals in client responses", "DONE"],
    ["Logging: no secrets, tokens or PII in logs; audit trail restricted to managers", "DONE"],
    ["Dependency audit: 22 advisories reduced to 2 moderate (documented, accepted)", "DONE"],
    ["Rotate default staff passwords (R1) and the exposed git token (R2/R3)", "PENDING - owner action"],
    ["Re-run the load test suite after the next enrollment season", "RECOMMENDED"],
  ],
};

// ============================= body =============================
const bodyChildren = [
  h1("1) Executive Summary"),
  bodyP("This report documents a complete pre-launch security audit and hardening pass over the Alnokhba Centers management system (alnokhba-centers.vercel.app), performed at the owner's request with one ground rule: every protection must live on the server, and no fix may rely on hiding interface elements. The audit covered the full stack - 79 API route handlers, three separate authentication systems (staff accounts, the student portal, the teacher portal) plus the Academia RBAC layer, the database layer, file handling, secrets management, third-party integrations, browser-facing headers and the dependency tree. Sixteen vulnerabilities were identified and individually verified in source code before any change was made."),
  bodyP("Fifteen of the sixteen were fixed and deployed in commit 5124c56; the sixteenth (per-IP-only brute-force throttling) was mitigated with per-account limits and is documented with its residual limitation. The most serious finding was a privilege gap with direct financial impact: staff accounts created as exam-only teachers were silently resolved as receptionists server-side, and payment recording had no permission check at all - meaning an exam-only account could record cash payments. That class of issue is now closed and verified against production. Two further high-severity findings in the Academia product allowed any enrolled student to read classmates' attendance, behaviour notes and exam scores; both are fixed."),
  bodyP("Verification was done at three levels. Locally, the existing 38-test functional suite passed in full, proving no feature broke. A new 16-check security regression suite proved the new permission model behaves exactly as intended. Finally, a 30-check verification ran against the live production deployment - headers, unauthenticated access to ten sensitive endpoints, teacher-role blocks on real accounts, a real student portal journey, and cookie flags on the wire - all passing, plus a real-browser check confirming the new Content-Security-Policy introduces zero console errors on the login and portal pages."),

  h1("2) Architecture as Audited"),
  bodyP("The system is a multi-tenant platform: several training centers share one database, and every center's data isolation depends on application-level scoping (the database connection is a single trusted service connection, so database-level RLS would not be enforced through it - making correct server-side scoping in every route the critical control, which is exactly where most findings clustered). The table below summarizes each layer as examined during the audit, before fixes."),
  tableTitle("Table 1: Audit coverage by architectural layer"),
  dataTable(archTable.headers, archTable.rows, archTable.widths),
  noteP("Note on RLS: row-level security was evaluated per the review checklist. Because the application connects to Supabase Postgres through a single server-side service connection (not per-user database roles), Postgres RLS policies would not be evaluated for application queries. The equivalent control - scoping every query by the session's center/student/teacher identity - is implemented and now verified in application code, which is the correct enforcement point for this architecture."),

  h1("3) Methodology"),
  bodyP("The audit followed an inspect-first discipline. A complete route inventory was built, and every one of the 79 API handlers was mapped to the guard it actually calls (requireUser, requireCenterUser, requireManager, requireAdmin, portal student, portal teacher, academia guard, or QR-token verification), producing a guard-deployment matrix. Two parallel deep sweeps then covered cross-cutting concerns: one focused on authorization and data isolation (IDOR, client-supplied IDs, cross-tenant reads, header-trust auth), the other on XSS sinks, embedded secrets, file handling, webhooks, raw SQL, logging hygiene and browser storage. Every candidate finding was confirmed by reading the exact source lines before being accepted - two initially-reported items were rejected in this step because the code was already correctly scoped, which is why the final register below contains only verified issues."),
  bodyP("Fixes were implemented backend-first and verified in a strict loop: TypeScript type-check, ESLint, a production build, the full 38-test functional suite (to guarantee no feature regression), and a purpose-built 16-check security regression suite. The result was deployed, and the same checks - plus additional ones only possible on production, such as live cookie flags and header inspection - were re-run against the real site. The entire audit trail, including the scripts, is preserved in the repository (scripts/sec1_regression.sh, scripts/sec1_prod_verify.sh) so the tests can be re-executed at any time."),

  h1("4) Vulnerability Register"),
  bodyP("Sixteen verified issues were recorded. Severity reflects real exploitability on the production deployment as it stood before this audit, not theoretical concern. Every item lists its precise location so the fix can be traced in the commit."),
  tableTitle("Table 2: Verified vulnerabilities and their resolution"),
  dataTable(vulnTable.headers, vulnTable.rows, vulnTable.widths),
  noteP("V-01 deserves emphasis: it combined two independent flaws (a missing permission gate and a role-mapping bug) that only become dangerous together - each alone looked harmless in code review. Fixing both was necessary, and the production test now proves an exam-only teacher receives 403 on payment recording."),

  h1("5) Fixes Applied"),
  bodyP("All fixes were implemented server-side. No interface element was hidden as a substitute for a real check, no functionality was removed, and the visual design is untouched - the only intentional user-visible change is the removal of the demo quick-login chips from the login screen, which existed solely to ease development and leaked usable passwords in the client bundle."),
  tableTitle("Table 3: Remediation by area"),
  dataTable(fixTable.headers, fixTable.rows, fixTable.widths),

  h1("6) Verification Evidence"),
  bodyP("Every claim in this report is backed by an executable test that remains in the repository. The functional suite is the same one used during feature development - running it against the hardened build is what allows this report to state that security work changed nothing about how the centers operate day to day."),
  tableTitle("Table 4: Test suites and results"),
  dataTable(verifyTable.headers, verifyTable.rows, verifyTable.widths),
  bodyP("The production verification deserves a short explanation of what it actually proved on the live site. Ten sensitive endpoints (accounting, audit, students, payments, staff, settings, backup, emergency, admin, portal exams) all reject anonymous callers with 401. The real production teacher account teacher1 now resolves as TEACHER - confirming the role-mapping fix is live - and receives 403 on payment recording, accounting, the audit trail and staff creation while still passing exams access, which is that role's entire purpose. The real student account (code 84478) completed its portal journey unchanged: login, home, and exam list all behave exactly as before. Finally, the session cookie returned by production now carries Secure, HttpOnly and SameSite flags on the wire."),

  h1("7) Remaining Risks and Owner Actions"),
  bodyP("A small number of risks remain that code changes cannot close, because they involve credentials the owner holds or deliberate product trade-offs. Each is listed with its recommended action. The first item is the only one this report classifies as urgent: as long as the production manager account keeps a well-known default password, every other protection in this report is weakened, because the attacker would not need to exploit software at all - they could simply log in."),
  tableTitle("Table 5: Residual risks"),
  dataTable(riskTable.headers, riskTable.rows, riskTable.widths),

  h1("8) Production Readiness Checklist"),
  bodyP("The checklist below consolidates the audit into a launch-gate view. Everything within the code's control is done and verified on production. Two credential rotations remain as owner actions, and one operational recommendation stands: re-run the load test suite at the start of each enrollment season, since the scripts are preserved and the previous report provides the baseline numbers to compare against. Once the password rotation in R1 is complete, the system is production-ready from a security standpoint."),
  tableTitle("Table 6: Launch-gate checklist"),
  dataTable(checklistTable.headers, checklistTable.rows, checklistTable.widths),
  noteP("Evidence: commit 5124c56 deployed to production on 2 October 2026; verification scripts at scripts/sec1_regression.sh and scripts/sec1_prod_verify.sh; full test transcripts preserved in the session worklog."),
];

// ============================= document =============================
const pgSize = { width: 11906, height: 16838 };
const pgMargin = { top: 1440, bottom: 1440, left: 1417, right: 1417 };

const doc = new Document({
  styles: {
    default: {
      document: {
        run: { font: FONT, size: 22, color: BODY },
        paragraph: { spacing: { line: 312 } },
      },
      heading1: {
        run: { font: FONT, size: 30, bold: true, color: PAL.primary },
        paragraph: { spacing: { before: 380, after: 160, line: 380 }, outlineLevel: 0 },
      },
      heading2: {
        run: { font: FONT, size: 25, bold: true, color: PAL.primary },
        paragraph: { spacing: { before: 260, after: 120, line: 340 }, outlineLevel: 1 },
      },
    },
  },
  sections: [
    {
      properties: { page: { size: pgSize, margin: { top: 0, bottom: 0, left: 0, right: 0 } } },
      children: buildCoverR1({
        title: "Production Security Audit & Hardening Report",
        subtitle: "Alnokhba Centers Management System - full-stack security review, vulnerability remediation, and production verification before launch",
        englishLabel: "PRE-LAUNCH SECURITY REVIEW",
        metaLines: [
          "Scope: 79 API endpoints - 3 authentication systems - full source audit",
          "Result: 16 verified vulnerabilities - 15 fixed and deployed, 1 mitigated",
          "Verification: 30/30 production checks - 38/38 functional tests - 16/16 regression",
          "Commit 5124c56 - Deployed 2 October 2026",
        ],
        footerLeft: "Alnokhba Centers",
        footerRight: "Internal document - Management",
        palette: PAL,
      }),
    },
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.UPPER_ROMAN } },
      },
      footers: { default: pageNumFooter() },
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 480, after: 360, line: 400, lineRule: "atLeast" },
          children: [run("Table of Contents", { bold: true, size: 32, color: PAL.primary })],
        }),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
        new Paragraph({
          spacing: { before: 200 },
          children: [run("Note: this table of contents is generated by Word fields - after any edit, right-click it and choose Update Field to refresh page numbers.", { italics: true, size: 18, color: "888888" })],
        }),
        new Paragraph({ children: [new PageBreak()] }),
      ],
    },
    {
      properties: {
        type: SectionType.NEXT_PAGE,
        page: { size: pgSize, margin: pgMargin, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } },
      },
      headers: { default: docHeader() },
      footers: { default: pageNumFooter() },
      children: bodyChildren,
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("/home/z/my-project/download/Security-Audit-Report-Alnokhba-Centers.docx", buf);
  console.log("docx written OK");
});
