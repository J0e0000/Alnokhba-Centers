# Device-Locked Attendance — Configuration Values

القيم القابلة للضبط في نظام الحضور العام بقفل الجهاز (`/a/<token>` + `unique(session_id, device_id)`).

| القيمة | الافتراضي | الحدود | المكان | الوظيفة |
|---|---|---|---|---|
| QR rotation interval (slotSeconds) | 10s | 5..60s | قدرة المركز `dynamic_qr.config.slotSeconds` (الإعدادات ← الحضور والpresence) أو `body.slotSeconds` | عمر الكود الواحد على شاشة الحصة — **غير مُثبّت** (spec §3: 5/10/15/20/30/60) |
| QR slot grace (هامش الشبكة) | 4s | ثابت بالكود (`QR_SLOT_GRACE_MS` في `src/lib/session-qr.ts`) | — | الكود يكمل شغال 4ث بعد نزوله من الشاشة للـ claims اللي في الطريق |
| Sighting claim grace (نافذة كتابة الكود) | 90s | ثابت بالكود (`QR_CLAIM_GRACE_MS` في `src/lib/checkin-pv.ts`) — يستبدل بـ env `NOKHBA_PV_SECRET`-independent constant | — | الطالب اللي فتح الصفحة والكود حي يكمل يكتب كوده حتى لو الكود تجدد — بإثبات sighting موقّع (pv) مربوط بالجهاز |
| PV signing secret | `nk-pv-secret-v1` | env `NOKHBA_PV_SECRET` (يُنصح بتعيينه في الإنتاج) | `src/lib/checkin-pv.ts` | توقيع إثبات "شاف الكود وهو حي" |
| Rate limit — check-in | 12/دقيقة لكل (توكن+IP) + 40/دقيقة لكل IP | بالكود | `src/app/api/attendance/public/check-in/route.ts` | الحد من الهجوم بالتكرار |
| Rate limit — peek | 90/دقيقة لكل IP | بالكود | `peek/route.ts` | |
| Risk window | 10 دقايق | `RISK_WINDOW_MS` في `src/lib/attendance-risk.ts` | نافذة تحليل محاولات كشف الإساءة |
| SAME_IP_RAPID_ATTEMPTS threshold | 4 محاولات | `SAME_IP_RAPID_ATTEMPTS` | أكتر من كده من نفس الـ IP لنفس الحصة → علم (مش رفض — IP مش هوية) |
| RAPID_MULTI_STUDENT_ATTEMPTS | 2 كود مختلف | `DEVICE_MULTI_STUDENT_N` | جهاز واحد جرّب كودين مختلفين في النافذة → علم |
| REPEATED_ATTENDANCE_ATTEMPTS | 5 محاولات | `DEVICE_RAPID_THRESHOLD` | محاولات كتير من نفس الجهاز → علم |
| Staff notify score | 40 | `STAFF_NOTIFY_SCORE` | درجة الخطورة اللي بتسجل في السجل المحوّل + تنبيه |
| Device ID cookie | `nk_did` — سنة، SameSite=Lax | `src/lib/device-id.ts` | UUID عشوائي (كوكي + LocalStorage احتياط) — مش PII |
| Session timeout | مفيش auto-close | — | الحصة تفضل OPEN لحد ما الموظف يقفلها (سلوك موجود قبل الميزة) |

## قواعد مصممة لا تُكسر

1. **جهاز واحد = حضور واحد ناجح لكل حصة** — محمي بـ `@@unique([sessionId, deviceId])` على جدول `Attendance` (الحكم النهائي في الداتابيز، مش في الكود).
2. **طالب واحد = حضور واحد لكل حصة** — `@@unique([sessionId, studentId])` (قاعدة موجودة قبل الميزة).
3. إعادة المحاولة/الريفرش/الدبل كليك آمنة — نفس الطالب = نفس الرد `alreadyAttended` بدون صف تاني.
4. السكرين شوت بتاع كود قديم: منتهي → `EXPIRED_TOKEN`؛ متدوّر → `REPLAYED_TOKEN`؛ ولا واحد بيتقبل بدون pv.
5. الـ pv مربوط بـ (qrId + deviceId + لحظة الإصدار وهو حي) — سرقته لجهاز تاني بيترفض، واستخدامه بعد 90ث بيترفض.
6. IP مجرد إشارة خطورة — مش هوية ولا حاجز (طالبة على نفس الواي فاي بيمروا عادي).
7. الرد العام مفيهوش أرصدة/بيانات مالية — صفحة بدون تسجيل دخول.
