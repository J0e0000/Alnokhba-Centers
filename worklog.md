
---
Task ID: L (center capabilities + unified attendance core + adaptive guided UI + role-aware Q&A)
Agent: main (Super Z)
Task: 19-section spec — per-center attendance capabilities (DB+API+UI enforcement), unified attendance core, teacher auto check-in (SESSION_START), staff dynamic-QR attendance via fixed center screen, optional fingerprint (max 3), center config area, adaptive workflows, guided next-action UI, compact square actions, "!" info popovers, tooltips, role+context Q&A, permissions separation, full testing + QA report.

Work Log:
- SCHEMA (+5 models): CenterCapability{centerId,key,enabled,config} · AttendanceEvent{personType STUDENT/STAFF, studentId/userId/teacherId, method NAME/STATIC_QR/DYNAMIC_QR/SESSION_START/FINGERPRINT, status, sessionId NULLABLE, deviceId, metadata} · AttendanceDevice{kind QR_SCREEN/FINGERPRINT_SCANNER, keyHash sha256, key shown once} · StaffQrToken{token 40hex, isActive rotation, expiresAt slot+4s} · FingerprintEnrollment{templateHash @unique (no raw biometrics), maxUsers from capability config}. Center relations + indexes.
- LIB: capabilities.ts (catalog of 8 keys, defaults: all legacy features ON + fingerprint OFF → zero regression) · center-capabilities.ts (getCenterCapabilities auto-seeds defaults, requireCapability → 403 Arabic msg, config bounds) · attendance-core.ts (METHOD_CAPABILITY map, assertAttendanceMethodAllowed/StatusAllowed, recordAttendanceEvent, hasPhysicalAttendanceToday excludes SESSION_START) · fingerprint.ts (adapter: DEVICE_MATCHED templateHash | SERVER_MATCH raw template → sha256).
- API GATES (server-side enforcement, not UI hiding): mark POST method+LATE gates + unified events (single+bulk) · mark PATCH LATE gate · scan route static/name gates (graceful RED) · session-qr/slot + legacy session-qr dynamic_qr gate · claim route dynamic_qr+student_self_scan gates + event · sync route gates + event · sessions POST teacher auto-attendance (SESSION_START event, dedupe per session×teacher, requireCenterPresence config → 403 without physical event today) + teacherAutoAttendance in response.
- NEW API: GET/PATCH /api/center/capabilities (manager PATCH, config clamps: maxUsers 1..10, slotSeconds 5..30, audit CAPABILITIES_UPDATED) · staff-qr/device (GET/POST/PATCH manager, deviceKey once) · staff-qr/issue (device-key auth, slot rotation kills old tokens, center binding) · staff-qr/claim (requireCenterUser + cap + live token + wrong-center 403 + once/day Cairo-tz + replay/expired audits) · staff-qr/peek (public, minimal info) · fingerprint/enroll (GET/POST/DELETE manager, max N, STAFF=userId OR teacherId, STUDENT) · fingerprint/event (X-Device-Key FINGERPRINT_SCANNER device or manager test, NO_MATCH graceful, links student → open session attendance+charge) · staff-events (unified staff log for settings).
- FRONTEND: caps context (CapsProvider in App + portal via home payload, nk-caps-changed refresh) · ActionSquare/ActionPill (compact icon actions + tooltips) + InfoIcon ("!" popover) in action-button.tsx · settings-attendance.tsx (new "الحضور والpresence" tab: toggles+InfoIcon per capability, fingerprint maxUsers, staff QR slotSeconds, requireCenterPresence, devices CRUD + key-once dialog, /staff-screen link, staff events list) · /staff-screen (device pairing via localStorage key, fullscreen rotating QR, clock, countdown) · /c/[token] (peek → claim → NEEDS login → /login?next= safe redirect) · login page ?next support (internal-path only) · today-view (staff self check-in card + CombiningQrScanner dialog, scan CTA gated, ActionSquare/Pill hierarchy, teacherAuto toast) · session-live (guided NEXT-ACTION bar: احضر→اعتمد وقفل→النتائج, adaptive methods legend, ScanView/SessionQrCard/bulk gated by caps) · portal (FAB+sheet gated by student_self_scan+dynamic_qr, QR card gated by static_qr) · help engine REWRITTEN role+capability-aware (filterQa roles/requiresCaps/anyCaps, MANAGER_ONLY_VIEWS, +15 new attendance Q&A items; HelpButton in shell/focus-shell(portal gap closed)/admin/portal).
- TESTS: scripts/e2e_capabilities.sh 37/37 (caps API 401/403/400/clamp/audit · Center A name+static-only: slot 403, mark 200, LATE 403, fingerprint 403, staff-claim 403 · Center B: slot 200, portal self-scan claim ok, mark MANUAL 403, scan blocked, staff device→issue→claim→dup→rotation-410→wrong-center-403→unauth-401→expired-410, fingerprint enroll×3→4th 400, verify match, NO_MATCH graceful, device X-Device-Key event, teacher auto SESSION_START event, requireCenterPresence 403 · Q&A role/capability unit ×4) + regression: e2e_qr_slot 15/15, tabs_security_suite 25/25, e2e_notifications 7/7 (fixed both e2e pickers for /api/today slot-prefixed suggestions; make_open_session scoped to main center) · tsc src clean · lint 0 errors on changed files · next build OK.
- UI (agent-browser): settings attendance tab (10 sections render, popover text exact, toggle → server persistence verified), portal FAB hidden when dynamic_qr/student_self_scan OFF + returns when ON (round-trip), /staff-screen pairing → live rotating QR screenshot, /c/token full claim → "تم تسجيل حضورك ✅", session-live next-action bar (احضر/اعتمد وقفل states), receptionist today (check-in card + guided actions), mobile 390px + dark mode verified. Screenshots: scripts/ui-settings-attendance.png, ui-staff-screen.png, ui-reception-today.png, ui-dark-session.png, ui-mobile-dark-session.png, ui-session-next-action.png.
- Commit 54f3ff2 pushed → Vercel; prod / 200, /staff-screen 200, caps 401 unauth, staff-qr issue 401 unauth.

Stage Summary:
- Capabilities are a first-class center-level concept enforced at DB/API layer (account permissions stay separate; final check = permission + capability + context + ownership). Unified AttendanceEvent core absorbs all methods (QR screens, session start, fingerprint, name/static/dynamic) with nullable sessionId + deviceId + metadata. Teacher check-in = session start. Staff check-in = rotating center-screen QR (replay/expired/wrong-center all rejected). Fingerprint = optional external-hardware adapter (needs physical device validation). UI adapts everywhere; guided one-primary-action flow; Q&A per role+page+capabilities. 84/84 automated checks green; production deployed.

---
Task ID: M (device-locked attendance — public no-login check-in)
Agent: main (Super Z)
Task: 34-section spec — session-scoped device-locked attendance: ONE DEVICE = ONE SUCCESSFUL ATTENDANCE PER SESSION, dynamic rotating QR, login-free student check-in by student code, DB-level unique(sessionId, deviceId), grace window, risk engine + suspicious dashboard, 12 edge cases + concurrency tests.

Work Log:
- SCHEMA: Attendance +deviceId/ipAddress/userAgent/riskScore/riskFlags + @@unique([sessionId, deviceId]) (NULLs don't conflict — staff/manual flows unaffected) + @@index([deviceId]) · new CheckInAttempt model (every public attempt: outcome/studentCode/deviceId/ip/ua/risk/tokenTail — powers suspicious dashboard & risk engine) + db:push.
- LIB: device-id.ts (getOrCreateAttendanceDeviceId — UUIDv4 cookie nk_did 1y SameSite=Lax + localStorage fallback, regenerates corrupt values, zero PII) · attendance-risk.ts (flags: RAPID_MULTI_STUDENT_ATTEMPTS/SAME_IP_RAPID_ATTEMPTS/REPEATED_ATTENDANCE_ATTEMPTS/DEVICE_REUSED/MULTIPLE_STUDENTS_SAME_DEVICE + Arabic labels + weighted score, window 10min, thresholds 4/2/5, notify ≥40) · checkin-pv.ts (signed sighting proof: HMAC(qrId|deviceId|iat) issued by peek ONLY while token live → check-in accepts expired/rotated tokens iff pv valid for same device and iat ≤ token expiry and now−iat ≤ 90s QR_CLAIM_GRACE_MS — preserves slot-QR anti-screenshot property while solving "typing time" death; env NOKHBA_PV_SECRET).
- API (new, public + rate-limited): GET /api/attendance/public/peek (minimal session info, no IDs, pv issuance, capability+closed checks) · POST /api/attendance/public/check-in (spec §10 order: structure → rate → token (live or pv-grace) → capability dynamic_qr → session OPEN+today → student ACTIVE → group registration → friendly pre-checks (byStudent→idempotent ALREADY; byDevice→DEVICE_LOCKED) → risk assess → ATOMIC insert with P2002 disambiguation (deviceId index → device lock; studentId → already) → charge+event+audit+notifies (no financial data in public response)) · GET /api/attendance/public/attempts (center-user only, masked IP, device tail, Arabic flags, suspiciousCount).
- QR PATH: session QR payload /s/<token> → /a/<token> (opaque token only — spec §21); legacy session-qr route path=/a/; portal scanner extractSessionToken accepts /a/ and /s/; slot clamp 5..60 (spec §3 — no hardcoded 10) + slot route reads center capability config slotSeconds default.
- UI: /a/[token] public page (RTL/brand/dark/mobile — peek→code input→submit disabled "جاري تسجيل الحضور…"→success/already/DEVICE_LOCKED/business-reject states, sessionStorage pv for retry/refresh, idempotent resubmit, no URLs/login/OTP) · session-live: مشبوه MiniStat (grid 5) + SuspiciousCard (⚠️ count + expandable details with outcome labels/flags/device·ip tails) + attendance table method column + risk badge on flagged rows + attempts polling 8s · sessions/[id] GET returns method+riskScore+riskFlags.
- AUDIT: new codes PUBLIC_CHECKIN_REJECTED/DEVICE_ALREADY_USED/SUSPICIOUS_ACTIVITY; attempts logged for every outcome; staff notifications on DEVICE_LOCKED + NOT_REGISTERED.
- TESTS: scripts/e2e_device_lock.sh 33/33 (peek+pv, invalid-token merged REPLAYED (no oracle), 400 structure ×3, no-login success + privacy (no balance/charged in response), device lock same-device-different-student, idempotent same-student (same device + other device), parallel race same device same student → exactly 1 row, parallel race same device two students → 1 accepted + 1 DEVICE_LOCKED, expired without pv, pv grace after expiry, legacy-rotate true REPLAYED, pv same-device grace accepted, pv device-mismatch rejected, CLOSED session + peek CLOSED, same-IP rapid → flagged not blocked (Arabic SAME_IP flag), dynamic_qr OFF → peek CAPABILITY_OFF + check-in 403 + restore, attempts 401/manager/IP-masking, riskScore>0 on accepted row, /a/ path, direct DB groupBy unique check) · fixtures scripts/make_lock_students.ts (idempotent: open session + students 99001-99008 + run cleanup) · regressions: e2e_qr_slot 15/15 (ceiling 30→60 per spec §3), tabs_security 25/25, e2e_notifications 7/7 (picker fixed for /api/today display-status vs DB-status), e2e_capabilities 37/37 → 117 checks total.
- BROWSER (agent-browser): /a page form render + disabled submit → fill 99002 → success state screenshot (name/code/session/status) → same browser second visit + 99008 → DEVICE_LOCKED state screenshot (exactly spec §2 copy) → nk_did cookie + localStorage synced UUID → deadbeef token → friendly rescan message → manager login → session dashboard: مشبوه stat=1, SuspiciousCard expandable (جهاز متكرر ⛔ + Arabic flags + dev/ip tails), attendance table method column, QR payload http://…/a/<token> confirmed → mobile 390px dark fresh-load screenshot. tsc src clean · lint 0 · next build OK (a/[token] + 3 public routes in output).
- DEPLOY: commit 71910ba → Vercel; prod verified: / 200, /a/<token> 200, peek unknown → {"valid":false,"reason":"REPLAYED"}, check-in unknown → 404, attempts unauth → 401.
- DOCS: docs/device-lock-config.md — all configurable values (rotation 5..60, graces, rate limits, risk thresholds, pv secret) + invariants.

Stage Summary:
- The core business rule (session_id + device_id = unique) is enforced by the DATABASE, not code: parallel same-device submissions produce exactly one row (race-tested). Students check in with zero login (code only); device identity is a random UUID cookie/localStorage value (no PII, no hardware IDs, honestly documented as bypassable — risk engine + staff review cover the incognito/browser-change gap instead of pretending). Grace window is server-authoritative and anchored to a signed live-sighting proof, so screenshots die with the code while legitimate students keep typing. Suspicious attempts (device reuse, rapid multi-student, same-IP bursts) surface in the teacher dashboard as reviewable flags, never auto-accusations. Existing flows untouched: portal self-scan (/s + claim), staff QR, slot rotation, mark/manual — all green.

---
Task ID: N (technical SEO + AI discoverability + rebrand)
Agent: main (Super Z)
Task: 30-phase technical SEO audit & implementation + rebrand all user-facing old name ("نخبة سنترز"/"AlNokhba Centers") → "Alnokhba Managment".

Work Log:
- AUDIT: full crawl of routing/metadata/robots/assets — only "/" is public-indexable; login/app/portal/teacher/staff-screen/academia private; /s /a /c ephemeral tokens; zero metadata/canonical/OG/schema/404 before.
- SEO LIB: src/lib/seo.ts — SITE_NAME/SITE_URL (NEXT_PUBLIC_SITE_URL, default prod domain), SITE_DESCRIPTION, PUBLIC_PATHS/PRIVATE_PATHS single source, pageMetadata() (title absolute + canonical + OG ar_EG + twitter + robots), privateLayoutMetadata() (noindex), JSON-LD builders (Organization/WebSite/SoftwareApplication — no fake schema: no SearchAction/FAQPage).
- LAYOUT: metadataBase, title.default+template, icons/manifest/appleWebApp, OG/Twitter defaults, robots googleBot max-image-preview, optional GOOGLE_SITE_VERIFICATION env hook (no secrets in code), Cairo woff2 preloads (crossOrigin).
- HOME: page.tsx → server component exporting metadata (canonical https://alnokhba-centers.vercel.app) + 3 JSON-LD scripts; LandingPage stays client/SSR.
- ROBOTS/SITEMAP: app/robots.ts (Disallow login/app/portal/teacher/staff-screen/academia/s///a///c//api/ + Sitemap + Host) replaced static permissive robots.txt (deleted); app/sitemap.ts from PUBLIC_PATHS (home only, no-trailing-slash canonical match).
- NOINDEX LAYOUTS ×9: login, app, portal, teacher, staff-screen, s/[token], a/[token], c/[token], academia (covers session/[id]).
- 404: not-found.tsx branded RTL with home/login links, status 404, noindex.
- AI: public/llms.txt (brand, products incl. Academia, public pages, canonical, notes that portals/token links are not content).
- OG IMAGE: scripts/gen_og_image.js (Playwright, logo data-URI, Cairo) → public/og.jpg 1200×630 55KB.
- REBRAND (user-facing strings only; kept AlNokhbaMark identifier, academia product name, demo center name/slogans, backup filename prefixes, domain): layout title/applicationName, manifest name/short_name, sw.js notification titles ×3, shared.tsx AlNokhbaMark wordmark (line2 → Arabic descriptor, tracking-normal to protect Arabic shaping), landing (aria-label/wordmark/hero/footer/copyright + typo رصيدهمقل→رصيدهم قل), login h1+subtitle+إدارة strings, shell ×4, print fallbacks+generated-by ×5, cards/reports fallbacks, help-content tours ×3, settings identity note, admin pricing subtitle, auth.ts admin msg, api/auth messages ×4, emergency boot/shell/excel/toast, backup creator+sheet. Zero old-name matches left in src/+public/.
- FIXES DURING VALIDATION: double title-template ("...| Alnokhba Managment | Alnokhba Managment") → title {absolute} in pageMetadata + privateLayoutMetadata; canonical/sitemap trailing-slash aligned; home title shortened to default brand line.
- VALIDATION: tsc src 0 errors; eslint 0 errors on all changed files; next build OK (/robots.txt /sitemap.xml /_not-found in output); dev crawl: title/canonical/OG/3×JSON-LD valid JSON/robots/sitemap/llms/og.jpg 200/login+app+portal noindex/404 status+branded/security headers intact/1×H1; agent-browser 390px: no h-scroll, brand+footer render (seo-mobile-home.png, seo-mobile-footer.png, seo-404.png); regressions e2e_qr_slot 15/15 + tabs_security 25/25 + e2e_notifications 7/7 + e2e_capabilities 37/37 + e2e_device_lock 33/33 = 117/117.
- DEPLOY: commit b5b0e31 → Vercel; prod verified: new title, dynamic robots with Disallows, sitemap.xml, canonical, og:image, llms.txt 200, og.jpg 200 image/jpeg, /login noindex, branded 404 (HTTP 404), 1×H1, old robots.txt gone.

Stage Summary:
- Public surface = exactly one canonical indexable page ("/") with full metadata + 3 legitimate JSON-LD entities + branded OG image; every private/token route is noindex AND robots-disallowed (auth still the real gate); dynamic robots/sitemap are generated from one PATHS source in seo.ts (maintainable); GSC verification is a zero-secret env hook (GOOGLE_SITE_VERIFICATION) with manual steps documented; llms.txt added as AI-discovery convention (not claimed as ranking factor). Rebrand to "Alnokhba Managment" shipped across all user-facing surfaces without touching internal identifiers, DB data, Academia product name, or the production domain. 117/117 regression checks green; production live.

---
Task ID: O (prod outage fix — stale postgres schema + device-lock verification)
Agent: main (Super Z)
Task: user reported 500 "حصل خطأ غير متوقع في السيرفر" on teacher session page (QR panel + toasts); wanted: fix errors, QR scannable by ANY external scanner app → opens public page → student registers by code, same device can never succeed twice per session.

Work Log:
- ROOT CAUSE: `prisma/schema.postgres.prisma` was never regenerated after Tasks L/M — deployed Vercel client was missing 6 models (CenterCapability, AttendanceEvent, AttendanceDevice, StaffQrToken, FingerprintEnrollment, CheckInAttempt) → every route touching them 500'd (caps/slot/staff-peek/attempts). `db push` had also been removed from the build earlier, so the prod Postgres DB lacked the tables/columns too. Verified by probing prod (staff-qr/peek 500, caps 500) while old-schema routes worked.
- FIX 1: regenerated schema.postgres.prisma (+148 additive lines incl. Attendance deviceId/ipAddress/userAgent/riskScore/riskFlags + @@unique([sessionId,deviceId])). Commit 8f55603.
- FIX 2: vercel-build.sh now runs guarded additive `db push` after generate (no --accept-data-loss, timeout 120s, failure never breaks the build). Push failed on prod (pooler), so:
- FIX 3: temporary manager-only POST /api/admin/schema-sync ran the exact `prisma migrate diff` additive DDL as 35 single autocommit statements (pgbouncer-safe) — all 35 OK (commit e069b0b, endpoint removed after one successful run).
- PROD E2E (scripts/prod_device_lock_e2e.mjs, v2 calibrated): 12/12 functional checks — slot 200 (QR panel fixed), /a/<token> page 200 (any external scanner opens the public no-login form), peek valid+pv no-ID-leak, ACCEPTED no-login, same student+device idempotent alreadyAttended, student lock across devices, DIFFERENT student+SAME device → DEVICE_LOCKED (risk 80 + flags), parallel race ×3 → exactly ONE attendance row (DB unique(sessionId,deviceId) enforced), expired token rejected (EXPIRED_TOKEN), expired WITH live-sighting pv → ACCEPTED grace, attempts audit rows + suspiciousCount=6, attendance rows method=SESSION_QR + riskScore.
- ⚠️ INCIDENT + FULL REMEDIATION: v1 e2e cleanup searched students by "اختبار آلي" and matched all 22 → archived 19 real students and zeroed 10 negative balances via ADJUSTMENTs. Restored 100%: all real students ACTIVE + balances exactly re-verified against pre-incident snapshot (scripts/prod_remediation.mjs). Test artifacts: 3+4 test students archived w/ 0 balance, all test sessions CANCELLED (no settlements/revenue), 2 empty groups deactivated, 2 groups with registrations remain (API refuses delete — user can delete from UI). 1-piastre charges on test students only. Portal notifications for the adjustments were sent (unavoidable); ledger + audit trail fully document the reversal.
- DOCS: PRODUCTION-DB.md — mandatory rule: every schema.prisma change MUST regenerate schema.postgres.prisma before deploy (this was the outage), new guarded build-sync mechanism, DDL-over-pooler notes.

Stage Summary:
- Production is healed AND the device-locked attendance system is live for real: QR panel generates codes again (any external scanner app → https://…/a/<token> → student types code → checked in, no login), and ONE DEVICE = ONE SUCCESSFUL ATTENDANCE PER SESSION is enforced by the Postgres-level unique(sessionId, deviceId) — race-tested on prod. The 500s were a deployment-pipeline schema drift, not app logic. Incident caused and fully reverted; final state verified line-by-line.

---
Task ID: P (attendance modes — roster/open + configurable code length + CSV export)
Agent: main (Super Z)
Task: 26-section spec — attendance modes (Database/Roster vs Open), configurable student code length (no hardcoded 5), auto-derived absence, CSV export for closed sessions, fullscreen QR without countdown, minimal teacher workflow. PRESERVE the existing device-locked attendance architecture.

Work Log:
- INSPECT (per §23/§14): reused existing SessionInstance (Group = roster via StudentGroup), Attendance device-lock @@unique([sessionId,deviceId]), public /a/<token> flow, slot QR rotation, capabilities gating — zero architectural rebuild.
- SCHEMA (additive only + postgres regen via build_postgres_schema.py): SessionInstance.groupId nullable (open sessions بدون كشف) + name/studentSource(ROSTER default|OPEN)/allowUnregistered/studentCodeLength(3..12) · Attendance.studentId nullable + studentName/studentCode snapshot · CheckInAttempt.studentName.
- NULLABLE FALLBACK: ~180 TS errors fixed across 26 files (zaki/reports/dashboard/backup/emergency/mark/scan/sync/claim/slot/templates/receipts/approvals/today…) — كلها `?.` + fallback للحصص المفتوحة.
- API: POST /api/sessions accepts studentSource=OPEN (name + codeLength, price 0, no teacher/room-economics) أو ROSTER + allowUnregistered · GET list/detail mode-aware (open: absent=[] و recorded counts) · close: OPEN mode skips settlement/centerTransaction (presentCount = recorded rows) + returns mode · guardrails: bulk-mark + scan + claim + fingerprint ترفض حصص OPEN برسائل واضحة (الحضور المفتوح QR بس).
- CHECK-IN: open mode = name(2..80, حروف/فواصل) + code بالطول بالظبط → صف Attendance بدون studentId ولا خصم · roster mode = مطابقة كود + فحص اسم ناعم (الاختلاف ملاحظة مش رفض) + allowUnregistered يقبل غير المسجلين (linked لو الكود اتحل لطالب حقيقي) · قفل الجهاز فحص مسبق + P2002 disambiguation للوضعين · OPEN check-ins مفيش إشعارات لكل طالب (منع سبام فصل كامل).
- CSV: GET /api/sessions/[id]/export — CLOSED فقط · UTF-8 BOM + CRLF + quoting صحيح (فواصل/اقتباسات في الأسماء) · أعمدة عربية واضحة + نوع التسجيل · بدون device/token/risk/IP · filename معقّم attendance-{name}-{date}.csv · 401/400 guards · audit ATTENDANCE_EXPORTED.
- UI: شيت «حصة جديدة» في تاب اليوم (مصدر الطلاب أولاً: كارتين — قاعدة بيانات→مجموعة+allowUnreg toggle / حضور مفتوح→اسم الحصة+طول الكود، وقت افتراضي now→+90م) · كارت الحصة شارة «مفتوحة» + اتصسجل N · شاشة الحصة mode-aware (اتسجل/محاولات بدل غايب/فلوس — بدون ScanView ولا طرق الكشف للمفتوح) · قفل/مراجعة/نجاح mode-aware + زرار تصدير CSV بعد القفل · fullscreen QR كبير متوسط بدون عدّاد (الدوران مستمر بصمت — spec §7) · صفحة /a: حقل اسم + maxLength/placeholder حسب طول كود الحصة (من peek).
- TESTS: scripts/e2e_attendance_modes.sh 44/44 (create OPEN 5&7, slot+peek mode info, open check-in, device-lock same-device, wrong lengths, multi-device multi-student, comma-name, parallel race 1+1, close mode=OPEN, CSV before-close 400, BOM bytes, quoted comma name, no deviceId/token/risk, row counts, roster accepted/rejected/allowUnreg+name-required/name-variant, roster CSV, derived absent, bulk-guard, list studentSource) · regressions: e2e_device_lock 33/33 · e2e_qr_slot 15/15 · tabs_security 25/25 · e2e_notifications 7/7 · e2e_capabilities 37/37 = 161/161 · tsc src clean · eslint clean · next build OK.
- FIXTURE: make_lock_students restricted to ROSTER sessions (كان بيمسك حصة مفتوحة groupId=null) + scripts/cleanup_mode_tests.ts لتنظيف حصص الاختبار (تعارض مدرس على إعادة التشغيل).
- UI BROWSER: dialog render + create open session → live view (اتسجل stat + مفيش غياب/حسابات) · fullscreen screenshot بدون عدّاد · /a page name+code form → «تم تسجيل حضرك بنجاح» · screenshots في scripts/ui-*.png.
- DEPLOY: commit c3b3613 → Vercel؛ **db push فشل فوق الـ pooler تاني (درس Task O)** → temp manager-only POST /api/admin/schema-sync نفّذ 11 statement DDL إضافي (ADD COLUMN IF NOT EXISTS + DROP NOT NULL + FK SET NULL) واحد-بواحد autocommit — كلها ✅؛ prod e2e (scripts/prod_modes_verify.mjs): login/create OPEN(7)/slot/peek/student check-in/device-lock/wrong-length/close mode=OPEN/CSV BOM bytes ef-bb-bf + name + clean — 10/10 بعد تصحيح قياس BOM (TextDecoder بي_strip_ الـ BOM)؛ جلسة الاختبار اتقفلت واتلغت (reopen→cancel)؛ الـ endpoint اتشال (fab576b) واتأكدت 404.

Stage Summary:
- «Database Attendance when a roster exists. Open Attendance when it doesn't.» شغال في الإنتاج: حصة مفتوحة بطول كود قابل للضبط، أي طالب يمسح QR بأي تطبيق → يكتب اسمه وكوده → يتسجل من غير حساب ولا خصم، والجهاز الواحد لسه مقفول على حضور واحد ناجح لكل حصة بالداتابيز. حصص الكشف زي ما هي بالظبط + إعداد اختياري لقبول غير المسجلين + غياب مُشتق تلقائيًا بعد القفل (من غير زرار). CSV نظيف Excel-friendly بالعربي بعد القفل. مفيش أي architectural rebuild — كل حاجة امتداد للبنية الموجودة.

---
Task ID: Q (anti-cheat layer + full-site load testing + DB scaling plan)
Agent: main (Super Z)
Task: user still could scan twice from same device; wanted prevention of غش: (a) same-device double scan, (b) QR sent to someone outside the room, (c) proxy attendance by re-scanning + typing someone's code. Then load-test the whole site (one session + multiple sessions) to find max simultaneous scanners, and a DB scaling/expansion plan.

Work Log:
- ROOT CAUSE (double scan): device identity was a random UUID in cookie+localStorage (nk_did) — incognito/clearing site data/2nd browser minted a fresh identity. Confirmed by code inspection.
- SCHEMA (additive, SQLite push + postgres regen + prod DDL 8/8 via temp /api/admin/schema-sync then removed): Attendance.deviceFingerprint + attendanceCode + unique(sessionId,deviceFingerprint) + unique(sessionId,attendanceCode) + index(deviceFingerprint) · SessionInstance.requireRoomPin + anchorIp · CheckInAttempt.deviceFingerprint.
- LIBS: device-fingerprint.ts (client, high-entropy: canvas+audio+WebGL+fonts+screen-sorted+hw+tz+langs → SHA-256; stable across incognito/cleared storage/window resize; graceful degradation) · room-pin.ts (server: 4-digit HMAC pin, 120s window, current+prev accepted, NOKHBA_PV_SECRET) · attendance-risk.ts +4 flags (STUDENT_CODE_REUSED 40, DIFFERENT_NETWORK 15, MISSING_FINGERPRINT 5, FINGERPRINT_REUSED 45) + extraFlags param.
- CHECK-IN API: room-PIN gate (WRONG_ROOM_PIN) · byDevice idempotent same-code ALREADY (friendly retry) · byFingerprint (same code → idempotent, diff code → DEVICE_LOCKED r90) · byCode → CODE_ALREADY_USED r70 · anchor-IP → DIFFERENT_NETWORK flag (never reject — NAT/same-WiFi) · MISSING_FINGERPRINT for legacy clients · insert stores fp+attendanceCode · P2002 disambiguation extended to 4 constraints (fp→device→code→student) · classroom-scale rate limits 600/min/IP (peek+check-in; was 40-120 → was 429-ing real classes).
- SLOTS/PEEK: slot returns roomPin+requireRoomPin (teacher display, auto-refreshed every slot) · peek returns requireRoomPin + rate limit 600.
- SESSIONS POST: requireRoomPin (both modes) + anchorIp from creator request.
- UI: /a page computes fp in parallel with peek, sends fp+pin, room-PIN field (4-digit) when required, updated copy ("حتى لو مسحت بيانات المتصفح أو نافذة خاصة") · session-qr-card shows room PIN big in normal card AND fullscreen · new-session dialog: 🔒 anti-cheat toggle default ON for both modes.
- TESTS: scripts/e2e_anticheat.sh 23/23 (incognito-sim = new device + same fp → blocked; proxy code → CODE_ALREADY_USED; wrong/correct PIN; different-network flag visible in suspicious dashboard; 4-parallel same-fp race → exactly 1 winner + 3 blocked; no-PIN session backward compat; roster with pin + same-student-2nd-device ALREADY) · regressions green: e2e_device_lock 33 (0 ❌), e2e_attendance_modes 45/45 (updated R5 to distinct code — old test asserted the OLD permissive proxy behavior; added explicit anti-proxy check), e2e_qr_slot 15/15 (suite now prefers ROSTER sessions — stale OPEN-mode demo sessions were breaking its pick), caps 37, notif 7, security 25. Total 185 green. tsc src clean · next build OK.
- CLEANUP: stale leftover OPEN sessions from earlier UI demos deleted/cancelled (they were polluting /api/today first-session picks); e2e_anticheat + modes suites now self-clean at end.
- LOAD TEST (scripts/loadtest.mjs + cleanup_loadtest.ts): local prod build + SQLite — single session tiers 25/50/100/150/200/300/400/500/700 → 100% success at every tier, p95: 42ms@50 · 88ms@100 · 385ms@150 · 987ms@200 · 2.1s@300 · 4.6s@400+; write plateau ~65-72/s. Multi-session 10×40=400 → 100%, 20×30=600 → 100% (same total ceiling — linear across sessions). Zero 429/5xx anywhere (rate limits raised + NK_RATELIMIT_OFF test hook).
- PROD LOAD TEST (Vercel+Postgres, sandbox egress throttled ~1.5-3 req/s): per-request page 289ms / peek 502ms / check-in 1139ms; 10-parallel 2.9s all accepted. Clustered 8-process waves 50/100/200: client reported timeouts (sandbox network) BUT prod DB verified 822/822 attendance rows recorded — server-side zero loss, zero 429, zero 5xx. Prod test sessions closed/cancelled + leftovers cleaned.
- DOCS: docs/anti-cheat.md (attack→layer table, limits, privacy, known same-model-device limitation + reception override) · docs/database-scaling.md (3 phases + measured numbers + trigger table).

Stage Summary:
- The double-scan hole is closed at the DATABASE level: same physical browser (incognito or after wiping all site data) can no longer take a second attendance in the same session; a student code can only ever be recorded once per session no matter the device (proxy attendance dead); QR screenshots are useless without the room's rotating 4-digit code that changes every 2 minutes; and anything odd (different network, fingerprint reuse, missing fp) surfaces as reviewable flags. All prior flows untouched (185 regression checks green). Load-tested: local ceiling is SQLite's single writer (~65-70 writes/s, p95<2s up to ~300 concurrent) while prod (Postgres) recorded every single request with zero server errors. Scaling plan documented in 3 phases with concrete triggers.

---
Task ID: R (DB/no-DB choice confirmed + DB scaling implemented + before/after comparison)
Agent: main (Super Z)
Task: user restated the session-creation choice (DB verification vs no-DB recording) and asked to actually IMPLEMENT the DB scaling changes, test the new system, and send a measured comparison.

Work Log:
- CHOICE (already built in Task P, polished to match user's exact words): NewSessionDialog cards now «من قاعدة البيانات — بيتحقق من وجود الطالب في النظام» vs «بدون قاعدة بيانات — يسجّل الاسم والكود زي ما الطالب يكتبهم — من غير تحقق»; OPEN selection auto-fills the session name (`حضور مفتوح — HH:MM`) so opening a no-DB session is literally pick-card → press open.
- BASELINE CAUTION: first baseline run was contaminated by the sandbox's auto-started dev server (20% CPU, 1.2GB RSS) — killed it, re-baselined clean (prod build + SQLite + NK_RATELIMIT_OFF=1 + slot 600s to avoid test-artifact EXPIRED_TOKEN under queue backlog). Baseline: 100% success 50→700, ceiling ~73/s.
- CHECK-IN HOT PATH (src/app/api/attendance/public/check-in/route.ts): 4 sequential lock reads (byStudent/byDevice/byFp/byCode findUnique) → ONE findMany with OR + same precedence in code (صفر تغيير سلوك); risk assessment now PARALLEL with lock read (was sequential after); post-insert writes (charge + attendanceEvent + audit + final attempt) → one Promise.all; token useCount/lastUsedAt UPDATE (same-row write hotspot — every successful student hit the same token row) throttled to once/30s per token (write-only telemetry, never read anywhere — verified by grep).
- CACHES: peek 3s micro-cache keyed by token (pv still HMAC-issued per request); getCenterCapabilities 30s cache + invalidateCenterCapabilities() wired into PATCH /api/center/capabilities (was re-querying per check-in/peek/scan).
- DB TUNING: db.ts — SQLite `PRAGMA journal_mode=WAL` at boot (readers don't block writer); Postgres URLs get connection_limit=10 (NK_DB_CONNECTION_LIMIT override) + pool_timeout=15 automatically.
- SCHEMA (additive + postgres regen via build_postgres_schema.py + local db push): CheckInAttempt @@index([sessionId,deviceId]) + @@index([sessionId,ipAddress]) — risk-engine lookups exact-match now.
- LOAD COMPARISON (same box, same method, slot 600s): 50: p50 24→14ms · 100: 111→20ms · 200: p95 1324→500ms, ceiling 59.3→73.8/s · 300: p95 2232→1513ms, 64.6→80.9/s · 500: p95 4442→3783ms, 68.5→82.6/s · 700: p95 6093→4933ms · NEW 1000-concurrent single session: 100% success, 82.0/s, p95 6.5s · multi 10×40: p50 264→213ms, p95 4050→3285ms · 100% success everywhere, zero 429/5xx before AND after.
- REGRESSIONS: e2e_device_lock 33/33 · e2e_attendance_modes 45/45 · e2e_anticheat 23/23 · e2e_qr_slot 15/15 = 116 green; tsc src clean; eslint clean; loadtest rows cleaned (39 sessions/7191 attempts); WAL checkpointed before commit; db/*-wal + *-shm gitignored.
- DEPLOY: commit c1717a6 → Vercel; temp /api/admin/schema-sync (manager-only, 2 idempotent CREATE INDEX) ran 2/2 + idempotent re-run green; prod full verify (prod_modes_verify.mjs) 10/10 incl. same-device lock on Postgres; endpoint removed (aacf8d6). Dev preview server restored on :3000 after measurements.

Stage Summary:
- توسعة الداتابيز اتنفذت فعليًا مش على الورق: السقف المحلي نزل من ~73 لـ ~82 تسجيل/ثانية، والزمن الاستجابة عند 200-500 طالب متزامن قل نص تقريبًا (p95 1324→500ms عند 200)، وأول مرة نعدّي 1000 طالب متزامن في حصة واحدة بنسبة نجاح 100% وصفر أخطاء — قبل وبعد على نفس الجهاز ونفس المنهجية. اختيار «من قاعدة البيانات / بدون قاعدة بيانات» عند فتح الحصة شغال بالصياغة الحرفية اللي طلبها المستخدم، والحصة المفتوحة بتتفتح بضغطة واحدة. القيود الأمنية زي ما هي (116 فحص regression أخضر) والإنتاج متحقق 10/10 بعد الـ deploy.

---
Task ID: S (print buttons fix + easier/s smarter workflow + no-DB scan confirmed)
Agent: main (Super Z)
Task: user reported «زراير الطباعة مش شغالة» + asked for easier & smarter workflow (think first, then implement) + still couldn't do a no-database scan (scan + write name + code outside DB).

Work Log:
- PRINT ROOT CAUSE (two real bugs found by reproduction):
  1) SessionLiveView (Focus Mode) was rendered OUTSIDE PrintProvider in app.tsx → usePrint() returned the no-op default context → EVERY print button inside a live session (كشف الحضور etc.) silently did nothing. Fixed: wrapped FocusShell branch with PrintProvider.
  2) Engine fragility: 1500ms teardown timer removed the print root while Safari/iOS print dialog was still open (window.print() is non-blocking there → blank prints); print CSS relied on :has() only; sandboxed iframes silently ignore window.print().
- PRINT ENGINE HARDENING (print.tsx): beforeprint detection → if print() ignored within 700ms, fallback opens an independent self-printing window (collects all page CSS + <base href> + auto print + auto close); no teardown race anymore (cleanup on afterprint + 60s safety only); body.nk-printing class + globals.css rules as no-:has() fallback; toast guidance if even the fallback popup is blocked.
- SMARTER WORKFLOW (think-first): the no-DB choice was invisible in the schedule-driven daily flow — sessions opened from schedule ("ابدأ"/auto-open) were always ROSTER. Implemented:
  a) «حضور مفتوح ⚡» hero quick-action on Today header → dialog opens PRESELECTED on بدون قاعدة بيانات with name auto-filled → 2 taps to a running open session.
  b) Planned-session cards now have TWO actions: «ابدأ» (roster w/ كشف) + «مفتوح» (one-tap OPEN session named after the slot, PIN on, code 5) — lands directly on fullscreen QR.
  c) After creating any OPEN session (dialog or planned), app lands directly on attendance tab with QR auto-fullscreen (openSession now accepts {tab, qrFullscreen}; SessionQrCard supports autoFullscreen; overview CTA for OPEN jumps fullscreen).
  d) Live OPEN session cards on Today got a «الكود» action (fullscreen QR from the list).
- PEEK CACHE INVALIDATION: peek micro-cache (3s, Task R) cached CAPABILITY_OFF results → after manager re-enables dynamic_qr students could see CAPABILITY_OFF up to 3s, and e2e_devices_lock check 13 flapped. Extracted cache to src/lib/peek-cache.ts + clearPeekCache() wired into PATCH /api/center/capabilities (instant visibility for caps toggles); removed test sleep hack.
- BROWSER E2E (headless): open-mode student check-in verified twice (name+code+PIN → «تم تسجيل حضرك بنجاح»); quick-action flow → fullscreen QR w/ room PIN in 2 taps; planned «مفتوح» one-tap → fullscreen QR; print normal path (root mounted+populated at print(), cleanup on afterprint), blocked path (window.open fallback produced 278KB styled self-printing doc), day-schedule print lifecycle — all verified. Stale dev server serving broken mixed chunks (client-side exception) was the likely reason the user's preview attempts failed — killed and re-daemonized cleanly.
- TESTS: e2e_device_lock 33/33 · e2e_attendance_modes 45/45 · e2e_anticheat 23/23 · e2e_qr_slot 15/15 = 116 green · tsc src clean · eslint clean · next build OK. Test sessions cancelled after verification (no pollution of today list).
- NO schema changes, NO architectural changes (spec iron rule respected) — UI wiring + print engine + cache invalidation only.

Stage Summary:
- أزرار الطباعة شغالت فعلًا: كان فيه بروفايدر ناقص جوه شاشة الحصة (كل الأزرار كانت بتنادي دالة فاضية) — اتصلّح، والمحرك بقى مقاوم لـ Safari/iframe مقفول مع نافذة طباعة احتياطية. الـ workflow بقى أسهل وأذكى: «حضور مفتوح ⚡» من الهيدر بضغطتين، «مفتوح» جنب «ابدأ» في كل حصة مجدولة (تفتح حضور مفتوح من غير داتابيز فورًا)، وأي حصة مفتوحة بتفتح الكود بحجم الشاشة على طول. المسح من غير داتابيز (اسم + كود + كود القاعة) متأكد شغال بالكامل من غير تسجيل دخول.

---
Task ID: brand-logos
Agent: Super Z (main)
Task: خد من الصورة (AlNokhba Management Brand System.png) كل اللوجوهات وحطها مكان أي حتة محتاجة لوجو فالموقع

Work Log:
- فحصت الموقع بالكامل: حددت 10+ نقطة استخدام للوجو (AlNokhbaMark في 16 مكان، شاشات الموظفين، الطباعة: إيصالات/تقارير/كروت طلاب، favicon/PWA icons، og.jpg، JSON-LD)
- اكتشفت إن /logo-full.png متستدعي في shared.tsx لكن الملف نفسه مش موجود (صورة مكسورة) — اتصلّح
- استخرجت الأصول من البراند شيت (1536×1024) بـ flood-fill background removal عشان أحافظ على الـ N الأبيض جوه المربع الكحلي (v1 بـ global keying كان بيمسحه)
- النسخ البيضاء اتولدت من الـ lockup الملوّن النظيف (الـ pill في الشيت فيه تدرج إضاءة خلى الـ keying مباشر وسخ)
- الأصول الجديدة في public/: logo.png (أيقونة كحلي 256)، logo-full.png (lockup أفقي)، logo-mark.png (الرمز)، logo-mark-white.png (رمز أبيض)، logo-white.png (lockup أبيض)، logo-vertical.png
- استبدلت favicon.png/icon-192/icon-512/icon-maskable-512/apple-touch-icon بالأيقونة الجديدة + أعيد توليد og.jpg (تدرج كحلي + lockup أبيض)
- layout.tsx: favicon size 48→64 (مطابقة الملف الفعلي)
- staff-screen: الرمز الأبيض بدل الأيقونة الكحلية على الخلفية الداكنة #0b1220
- sw.js: cache bump v8→v9 (الـ shell precache كان هيفضل على اللوجو القديم)
- Build نجح + لقطات تحقق: landing/login/staff-screen كلها بتعرض البراند الجديد صح
- Commit: brand-logos (القديم اتعمل له backup في backups/logo-old.png)

Stage Summary:
- كل نقطة لوجو في الموقع دلوقتي على البراند الرسمي AlNokhba Management (navy #0B1B4F / blue #2563EB / teal #10B981)
- سكربت الاستخراج محفوظ في scripts/extract_brand.py — قابل لإعادة التشغيل لو البراند شيت اتحدث

---
Task ID: print-pdf-readability
Agent: Super Z (main)
Task: make sure the text in the PDFs is visible and not the same colors as the background + fit perfectly in downloading and look professional

Work Log:
- بنيت print-lab (صفحة مؤقتة اتحذفت) تعرض كل مستندات الطباعة الستة ببيانات واقعية + وضع داكن/فاتح + براند فاتح (أسوأ حالة)
- Playwright: emulateMedia(print) + page.pdf() + pdftoppm → أكدت الباج بصرياً
- الباج المؤكد: في الدارك مود النصوص من غير لون صريح (جداول التقارير، أسماء الكروت، كشوف الحضور) بتورّث foreground الفاتح → أبيض على أبيض
- باج تاني: سنتر بألوان فاتحة (أصفر) → النص الأبيض على الهيدر مش باين + شريحة الكود ضعيفة التباين
- الإصلاحات: (1) #nk-print-root/.nk-print-doc يفرض ورقة بيضاء + حبر #1b2635 في @media print (2) brandInk/brandOnLight يختاروا الحبر حسب إضاءة لون البراند (3) كروت الشاشة كمان حبر صريح (4) الإيصال الثيرمال يحقن @page 80mm auto (والنافذة الاحتياطية برضه) عشان الـ PDF ينزل بمقاس الورق
- التحقق بعد الإصلاح: داكن/فاتح × براند افتراضي/فاتح — كل النصوص مقروءة، السالب أحمر، المجاميع ظاهرة
- حذفت print-lab + build نجح + Commit 416f93a

Stage Summary:
- كل مستندات الطباعة (إيصالات A4/ثيرمال، تقارير، كشوف حضور، جداول اليوم، كروت طلاب) نصوصها مضمونة التباين في الوضع الداكن والفاتح وأي ألوان سنتر
- سكربت التدقيق محفوظ: scripts/print_audit.js

---
Task ID: F (UI/UX redesign — phase 1: audit + critical fixes across all surfaces)
Agent: Super Z (main)
Task: 29-section UI/UX redesign (Task F) — STEP 1 full codebase audit + fix why the site still shows the old logo. Spec iron rule: no architectural/schema changes.

Work Log:
- OLD LOGO ROOT CAUSE: server-side was already correct (new brand PNGs everywhere, landing/login/staff-screen verified by screenshot). Culprits: (a) two STALE old-brand SVGs still publicly served (/logo.svg = old Z mark, /nokhba-icon.svg = old green shield — unreferenced leftovers), (b) sticky client caches (favicon/PWA SW/og-image cache by URL) with no versioning on asset URLs. FIX: every brand asset URL now carries ?v=2 (layout metadata icons/og/twitter, JSON-LD, manifest icons, all component img srcs), SW bumped v10→v11 with pathname-normalized cache match/put (versioned URLs still hit the offline cache), stale SVGs deleted. Browsers self-heal in 1-2 visits after SW update.
- AUDIT (3 parallel read-only agents, all file:line verified): main app 37 files, portals/public 10 surfaces, design system + drift stats. Top findings: 10 dead hover:nk-brand-text states (Tailwind v4 never registered the class), .nk-btn never defined (emergency recovery buttons unstyled), invalid border-[color:mix()] x4 in emergency, TWO default identities (navy on screen vs old green #0E9F6E in print/cards/portal/academia fallbacks), portal applyBrand set --c-primary/--c-secondary but all brand classes read --c-primary-strong → per-center branding had ZERO visible effect in student portal (and teacher portal never applied branding at all), network failure = fake logout on both portals (student offline screen was dead code), academia views (groups/students/exams/requests/reports) unreachable on desktop, staff-screen countdown divided by hardcoded 14000ms, command palette "صفحات" header rendered AFTER its list + 6 views missing, dead 416-line dashboard.tsx, 557 font-extrabold/black overload, 4 button systems, 4 autocomplete implementations (documented for phase 2).
- FIXED IN PHASE 1 (all verified): @utility nk-brand-text + .nk-btn/.nk-btn.sm base + .dark .nk-badge overrides in globals.css · broken classes fixed (color:mix→color-mix x4, rounded-2-xl, mono→font-mono, "الحضور والpresence"→"الحضور") · BRAND_DEFAULTS single source in lib.ts (navy #0B1B4F/blue #2563EB/teal #10B981) threaded through print ×5, cards, settings ColorField, academia views-today · portal.tsx broken local applyBrand removed → applyCenterBranding from lib (which sets -strong/-lift vars properly) · teacher-portal now applies center branding + tapi fetch guard · student boot catch distinguishes status=0 → offline screen (dead UI now reachable); teacher boot same → new offline screen · academia desktop nav row under header + ?view= validated against known keys · staff-screen: bg var(--navy), QR color #0B1B4F, nk-btn-brand CTA (was emerald-500), blue glow, CountdownBar takes slotSeconds (real lifetime) · command palette: sections render in order (طلاب then صفحات), nav = role-correct full lists (manager 18 views, teacher 5, receptionist 8), data-idx mapping preserved for keyboard nav · message-queue red/slate → rose/muted tokens · app.tsx: setView wrapper syncs view to URL hash (replaceState) + restores from hash on mount (keys from NAV_LABELS) → undo's reload()/refresh no longer dumps user on home · dashboard.tsx (dead, drifted dark-mode classes) deleted · today-view approvals card now data-driven (GET /api/approvals pendingCount, manager-only) — hidden when 0, shows rose count badge · scan.tsx duplicate amber "pick a session" banner removed · s/[token]: brand mark added + bg-background token; a/[token] bg tokenized · landing footer year dynamic.
- VERIFY: tsc src clean · eslint clean (2 pre-existing unused-directive warnings, staff-screen cascading-setState error pre-existing — confirmed via git stash) · next build OK · screenshots: landing/login/staff-screen(navy+gradient CTA)/a-invalid/s-invalid(brand mark+token bg)/landing-mobile · regressions: e2e_qr_slot 15/15 · e2e_capabilities 37/37 · e2e_device_lock 33 ✅/0 ❌ · e2e_attendance_modes 45/45 · e2e_anticheat 23/23 = 153 green · commit cb8008b.
- PHASE 2 BACKLOG (documented from audit, not yet implemented): unify 4 button systems via ActionButton variants, extract PaymentPanel + Field/inputCls + assessment trio (exam/quiz/assignment duplication), typography weight-reduction pass (worst: emergency/admin), consolidate 4 autocomplete implementations (cmdk installed unused), print.tsx inline styles → nk-print layer, z-index scale tokens, elevation tokens, native confirm() (14 spots) → styled dialog, accounting صرف unprotected tap + quick-fill, portal badge RTL offset hack.

Stage Summary:
- المرحلة الأولى من إعادة التصميم خلصت: التقرير كشف إن «اللوجو القديم» كان كاش بجهاز المستخدم + ملفين SVG قدماء لسه متخزنين — اتشالوا واتعمل cache-busting لكل أصول البراند (?v=2 + SW v11) فالمتصفح هيجدد تلقائي بعد زيارة أو اتنين. اتصلّحت 12+ باج حقيقي (أزرار بدون ستايل، hover ميت، هويتين مختلفتين للسنتر اللي مالوش ألوان، براند البورتال مش بيشتغل أصلًا، «تسجيل خروج» وهمي عند قطع النت، شاشات مش متاحة على الديسكتوب في أكاديميا، عدّاد شاشة التلفزيون غلط، وقائمة Ctrl+K ناقصة وفوضوية). كل الفحوصات خضرا (153) والبناء نضيف.

---
Task ID: session-pipeline (صفحة الحصة مبسطة كـ pipeline)
Agent: Super Z (main)
Task: user: «لما باجي اسجل حضور بدوس عالحصة، اول ما بخش بلاقي الصفحة معقدة جدًا — خليها مبسطة وواضحة و pipeline»

Work Log:
- AUDIT: صفحة الحصة القديمة كانت ٥ طبقات متكدسة (زرار رجوع + PageHeader بزرار قفل + داشبورد لاصق فيه شارة حالة و5 MiniStats وشريط تقدم + كارت «الخطوة الجاية» + ٤ تابات) وبتفتح على «نظرة عامة» فيها أرقام فلوس قبل شغل الحضور، وجدول الحضور + النشاط المشبوه متكررين في تابات مرتين.
- REDESIGN (session-live.tsx إعادة بناء كاملة — UI فقط، صفر تغيير API/schema):
  1) كارت حصة مضغوط واحد: شارة الحالة (شغالة/مقفولة/ملغاة) + العنوان + الميعاد/القاعة/المدرس + قائمة ⋯ (DropdownMenu).
  2) خط أنابيب من خطوتين بدل ٤ تابات وداشبورد وشريط تقدم وكارت الخطوة الجاية: «١ سجّل الحضور (عداد حي)» → «٢ راجع وقفل» — بيفتح عليه على الخطوة ١ مباشرة، وبعد القفل العلامتان ✓✓ وبيفتح على الملخص النهائي، والملغاة: تنبيه وردي + السجل المحفوظ بلا خطوات.
  3) الخطوة ١ = شغل الحضور: عداد (حاضر/غايب/مشبوه أو اتسجل/مشبوه) + QR الحصة + المسح المدمج + المسجلين ومحضروش مع «علّم الكل» + جدول الحضور مرة واحدة + النشاط المشبوه.
  4) الخطوة ٢ = المراجعة والقفل: ملخص الأرقام + ReviewFlags + مدفوعات الحصة + زرار القفل؛ بعد القفل تتحول للملخص النهائي (نصيب المدرس/السنتر + طباعة/CSV/رجوع).
  5) تاب «العمليات» اتشال: طباعة/شاشة المسح الكاملة/إلغاء أو طلب إلغاء/إعادة فتح → قائمة ⋯؛ بيانات الحصة وسجل الحالة → حوار «سجل الحالة والبيانات» من نفس القائمة.
  6) اتحذف: زرار الرجوع المكرر (FocusShell فيه «خروج من الحصة»)، تكرار الجدول/الإحصاءات، تنبيهات الـ overview (اتنقلت لمكان الفعل: غياب في الخطوة ١، متأخرات في مراجعة الخطوة ٢).
- PRESERVED: autoFullscreen للـ QR من openSession، بولينج 8ث، loadPayments عند المراجعة، closeSession→خطوة المراجعة + شريط النجاح بالتراجع/CSV، bulk mark، dialogs (bulk/close/cancel/reopen) بنصوصها، data-tour keys، توقيع الـ props (initialTab متوافق مع القيم القديمة overview/operations → auto)، spec §1B/§10/§15/§16 للحضور المفتوح.
- VERIFY: tsc src clean · eslint clean · متصفح كامل: حصة شغالة (كشف) بتفتح على الخطوة ١ ✓، تنقل الخطوات ✓، قائمة ⋯ ✓، حوار سجل الحالة ✓، حصة مقفولة بتفتح على الملخص بعلامتي ✓ ✓، حضور مفتوح (QR بس + «اتسجل» + fullscreen بعد الإنشاء) ✓، إلغاء → حالة ملغاة ✓، موبايل 390px لقطة مؤكدة (كله فوق بعض في شاشة واحدة) — لقطات في download/session-pipeline-*.png · regressions: attendance_modes 45/45 · device_lock 33✅/0❌ · qr_slot 15/15 · anticheat 24✅/0❌ = 117 أخضر · commit d1ced12 (211+/342−).

---
Task ID: session-foldable (المعلومات مطوية ومضغوطة)
Agent: Super Z (main)
Task: user: «make any info compressed and can be folded to reduce the size» — تكملة لخط أنابيب الحصة: كل المعلومات تبقى مضغوطة وقابلة للطي.

Work Log:
- COMPONENT جديد FoldSection (في session-live.tsx — مكانه الصح لو احتاجته صفحات تانية): هيدر سطر واحد (أيقونة + عنوان + badge عدّاد + ملخص مطوي + زرار إجراء + شيفرون)، التفاصيل تفتح بالضغط، aria-expanded + دعم كيبورد Enter/Space، الإجراءات الداخلية بـ stopPropagation عشان ما تفتحش القسم.
- حضور الحصة (الجدول): بقى قابل للطي — مطوي يظهر صف أفاتارات (أول ٥ حروف + ‎+N) بدل جدول طويل؛ بيفتح لوحده لو الحضور ≤ ٨، والمفتوح ليه سقف ارتفاع max-h-[55vh] بتمرير + صفوف أضغط (py-2، أفاتار 7×7 بدل 8×8) + زرار الطباعة في الهيدر دايمًا ظاهر.
- مسجلين ومحضروش: مطوي افتراضيًا («أسماء الغايبين مطوية») والشرائح ليها سقف max-h-40، وزرار «علّم الكل (N)» بقى في الهيدر ظاهر دايمًا حتى والقسم مقفول.
- النشاط المشبوه: الكارت كله بقى مطوي بعدّاد وشارة «مراجعة» (قبل كده الكارت ظاهر دايمًا والتفاصيل بس اللي بتطوي) — اتحذ التوجل الداخلي.
- مدفوعات الحصة (خطوة المراجعة): مطوية افتراضيًا بعدّاد الدفعات في الهيدر بدل كارت كامل بشرح؛ الشرح والقائمة بيظهروا عند الفتح.
- ملخص ما بعد القفل: بيانات الحصة (المجموعة/المدرس/القاعة/الميعاد) في عمودين grid-cols-2 — نص الارتفاع.
- PRESERVED: صفر تغيير API/schema، كل الحوارات والأزرار والتوقيعات زي ما هي، FoldSection بيحترم nested buttons (div role=button + أزرار حقيقية جواه — HTML سليم).
- VERIFY: tsc src صفر أخطاء · eslint نظيف · متصفح كامل: فتح حصة حية من كارت اليوم → ارتفاع الصفحة نزل من ~2800 لـ ~1190px، الغايبين مطويين والزرار شغال، الجدول اتفتح (3≤8) وقفل على أفاتارات (ي ع م)، خطوة المراجعة «مدفوعات الحصة 0» مطوية، القفل → الملخص النهائي بعمودين، موبايل 390px = 844px (شاشة واحدة) — لقطات في download/fold-*.png · regressions: attendance_modes 45/45 · device_lock 33/0 · qr_slot 15/15 · anticheat 23/23 = 116 أخضر · next build OK · جهاز اختبار اتفتح وقفل ورجع واتلغى (الخصومات اتعكس بالـ reopen).
- commit d304273 (158+/82−).

Stage Summary:
- صفحة الحصة بقت «سطر لكل معلومة»: الكشف الكبير والغياب والمشبوه والمدفوعات كلهم بطاقات مطوية بعنوان وعداد واضح، والتفاصيل مطلوب عليها بالضغط بس — والصفحة كلها على الموبايل بقت شاشة واحدة. أداة FoldSection جاهزة لإعادة الاستخدام في باقي الشاشات لو حبيت نفس الأسلوب.

---
Task ID: session-deploy (المستخدم شايف التصميم القديم — النشر كان ناقص)
Agent: Super Z (main)
Task: user sent 2 screenshots from alnokhba-centers.vercel.app showing the session page «still crowded» — السكرينشوتس طلعوا التصميم القديم أصلاً (داشبورد لاصق + ٥ عدادات + شريط تقدم + بيانات الحصة + ٤ تابات) لأن last 14 commits (بينهم session-pipeline d1ced12 وsession-foldable d304273) كانت محلية ومعداتش اتدفعت لـ Vercel.

Work Log:
- ROOT CAUSE: git log origin/main..HEAD = 14 unpushed commits — إعادة تصميم خط الأنابيب والطي والماركة والطباعة كلها كانت شغالة محلياً بس، والإنتاج لسه على التصميم القديم.
- SIMPLIFY MORE قبل الدفع: شيلت صف العدادات (MiniStats) من الخطوة ١ خالص — كان مكرر ١٠٠٪ (الأرقام عايشة أصلاً في عنوان الخطوة «١ سجّل الحضور — 3 حاضر · 4 غايب» وفي ترويسات الأقسام المطوية «حضور الحصة (3)» / «مسجلين ومحضروش (4)» / «النشاط المشبوه (N)»)؛ اتحذف الدالة والمستخدم الوحيد ليها (GraduationCap icon) — الخطوة ١ بقت: كارت الحصة + خطوتين + QR + المسح + ٣ أقسام مطوية.
- RISK CHECK قبل الدفع: git diff origin/main..HEAD — مفيش أي تغيير في prisma/schema.prisma (seed.ts بس) → صفر مخاطر DDL على داتابيز الإنتاج.
- VERIFY: tsc src = 0 أخطاء · eslint نظيف · next build ✓ (28.7s) · دفعت 14 commit (4945203..afe794a) → Vercel auto-deploy.
- PROD VERIFY بمتصفح حقيقي: login manager على alnokhba-centers.vercel.app → فتحت حصة «رياضيات — الأول الثانوي B» → الصفحة الجديدة شغالة: تاب «١ سجّل الحضور 0 حاضر · 7 غايب» مختار مباشرة + «٢ راجع وقفل»، مفيش داشبورد ولا عدادات ولا شريط تقدم ولا بيانات الحصة ولا ٤ تابات، «مسجلين ومحضروش (7)» مطوية + «علّم الكل (7)» ظاهر، «حضور الحصة (0)» مطوية + طباعة ظاهر — لقطة في download/prod-new-step1.png. (بعد الـ push بياخد ٣-٥ دقايق بناء — أول فحص كان لسه على النشر القديم.)
- SW مش محتاج bump: /app مش متكاشة أصلًا (الـ SHELL = "/" و"/portal" بس) والـ chunks content-hashed → النشر الجديد بيتلقط فورًا.
- commit afe794a (شيل العدادات) — متدفعل مع الباقي.

Stage Summary:
- «الصفحة لسه معقدة» كان تشخيص مش قديم — الكود الجديد كان موجود بس مش منشور. دلوقتي الإنتاج على نفس حالة المحلي بالظبط: صفحة الحصة = كارت واحد + خطوتين + أدوات الشغل + أقسام مطوية، وعدادات مكررة صفر. لو المستخدم لسه شايف القديم بعد كده يبقى كاش متصفح عنده — تحديث صفحة واحدة هيصلّحها.

---
Task ID: brand-theme-logo (توحيد ألوان التطبيق مع اللوجو)
Agent: Super Z (main)
Task: user: «make the color theme match the logo» — التطبيق كله أخضر/عنبري واللوجو كحلي/أزرق/تركواز.

Work Log:
- ROOT CAUSE: الثيم في globals.css كان سليم (كحلي #0B1B4F · أزرق #2563EB · تركواز #10B981 من اللوجو) لكن applyCenterBranding بيطغى عليه وقت التشغيل بألوان السنتر من الداتابيز — وصفوف المراكز كانت لسه شايلة الافتراضيات القديمة قبل البراند شيت: #0E9F6E أخضر + #0F766E تيل + #F59E0B عنبري (الـ seed اتصلّح في جلسة قديمة لكن الداتابيز الفعلية لأ). اتأكدت بالمتصفح: --c-primary كانت #0E9F6E بعد تسجيل الدخول.
- FIX (٤ طبقات):
  1) src/lib/branding.ts جديدة — وحدة محايدة (من غير "use client") فيها BRAND_DEFAULTS + normalizeCenterBranding: التوليفة القديمة الكاملة (#0E9F6E+#0F766E) بتتعامل كبصمة "مفيش تخصيص" وترجع لهوية اللوجو؛ التخصيص الحقيقي بيفضل.
  2) wire في كل الأسطح: applyCenterBranding (lib.ts بيعيد التصدير من branding.ts عشان الكلاينت القديم)، GET /api/settings (الفورم بيتخزن بالنظيفة فالداتابيز بتتشفى مع أول حفظ)، print.tsx (١٠ مواضع أساسي/ثانوي للكروت والإيصالات وكشوف الحضور).
  3) schema defaults (SQLite + postgres twin): primaryColor #0B1B4F · secondaryColor #2563EB · AcaSubject.color #2563EB + default لون المادة في API الأكاديميا + مثال رسالة الخطأ في الإعدادات. db push ✓.
  4) داتا: scripts/brand_retheme_centers.mjs حدّث النخبة + اختبار القدرات A/B للهوية الرسمية — سنتر الأمل اتسيب (#B45309 تخصيص حقيقي بيوضح ميزة الهوية لكل سنتر). ملف الداتابيز متتبع في جيت فالإنتاج بيتصلح مع الـ deploy تلقائيًا.
- حذر مهم: lib.ts فيها "use client" — استيرادها من route.ts سيرفر كان هيدي client-reference stub بيضرب وقت التشغيل؛ عشان كده الوحدة المحايدة اتعملت أصلاً.
- VERIFY: tsc src صفر أخطاء · eslint نظيف · next build ✓ · 116 ريجريشن أخضر (attendance 45/45 · device-lock 33 · qr-slot 15/15 · anticheat 23/23) · متصفح: بعد الدخول --c-primary #0B1B4F / --c-secondary #2563EB / --c-accent #10B981 / theme-color meta #0B1B4F ✓ · لقطات before/after في download/theme-before-app.png و theme-after-app.png و theme-after-session.png (صفحة الحصة خط الأنابيب على الهوية الجديدة) · حصة الاختبار اللي اتفتحت للتصوير اتلغت بنظافة (سبب محفوظ في السجل).
- commit caf4e77 — اتدفعل لـ Vercel (الإنتاج بياخد ٣-٥ دقايق بناء، وبعدها المتصفح محتاج تحديث صفحة واحدة بس).

Stage Summary:
- التطبيق بقى بلون اللوجو بالظبط: كحلي للهوية والأزرار الأساسية، أزرق للحركة والروابط، تركواز للإبراز — على الشاشة والطباعة والبورتالات والإعدادات. ولو أي سنتر قديم في أي داتابيز لسه شايل الألوان الخضرا، الموحّد بيرجعه للوجو من غير لمسة داتا، والتخصيص الحقيقي محترم.

---
Task ID: zaki-agent (طبقة الوكيل الذكي الكاملة — ALNOKHBA MANAGEMENT)
Agent: Super Z (main)
Task: بناء نظام وكيل ذكي كامل (LLM/Orchestrator/Tools/Permissions/Confirmations/Tasks/Mobile UX) جوه النخبة — مش شات بوت.

Work Log:
- معمارية src/ai/: providers (عقد LLMProvider + zai + openai-compatible + factory من env) · prompts (بروتوكول JSON صارم + كتالوج أدوات متولد من zod v4 toJSONSchema) · context (سياق مُتحقق: دور/سنتر/صفحة/طالب مفتوح) · memory (AgentMemory منظمة) · tools (registry + authorizeAndValidate: schema→permission→capability) · orchestrator (حلقة حقيقية tool⇄observe + self-correction retry + فول باك حتمي بحالة) · tasks (AgentTask/Messages/Executions/Confirmations في Prisma).
- 8 أدوات MVP: student.search/get · group.list/enroll_student · attendance.start_session/get · reports.get_student_report · dashboard.get_today (بيقرا قواعد زكي الحتمية من lib/zaki.ts — مصدر حقيقة واحد). كل أداة: risk + requiredPermission + handler + preview (بدون side effects) + verify (من الداتابيز).
- استخراج sessions-core.ts (تعارضات القاعة/المدرس + حضور المدرس التلقائي) من route الحصص لمكتبة مشتركة — أداة فتح الحصة بتستخدم نفس قواعد الـ API بالظبط. (درس: الاستخراج الأول كان قصّد GET handler + OpenBody → 405 في attendance_modes؛ اترجع ونظف الديف → 45/45 تاني.)
- سياسة التأكيد: LOW=فوري · MEDIUM/HIGH=تأكيد إلزامي. كارت التأكيد من preview() بدون تنفيذ (باج خطير اتصلح: المعاينة كانت بتنفذ!). التنفيذ من صف AgentConfirmation المخزن + إعادة فحص صلاحية + تدقيق.
- UI: AgentDock (موبايل bottom-sheet + fullscreen، ديسكتوب لوحة جانبية RTL) + agent-cards (طالب/طلبة/تقرير/insight/تأكيد/خطأ/خطة/خطوات حية) + درس أول استخدام + مساعدة (٥ أنواع طلبات) + أمثلة + اختصارات سياقية + تلميحات + مهام تاريخية + مايك (SpeechRecognition ar-EG) + أوفلاين. زكي = الشخصية، العقل سيرفري. ZakiInsightsPanel اتضمنت جوه الوكيل.
- بروتوكول مقاوم: needInfo camelCase alias · رد فاضي/خطة-من-غير-أداة = خرق بروتوكول → retry بتنبيه → فول باك · closing message مضمون من آخر أداة متحققة (ممنوع سكوت) · خيارات سؤال التوضيح بتوصل للـ UI كأزرار قابلة للضغط.
- VERIFY: e2e_agent.sh = 22/22 (×3): قراءة تلقائية · توضيح → تأكيد → تنفيذ → تحقق DB · رفض لا ينفذ · تكرار «مسجل أصلاً» · حقن DROP TABLE محجوب · مدرس متحجب بالصلاحية · إنجليزي · تاريخ + تدقيق. ريجريشن النظام كله 116 أخضر (attendance 45 · device-lock 33 · qr-slot 15 · anticheat 23). tsc/eslint/build ✓. متصفح: موبايل 390 (درس/أمثلة/حالات/كارت تأكيد/نجاح + قيد التدقيق في DB) وديسكتوب (لوحة + تاريخ). لقطات: download/agent-*.png.
- حذار مأخوذ: lib.ts فيها "use client" فالـ API server بيسعد من src/lib/branding.ts المحايدة (قبل كده) — نفس المبدأ اتطبق هنا: src/ai كلها server-only والـ SDK جوه providers بس.
- commit (التالي) + push → الإنتاج.

Stage Summary:
- النخبة بقت فيها وكيل ذكي حقيقي: بيفهم عربي مصري وإنجليزي، بيخطط بصوت آمن، بينفذ بأدوات مسجلة بصلاحيات سنتر وصلاحيات الحساب، بيطلب تأكيد للحساس، بيتحقق من الداتابيز بعد التنفيذ، بيسجل كل حاجة، وشكله زكي على الموبايل والديسكتوب. الموديل قابل للاستبدال من env من غير لمس الأدوات، ولو مفيش موديل الفول باك الحتمي بيشتغل بنفس الأمان.

---
Task ID: zaki-agent-fix (الوكيل في الإنتاج + الصوت + مخ أذكى)
Agent: Super Z (main)
Task: "fix it and also the voice in it isn't working, make sure all works (and make the agent smarter)" — سكرينشوت من الإنتاج: كارت «Cannot read properties of undefined (reading 'create')» على سؤال «من هنحضرش النهاردة؟» في لوحة زكي.

Work Log:
- ROOT CAUSE (الإنتاج): prisma/schema.postgres.prisma اتعمل قبل إضافة موديلات الوكيل → الكلينت المنشور مكانش فيه AgentTask/AgentMessage/AgentToolExecution/AgentConfirmation/AgentMemory → db.agentTask.create بيرمي TypeError خام. نفس نمط Task O/P (schema drift).
- FIX 1: build_postgres_schema.py أعاد توليد السكيما (+5 جداول +3 أعمدة Center للعقل الذكي agentLlmBaseUrl/Model/ApiKey في السكيمتين) + db push محلي. build-time db push فشل فوق الـ pooler زي Task P → TEMP manager-only POST /api/admin/schema-sync بـ 23 statement DDL إضافي hardcoded (مفيش SQL من الطلب) autocommit واحد-بواحد → 23/23 ✅ → الـ endpoint اتشال واتأكدت 404 (commit de69423 → 74996ef).
- FIX 2 (الصوت — agent.tsx): مايك كان صامت عند أي فشل → دلوقتي: onerror بيكود الخطأ → رسالة عربية واضحة لكل حالة (not-allowed/audio-capture/network/language) + start() في try/catch + نتايج فورية (interimResults) بتظهر في الخانة + إرسال تلقائي لما التسجيل يخلص طبيعي (الضغطة التانية = وقف يدوي بيسيب النص) + hasVoice/hasTts بحالة بعد التركيب (تفادي SSR mismatch).
- FIX 3 (الرد الصوتي): زكي بيتكلم — speechSynthesis بصوت عربي لو متاح، بيقري آخر رسالة (نتيجة نهائية أو سؤال) بس من غير ترديد الخطوات، زرار سماعة في الهيدر (مفتوح افتراضيًا + كتم محفوظ nk-agent-tts)، وسكات تلقائي لما المستخدم يبعت أو يسمع.
- SMARTER A (ترتيب العقول): المخ الحتمي بقى الأول — fallbackPlan يشتغل فورًا للنوايا المعروفة (سريع/ثابت/مجاني/بدون 429) والموديل الذكي للصيغ المفتوحة اللي المخ ميعرفهاش، وfallbackUnknown آخر حاجة. provider label: brain|llm|fallback في التدقيق.
- SMARTER B (مخ أكبر): نوايا جديدة: «من هنحضرش/مش حاضر/مجاش النهاردة» · «مين غاب أكتر من N مرات» (فوق absent_today عشان ميتلخبطش) · «كام حصة النهاردة» · «حضور مجموعة X إزاي» (pipeline قائمة→نسبة) · «مين مستواه نازل/محتاج متابعة» · «التحصيل» · تحيات/شكر/مساعدة · متابعة بحث بالاسم بعد نتايج بحث · كود طالب مباشر → student.get. تطبيع عربي (همزات/تاء مربوطة/تشكيل) — \b مش بيشتغل مع العربي فاتصلح بـ(\s|$). اختيارات المستخدم («رياضيات — Group B» / «أحمد (99002)») بتكمل نفس المهمة عبر goal + pickStudent/pickGroup. حماية لوب: كل نية لو ملاحظتها موجودة تقفل بالملخص/الخطأ (doneWith) بدل التكرار؛ ملاحظات الأخطاء بتقفل بالخطأ الحقيقي مش «مفيش مطابقة».
- SMARTER C (كتالوج + بروتوكول): argsSummary بيورّي قيم الـ enum — كان سبب فشل الموديل في attendance.get (كان بيخمّن mode) + رسائل validation بتفصّل المشكلة للموديل + سياق الطالب المفتوح دخل رسالة المستخدم بالـ id + مثال few-shot للضمائر في الـ system prompt + لوج تشخيصي سيرفري لردود الموديل الفاشلة.
- SMARTER D (العقل الذكي في الإعدادات): تاب «زكي — العقل الذكي» (مدير بس): Base URL + Model + API Key (سيرفري بس، GET بيرجع الذيل ••••، المقنّع في التدقيق) + زرار «جرب الاتصال» (POST /api/agent/llm-test برسايل أخطاء عربية لكل حالة 401/404/429/timeout/fetch) + getLLM(centerId) بالأولوية env → center (TTL 30s + resetLLMCache عند الحفظ) → ZAI → fallback.
- حماية: runAgentMessage كله في try/catch — أخطاء الداتابيز بتوصل برسالة عربية مفهومة والتفاصيل في اللوج (مفيش أخطاء إنجليزي خام تاني).
- VERIFY: e2e_agent.sh مولّع بـ 14 فحص جديد (6b-6i) = 43/43 (×2 بعد استقرار — الفشل اللي في النص كان rate-limit الـ auth شغال زي ما هو مصمم) · ريجريشن كامل: attendance 45 + device-lock 33 + qr-slot 15 + anticheat 23 = 116/116 · tsc/eslint/build ✓ · متصفح: اللوحة + درس + أمثلة + مايك + زرار الصوت + كارت «غايبين النهاردة (13)» على الطلب اللي كان باظ + تاب العقل الذكي بيحفظ ويجرب + موبايل 390 مايك بيرد برسالة الإذن بدل الصمت (لقطات download/agent-ui-*.png).
- PROD E2E: auth 200 · /api/agent/tasks 200 · «من هنحضرش النهاردة؟» → attendance.get → «النهاردة كله تمام — مفيش غايبين.» COMPLETED · «مين غاب أكتر من 3 مرات؟» → COMPLETED · «كام حصة النهاردة؟» → dashboard COMPLETED · settings فيها agentLlm (masked) · schema-sync 404 بعد الإزالة.

Stage Summary:
- زكي بقى شغال فعلًا في الإنتاج: نفس الطلب اللي كان طالع فيه خطأ تقني بقى بيجاوب وينفذ ويتحقق من الداتابيز. الصوت بقى بالاتجاهين — مايك بيفهم ليه بيصمت (رسايل واضحة) وزكي بيرد بصوت قابل للكتم. والمخ بقى أذكى في الحالتين: المخ الحتمي المدمج فهم المصري والإنجليزي ومتابعة الاختيارات وحماية من اللوب، وأي موديل OpenAI-compatible يقدر المدير يوصّله من الإعدادات بدقيقة ويجرب الاتصال قبل الحفظ.

---
Task ID: agent-voice-universal-smart
Agent: main (Super Z)
Task: «still the voice commands doesn't work although i gave it permission (search github for open source models) + arabic pronouncing not available + search open-source models to make the ai smarter + each question shows me (give me the admin account)»

Work Log:
- بحث (web_search): STT مفتوح = Vosk/Whisper · TTS عربي مفتوح = Coqui/MMS/Piper · LLM عربي مفتوح = Qwen3/Llama 3.3/ALLaM/Jais/Falcon-H1-Arabic — القرار: الأساس سيرفري (z-ai SDK ASR/TTS/LLM) لأنه شغال على كل المتصفحات، والموديلات المفتوحة تتوصل من إعدادات العقل (OpenAI-compatible) — التوثيق اتضاف في شاشة الإعدادات.
- اختبار قدرات SDK سكريبتات محفوظة: test_arabic_voice.ts + test_asr_formats.ts → TTS عربي wav ✓ (mp3 unsupported 400) · ASR يقبل WAV+WebM ويرفض MP4/Safari · LLM بيرد مصري طبيعي.
- صوت دخول سيرفري (الحل الجذري لـ«بيسمح للمايك ومش شغال»): src/components/nokhba/voice-recorder.ts — getUserMedia+AudioContext→PCM→downsample 16k→WAV base64 (شغال على كل المتصفحات بدون SpeechRecognition) + /api/agent/transcribe (auth+rateLimit+حدود حجم+رسايل عربية) → النص يدخل الشات ويتبعت تلقائي. Web Speech بقى فول باك بس. وقف تلقائي لما المستخدم يسكت ~1.8s (onLevel silence detection) + ضغطة تانية = إرسال فوري.
- رد صوتي عربي سيرفري (حل «النطق العربي مش موجود»): /api/agent/speak — zai.audio.tts (voice tongtong, wav) + كاش LRU (24 مدخل، X-Speak-Cache hit/miss) + قص آمن عند آخر جملة (900 حرف) · العميل: fetch→Audio element مع فول باك لصوت المتصفح العربي لو السيرفر فشل.
- أمن: «give me the admin account»/«اعطني حساب الأدمن»/«هاتلي الباسورد» → رفض صريح من المخ الحتمي (كشف حساب مستثنى عشان ميتلخبطش مع المحاسبة) + قاعدة جديدة في system prompt: ممنوع تسليم أي بيانات دخول نهائيًا.
- ذكاء: المخ الحتمي الأول (فوري) والموديل (GLM مدمج أو أي OpenAI-compatible من الإعدادات: OpenRouter/Groq/Ollama) للصيغ المفتوحة — إعدادات شاشة العقل بتعرض الموديلات المفتوحة العربية الموصى بها.
- اختبارات: e2e_agent_voice.sh جديد (login+speak wav valid+cache hit+transcribe roundtrip+رفض أمني بالعربي والإنجليزي+غايبين+LLM مفتوح) · e2e_agent 43/43 · attendance 45/45 · device-lock 33/33 · qr-slot 15/15 · anticheat 23/23 (مجموع 159 أخضر؛ فشل نص الطريق كان rate-limit مش بگ — التانية نظيفة) · tsc 0 · eslint نظيف · build ✓ · متصفح: المايك ظاهر دايمًا، إذن مرفوض برسالة عربية واضحة (مش صمت)، «مين غايب النهارده؟» جاب كارت 13 غايب (لقطات download/zaki_*.png).

Stage Summary:
- صوت زكي بقى سيرفري بالاتجاهين: التسجيل WAV من كل المتصفح → تعرف سيرفري، والرد الصوتي عربي طبيعي من السيرفر — كده مستحيل يبوظ بسبب متصفح/جهاز مفيش فيه دعم عربي، والإذن المسموح بيتحول لصوت شغال فعلًا. طلبات كلمات السر بتترفض أمنيًا في كل المسارات (مخ حتمي + برومبت الموديل). والموديلات المفتوحة الأقوى في العربي (Qwen3/Llama 3.3/ALLaM/Jais) documented جاهزة للوصل من الإعدادات في دقيقة. commit 9cc0645 + دفعة origin (74996ef..9cc0645) — Vercel هيعمل deploy تلقائي.

---
Task ID: zaki-rebuild-patch
Agent: Super Z (main)
Task: user uploaded zaki-rebuild.patch — "see how can you benefit from this to upgrade and fix zaki". باتش خارجي (LLM-first routing + كتالوج لكل مستخدم + أدوات جدول/تحصيل + JSON mode + unmapped logging).

Work Log:
- فحص الباتش قبل التطبيق: git apply --check ✓ — وكل المتطلبات الدلالية اتأكدت: hasPermission/requiredCapability/ToolContext في types+registry · getCenterCapabilities+capabilityBool · usage tokens في LLMGenerateResult · StudentTransaction (PAYMENT/piastres) · SessionInstance→group→subject/teacher · todayStr في lib/normalize · مفيش متصلين خارجيين لـ buildSystemPrompt.
- ROOT CAUSE اللي الباتش بيحلها: المخ الحتمي كان أول واحد دايمًا — فالموديل الذكي (بعد ما المدير يوصله من الإعدادات) كان بيشوف بس الصيغ اللي الريجكس مش فاهمها، فالترقية «الموديلات المفتوحة» كانت مش هتحس بيها. الباتش قلب الترتيب: الموديل أول للطلبات المفتوحة (>6 كلمات)، والمخ للردود الجاهزة (تحية/شكر/رفض أمني)/متابعة وسط مهمة/طلبات قصيرة، وبيرجع للأول بـ NK_AGENT_BRAIN_FIRST=1.
- تحسين فوق الباتش (ثغرة ميت): مهمة بدأها الموديل ووقع الموديل (شبكة/اتشال) كانت بتخلص fallbackUnknown فورًا حتى لو المخ يعرف الطلب — اتصلحت: brainPlan بيتحسب دايمًا وبيبقى شبكة أمان تحت الموديل (حماية اللوب بالـ observations بتقفل النية المكررة بالملخص مش بإعادة تنفيذ).
- إصلاح مالي: finance.get_collection كان Math.round(piastres/100) — في المجاميع بيضيع قروش (150.50→151). بقى يعرض .toFixed(2) بس لما فيه قروش.
- ربط المخ بالأدوات الجديدة (الباتش ضاف الأدوات بس المخ مكان يعرفها): «عندنا إيه بكرة؟» → schedule.get_day بتاريخ بكرة (todayStr+24h بتوقيت القاهرة) · «حصّلنا كام النهارده؟» → finance.get_collection — مع توسيع regex التحصيل للصيغة المصرية «حصلنا كام» (كانت مش بتتشال) + تحديث رسايل المساعدة والبدائل.
- speak: 429 من خدمة الصوت بيرجع 429+Retry-After بدل 502 (العميل يرجع لصوت المتصفح بهدوء ويجرب بعدين).
- voice e2e: بيتعطل لو فيكستشور arabic_tts_test.wav مش موجود (ملف مولّد مش ملتزم) — بقى self-healing بيستخدم مخرج الـ TTS من الخطوة 2.
- VERIFY: tsc 0 · eslint نظيف · build ✓ · e2e_agent 43/43 (مرتين) · attendance 45 · device-lock 33 · qr-slot 15 · anticheat 23 = 159 أخضر (الدروس: متباعدتش السويتات أقل من 65 ثانية → rate-limit المصمم بيضرب، التانية نظيفة) · متصفح: «عندنا إيه بكرة؟» رد بالمواعيد + «حصّلنا كام؟» جاب كارت تحصيل برقم من الداتابيز (لقطات download/zaki_schedule_tomorrow.png و zaki_collection.png).
- TTS الخارجي كان بيرجع 429 طول الجلسة (ضغط على الخدمة) — السلوك سليم: العميل بيرجع لصوت المتصفح العربي، والـ route بيرجع 429 واضح.
- commit d005e29 → push (9cc0645..d005e29) — Vercel هيعمل deploy.

Stage Summary:
- زكي بقى فعلاً «يستاهل موديل»: لما المدير يوصل أي موديل OpenAI-compatible (Qwen3/Llama 3.3/ALLaM/Jais من OpenRouter/Groq/Ollama) الطلبات المفتوحة بتروح له أول بأول، والمخ الحتمي بقى حارس أمان مش حاجز. الأدوات اتوسعت للجدول والتحصيل بأرقام حقيقية من الداتابيز، وكل طلب مش مفهوم بيتلوج بعلم unmapped عشان نعرف نجيب نوايا جديدة بإحصاء مش بتخمين. البروتوكول بقى JSON صارم مع تراجع آمن للسيرفرات القديمة.

---
Task ID: zaki-llm-package-integration
Agent: Super Z (main)
Task: user uploaded zaki-llm-package.zip (providers من برانش zaki-rebuild) — "how would this file help you improve zaki? and do you need something else to put the free api providers to make it fully functional"

Work Log:
- فحص المحتوى: providers من برانش zaki-rebuild — llm-provider/openai-compatible/zai-provider **متطابقين مع عندنا** (الباتش السابق كان مغطيهم) · الجديد فعليًا: anthropic-provider + failover-provider + index.ts محدّث (AGENT_LLM_FALLBACK_*) + ENV.example (وصفة المجانية: Groq gpt-oss-120b أساسي + NVIDIA nemotron احتياطي) + README_FOR_AGENT.
- المراجعة قبل الدمج: failover = أول يرد يكسب مع تسجيل مين جاوب فعلًا · anthropic = Messages API بدون SDK مع system منفصل ودمج الأدوار المتتالية (شرط Anthropic) · index.ts الجديد بيحافظ 1:1 على منطق السنتر + الكاش + ZAI builtin — drop-in آمن.
- دمج: النسخ الثلاثة اتعملت cp للمسارات الرسمية. الفرق الوحيد في resolveLLM: الخطوة 1 (env) بتبني بـ providerFromEnv(prefix) بيدعم PROVIDER=anthropic|openai-compatible + سلسلة FailoverProvider لو AGENT_LLM_FALLBACK_* موجود.
- ثغرة من الـ README اتقفلت فورًا: maxTokens 1200 في runner كانت هتقطع ردود موديلات الـ reasoning (gpt-oss بتحرق output tokens في تفكير داخلي قبل الـ JSON) → 2000 مع تعليق.
- /api/agent/status اتعملت (كانت مذكورة في README كخطوة تحقق بس مش موجودة): manager-only، getLLMStatus (المصدر+الموديل) + brainFirst + groupBy على agentTask لآخر 7 أيام لتوزيع llm/brain/fallback — بدون أي مفتاح.
- درس تقني: smoke test لملفات server-only في plain node بيفشل (الپاكدج بيرمي في الـ index entry) — الحل npx tsx --conditions react-server · ودرس تاني: مسار tsconfig alias لـ server-only كان هيكسر حماية السيرفر/الكلاينت في البيلد كله — اتشال واتركب الپاكدج الرسمي devDependency بدل التلاعب بالـ alias.
- smoke test محفوظ (scripts/test_providers_smoke.ts): 9 فحص — أول يكسب · احتياطي ياخد مكانه · الكل فاشل يرمي آخر خطأ · سلسلة فاضية مرفوضة · تحويل Anthropic (system/دمج/ترتيب/حقن user) · isAvailable للسلسلة. كله أخضر.
- VERIFY: tsc 0 · eslint · build ✓ · e2e_agent 43/43 (الرنة الأولى فيها 3 فشل كان rate-limit من اختبار الـ status قبلها — التانية نظيفة) · status حي: builtin glm-4.6 · brainFirst=false · split 7 أيام: 79 llm / 43 brain / 5 fallback.
- إيه اللي ناقص للتفعيل الكامل (سؤال المستخدم): المفاتيح الحقيقية فقط — الكود جاهز للـ env والـ settings tab. Groq (مجاني، console.groq.com) + NVIDIA (مجاني، build.nvidia.com) → Vercel env vars (Production+Preview) → redeploy → التحقق من /api/agent/status أو زرار جرب الاتصال. من غير مفاتيح: زكي شغال عادي بالـ builtin.
- commit caa315c → push.

Stage Summary:
- طبقة المزودين بقت صناديق: أي موديل OpenAI-compatible أو Anthropic من البيئة أو من إعدادات السنتر، مع failover تلقائي أساسي→احتياطي، وstatus endpoint بيوريك مين شغال فعليًا وبأي عدد مهمات. الوصفة المجانية جاهزة في ENV.example — ناقص بس المفاتيح من صاحب الحساب، ولو مفيش مفاتيخ زكي بيفضل شغال بالمدمج والمخ الحتمي.

---
Task ID: zaki-groq-live
Agent: Super Z (main)
Task: user provided Groq API key — "make zaki work and apply all you need" (توصيل المفتاح الحقيقي اللي كان ناقص من zaki-llm-package)

Work Log:
- تشخيص أولي: المفتاح من الساندبوكس بيرجع 403 Forbidden عري على كل الموديلات — السبب جهوي مش المفتاح: الـ egress بتاعنا HK (8.212.10.159) وGroq بتحظر المنطقة دي (المفتاح الغلط بيرجع 401 مش 403). OpenRouter متاح من هنا (200) كمرجع.
- المسار الصح: المفتاح اتخزن في إعدادات السنتر على الإنتاج (PATCH /api/settings بـ agentLlmBaseUrl/Model/ApiKey — بيتخزن سيرفري والقراءة مقنّعة keyTail فقط) لأن مفيش Vercel CLI هنا لتظبيط env vars، والإنتاج بيرجع لـ center config لو env فاضي.
- فشل أول من llm-test على الإنتاج: llm-empty-response مش 401/403 — الطلب وصل Groq فعلًا لكن gpt-oss-120b موديل reasoning بيحرق الـ maxTokens=20 بتوعة الاختبار كلها في تفكير داخلي قبل ما يكتب حرف. (404 على llama-3.1-8b-instant وllama-3.3-70b-versatile — اتشالوا من Groq في 2026؛ وصفة ENV.example الصح: gpt-oss-120b).
- FIX: llm-test maxTokens 20→512 + رسالة عربية واضحة لحالة llm-empty-response. (الـ runner كان مظبوط من قبل بـ 2000 للسبب ده بالظبط.)
- VERIFY محلي: tsc 0 · eslint نظيف · build ✓ · e2e_agent 43/43 (رنتين فاشلين كانوا rate-limit الـ auth — سويتشات أقل من 65 ثانية).
- VERIFY إنتاج بعد النشر (e9ad949): llm-test بالمفتاح المخزن ✓ GROQ LIVE — model=openai/gpt-oss-120b latency=515ms sample="تمام" · status: source=center · طلب مفتوح حقيقي («ملخص وضع السنتر واقتراح أحسنها») مشى كامل بالموديل: task → اختار dashboard.get_today بنفسه → observation → ملخص مصري بأرقام حقيقية (10 حصص مفتوحة من أيام سابقة + تحصيل أسبوعي تحت المتوسط + طالبين رصيدهم واطي) → COMPLETED · split 7 أيام يسجل openai-compatible:openai/gpt-oss-120b = 1.
- سكريبتات محفوظة: scripts/configure_groq_prod.sh (إعداد+تحقق إنتاج كامل) · test_groq_smoke.mjs / test_groq_direct.mjs (تشخيص المفتاح/الموديلات).

Stage Summary:
- زكي شغال فعليًا بعقل Groq المجاني (gpt-oss-120b) على الإنتاج: المفتاح في إعدادات السنتر (مقنّع)، الطلبات المفتوحة بتروح للموديل أول بأول، والمخ الحتمي شبكة أمان تحته. لو حابب بدّل الموديل: الإعدادات → زكي — العقل الذكي. بديل الـ env على Vercel (AGENT_LLM_*) بيتقدم على إعداد السنتر لو اتظبط يومًا. 429 من الطبقة المجانية بيسقط تلقائي على المخ من غير ما يبوظ تجربة المستخدم.

---
Task ID: zaki-full-agent
Agent: Super Z (main)
Task: user: «خليه يقبل أي كلام يبقى LLM كامل ويعمل functions مختلفة زي فتح حصص ومجموعات (agent كامل)» — توسيع أدوات الوكيل من 10 (7 قراءة) لـ 15 (5 كتابة إدارية حقيقية).

Work Log:
- قراءة قواعد الـ API الرسمي كلها قبل الكتابة: POST /api/students (حد 10k، تليفون مصري، كود أوتوماتيك، tx+تسجيل مجموعات) · academics type=group (مرحلة/مادة موجودة، سعر ≤2000ج، نسبة 0-100) · payments (RECORD_PAYMENT، إيصال RC متسلسل، إشعار بورتال best-effort) · students [id] PATCH — والأدوات الجديدة بتعيد نفس الفحوص بالظبط.
- ٥ أدوات جديدة في src/ai/tools/: group.create (HIGH، مدير بس، مطابقة مرنة بالأسماء + اسم قسم A/B/C أوتوماتيك) · group.update (MEDIUM، سعر/مدرس/نسبة/قاعة/تفعيل) · student.create (HIGH، ADD_STUDENT، undo) · student.update (MEDIUM، إيقاف محتاج ARCHIVE_STUDENT) · finance.record_payment (HIGH، RECORD_PAYMENT، PAYMENT بس — الاسترداد عمدًا بره الوكيل).
- مطابقة مرنة بالأسماء مش بالـ id: resolveGroupFlexible/resolveGrade/resolveSubject/resolveTeacher بنORM عربي — الـ LLM يكتب «فيزياء للصف الثاني الثانوي» وده اللي بيحلها، والتعادل بيرجع خطأ بالخيارات.
- schedule.get_day بيتوسع: بيضم سلوتات الجدول الأسبوعي (slotId/مواعيد/مدرس/عدد) جنب الحصص المتفتحة — «عندنا إيه بكرة؟» بقى بيجاوب بالجدول الفعلي مش بالحصص المفتوحة بس.
- المخ الحتمي: RE.enroll اتضبط («سجل دفعة» مبقاش بيلقطها) · pipeline دفعات كامل (كود ← student.get ← مبلغ ← تأكيد، أو اسم ← بحث) · pipeline فتح حصة حقيقي مكان الرد القديم «مش متاح» (جدول ← اختيار بسلوت وحيد/سؤال بخيارات ← تأكيد) · إنشاءات (طالب جديد/مجموعة جديدة) بترجع null عشان الموديل يشارها أول بأول (بيجمع التليفونات والسعر أحسن) — ولو مفيش موديل fallbackUnknown صادق.
- درس: تنضيف سلوتات الاختبار جوه dbq بسلاسل `;` جوه await واحد = syntax error صامت → سلوتات متراكمة خلت المطابقة متعادلة («أنهي حصة؟») — الاتنين اتصلحوا: تنضيف سليم + الاختيار التلقائي بياخد الأعلى لوحده لو وحيد.
- درس تاني: طلب دفعة >6 كلمات كان بيروح للموديل الأول و ZAI builtin وقع مرة — الاختبار بقى ٦ كلمات بالكود («سجل دفعة 25 جنيه لـ 10001») عشان المسار الحتمي يتحدد.
- VERIFY: tsc 0 · eslint (أخطاء الـ 3 في ملفات UI قديمة مش مني) · build ✓ · e2e_agent 43→60 كلها خضرا (دفعة: بحث/كود ← تأكيد ← رصيد +2500 قرش + إيصال RC + تنفيذ متحقق · فتح حصة: جدول ← تأكيد ← OPEN في DB ← تنضيف) · ريجريشن: attendance 45 + device-lock 33 + qr 15 + anticheat 23 = 176 أخضر.
- متصفح حي: «اعمل مجموعة تجربة زكي فيزياء للصف الثاني الثانوي بسعر 55» ← كارت تأكيد HIGH بالمعاينة (المادة/المرحلة محلولين) ← تنفيذ ← «تم إنشاء… للتسجيل الآن» · «سجل دفعة 25 جنيه لـ 10001» ← RC-000004 + رصيد 350 ج عليه · «افتح حصة رياضيات» ← اختار السلوت الوحيد ← «حصة رياضيات — B بقت مفتوحة + المدرس اتسجل حاضر تلقائيًا» — لقطات: download/zaki_create_group_confirm.png · zaki_payment_confirm.png · zaki_open_session_confirm.png · zaki_open_session_state.png. تنظيف: مجموعة التجربة + سلوت/حصة الاختبار اتمسحوا.
- commit abac0fd → push → Vercel deploy (الإنتاج عليه Groq gpt-oss-120b — هيكون أذكى من تجربة الـ builtin المحلية).

Stage Summary:
- زكي بقى وكيل إدارة كامل: بيفهم أي كلام (موديل Groq شغال على الإنتاج) وبيعمل العمليات الإدارية الحقيقية — فتح حصص من الجدول، إنشاء وتعديل مجموعات، إضافة وتعديل طلبة، تسجيل دفعات بإيصالات رسمية — كلها بنفس قواعد الـ API الرسمي: schema + صلاحية + قدرة سنتر قبل أي تنفيذ، معاينة بدون side effects، تأكيد إلزامي للحساس، verify من الداتابيز بعد التنفيذ، وتدقيق كامل. المخ الحتمي فضل شبكة أمان مجانية للصيغ القصيرة والموديل بيشار في الصيغ المفتوحة والمعقدة.

---
Task ID: zaki-teacher-complete
Agent: Super Z (main)
Task: user: «هو دلوقتي أحسن، لكن عايزك تخليه يقدر يعمل أي مهمة في النظام كأنه بالظبط مدرس، يعني يسجل حضور بمجرد الاسم و كده (يكون ذكي و يحاول يفهم قصد المتحدث) و هكذا»

Work Log:
- قراءة القواعد الرسمية كلها قبل الكتابة: POST /api/attendance/mark (single+bulk/تحضير معكوس، تحميل داخل transaction، EXCUSED مجاني، بوابات name_attendance/late_checkin، أحداث موحدة، إشعارات) + POST /api/sessions/[id] close (تجميعات + settlement + center txns) — والأدوات الجديدة بتعيد نفس الفحوص بالظبط.
- attendance.mark_names (MEDIUM): حضور بالأسماء الحرّة — marks فردية بحالتها + namesText نص حر بيتجزّع بنوافذ متتالية (4→1) ضد كشف الحصة + markRest/except للتحضير المعكوس — الحصة بتتحل بالاسم أو لو مفتوحة واحدة تلقائيًا؛ الأسماء الغريبة/المتعادلة بترجع خطأ بعرض الكشف (ممنوع تخمين)؛ no-op صادق لو الحالة مطابقة (idempotent زي الرسمي)؛ تحميل لكل طالب بـ priceOverride؛ تدقيق + إشعارات بحالة كل طالب.
- attendance.close_session (MEDIUM): «اقفل الحصة» بنفس مسار الـ API الرسمي — sessionEconomics + settlement EARNED + حركات مركز (SESSION_REVENUE/TEACHER_SHARE) — والحضور المفتوح بيتقفل من غير حسابات.
- مطابقة الأسماء (دروس مهمة): (1) التقسيم المفرد بيكسر الأسماء المركبة → نوافذ متتالية: تطابق تام ← احتواء باتجاه واحد (الجزء المكتوب ⊆ اسم الكشف — «مريم عادل» ⊆ «مريم عادل رشاد»)، والاتجاه العكسي بيبلع الأسماء اللي جنب بعض (w=4 التهمت نورهان+مريم) — اتشال؛ (2) «و» الملتصقة بتتقسم لو الكلمة ≥4 حروف (ومحمد←محمد، وحيد متتقطعش)؛ (3) pass2 مرن للاسم الأول.
- المخ الحتمي: RE.markAttendance + RE.closeSession — pipeline حضور (حصة ← أسماء ← تأكيد) بيصلح سوء توجيه قديم («سجل حضور أحمد» كان بيتحول لبحث طالب!) + pipeline اقفل الحصة + حماية لوب: إعادة المحاولة بس لو الرد اختيار/تصحيح (مش تكرار نفس الصيغة — التكرار كان بيعيد نفس الغلطة 8 مرات = max_iterations)؛ extractExceptNames بيشيل جزء الغايبين من نص الأسماء + الـ dash «—» في char class.
- برموت النظام: قاعدة نية الحضور (حاضر/متأخر/بعذر/الغايبين→markRest+except؛ حصة واحدة مفتوحة = كمّل من غير سؤال؛ الأسماء غير المطابقة تتعرض وتتسأل).
- VERIFY محلي: tsc 0 · eslint نظيف · build ✓ · e2e_agent 60→77 خضرا (6l حضور بالأسماء بالتحميل في الداتابيز · 6m تحضير معكوس: التالت اتسجل والمستثنى فضل غايب ومفيش تكرار · 6n قفل بالتجميعات) · ريجريشن: attendance 45 + device-lock + qr 15 + anticheat 23 كلها خضرا.
- متصفح حي (لقطات download/zaki_*.png): «افتح حصة كيمياء» → تأكيد → حصة مفتوحة + المدرس حاضر تلقائيًا · «سجل حضور نورهان سامي ومريم عادل» → كارت بالأسماء محلولة والتحميل 120ج → تنفيذ → «سجلت حضور 2» · «الغايبين يوسف وزياد — سجل الباقي» → 9 حاضر والاتنين غايبين · «اقفل الحصة» → «11 حاضر · إيراد 660 ج · نصيب المدرس 429 ج» → CLOSED في الداتابيز + settlement واحد + تحميلات -66000قرش.
- مشاكل بيئة الاختبار اتحلت: حصص يتيمة 05:00/حقيقية 20:00 من رنات قديمة كانت بتتعارض في حلّ الحصة → تنظيف مسبق شامل لمجموعة الاختبار · حد المعدل (20/دقيقة) بيحسب الطلبات المرفوضة → تبخيد 4ث + إعادة محاولة في e2e agent() · dev server اتعاد بـ NK_AGENT_BRAIN_FIRST=1 للاختبارات الحتمية (الموديل المدمج 429 متقطع كان بيخطف الطلبات >6 كلمات).
- commit fa7a9e5 → push → Vercel deploy (الإنتاج عليه Groq gpt-oss-120b هيستفيد من كل ده فورًا).

Stage Summary:
- زكي بقى مدرس كامل فعليًا: بيفهم أي صيغة حضور بالمصري («سجل حضور فلان وعلان» / «الغايبين كذا سجل الباقي» / «فلان متأخر وفلان بعذر») وينفذ زي المدرس بالظبط — حل الأسماء ضد الكشف بنفسه، يعرض تأكيد بالتحميل المتوقع، ينفذ بقواعد الـ API الرسمي، ويتحقق من الداتابيز. ودورة الحياة كاملة: فتح حصة → حضور → قفل بحسابات الإيراد والمدرس. المخ الحتمي فضل شبكة أمان مجانية والطلب المفتوح بيروح لموديل Groq.

---
Task ID: zaki-teacher-prod-hardening
Agent: Super Z (main)
Task: تحقق إنتاج حقيقي لميزة الحضور بالأسماء + إصلاح ثلاث ثغرات ظهرت من مخرجات Groq الفعلية

Work Log:
- اختبار إنتاج آمن (صفر كتابة): «سجللي حضور يوسف طارق سعيد في حصة الكيمياء النهاردة وقولي هيتحمل منه كام» — Groq فهم الصيغة المفتوحة → student.search → attendance.mark_names → كارت تأكيد بأرقام حقيقية (كيمياء — A 17:00 · يوسف طارق سعيد حاضر 60ج · 7 غايبين) → إلغاء → «مفيش حاجة اتنفذت» ✓
- إصلاح 1 (ec63b9f): «ال» التعريف كانت بكسر مطابقة الحصة («حصة الكيمياء» ≠ «كيمياء — A») — بتتشال من الفحص كامل النص والتوكنات.
- إصلاح 2 (642137b): Groq بيبعت marks: ["اسم"] نصوص بدل كائنات — الـ schema بقت union (نص = حاضر / {name, status}).
- إصلاح 3 (a9d5133): Groq سكب جملة الطلب كلها في namesText — شبكة NAME_STOP (كلمات زخرفية normalized) بتتفلتر قبل المطابقة + وصف namesText بقى «أسماء الطلبة بس».
- سلوك الموديل متغير بين الرنات (سأل «نعم/لا» مرة، نادى الأداة مباشرة مرة) — الأداة والحلقة ثابتين: كل الصيغ بتنتهي تأكيد حقيقي أو خطأ صادق بالخيارات.
- VERIFY: tsc 0 · build ✓ · e2e_agent 77/77 (×3 مرات بعد كل إصلاح) · status: Groq gpt-oss-120b شغال على الإنتاج.

Stage Summary:
- ميزة الحضور بالأسماء متحققة على الإنتاج بموديل Groq الحقيقي ومن غير أي كتابة على داتا حقيقية: الفهم (أي صيغة) → الحل (كشف الحصة) → التأكيد (بالتحميل المتوقع) → التنفيذ بقواعد الـ API الرسمي → التحقق من الداتابيز. والتقاويم الثلاثة اللي طلعت من مخرجات الموديل الفعلية اتقفلت (ال التعريف / نصوص بدل كائنات / كلمات زخرفية في الأسماء).

---
Task ID: zaki-voice-analytics
Agent: Super Z (main)
Task: تنفيذ مواصفة 13-phase الجديدة — إصلاح الصوت end-to-end (Groq STT + مراجعة النص) + التحليل الحتمي + الاقتراحات الديناميكية + اختبارات أمنية

Work Log:
- AUDIT: الزاكي كان ليه أساس قوي (orchestrator LLM-first + 18 أداة + تأكيدات + تدقيق)، والفجوات: (1) النص الصوتي بيتبعت فورًا من غير مراجعة (spec 8C) (2) مفيش Groq STT — Z.ai ASR بس (3) حالات صوت ناقصة (إذن/مراجعة/429/retry) (4) مفيش أداة تحليل بمقارنات فترات (5) اقتراحات «مش قادر» ثابتة (6) اختبارات صوت/تحليل/أمن ناقصة.
- STT CHAIN (src/ai/providers/stt.ts): Groq /audio/transcriptions (مش translation) بالأولوية — مفتاح env AGENT_STT_API_KEY ← مفتاح العقل المحفوظ للسنتر، endpoint env ← baseUrl السنتر ← api.groq.com، الموديل env AGENT_STT_MODEL ← agentSttModel (حقل جديد في Center) ← whisper-large-v3-turbo الافتراضي، مع prompt تلميح مصطلحات (زكي/النخبة/حضور/فودافون/QR...) ← فشل Groq (403 ريجون/429) → ZAI تلقائيًا — الصوت مبيفشل.
- TRANSCRIBE ROUTE: فحص mime (415) + حجم (413، 8MB) + مدة بالحساب (>90s → 413) + فاضي/صغير (400) + أخطاء عربية مفهومة + rate limit 30/دقيقة + إعلان provider/model في الرد — raw audio مش بيتخزن.
- SCHEMA/SETTINGS: Center.agentSttModel + db push + GET/PATCH /api/settings (masked).
- VOICE UI (agent.tsx): النص المحوّل بيروح مربع الكتابة مع بانر «راجعه وعدّله واضغط إرسال» + زرار إلغاء — مفيش تنفيذ فوري من الصوت (نفس قواعد الأمان للكتابة). حالات جديدة: micStarting (بطلب إذن — الزرار متقفل ضد المسجلين المتوازيين)، placeholder لكل حالة، زرار «سجل تاني» على أخطاء التحويل (ErrorCard retryLabel). فول باك Web Speech كمان بقى يمرّ على المراجعة.
- reports.analyze (src/ai/tools/analytics.ts): تحليل حتمي 100% من داتا السنتر — فترات يوم/أسبوع/شهر vs الفترة اللي قبلها بنفس الطول: حصص بالحالة، حضور/غياب/بعذر، نسبة، أكتر 3 مجموعات غيابًا (≥5 تسجيلات)، تحصيل + تغير% + MTD (بصلاحية مالية)، حصص OPEN من أيام فاتت، طلبة <70% حضور بـ≥5 تسجيلات (آخر 30 يوم) — ملخص + كارت تقرير + كارت insight + إجراءات تنقل. VIEW_REPORTS مطلوبة، فلترة المالية جوه الأداة كمان.
- المخ الحتمي: قاعدة analyze (حلل/قارن/اكتر مجموعه غياب/من اول الشهر/ما اتقفلتش...) بتحدد الفترة من الكلام + guard مش يخطف تقرير طالب بالاسم. fallbackUnknown بقى بيولد اقتراحات من usageHints الأدوات المتاحة فعلًا للحساب (spec Phase 9).
- اختبار direct للأداة (tsx + react-server conditions): 13/13 — أرقام سليمة، حدود مقارنة صحيحة، مدرس من غير صلاحية اتحجب (PERMISSION)، حقن centerId/studentId اتشالوا (zod strip)، مدرس معاه VIEW_REPORTS بس شاف التحليل من غير مالية.
- STT chain live: بمفتاح Groq → groq-stt-403 (بلوك ريجون الساندبوكس) → ZAI fallback سلس في 436ms. TTS→ASR roundtrip: البايبلاين شغال (provider معلن) لكن Z.ai ASR ضعيف على كلام TTS اصطناعي — الجودة الحقيقية مع whisper على الإنتاج.
- إصلاح اختباراتي: أقواس node -e ناقصة في استخراج الملخصات (كانت بترجع فاضي) + mime test بقى @file (argv limit).
- VERIFY كامل: tsc 0 · eslint نظيف · build ✓ · e2e_agent 85/85 (منهم 6c-6e الجداد: تحليل أسبوع/مقارنة شهر/حجب مدرس من غير كروت) · voice 8/8 (فاضي/صغير/تالف/mime/طويل/roundtrip/أمن) · ريجريشن attendance 45 + device-lock + qr 15 + anticheat 23 كلها خضرا.
- commit 0ac6881 → push → Vercel deploy → smoke إنتاج.

Stage Summary:
- الصوت بقى مدخل كامل فعليًا: تسجيل ← Groq whisper (موديل قابل للتهيئة من الإعدادات، المفتاح سيرفري، تلميح مصطلحات) ← النص في مربع الكتابة للمراجعة ← نفس pipeline الكتابة بالظبط (صلاحيات/تأكيد/تحقق). التحليل بقى أداة حقيقية بأرقام من الداتابيز بمقارنات فترات محسوبة حتميًا — الموديل بيشرح مش بيخترع. الطلبات اللي الزاكي مش عارفها بترجع باقتراحات من الأدوات المتاحة فعلًا للحساب.
