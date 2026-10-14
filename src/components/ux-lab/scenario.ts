"use client";
/* السيناريو الموحد — نفس البيانات الاصطناعية بالظبط لكل البدائل
   عشان الفرق اللي هتحسه يكون فرق أسلوب عمل مش فرق بيانات. */

import type { LabStudent } from "./types";

export const SCENARIO = {
  centerName: "سنتر النخبة — فرع التجريبي (بيانات وهمية)",
  groupName: "فيزياء — ثانوية عامة",
  teacherName: "أ. كريم منصور",
  room: "قاعة A",
  time: "5:00 م ← 6:30 م",
  price: 75, // جنيه لكل حاضر
  day: "الخميس",
};

export const STUDENTS: LabStudent[] = [
  { id: "st01", code: "10001", name: "كريم أشرف زكي" },
  { id: "st02", code: "10002", name: "مريم عبد الله حسن" },
  { id: "st03", code: "10003", name: "عمر الخطيب", lastWeakness: "مشكلة في أساسيات الكهرباء" },
  { id: "st04", code: "10004", name: "سلمى فاروق عيد" },
  { id: "st05", code: "10005", name: "مصطفى كامل يونس", usualLate: true },
  { id: "st06", code: "10006", name: "هنا سامي مرسي" },
  { id: "st07", code: "10007", name: "زياد طلعت رشاد" },
  { id: "st08", code: "10008", name: "نور الهدى عادل" },
  { id: "st09", code: "10009", name: "ياسين جمال فهمي", lastWeakness: "بيسلّم الواجب متأخر" },
  { id: "st10", code: "10010", name: "روضة أشرف لبيب" },
  { id: "st11", code: "10011", name: "حمزة نبيل سريا" },
  { id: "st12", code: "10012", name: "آدم شريف قنديل" },
];

export const studentById = (id: string) => STUDENTS.find((s) => s.id === id);

/* تنسيق المبالغ — نسخة معزولة (من غير أي استيراد من طبقة الإنتاج) */
export function egp(piastres: number): string {
  return `${(piastres / 100).toLocaleString("en-EG")} ج`;
}
export const pricePiastres = SCENARIO.price * 100;

/* توقيت مختصر عربي */
export function clockAt(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours() % 12 || 12;
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m} ${d.getHours() < 12 ? "ص" : "م"}`;
}
