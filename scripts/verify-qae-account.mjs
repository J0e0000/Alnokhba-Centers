// Verify the 5000-student stress-test account credentials against db/custom.db
import { scryptSync, timingSafeEqual } from "crypto";
import { execSync } from "child_process";

function verify(password, stored) {
  const [scheme, salt, hash] = String(stored).split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

const PWD = "Qae#2026";
const raw = execSync(
  `python3 -c "import sqlite3,json;c=sqlite3.connect('/home/z/my-project/db/custom.db');print(json.dumps(c.execute('SELECT username,name,role,isActive,passwordHash FROM User WHERE centerId=\\"cmv954yva0000vaz8mm8ibkwq\\"').fetchall()))"`,
  { encoding: "utf8" }
);
const users = JSON.parse(raw);

console.log(`Center: QAE1 سنتر الجودة 99 (slug: qae-c99-stress)`);
for (const [username, name, role, isActive, passwordHash] of users) {
  const ok = verify(PWD, passwordHash);
  console.log(`${username.padEnd(14)} role=${role.padEnd(13)} active=${isActive} password "${PWD}" valid=${ok}`);
}

const count = execSync(
  `python3 -c "import sqlite3;c=sqlite3.connect('/home/z/my-project/db/custom.db');print(c.execute('SELECT COUNT(*) FROM Student WHERE centerId=\\"cmv954yva0000vaz8mm8ibkwq\\"').fetchone()[0])"`,
  { encoding: "utf8" }
).trim();
console.log(`Students in center: ${count}`);
