// تجهيز ملف ديمو نظيف للترحيل الاختياري للإنتاج:
// - نسخة من باك أب الـ 5000 طالب
// - من غير qae-admin (أدمن المنصة — صاحب المنتج عنده أدمن خاص بيه على الإنتاج)
// - من غير صفوف BackupRun (بيانات تشغيل داخلية)
import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import fs from 'fs';

const SRC = 'db-backup-20261015/custom.db';
const DST = 'download/alnokhba-demo-5000-students.db';

fs.mkdirSync('download', { recursive: true });
fs.copyFileSync(SRC, DST);

const db = new PrismaClient();
// إعادة توجيه العميل لملف الديمو
process.env.DATABASE_URL = `file:/home/z/my-project/${DST}`;

await db.$executeRawUnsafe(`DELETE FROM User WHERE username = 'qae-admin'`);
await db.$executeRawUnsafe(`DELETE FROM BackupRun`);

const centers = await db.center.findMany({ select: { slug: true, name: true } });
const students = await db.student.count();
const users = await db.user.findMany({ select: { username: true, role: true } });
console.log('DEMO FILE:', DST, fs.statSync(DST).size, 'bytes');
console.log('centers:', JSON.stringify(centers));
console.log('students:', students);
console.log('users:', JSON.stringify(users));
await db.$disconnect();
