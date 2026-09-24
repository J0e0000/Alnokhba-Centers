import { redirect } from "next/navigation";
import { getAcaUser } from "@/lib/academia/guard";
import { db } from "@/lib/db";
import { todayStr } from "@/lib/academia/dates";
import { AcademiaApp } from "@/components/academia/app";

/* /academia — AlNokhba Academia app (server-guarded) */
export default async function AcademiaPage() {
  const user = await getAcaUser();
  if (!user) redirect("/login");
  const term = await db.academicTerm.findFirst({
    where: { isActive: true },
    select: { id: true, name: true, type: true, startDate: true, endDate: true },
  });
  const unread = await db.acaNotification.count({ where: { userId: user.id, readAt: null } });
  return <AcademiaApp initialUser={user} term={term} today={todayStr()} unread={unread} />;
}
