// helper for e2e scripts — scrypt hash identical to src/lib/auth.ts
const { randomBytes, scryptSync } = require("crypto");
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}
module.exports = { hashPassword };
