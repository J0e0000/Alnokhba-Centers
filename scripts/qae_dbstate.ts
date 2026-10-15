import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const centers = await db.center.findMany({ select: { id: true, name: true, slug: true } });
  console.log("CENTERS:", JSON.stringify(centers));
  const counts: Record<string, number> = {};
  for (const m of ["user","student","group","studentGroup","sessionInstance","attendance","studentTransaction","receipt","auditLog","trustedDeviceBinding","staffQrToken","attendanceDevice","centerCapability","attendanceEvent","announcement","notificationAttempt","expense"]) {
    try { counts[m] = await (db as any)[m].count(); } catch (e) { counts[m] = -1; }
  }
  console.log("COUNTS:", JSON.stringify(counts));
  const users = await db.user.findMany({ select: { id:true, username:true, role:true, centerId:true, isActive:true } });
  console.log("USERS:", JSON.stringify(users));
  const studentsSample = await db.student.findMany({ take: 3, select: { id:true, name:true, code:true, centerId:true } });
  console.log("STUDENT SAMPLE:", JSON.stringify(studentsSample));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
