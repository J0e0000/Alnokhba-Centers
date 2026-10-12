/* ============================================================
   Unit tests — طبقة تحويل حالة الروبوت (zaki-status.ts)
   تشغيل: npx tsx scripts/test_zaki_robot_state.ts
   كل حالة مؤكدة تقابل حدث حقيقي من الوكيل — ممنوع اختراع حالات.
============================================================ */
import assert from "node:assert/strict";
import { mapZakiRobotState, ZAKI_STATE_AR, ZAKI_STATE_DOT } from "../src/components/zaki/zaki-status";

let pass = 0;
let fail = 0;

function t(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fail++;
    console.error(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const base = {
  agentState: "IDLE",
  running: false,
  listening: false,
  transcribing: false,
  speaking: false,
  celebrate: false,
  fail: false,
};

console.log("— القاعدة المحايدة —");
t("كله هادي → idle", () => {
  assert.equal(mapZakiRobotState({ ...base }), "idle");
});
t("WAITING_CONFIRMATION بدون تشغيل → idle (مش listening — مفيش مايك حقيقي)", () => {
  assert.equal(mapZakiRobotState({ ...base, agentState: "WAITING_CONFIRMATION" }), "idle");
});

console.log("— الصوت الحقيقي —");
t("مايك حقيقي شغال → listening حتى لو الطلب شغال", () => {
  assert.equal(mapZakiRobotState({ ...base, listening: true, running: true, agentState: "EXECUTING" }), "listening");
});
t("TTS بيشتغل فعلًا → speaking", () => {
  assert.equal(mapZakiRobotState({ ...base, speaking: true }), "speaking");
});
t("speaking بتتقدم على success transient (الصوت الجاري أهم من احتفال قديم)", () => {
  assert.equal(mapZakiRobotState({ ...base, speaking: true, celebrate: true }), "speaking");
});

console.log("— الطلب الشغال —");
t("UNDERSTANDING → thinking", () => {
  assert.equal(mapZakiRobotState({ ...base, running: true, agentState: "UNDERSTANDING" }), "thinking");
});
t("ANALYZING → thinking (مش searching — ممنوع عرض البحث من مجرد تفكير)", () => {
  assert.equal(mapZakiRobotState({ ...base, running: true, agentState: "ANALYZING" }), "thinking");
});
t("PLANNING → thinking", () => {
  assert.equal(mapZakiRobotState({ ...base, running: true, agentState: "PLANNING" }), "thinking");
});
t("TRANSCRIBING (تحويل صوت→نص) → thinking", () => {
  assert.equal(mapZakiRobotState({ ...base, running: true, transcribing: true, agentState: "TRANSCRIBING" }), "thinking");
});
t("EXECUTING → working (أداة حقيقية شغالة)", () => {
  assert.equal(mapZakiRobotState({ ...base, running: true, agentState: "EXECUTING" }), "working");
});
t("VERIFYING → working", () => {
  assert.equal(mapZakiRobotState({ ...base, running: true, agentState: "VERIFYING" }), "working");
});
t("حالة سيرفر غير معروفة أثناء التشغيل → thinking (حياد آمن)", () => {
  assert.equal(mapZakiRobotState({ ...base, running: true, agentState: "SOMETHING_NEW" }), "thinking");
});

console.log("— النجاح والفشل المؤكدين (عابرين) —");
t("نجاح مؤكد → happy", () => {
  assert.equal(mapZakiRobotState({ ...base, celebrate: true }), "happy");
});
t("فشل مؤكد → error", () => {
  assert.equal(mapZakiRobotState({ ...base, fail: true }), "error");
});
t("فشل بيتقدم على نجاح (أحدث حدث هو اللي بيظهر)", () => {
  assert.equal(mapZakiRobotState({ ...base, celebrate: true, fail: true }), "error");
});
t("running بيلغي الـ transient (طلب جديد بيدخل فورًا)", () => {
  assert.equal(mapZakiRobotState({ ...base, running: true, agentState: "PLANNING", celebrate: true }), "thinking");
});
t("النجاح مبيظهرش قبل التأكيد — running + EXECUTING = working مش happy", () => {
  assert.equal(mapZakiRobotState({ ...base, running: true, agentState: "EXECUTING", celebrate: true }), "working");
});

console.log("— الحالات الممنوعة صريحًا —");
t("searching عمره ما بيرجع من المحوّل (مفيش حدث بحث سيرفري)", () => {
  for (const s of ["IDLE", "UNDERSTANDING", "ANALYZING", "PLANNING", "EXECUTING", "VERIFYING", "TRANSCRIBING", "WAITING_CONFIRMATION", "COMPLETED", "FAILED"]) {
    assert.notEqual(mapZakiRobotState({ ...base, agentState: s, running: true }), "searching");
    assert.notEqual(mapZakiRobotState({ ...base, agentState: s, running: false }), "searching");
  }
});
t("sleeping عمره ما بيرجع من المحوّل (مفيش workflow خمول)", () => {
  assert.notEqual(mapZakiRobotState({ ...base }), "sleeping");
});

console.log("— جداول العرض —");
t("ZAKI_STATE_AR: كل الحالات التسعة ليها وصف عربي غير فاضي", () => {
  const states = ["idle", "thinking", "searching", "listening", "speaking", "working", "happy", "error", "sleeping"];
  for (const s of states) {
    assert.ok(ZAKI_STATE_AR[s as keyof typeof ZAKI_STATE_AR]?.length > 0, `missing AR label for ${s}`);
  }
});
t("ZAKI_STATE_DOT: كل الحالات ليها لون معرف", () => {
  const states = ["idle", "thinking", "searching", "listening", "speaking", "working", "happy", "error", "sleeping"];
  for (const s of states) {
    assert.ok(/bg-[a-z]+-\d+/.test(ZAKI_STATE_DOT[s as keyof typeof ZAKI_STATE_DOT]), `missing dot for ${s}`);
  }
});

console.log(`\nالنتيجة: ${pass} ناجح / ${fail} فاشل`);
if (fail > 0) process.exit(1);
