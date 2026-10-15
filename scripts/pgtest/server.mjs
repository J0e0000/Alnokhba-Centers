/** تشغيل PostgreSQL مدمج كـ daemon للتشخيص — بورتب 5433 وقاعدة nokhba
 *  الاستخدام: node scripts/pgtest/server.mjs start  → يشغّل ويفضل شغال في الخلفية
 *             node scripts/pgtest/server.mjs stop   → يوقف
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "fs";

const DATA_DIR = "/home/z/my-project/scripts/pgtest/pgdata";
const action = process.argv[2] ?? "start";
const pidFile = "/home/z/my-project/scripts/pgtest/pg.pid";

if (action === "stop") {
  try {
    const pid = fs.readFileSync(pidFile, "utf8").trim();
    process.kill(Number(pid), "SIGINT");
    console.log("stopping pg pid", pid);
    setTimeout(() => process.exit(0), 2500);
  } catch (e) {
    console.log("no pid file or already stopped:", e.message);
    process.exit(0);
  }
} else {
  if (fs.existsSync(pidFile)) {
    try {
      const old = Number(fs.readFileSync(pidFile, "utf8").trim());
      process.kill(old, 0);
      console.log("pg already running pid", old);
      process.exit(0);
    } catch { /* stale */ }
  }
  const fresh = !fs.existsSync(DATA_DIR);
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: 5433,
    persistent: true,
  });
  if (fresh) await pg.initialise();
  await pg.start();
  try {
    await pg.createDatabase("nokhba");
    console.log("database nokhba created");
  } catch (e) {
    console.log("createDatabase:", e.message ?? e);
  }
  fs.writeFileSync(pidFile, String(process.pid));
  console.log("pg running on 5433 pid", process.pid);
  // يفضل حي في الخلفية
  setInterval(() => {}, 1 << 30);
}
