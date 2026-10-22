// فحص سريع لـ WA_LINK_RE قبل البناء — نفس الـ regex اللي في academics/route.ts
const WA_LINK_RE =
  /https:\/\/(?:www\.)?(?:chat\.whatsapp\.com\/(?:invite\/)?[A-Za-z0-9_-]+|whatsapp\.com\/channel\/[A-Za-z0-9_.-]+|wa\.me\/\d{6,15})(?:[/?#][^\s]*)?/i;

const accept = [
  ["https://chat.whatsapp.com/AbC123_xZ-9", "https://chat.whatsapp.com/AbC123_xZ-9"],
  ["https://chat.whatsapp.com/Invite123456789?mode=r_t", "https://chat.whatsapp.com/Invite123456789?mode=r_t"],
  ["انضم إلى مجموعة واتساب الخاصة بي: https://chat.whatsapp.com/Invite123456789?mode=r_t", "https://chat.whatsapp.com/Invite123456789?mode=r_t"],
  ["https://chat.whatsapp.com/invite/AbCdEf123456", "https://chat.whatsapp.com/invite/AbCdEf123456"],
  ["HTTPS://WWW.Chat.Whatsapp.COM/AbCdEf123456", "HTTPS://WWW.Chat.Whatsapp.COM/AbCdEf123456"],
  ["https://www.whatsapp.com/channel/0029VaBcD123456", "https://www.whatsapp.com/channel/0029VaBcD123456"],
  ["https://whatsapp.com/channel/0029VaBcD123456", "https://whatsapp.com/channel/0029VaBcD123456"],
  ["https://wa.me/201014996636?text=مرحبا", "https://wa.me/201014996636?text=مرحبا"],
  ["https://wa.me/201014996636", "https://wa.me/201014996636"],
  ["\u200Fانضم: \u200Ehttps://chat.whatsapp.com/AbCdEf123456\u200F", "https://chat.whatsapp.com/AbCdEf123456"],
];

const reject = [
  "javascript:alert(1)",
  "http://chat.whatsapp.com/Abc123",
  "https://evil.example.com/invite",
  "https://chat.whatsapp.com.evil.com/AbCdEf123",
  "لا يوجد لينك هنا",
  "ftp://chat.whatsapp.com/Abc123",
];

let fail = 0;
for (const [input, want] of accept) {
  const got = (String(input).match(WA_LINK_RE) || [null])[0];
  if (got !== want) { console.log(`❌ ACCEPT FAIL\n  in:   ${JSON.stringify(input)}\n  want: ${want}\n  got:  ${got}`); fail++; }
}
for (const input of reject) {
  const got = String(input).match(WA_LINK_RE);
  if (got) { console.log(`❌ REJECT FAIL → قبّل بشكل غلط: ${JSON.stringify(input)} → ${got[0]}`); fail++; }
}
console.log(fail === 0 ? "✅ كل حالات الـ regex سليمة (10 قبول + 6 رفض)" : `❌ ${fail} حالة فاشلة`);
process.exit(fail === 0 ? 0 : 1);
