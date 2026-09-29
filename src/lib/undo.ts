import "server-only";
import { db } from "@/lib/db";
import { logAudit, AUDIT } from "@/lib/audit";
import type { SessionUser } from "@/lib/auth";

/* ============================================================
   تراجع / إعادة (spec §13) — عمليات مختارة قابلة للعكس بأمان:
   EXPENSE (create/delete) · ANNOUNCEMENT (create) ·
   SCHEDULE_SLOT (create/delete/update) · STUDENT (create → أرشفة)
   ⚠️ الدفعات مش قابلة للتراجع عمدًا — الاسترداد عن طريق طلبات الموافقة.
   سجل العمليات (AuditLog) مستقل عن ده ومش بيتأثر.
============================================================ */

type UndoUser = Pick<SessionUser, "id" | "name"> & { centerId: string };

export async function recordUndo(opts: {
  user: UndoUser;
  entity: "EXPENSE" | "ANNOUNCEMENT" | "SCHEDULE_SLOT" | "STUDENT";
  entityId: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  label: string;
  forward: unknown; // JSON لإعادة التنفيذ
  inverse: unknown; // JSON للتراجع
}): Promise<void> {
  await db.undoEntry.create({
    data: {
      centerId: opts.user.centerId,
      userId: opts.user.id,
      userName: opts.user.name,
      entity: opts.entity,
      entityId: opts.entityId,
      action: opts.action,
      label: opts.label,
      forward: JSON.stringify(opts.forward ?? {}),
      inverse: JSON.stringify(opts.inverse ?? {}),
    },
  });
  // خلي الستاك عملي: آخر 15 مدخل نشط لكل مستخدم
  const stale = await db.undoEntry.findMany({
    where: { centerId: opts.user.centerId, userId: opts.user.id, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    skip: 15,
    select: { id: true },
  });
  if (stale.length) {
    await db.undoEntry.updateMany({ where: { id: { in: stale.map((s) => s.id) } }, data: { status: "EXPIRED" } });
  }
}

type Payload = Record<string, unknown>;

/** تنفيذ التراجع — بيرجع label العملية اللي اتراجعت */
export async function executeUndo(user: UndoUser, entryId?: string): Promise<{ label: string }> {
  const entry = entryId
    ? await db.undoEntry.findFirst({ where: { id: entryId, centerId: user.centerId, userId: user.id, status: "ACTIVE" } })
    : await db.undoEntry.findFirst({
        where: { centerId: user.centerId, userId: user.id, status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
      });
  if (!entry) throw new Error("مفيش حاجة تتراجع.");

  const inverse = JSON.parse(entry.inverse) as Payload;
  switch (entry.entity) {
    case "EXPENSE":
      if (entry.action === "CREATE") {
        // التراجع عن إنشاء مصروف = حذف المصروف + قيده في دفتر السنتر
        await db.expense.deleteMany({ where: { id: entry.entityId, centerId: user.centerId } });
        await db.centerTransaction.deleteMany({ where: { centerId: user.centerId, refType: "EXPENSE", refId: entry.entityId } });
      } else if (entry.action === "DELETE") {
        const { id, ...data } = inverse as { id: string } & Payload;
        await db.expense.create({ data: { ...(data as Record<string, unknown>), id } as never });
      }
      break;
    case "ANNOUNCEMENT":
      if (entry.action === "CREATE") {
        await db.studentNotification.deleteMany({ where: { announcementId: entry.entityId } });
        await db.announcement.deleteMany({ where: { id: entry.entityId, centerId: user.centerId } });
      }
      break;
    case "SCHEDULE_SLOT":
      if (entry.action === "CREATE") {
        // تعطيل آمن — مش مسح (الحصة ممكن تكون بنت إشعارات/سجل)
        await db.scheduleSlot.updateMany({
          where: { id: entry.entityId, centerId: user.centerId },
          data: { isActive: false },
        });
      } else if (entry.action === "DELETE") {
        const { id, ...data } = inverse as { id: string } & Payload;
        await db.scheduleSlot.create({ data: { ...(data as Record<string, unknown>), id } as never });
      } else if (entry.action === "UPDATE") {
        await db.scheduleSlot.updateMany({
          where: { id: entry.entityId, centerId: user.centerId },
          data: inverse as never,
        });
      }
      break;
    case "STUDENT":
      if (entry.action === "CREATE") {
        // أرشفة آمنة — مش مسح (الطالب ممكن يكون ليه معاملات)
        await db.student.updateMany({
          where: { id: entry.entityId, centerId: user.centerId },
          data: { status: "ARCHIVED" },
        });
      }
      break;
  }

  await db.undoEntry.update({
    where: { id: entry.id },
    data: { status: "UNDONE", undoneAt: new Date(), undoneByName: user.name },
  });
  await logAudit({
    user: { id: user.id, name: user.name, centerId: user.centerId },
    action: AUDIT.ATTENDANCE_UPDATED,
    entity: `UNDO_${entry.entity}`,
    entityId: entry.entityId,
    before: null, after: null,
    reason: `تراجع: ${entry.label}`,
  });
  return { label: entry.label };
}

/** إعادة تنفيذ — بيرجع label العملية */
export async function executeRedo(user: UndoUser, entryId?: string): Promise<{ label: string }> {
  const entry = entryId
    ? await db.undoEntry.findFirst({ where: { id: entryId, centerId: user.centerId, userId: user.id, status: "UNDONE" } })
    : await db.undoEntry.findFirst({
        where: { centerId: user.centerId, userId: user.id, status: "UNDONE" },
        orderBy: { undoneAt: "desc" },
      });
  if (!entry) throw new Error("مفيش حاجة تتلفظ تاني.");

  const forward = JSON.parse(entry.forward) as Payload;
  switch (entry.entity) {
    case "EXPENSE":
      if (entry.action === "CREATE") {
        const { id, ...data } = forward as { id: string } & Payload;
        await db.expense.upsert({ where: { id: String(id) }, update: data as never, create: { ...(data as Record<string, unknown>), id } as never });
        // رجّع كمان قيد دفتر السنتر اللي اتمسح مع التراجع
        await db.centerTransaction.upsert({
          where: { id: `redo-${id}` },
          update: { amount: -(Number(data.amount) || 0) },
          create: {
            id: `redo-${id}`,
            centerId: String(data.centerId ?? user.centerId),
            type: "EXPENSE",
            amount: -(Number(data.amount) || 0),
            date: String(data.date ?? ""),
            note: String(data.note ?? data.category ?? ""),
            refType: "EXPENSE",
            refId: String(id),
            createdBy: String(data.createdBy ?? user.id),
          },
        });
      } else if (entry.action === "DELETE") {
        await db.expense.deleteMany({ where: { id: entry.entityId, centerId: user.centerId } });
        await db.centerTransaction.deleteMany({ where: { centerId: user.centerId, refType: "EXPENSE", refId: entry.entityId } });
      }
      break;
    case "ANNOUNCEMENT":
      // إعادة إنشاء إعلان بيبعت إشعارات تاني — مش آمن، فممنوع (يتسجل EXPIRED)
      throw new Error("إعادة الإعلانات مش مدعومة — اعمل إعلان جديد.");
    case "SCHEDULE_SLOT":
      if (entry.action === "CREATE") {
        await db.scheduleSlot.updateMany({
          where: { id: entry.entityId, centerId: user.centerId },
          data: { isActive: true },
        });
      } else if (entry.action === "DELETE") {
        await db.scheduleSlot.deleteMany({ where: { id: entry.entityId, centerId: user.centerId } });
      } else if (entry.action === "UPDATE") {
        const cur = await db.scheduleSlot.findUnique({ where: { id: entry.entityId } });
        if (cur) {
          const { startTime, endTime, room, isActive } = forward as { startTime?: string; endTime?: string; room?: string | null; isActive?: boolean };
          await db.scheduleSlot.update({
            where: { id: entry.entityId },
            data: {
              startTime: startTime ?? cur.startTime, endTime: endTime ?? cur.endTime,
              room: room ?? cur.room, isActive: isActive ?? cur.isActive,
            },
          });
        }
      }
      break;
    case "STUDENT":
      // إعادة إنشاء طالب = رجوع من الأرشفة (لو لسه مؤرشف)
      if (entry.action === "CREATE") {
        await db.student.updateMany({
          where: { id: entry.entityId, centerId: user.centerId, status: "ARCHIVED" },
          data: { status: "ACTIVE" },
        });
      }
      break;
  }

  await db.undoEntry.update({ where: { id: entry.id }, data: { status: "ACTIVE", undoneAt: null, undoneByName: null } });
  await logAudit({
    user: { id: user.id, name: user.name, centerId: user.centerId },
    action: AUDIT.ATTENDANCE_UPDATED,
    entity: `REDO_${entry.entity}`,
    entityId: entry.entityId,
    reason: `إعادة: ${entry.label}`,
  });
  return { label: entry.label };
}
