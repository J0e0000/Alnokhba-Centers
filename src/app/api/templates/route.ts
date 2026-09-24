import { db } from "@/lib/db";
import { ok, handler, readJson } from "@/lib/api";
import { requireCenterUser, requireManager, ApiError } from "@/lib/auth";
import { logAudit, AUDIT } from "@/lib/audit";
import { studentBalance, effectivePrice } from "@/lib/finance";
import { formatDateAR, formatTime12 } from "@/lib/normalize";

export const dynamic = "force-dynamic";

export const WHATSAPP_VARS = [
  "{student_name}", "{parent_name}", "{subject}", "{group_name}", "{amount}",
  "{balance}", "{amount_due}", "{date}", "{session_time}", "{center_name}",
  "{teacher_name}", "{student_code}", "{center_phone}",
];

/** GET /api/templates — list templates */
export const GET = handler(async () => {
  const user = await requireCenterUser();
  const templates = await db.whatsAppTemplate.findMany({
    where: { centerId: user.centerId },
    orderBy: { createdAt: "asc" },
  });
  return ok({ templates, variables: WHATSAPP_VARS });
});

type TplBody = { id?: string; name?: string; body?: string };

/** POST /api/templates — create template (manager) or render preview */
export const POST = handler(async (req: Request) => {
  const user = await requireCenterUser();
  const url = new URL(req.url);
  const body = await readJson<TplBody & { action?: string; studentId?: string; sessionId?: string; amount?: number }>(req);

  // Render with real values + generate wa.me link
  if (body.action === "render") {
    const studentId = String(body.studentId ?? "");
    const student = await db.student.findFirst({
      where: { id: studentId, centerId: user.centerId },
      include: { registrations: { where: { status: "ACTIVE" }, include: { group: { include: { subject: true, teacher: true, grade: true } } } } },
    });
    if (!student) throw new ApiError("الطالب ده مش موجود.", 404);

    const tpl = await db.whatsAppTemplate.findFirst({ where: { id: String(body.id ?? ""), centerId: user.centerId } });
    if (!tpl) throw new ApiError("القالب ده مش موجود.", 404);

    const balance = await studentBalance(student.id);
    let session: { subject: string; teacher: string | null; startTime: string; price: number; group: string } | null = null;
    if (body.sessionId) {
      const sess = await db.sessionInstance.findFirst({
        where: { id: String(body.sessionId), centerId: user.centerId },
        include: { group: { include: { subject: true, teacher: true, grade: true } } },
      });
      if (sess) {
        session = {
          subject: sess.group.subject.name, teacher: sess.group.teacher?.name ?? null,
          startTime: sess.startTime, price: sess.price, group: `${sess.group.grade.name} ${sess.group.name}`,
        };
      }
    }
    const firstReg = student.registrations[0];
    const price = session ? effectivePrice(firstReg?.priceOverride ?? null, null, session.price) : (firstReg?.priceOverride ?? firstReg?.group.sessionPrice ?? 0);

    const center = user.center!;
    const phone = student.parentPhone || student.phone || "";
    const values: Record<string, string> = {
      student_name: student.name,
      parent_name: student.parentName ?? "ولي الأمر",
      subject: session?.subject ?? firstReg?.group.subject.name ?? "",
      group_name: session?.group ?? (firstReg ? `${firstReg.group.grade.name} ${firstReg.group.name}` : ""),
      amount: ((body.amount ?? price) / 100).toLocaleString("en-EG"),
      balance: (Math.abs(balance) / 100).toLocaleString("en-EG") + (balance < 0 ? " (عليه)" : balance > 0 ? " (له رصيد)" : ""),
      amount_due: (Math.max(-balance, 0) / 100).toLocaleString("en-EG"),
      date: formatDateAR(new Date().toISOString().slice(0, 10)),
      session_time: session ? formatTime12(session.startTime) : "",
      center_name: center.name,
      teacher_name: session?.teacher ?? firstReg?.group.teacher?.name ?? "",
      student_code: student.code,
      center_phone: center.phone ?? "",
    };

    let text = tpl.body;
    for (const v of WHATSAPP_VARS) {
      text = text.split(v).join(values[v.slice(1, -1)] ?? "");
    }
    const signature = center.signature ? `\n\n${center.signature}` : "";
    const fullText = `${text}${signature}`;
    const waNumber = phone.replace(/^0/, "20");
    const link = phone ? `https://wa.me/${waNumber}?text=${encodeURIComponent(fullText)}` : null;

    return ok({ text: fullText, link, phone, templateName: tpl.name });
  }

  // Create template
  const manager = await requireManager();
  const name = String(body.name ?? "").trim();
  const tplBody = String(body.body ?? "").trim();
  if (!name) throw new ApiError("اكتب اسم القالب.");
  if (tplBody.length < 3) throw new ApiError("اكتب نص الرسالة.");
  const exists = await db.whatsAppTemplate.findFirst({ where: { centerId: manager.centerId, name } });
  if (exists) throw new ApiError(`في قالب اسمه "${name}" خلاص — اختار اسم تاني.`);

  const tpl = await db.whatsAppTemplate.create({ data: { centerId: manager.centerId, name, body: tplBody } });
  await logAudit({ user: manager, action: AUDIT.TEMPLATE_CREATED, entity: "TEMPLATE", entityId: tpl.id, after: { name } });
  return ok({ template: { id: tpl.id } }, { status: 201 });
});

/** PATCH /api/templates — update (manager) */
export const PATCH = handler(async (req: Request) => {
  const user = await requireManager();
  const body = await readJson<TplBody>(req);
  const tpl = await db.whatsAppTemplate.findFirst({ where: { id: String(body.id ?? ""), centerId: user.centerId } });
  if (!tpl) throw new ApiError("القالب ده مش موجود.", 404);
  const data: Record<string, string> = {};
  if (body.name?.trim()) data.name = body.name.trim();
  if (body.body?.trim()) data.body = body.body.trim();
  await db.whatsAppTemplate.update({ where: { id: tpl.id }, data: data as never });
  await logAudit({ user, action: AUDIT.TEMPLATE_UPDATED, entity: "TEMPLATE", entityId: tpl.id, before: { name: tpl.name, body: tpl.body }, after: data });
  return ok({ ok: true });
});

/** DELETE /api/templates?id= — delete (manager) */
export const DELETE = handler(async (req: Request) => {
  const user = await requireManager();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const tpl = await db.whatsAppTemplate.findFirst({ where: { id, centerId: user.centerId } });
  if (!tpl) throw new ApiError("القالب ده مش موجود.", 404);
  await db.whatsAppTemplate.delete({ where: { id } });
  await logAudit({ user, action: AUDIT.TEMPLATE_DELETED, entity: "TEMPLATE", entityId: id, before: { name: tpl.name } });
  return ok({ ok: true });
});
