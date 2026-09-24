import "server-only";
import { db } from "@/lib/db";
import { toEGP, cleanRaw } from "@/lib/normalize";
import { studentBalance } from "@/lib/finance";
import type { Student } from "@prisma/client";

/* ============================================================
   بناء رسائل واتساب لولي الأمر — مصدر واحد للحقيقة:
   - قالب السنتر (WhatsAppTemplate) لو موجود، وإلا الافتراضي
   - المتغيرات: {student_name} {parent_name} {amount_due} ... إلخ
   - waUrl: تحويل رقم مصري 01x → wa.me دولي + ترميز عربي صحيح
============================================================ */

/** الحد الأدنى من بيانات السنتر اللازمة لبناء الرسائل */
export type MessageCenter = {
  id: string;
  name: string;
  phone: string | null;
  signature: string | null;
};

export function waUrl(phone: string, message: string): string {
  let p = cleanRaw(phone);
  if (p.startsWith("0020")) p = "0" + p.slice(4);
  else if (p.startsWith("+20")) p = "0" + p.slice(3);
  else if (p.startsWith("20") && p.length === 12) p = "0" + p.slice(2);
  if (p.startsWith("0")) p = "2" + p.slice(1); // 01x → 201x
  return `https://wa.me/${p}?text=${encodeURIComponent(message)}`;
}

async function centerTemplate(centerId: string, name: string): Promise<string | null> {
  const t = await db.whatsAppTemplate.findUnique({
    where: { centerId_name: { centerId, name } },
  });
  return t?.body ?? null;
}

function applyVars(raw: string, vars: Record<string, string>): string {
  let message = raw;
  for (const [k, v] of Object.entries(vars)) message = message.split(k).join(v);
  return message;
}

/** رسالة تنبيه رصيد سالب (تُستخدم في notify المفرد وطابور الرسائل) */
export async function buildLowBalanceMessage(center: MessageCenter, student: Student): Promise<string> {
  const t = await centerTemplate(center.id, "تنبيه رصيد");
  const balance = await studentBalance(student.id);
  const due = Math.max(-balance, 0);
  const vars: Record<string, string> = {
    "{student_name}": student.name,
    "{parent_name}": student.parentName ?? "ولي الأمر",
    "{amount_due}": toEGP(due).toLocaleString("en-EG"),
    "{center_name}": center.name,
    "{center_phone}": center.phone ?? "",
    "{student_code}": student.code,
  };
  const raw =
    t ??
    "نود التنبيه بأن المتبقي على {student_name} مبلغ {amount_due} جنيه. نرجو السداد عند أقرب فرصة. شكراً لتعاونكم.";
  let message = applyVars(raw, vars);
  if (center.signature) message += `\n— ${center.signature}`;
  return message;
}

/** رسالة حملة عامة / مجموعة — نص حر من قالب «رسالة عامة» أو الافتراضي */
export async function buildCampaignMessage(opts: {
  center: MessageCenter;
  student: Student;
  templateKey: string;
}): Promise<string> {
  if (opts.templateKey === "low_balance") {
    return buildLowBalanceMessage(opts.center, opts.student);
  }
  const t = await centerTemplate(opts.center.id, "رسالة عامة");
  const vars: Record<string, string> = {
    "{student_name}": opts.student.name,
    "{parent_name}": opts.student.parentName ?? "ولي الأمر",
    "{center_name}": opts.center.name,
    "{center_phone}": opts.center.phone ?? "",
    "{student_code}": opts.student.code,
  };
  const raw = t ?? "تحية طيبة من {center_name} — رسالة لولي أمر الطالب {student_name}.";
  let message = applyVars(raw, vars);
  if (opts.center.signature) message += `\n— ${opts.center.signature}`;
  return message;
}
