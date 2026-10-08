import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { register } from "./registry";
import { ToolError, type ToolOutput } from "./types";
import { validateEgyptianPhone } from "@/lib/normalize";
import { logAudit, AUDIT } from "@/lib/audit";

/* ============================================================
   TOOL: تعديل بيانات تواصل طالب — student.update_contact (MEDIUM → تأكيد)
   حقول محدودة عن قصد: موبايل الطالب/ولي الأمر + اسم ولي الأمر + المدرسة + ملاحظات.
   مفيش تعديل للاسم/الكود/الحالة/الرصيد من الوكيل.
============================================================ */

const Args = z.object({
  studentId: z.string().min(1),
  phone: z.string().optional(),
  parentPhone: z.string().optional(),
  parentName: z.string().max(80).optional(),
  school: z.string().max(80).optional(),
  notes: z.string().max(500).optional(),
});

type A = z.infer<typeof Args>;

function buildPatch(args: A): Record<string, string> {
  const patch: Record<string, string> = {};
  if (args.phone !== undefined) {
    const c = validateEgyptianPhone(args.phone);
    if (!c.ok) throw new ToolError("VALIDATION", c.error);
    patch.phone = c.normalized;
  }
  if (args.parentPhone !== undefined) {
    const c = validateEgyptianPhone(args.parentPhone, true);
    if (!c.ok) throw new ToolError("VALIDATION", c.error);
    patch.parentPhone = c.normalized;
  }
  if (args.parentName !== undefined) patch.parentName = args.parentName.trim();
  if (args.school !== undefined) patch.school = args.school.trim();
  if (args.notes !== undefined) patch.notes = args.notes.trim();
  if (!Object.keys(patch).length) throw new ToolError("VALIDATION", "مفيش حاجة تتعدل — حدد حقل واحد على الأقل.");
  return patch;
}

const LABELS: Record<string, string> = {
  phone: "موبايل الطالب", parentPhone: "موبايل ولي الأمر", parentName: "اسم ولي الأمر", school: "المدرسة", notes: "ملاحظات",
};

async function load(args: A, centerId: string) {
  const s = await db.student.findFirst({
    where: { id: args.studentId, centerId },
    select: { id: true, name: true, code: true, phone: true, parentPhone: true, parentName: true, school: true, notes: true },
  });
  if (!s) throw new ToolError("NOT_FOUND", "الطالب ده مش موجود في السنتر.");
  return s;
}

register({
  name: "student.update_contact",
  group: "students",
  description: "عدّل بيانات تواصل طالب: موبايل الطالب/ولي الأمر، اسم ولي الأمر، المدرسة، ملاحظات (حقول محدودة)",
  usageHint: "«غيّر رقم ولي أمر أحمد لـ 01012345678» — محتاج studentId من student.search",
  input: Args,
  risk: "MEDIUM",
  requiredPermission: "EDIT_STUDENT",
  permissionLabel: "تعديل بيانات طالب",
  async preview(args, ctx) {
    const patch = buildPatch(args);
    const s = await load(args, ctx.centerId);
    const changes = Object.fromEntries(
      Object.entries(patch).map(([k, v]) => [LABELS[k], `${(s as Record<string, string | null>)[k] || "—"} ← ${v || "—"}`]),
    );
    return { summary: `هعدّل بيانات ${s.name} (كود ${s.code}): ${Object.keys(changes).join("، ")}.`, details: changes };
  },
  async handler(args, ctx): Promise<ToolOutput> {
    const patch = buildPatch(args);
    const s = await load(args, ctx.centerId);
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, (s as Record<string, string | null>)[k] ?? null]));
    await db.student.update({ where: { id: s.id }, data: patch });
    await logAudit({
      user: ctx.user, action: AUDIT.STUDENT_UPDATED, entity: "Student", entityId: s.id,
      before, after: patch, reason: "عبر زكي",
    });
    return {
      summary: `عدّلت بيانات ${s.name}: ${Object.keys(patch).map((k) => LABELS[k]).join("، ")}.`,
      confirmSummary: `هعدّل بيانات ${s.name} (كود ${s.code}).`,
      data: { studentId: s.id, changed: Object.keys(patch) },
    };
  },
  async verify(args, _out, ctx) {
    const patch = buildPatch(args);
    const s = await db.student.findFirst({ where: { id: args.studentId, centerId: ctx.centerId } });
    if (!s) return "الطالب مش ظاهر بعد التعديل.";
    for (const [k, v] of Object.entries(patch)) {
      if (((s as unknown as Record<string, string | null>)[k] ?? "") !== v) return `التعديل في «${LABELS[k]}» ماتسجلش — حاول تاني.`;
    }
    return null;
  },
});
