/* فحص: الكتب + حصص الأسبوع المحتملة للاختبار */
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const books = await db.book.findMany({ select: { name: true, price: true, stock: true, isActive: true, centerId: true } });
  console.log("books:", books.length);
  books.slice(0, 10).forEach((b) => console.log(" -", b.name, "price:", b.price / 100, "stock:", b.stock));

  const slots = await db.scheduleSlot.findMany({ where: { isActive: true }, select: { dayOfWeek: true, startTime: true, endTime: true, groupId: true } });
  const today = new Date().toISOString().slice(0, 10);
  const todayDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  console.log("today:", today, "dow:", todayDow);
  const todaySlots = slots.filter((s) => s.dayOfWeek === todayDow);
  console.log("today slots:", todaySlots.map((s) => `${s.startTime}-${s.endTime} (g=${s.groupId.slice(-6)})`).join(" | ") || "none");

  const sessions = await db.sessionInstance.findMany({ where: { date: { gte: today } }, select: { date: true, startTime: true, status: true, groupId: true } });
  console.log("sessions from today:", sessions.map((s) => `${s.date} ${s.startTime} ${s.status} (g=${s.groupId.slice(-6)})`).join(" | ") || "none");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
