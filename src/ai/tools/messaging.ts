import "server-only";
import { db } from "@/lib/db";
import { z } from "zod";
import { register } from "./registry";
import { ToolError, type ToolOutput } from "./types";
import { buildLowBalanceMessage, waUrl } from "@/lib/messages";

/* ============================================================
   TOOL: رسائل — message.draft_balance_reminder
   بيجهّز نص تذكير الرصيد + رابط واتساب جاهز — مبيبعتش أي حاجة.
   الإرسال الفعلي بيفضل بإيد المستخدم (يفتح الرابط ويبعت) —
   فمفيش خطر رسائل خارجية من غير علمه.
============================================================ */
register({
  name: "message.draft_balance_reminder",
  group: "messages",
  description: "جهّز رسالة تذكير بالمديونية لولي أمر طالب + رابط واتساب جاهز (بيجهّز فقط — مبيبعتش)",
  usageHint: "«جهزلي رسالة لولي أمر أحمد عن الفلوس» — محتاج studentId من student.search",
  input: z.object({ studentId: z.string().min(1) }),
  risk: "LOW",
  requiredPermission: "VIEW_STUDENT_FINANCIAL_STATUS",
  permissionLabel: "عرض الحالة المالية للطالب",
  async handler(args, ctx): Promise<ToolOutput> {
    const student = await db.student.findFirst({ where: { id: args.studentId, centerId: ctx.centerId } });
    if (!student) throw new ToolError("NOT_FOUND", "الطالب ده مش موجود في السنتر.");
    const center = await db.center.findUnique({
      where: { id: ctx.centerId },
      select: { id: true, name: true, phone: true, signature: true },
    });
    if (!center) throw new ToolError("NOT_FOUND", "السنتر مش موجود.");
    const phone = student.parentPhone || student.phone;
    if (!phone) throw new ToolError("STATE", `${student.name} ملوش رقم موبايل مسجل (لا هو ولا ولي الأمر).`);
    const text = await buildLowBalanceMessage(center, student);
    const url = waUrl(phone, text);
    return {
      summary: `جهزت رسالة تذكير لـ ${student.parentName ?? "ولي أمر"} ${student.name} — افتح الرابط وابعتها من واتساب.`,
      data: { studentId: student.id, to: student.parentPhone ? "parent" : "student", message: text },
      cards: [{
        type: "result",
        title: `رسالة تذكير — ${student.name}`,
        subtitle: text,
        actions: [],
        rows: [{ label: "واتساب", value: url, tone: "info" }],
      }],
    };
  },
});
