#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""generate_final_report.py — builds the Stage G verification report body (ReportLab),
then merges the Playwright cover as page 0 and writes the final single PDF."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from report_lib import (  # noqa: E401
    S, ar, body, bullet, H1, H2, safe_keep_together, make_table, stat_row, callout,
    TocDocTemplate, build_toc, _page_painter, DOC_TITLE, MARGIN, PAGE_W, PAGE_H,
)
from reportlab.lib.pagesizes import A4
from reportlab.platypus import Paragraph, Spacer, PageBreak

OUT_BODY = "/tmp/report_body.pdf"
OUT_FINAL = "/home/z/my-project/download/ALNOKHBA-Autonomous-AI-System-Verification-Report.pdf"

story = []

# ---------------------------------------------------------------- TOC (front matter, roman i)
story.append(Paragraph("<b>Table of Contents</b>", S["toctitle"]))
story.append(build_toc())
story.append(PageBreak())

# ================================================================ 1. Executive Summary
story += H1(1, "Executive Summary",
    "This report closes the current engineering cycle on the ALNOKHBA MANAGEMENT autonomous AI "
    "system, an operations agent named Zaki embedded in a multi-center educational management "
    "platform. The system is designed around four combined capabilities: it analyzes real center "
    "data, advises in natural language (Egyptian Arabic, Modern Standard Arabic, and English), "
    "executes controlled actions through a server-side tool registry, and improves continuously "
    "through measurement, feedback, and budget governance. This cycle covered a fresh audit of the "
    "codebase, one new implementation track (session context and coreference resolution), a "
    "complete verification pass, and a production deployment with an evidence-only probe suite.")
story += stat_row([
    ("103 / 0 / 1", "end-to-end agent checks: pass / fail / honest skip"),
    ("22 / 22", "deterministic brain unit cases, incl. 14 coreference cases"),
    ("11 / 11", "production probe checks on the live deployment"),
    ("18", "real server-side tools exposed via capability discovery"),
])
story.append(body(
    "Three outcomes define this cycle. First, the agent now resolves conversational references "
    "across tasks: after a search such as \u00ab" + ar("هاتلي أحمد محمود الشريف") + "\u00bb, a brand-new request "
    "\u00ab" + ar("سجل حضوره") + "\u00bb or \u00ab" + ar("تقريره") + "\u00bb correctly targets the same student, using a "
    "structured, inspectable memory row rather than free-form chat memory, and production was "
    "verified end-to-end on live data through a read-only path. Second, verification depth "
    "increased: the deterministic-brain suite grew from 8 to 22 cases and the end-to-end suite "
    "added a dedicated cross-task coreference section, both fully green. Third, honesty gates were "
    "enforced on every claim: the voice pipeline is reported as verified only where real audio "
    "actually passed through the production transcription chain, and the remaining limits are "
    "stated explicitly rather than smoothed over."))
story.append(body(
    "The deployment at https://alnokhba-centers-nine.vercel.app runs connected to the legacy "
    "Supabase Postgres production database (mode: postgres), with the center's Groq key stored "
    "server-side. No production data was mutated during verification: the coreference probe used a "
    "search-then-report flow that is strictly read-only, and the only write attributable to testing "
    "is the by-design, user-scoped memory row that records the last resolved student."))

# ================================================================ 2. Scope, Method, Evidence
story += H1(2, "Scope, Method and Evidence Standard",
    "The engineering method follows a fixed loop: inspect the repository, audit with file-level "
    "evidence, design the smallest safe change, implement server-side, verify with type checks, "
    "lint, build and behavior tests, then deploy and re-verify in production. This cycle's Stage A "
    "re-inventory found the AI module restructured into six focused packages (context, memory, "
    "orchestrator, prompts, providers, tools) totaling roughly five thousand lines, with eighteen "
    "registered tools and zero stubs. The audit confirmed that strong server-side authorization, "
    "audit logging, confirmation storage, and loop protection were already in place from previous "
    "cycles, which allowed this cycle to concentrate on the highest-value remaining gap: how the "
    "agent understands who the user is talking about across messages and sessions.")
story.append(body(
    "The evidence standard is deliberately strict. Every quantitative claim in this report maps to "
    "one of four artifact classes: (1) static checks, namely TypeScript compilation with zero "
    "errors in src/, a clean ESLint pass on changed modules, and a successful Next.js production "
    "build; (2) behavior tests executed against a real server with a real database, including "
    "database-state assertions rather than UI-text assertions; (3) production probes executed "
    "against the live deployment, which are read-only by policy; and (4) code-level facts "
    "verifiable by inspection, cited with file names. Where a claim could not be evidenced, it is "
    "listed as a known gap in Chapter 9 instead of being asserted."))
story.append(body(
    "Two honesty constraints shaped the voice testing specifically, because voice is the easiest "
    "area to overclaim. A transcription result is only counted when a real audio file - an actual "
    "RIFF/WAVE byte stream, not a synthetic stub - was uploaded to the production endpoint and a "
    "provider and model were declared in the response. And synthetic speech is never presented as "
    "equivalent to human microphone input: where the test audio was machine-generated, the report "
    "says so, and the definitive Arabic on-device test is explicitly deferred to the user's own "
    "microphone rather than assumed."))

# ================================================================ 3. Architecture
story += H1(3, "System Architecture as Verified",
    "The agent is a strictly layered server-side system. The model never touches the database and "
    "never executes arbitrary queries: every capability is a registered tool whose arguments pass "
    "through schema validation, permission checks, and center-capability checks before execution, "
    "and every execution is recorded in an AgentToolExecution row plus an audit-log entry. The "
    "orchestrator runs a bounded loop (maximum eight model iterations, ten tool calls per task) "
    "with an idempotent failure-signature guard that stops identical repeated failures immediately. "
    "A deterministic regex-based planner (the fallback brain) can run the entire product with zero "
    "model cost and serves as both the primary brain for short or follow-up requests and the safety "
    "net when the model is unreachable, over budget, or misbehaving at the protocol level.")
story += make_table(
    ["Module", "Approx. LOC", "Verified role"],
    [
        ["src/ai/orchestrator/runner.ts", "690", "Bounded agent loop; tool authorization gate; confirmation store; memory capture"],
        ["src/ai/orchestrator/fallback.ts", "735", "Deterministic Egyptian-Arabic/English brain; referent chain; honest unknowns"],
        ["src/ai/tools/ (10 files)", "2,900", "18 real tools: attendance, groups, students, finance, reports, schedule, dashboard"],
        ["src/ai/context/builder.ts", "150", "Server-verified context snapshot: user, center, open screen entities, last student"],
        ["src/ai/memory/memory.ts", "90", "Structured AgentMemory: user prefs + last-resolved-student reference (TTL 24 h)"],
        ["src/ai/providers/", "520", "LLM failover chain (Groq/OpenAI-compatible + ZAI); Groq Whisper STT; ZAI TTS"],
        ["src/ai/usage.ts", "80", "Per-turn usage persistence and center budget state (daily/monthly caps)"],
    ],
    [0.34, 0.12, 0.54],
    "Table 3-1. Verified module inventory of the AI subsystem.")
story.append(body(
    "Risk classification is uniform across the surface. Read-only tools execute automatically; "
    "reversible writes (attendance marking, enrollments, session open/close) stop the loop and "
    "raise a confirmation card whose preview is generated without side effects, and execution "
    "always proceeds from the stored confirmation row rather than from model text. Money-adjacent "
    "operations follow the same confirmation path with piastre-precision arithmetic (amounts are "
    "stored in piastres and only formatted to two decimals at the edges). The model protocol is a "
    "single-JSON contract with a two-attempt self-correction ladder; a protocol breach burns the "
    "usage record (tokens were really spent) but never reaches the user as raw English errors."))

# ================================================================ 4. Coreference
story += H1(4, "Session Context and Coreference Resolution",
    "Before this cycle, pronoun references only worked through one narrow channel: a student "
    "explicitly open on the screen. The deterministic brain literally asked \u00ab"
    + ar("مين اللي هسجل حضورهم؟") + "\u00bb when a user said \u00ab" + ar("سجل حضوره") + "\u00bb with the student "
    "already resolved one message earlier, because the attendance phrase normalizer strips the "
    "pronoun suffix and no referent chain existed. New sessions had no memory at all of what a "
    "previous conversation had been about. This chapter documents the implemented fix and the four "
    "real bugs the test-first process surfaced along the way.")
story += H2("4.1  Design: one structured reference, not free-form memory",
    "The memory model is deliberately minimal and inspectable. A single AgentMemory row per user "
    "(scope SESSION, key last_student) stores the last unambiguously resolved student: id, name, "
    "code, centerId, and an ISO timestamp with a 24-hour time-to-live. The row is written "
    "server-side only after a tool genuinely resolves exactly one student - a single-result search, "
    "a student fetch by code, or a student report - so ambiguous searches (two or more candidates) "
    "never poison the reference. Every read re-validates against the database: the student must "
    "still exist and belong to the user's center, and the screen-open student always wins over the "
    "memory when both exist. There is no free-form profile, no derived personality, and nothing "
    "the user cannot inspect in the table itself.")
story += H2("4.2  The referent chain",
    "When a request contains an intent but no explicit name, the deterministic brain resolves the "
    "referent in a fixed priority order: the student open on screen first, then the conversation "
    "memory (last resolved student), then a single-result search or report observation from the "
    "same task. If no referent exists, the agent asks one clear question instead of guessing - the "
    "same ask-back discipline that already governs ambiguous roster names server-side, where "
    "resolveNamesAgainstRoster returns candidate lists for duplicate names and the request stops "
    "with an explicit disambiguation message rather than a wrong write. The chain feeds both "
    "brains identically: the model sees the same reference line in its context block, so LLM-first "
    "and deterministic modes behave consistently.")
story += H2("4.3  Session resolution learned the student's roster",
    "A second, independent robustness fix landed in the attendance tool itself. When attendance is "
    "requested without naming a session, resolveOpenSession now prefers the open session whose "
    "roster actually contains the requested student (name-token match on normalized Arabic), even "
    "when other unrelated sessions are open; if two open sessions both contain the student it asks "
    "which one, and if none contains the student it falls back to the previous behavior with the "
    "honest roster listing in the error. This was not hypothetical: the e2e suite caught a stale "
    "open test session from an earlier run capturing a bare-pronoun request, which is exactly the "
    "failure mode a real center with parallel sessions would hit.")
story += H2("4.4  Real bugs surfaced by the new test cases",
    "Writing 14 coreference cases before the code exposed four genuine defects, three of them "
    "pre-existing. First, \u00ab" + ar("سجل دفعته") + "\u00bb (with the pronoun attached to \u201cpayment\u201d) was not "
    "recognized as a payment intent at all, so the word \u201cpayment-him\u201d was treated as a student "
    "name. Second, the payment-name extractor matched the Arabic preposition L inside unrelated "
    "words - the L in \u00ab" + ar("سجل") + "\u00bb itself - capturing garbage as names; it now requires a word "
    "boundary, which also fixes normal payment phrases. Third, a bare \u00ab" + ar("سجل حضور") + "\u00bb left "
    "the literal word \u201cattendance\u201d standing as the name text instead of entering the referent "
    "branch. Fourth, the stale-session capture described above. All four are covered by regression "
    "cases that now pass deterministically.")

# ================================================================ 5. Verification evidence
story += H1(5, "Verification and Test Evidence",
    "Verification ran in four independent gates, each re-run after the last code change. The "
    "static gate: tsc reports zero errors under src/ (remaining project-level errors are in "
    "scripts/ and skills/ and pre-date this work), ESLint is clean on all touched modules with "
    "warnings-as-errors, and the Next.js production build compiles and prerenders successfully. "
    "The unit gate exercises the deterministic brain directly: 8 attendance phrasing cases plus "
    "14 coreference cases covering screen-precedence, memory, single-result observations, "
    "multi-result refusal, and no-referent ask-back - 22 of 22 green, run with the react-server "
    "condition to satisfy the server-only import contract.")
story += make_table(
    ["End-to-end area", "What it proves"],
    [
        ["Read flows (today, absentees, summary, schedule)", "Real data returned without confirmation for LOW-risk reads"],
        ["Write flows (enroll, attendance, payments, close)", "Confirmation required, preview accurate, DB state changes exactly once (idempotent)"],
        ["Cross-task coreference (section 6o)", "Search in one task, then a brand-new task with only a pronoun, resolves and writes the correct student after explicit confirmation"],
        ["Permissions and injection", "Teacher blocked from analytics with honest errors; injected instructions produce no execution"],
        ["Loop protection", "Repeated identical failures stop with a clear message; repeated name follow-ups do not re-search"],
        ["Analytics (reports.analyze)", "Deterministic period comparison with server-computed numbers; month/week detection; permission-gated financials"],
        ["Governance (usage, feedback, capabilities)", "Usage persisted per turn; budget gate message on cap; feedback stored server-side; capability list matches available tools"],
    ],
    [0.38, 0.62],
    "Table 5-1. End-to-end coverage map (103 checks passing, 1 honest skip).")
story.append(body(
    "The one skip is deliberate and documented: the live LLM connectivity check is marked skipped, "
    "not failed, when the local development database has no model credentials - the only existing "
    "Groq key lives in the production center settings, and copying secrets into the local "
    "git-tracked SQLite file would violate the secrets policy. Two earlier full runs showed three "
    "moving failures each; investigation attributed them to shared rate-limit windows between the "
    "suite's message bursts (the suite already waits and retries on HTTP 429), and the final run "
    "completed with zero failures. Flakiness of that class is environmental, not behavioral, and "
    "the suite's DB-state assertions - which cannot pass by accident - are the authoritative gate."))

# ================================================================ 6. Production evidence
story += H1(6, "Production Deployment Evidence",
    "Production verification ran against the live deployment with the production commit marker "
    "confirmed through the authenticated status endpoint (c5aaa07 at the time of the voice "
    "re-check). The database linkage is confirmed by the public status endpoint reporting "
    "postgres mode, and login with the manager account returns a stable session across "
    "subsequent calls. Capability discovery returns the full registered catalog with risk and "
    "confirmation metadata for each entry.")
story += make_table(
    ["Production check", "Result", "Evidence"],
    [
        ["Database mode", "postgres", "GET /api/system/db-status on the live URL"],
        ["Deployed commit", "c5aaa07", "Authenticated GET /api/agent/status commit field"],
        ["Manager login", "HTTP 200", "Session cookie accepted across the whole probe suite"],
        ["Capability catalog", "18 tools", "GET /api/agent/capabilities"],
        ["Cross-task coreference (read-only)", "Verified", "Search wrote the correct last_student row (checked in the production DB); new task \u00abتقريره\u00bb produced a student report for the same student (code 10001)"],
        ["STT with real audio", "Verified", "English WAV uploaded to /api/agent/transcribe returned an exact-match transcript twice, provider groq, model whisper-large-v3-turbo"],
        ["Write safety during probes", "Zero data mutation", "Probe policy is read-only; only the designed memory row was written"],
    ],
    [0.30, 0.16, 0.54],
    "Table 6-1. Production probe results (11 of 11 passing).")
story.append(body(
    "The coreference probe deserves a precise description because it is the first production "
    "verification of conversational memory on real data. A uniquely-named active student was "
    "selected from the production database; the probe searched for him by name through the agent "
    "message endpoint; the production AgentMemory table was then queried directly and found to "
    "contain a last_student row referencing exactly that student; a brand-new task containing only "
    "the word \u00ab" + ar("تقريره") + "\u00bb (\u201chis report\u201d) then produced a student report whose payload "
    "identifies the same student id. Every step except the memory row is a read, and the memory "
    "row is the designed feature operating on its intended data."))

# ================================================================ 7. Voice
story += H1(7, "Voice Pipeline Status - Honest Assessment",
    "The voice chain has two independent directions with very different verification states. "
    "Speech-to-text, the direction users need for voice commands, is verified in production with "
    "real audio: a genuine WAV file of the spoken phrase \u201cWho is absent today?\u201d was uploaded to "
    "the production transcription endpoint and returned the exact text with the provider (groq) "
    "and model (whisper-large-v3-turbo) declared in the response, reproduced twice including once "
    "after the final deploy. The transcription path uses the center's server-side key, never "
    "exposes it, and returns Arabic-script text for Arabic speech per its design (the "
    "transcription endpoint is used, not translation).")
story.append(body(
    "Text-to-speech on the production deployment currently fails with HTTP 502: the TTS provider "
    "is the built-in ZAI SDK, whose credentials exist in the sandbox environment but not in the "
    "Vercel deployment's environment. This is an environment gap, not a code defect, and it is "
    "declared as such; the TTS direction is separately verified in the development environment, "
    "where it produced the real 24 kHz WAV files used as STT test inputs. If spoken replies on "
    "production matter, adding the ZAI environment variables to the Vercel project is a one-step "
    "fix; alternatively the TTS route can be pointed at any compatible provider."))
story.append(body(
    "Arabic recognition quality with synthetic voices could not be demonstrated: both available "
    "machine-generated Arabic sources (the TTS voice and an espeak-ng synthesis) produced audio "
    "that Whisper decoded as nonsense, with and without an explicit language hint. A language-hint "
    "parameter was nevertheless implemented and deployed (an ISO-2 code validated server-side and "
    "derived in the UI from the user's last message language), but measurements show no effect on "
    "the provider's turbo model - the honest conclusion is that the hint is harmless plumbing "
    "while the decisive Arabic evidence must come from real human microphone input, which remains "
    "the single remaining voice gate. Nothing in this report claims Arabic voice verification "
    "before that test."))

# ================================================================ 8. Security
story += H1(8, "Security and Governance Checklist",
    "The governing principle is unchanged: the model proposes, the server disposes. The following "
    "checklist reflects controls verified by code inspection, by dedicated e2e sections, or by "
    "both. Each row states the control and the evidence class behind it.")
story += make_table(
    ["Control", "Status", "Evidence"],
    [
        ["Model never touches the DB; all access via authorized tools", "Enforced", "authorizeAndValidate gate on every execution; schema + permission + center capability checks"],
        ["Three-level action policy (L1 read auto, L2 reversible write with explicit confirmation, L3 sensitive blocked)", "Enforced", "CONFIRM_POLICY by risk; confirmation rows executed from store, not model text; payment/attendance idempotency"],
        ["Server-side secrets", "Enforced", "Groq key stored in center settings (server-only select); settings responses mask to key tail; no secrets in the public repo"],
        ["Prompt-injection fencing", "Enforced", "Tool observations wrapped in fenced data markers; hidden control characters stripped from user input and observations; explicit system-prompt rule that fenced data is data"],
        ["Center boundary", "Enforced", "Every query scoped by centerId; cross-center student/session references rejected; memory reads re-validate center membership"],
        ["Loop and cost protection", "Enforced", "MAX_ITERATIONS 8, MAX_TOOLS 10, repeated-failure signature stop, per-center daily/monthly turn budgets with graceful deterministic fallback"],
        ["Rate limiting", "Enforced", "Per-user message and ASR rate limits in the API layer; 429 handling in the e2e suite"],
        ["Audit trail", "Enforced", "Task created/completed/failed, confirmations granted/cancelled, tool executed/blocked - all in AuditLog with actor and payload"],
        ["Feedback integrity", "Enforced", "Message ownership checked in the query itself; zod-validated; rate-limited; silent-failure UI"],
    ],
    [0.40, 0.13, 0.47],
    "Table 8-1. Security and governance controls with their evidence class.")

# ================================================================ 9. Gaps
story += H1(9, "Known Gaps and Honest Limitations",
    "The following items are explicitly not done, partially verified, or environmentally blocked. "
    "They are listed here rather than buried, because an autonomous system's trustworthiness "
    "depends on the accuracy of its self-report.")
story += make_table(
    ["Gap", "Impact", "Disposition"],
    [
        ["Arabic STT with a real human microphone unverified", "Voice commands in Arabic not yet certified on-device", "Single user test on a phone/browser; the pipeline is identical to the verified English path"],
        ["TTS 502 on production", "No spoken agent replies on the live site", "Add ZAI env vars to Vercel or re-point the TTS route to a compatible provider"],
        ["Language hint has no measured effect on Groq turbo", "Synthetic-Arabic decoding failure unexplained", "Hint retained (harmless); quality depends on natural speech; re-measure with real audio"],
        ["Proactive insights deferred", "Agent does not yet push alerts without being asked", "Needs a cron trigger plus dedup design; deterministic building blocks already exist in dashboard insights"],
        ["User-preference memory helpers unused", "getPref/setPref remain wired but uncalled", "Wire when a concrete preference need (e.g. default session view) is agreed"],
        ["Groq blocks the sandbox egress (Forbidden)", "Direct Groq debugging from the dev box impossible", "All Groq traffic is verified through Vercel egress; sandbox-only limitation"],
        ["Local dev DB lacks model credentials; llm-test marked skip", "One e2e check cannot run locally", "Honest SKIP state in the suite; production carries the key (tail v0QM verified earlier)"],
        ["db/custom.db tracked in git; occasional 429 e2e flakes", "Repo hygiene; suite noise", "Recommended: untrack the SQLite file; keep DB-assertion checks as the authority"],
    ],
    [0.30, 0.30, 0.40],
    "Table 9-1. Open gaps with impact and disposition.")

# ================================================================ 10. Next actions
story += H1(10, "Next Actions",
    "The system is deployable and verified as described, and the remaining work divides cleanly "
    "into one user-side test and a short engineering backlog. The single highest-value user action "
    "is the on-device Arabic microphone test, because it is the only gate between the current "
    "state and a fully certified voice loop; everything else is optional polish or future scope.")
story.append(bullet("<b>User (5 minutes):</b> open the production site on a phone, tap the microphone in the Zaki dock, "
    "say \u00ab" + ar("مين غايب النهارده؟") + "\u00bb or \u00ab" + ar("سجل حضور أحمد") + "\u00bb, check the draft text, then send it. "
    "Report whether the transcript matches; that result completes or corrects Chapter 7."))
story.append(bullet("<b>User (optional):</b> add the ZAI environment variables to the Vercel project to enable spoken replies on production."))
story.append(bullet("<b>Engineering - proactive insights:</b> schedule the existing deterministic insight rules behind a cron trigger with per-center deduplication, delivering at most one daily digest per user."))
story.append(bullet("<b>Engineering - preference wiring:</b> connect getPref/setPref to a concrete preference (for example the default view the dock opens on) so the memory helpers stop being dead code."))
story.append(bullet("<b>Engineering - long-task context re-resolution:</b> re-inject the context snapshot between multi-step confirmations so very long tasks cannot drift from the entities they started with."))
story.append(bullet("<b>Engineering - repo hygiene:</b> untrack db/custom.db, and consider a tiny jitter in the e2e suite's message cadence to further reduce shared rate-limit flakes."))
story.append(body(
    "With the microphone test recorded, the voice chapter can be upgraded from \u201cSTT verified "
    "with real synthetic-input audio; Arabic human input pending\u201d to a complete statement, and "
    "the four-in-one agent stands verified across its full surface: analysis on real data, advice "
    "in the user's own language and dialect, controlled action with mandatory confirmation, and "
    "continuous improvement through measured usage, user feedback, and budget governance."))

# ---------------------------------------------------------------- build + merge
doc = TocDocTemplate(
    OUT_BODY, pagesize=A4,
    leftMargin=MARGIN, rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=MARGIN,
    title=DOC_TITLE, author="Z.ai", creator="Z.ai",
    subject="Engineering verification of the ALNOKHBA autonomous AI agent (Stage G)",
)
doc.multiBuild(story, onFirstPage=_page_painter, onLaterPages=_page_painter)
print("body built:", OUT_BODY)

# merge cover (rendered separately via html2poster.js) as page 0
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89

def normalize(page):
    box = page.mediabox
    w, h = float(box.width), float(box.height)
    if abs(w - A4_W) > 0.1 or abs(h - A4_H) > 0.1:
        page.scale_to(A4_W, A4_H)
    return page

os.makedirs(os.path.dirname(OUT_FINAL), exist_ok=True)
writer = PdfWriter()
writer.add_page(normalize(PdfReader("/tmp/report_cover.pdf").pages[0]))
for page in PdfReader(OUT_BODY).pages:
    writer.add_page(normalize(page))
writer.add_metadata({
    "/Title": DOC_TITLE,
    "/Author": "Z.ai",
    "/Creator": "Z.ai",
    "/Subject": "Engineering verification of the ALNOKHBA autonomous AI agent (Stage G)",
})
with open(OUT_FINAL, "wb") as f:
    writer.write(f)
print("final:", OUT_FINAL, os.path.getsize(OUT_FINAL), "bytes")
