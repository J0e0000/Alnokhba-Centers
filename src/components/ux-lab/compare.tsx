"use client";
/* شاشة المقارنة — أرقام مُقاسة فعليًا من اختبار متصفح (نقرات حقيقية عالـDOM)
   + تقييمات ذاتية موسومة صراحة كـ«فرضية» لحد ما تتختبر مع مستخدمين حقيقيين. */

import React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useLab } from "./store";
import { OPTION_META, OptionId } from "./types";
import { Scale, FlaskConical, Info } from "lucide-react";

type Cell = { v: string | number; hint?: string };

/* أرقام الحد الأدنى النظري — اتحققت منها بمتصفح آلي (ابدأ → علّم → قفل → تأكيد) */
const ROWS: { label: string; quick: Cell; guided: Cell; cockpit: Cell; measured?: boolean }[] = [
  { label: "نقرات الحد الأدنى لإتمام حصة كاملة (كلهم حاضر)", measured: true,
    quick: { v: 4, hint: "افتح + الكل حاضر + قفل + تأكيد" },
    guided: { v: 17, hint: "افتح + 12 علامة فردية + إتمام حضور + تخطي ملاحظات + إنهاء + تأكيد" },
    cockpit: { v: 4, hint: "افتح + الكل حاضر + قفل + تأكيد" } },
  { label: "نقرات مع 2 استثناء (متأخر + غايب)", measured: true,
    quick: { v: 6 }, guided: { v: 17 }, cockpit: { v: 6 } },
  { label: "انتقالات شاشات/مراحل", measured: true,
    quick: { v: 2, hint: "قائمة ← شاشة الحصة ← الخلاصة" },
    guided: { v: 5, hint: "قائمة + 3 مراحل + خلاصة" },
    cockpit: { v: 2, hint: "نفس السريعة — بس من غير أي شاشة إضافية أثناء العمل" } },
  { label: "حقول مطلوبة (إجبارية)", measured: true, quick: { v: 0 }, guided: { v: 0 }, cockpit: { v: 0 } },
  { label: "قرارات مفروضة على المستخدم في الحد الأدنى", measured: true,
    quick: { v: 1, hint: "تأكيد القفل" }, guided: { v: 15, hint: "12 حالة حضور + إتمام/تخطي/إنهاء + تأكيد" }, cockpit: { v: 1, hint: "تأكيد القفل" } },
  { label: "استرجاع من انقطاع شبكة", measured: true,
    quick: { v: "طابور تلقائي + تزامن عند الرجوع" }, guided: { v: "طابور تلقائي + تزامن عند الرجوع" }, cockpit: { v: "طابور تلقائي + تزامن عند الرجوع" } },
  { label: "خطر سجل ناقص/مكرر",
    quick: { v: "منخفض", hint: "قفل مرفوض بصفر حضور + منع تكرار نفس الحالة" },
    guided: { v: "الأقل", hint: "إتمام صريح لكل مرحلة + شرط حضور قبل الإنهاء" },
    cockpit: { v: "منخفض", hint: "نفس حمايات السريعة + الملخص ظاهر دايمًا" } },
  { label: "موبايل 390px", measured: true,
    quick: { v: "ممتاز", hint: "شريط قفل ثابت أسفل" }, guided: { v: "جيد", hint: "أزرار التقييم بتلتف" }, cockpit: { v: "ممتاز", hint: "شريط ملخص مضغوط فوق + قفل ثابت" } },
  { label: "لوحة مفاتيح / وصولية", measured: true,
    quick: { v: "كامل", hint: "كل الأزرار focusable + aria-pressed" },
    guided: { v: "كامل", hint: "tablist + aria-selected" },
    cockpit: { v: "كامل", hint: "نفس السريعة + aria-live للعدادات" } },
  { label: "مناسب لمين؟",
    quick: { v: "الاستقبال والمدرس المشغول — سرعة فوق كل حاجة" },
    guided: { v: "السنتر اللي عايز انضباط وملاحظات تربوية منتظمة" },
    cockpit: { v: "المدير/المدرس اللي عايز يبص للكل ويقرر فورًا" } },
  { label: "متى تختار بديل تاني؟",
    quick: { v: "لو محتاج إلزام تسجيل ملاحظات تربوية → المُوجَّهة" },
    guided: { v: "لو السرعة أهم من الإرشاد → السريعة أو القمرة" },
    cockpit: { v: "لو الشاشة صغيرة ومحتاج بسّاطة قصوى → السريعة" } },
];

export default function Compare() {
  const lab = useLab();
  const cols: { id: OptionId; label: string }[] = [
    { id: "quick", label: OPTION_META.quick.name },
    { id: "guided", label: OPTION_META.guided.name },
    { id: "cockpit", label: OPTION_META.cockpit.name },
  ];

  return (
    <div className="nk-anim-in" data-lab-scope>
      <div className="nk-card rounded-3xl p-5">
        <h3 className="font-extrabold text-lg flex items-center gap-2"><Scale className="w-5 h-5 text-primary" /> مقارنة البدائل الثلاثة</h3>
        <p className="text-sm text-muted-foreground mt-1">
          نفس السيناريو بالظبط: <b>12 طالبًا · فيزياء ثانوية · <span dir="ltr" className="nk-num">75</span> ج</b> — الأرقام الموسومة
          <Badge variant="secondary" className="mx-1">مُقاس</Badge>طلعت من تشغيل فعلي بالمتصفح لكل بديل، والباقي فرضيات مسماة.
        </p>

        <div className="mt-4 overflow-x-auto -mx-1 px-1">
          <table className="w-full text-sm border-separate" style={{ borderSpacing: "0 6px" }}>
            <thead>
              <tr className="text-start">
                <th className="text-start font-extrabold p-2 w-[34%]">المقياس</th>
                {cols.map((c) => (
                  <th key={c.id} className="text-center font-extrabold p-2">
                    <span className={cn("inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1",
                      lab.choice.option === c.id ? "nk-brand-grad text-white" : "bg-muted text-foreground")}>
                      {c.label}
                      {lab.choice.option === c.id && <span className="text-[10px]">اختيارك</span>}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.label} className="align-top">
                  <td className="p-2 font-bold rounded-xl bg-muted/40 border border-border">
                    {r.label}
                    {r.measured && <Badge variant="secondary" className="ms-1.5 text-[9px] px-1.5">مُقاس</Badge>}
                    {!r.measured && <Badge variant="outline" className="ms-1.5 text-[9px] px-1.5">فرضية</Badge>}
                  </td>
                  {cols.map((c) => {
                    const cell = r[c.id];
                    return (
                      <td key={c.id} className="p-2 text-center rounded-xl border border-border bg-card">
                        <div className="font-bold">{cell.v}</div>
                        {cell.hint && <div className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">{cell.hint}</div>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="nk-card rounded-3xl p-5 mt-3">
        <h4 className="font-extrabold flex items-center gap-2"><FlaskConical className="w-4 h-4 text-primary" /> إيه اللي مش بيوصفه الأرقام؟ (فرضيات محتاجة اختبار مستخدمين)</h4>
        <ul className="mt-2 space-y-2 text-sm text-muted-foreground list-disc ps-5">
          <li><b className="text-foreground">«الكل حاضر» ممكن يتعود غلط:</b> في السريعة والقمرة، لو الأستاذ ضغطها بالخطأ وساكب، الغايبين ممكن يعدّوا حاضرين — المراجعة قبل القفل هي شبكة الأمان، بس فرضيتنا إنها محتاجة اختبار مع استخدام حقيقي.</li>
          <li><b className="text-foreground">نقرات أقل ≠ أسرع دايمًا:</b> المُوجَّهة أبطأ بالأرقام، بس ممكن تقلل أخطاء الإغفال في السنترات الجديدة — النسبة دي معروفة بس من الميدان مش من الشاشة.</li>
          <li><b className="text-foreground">القمرة على شاشة كبيرة:</b> افترضنا إنها بتلعب على تابلت/لابتوب في الاستقبال — على موبايل ضيق ميزتها بتقل.</li>
        </ul>
        <p className="text-xs text-muted-foreground mt-3 flex items-start gap-1.5"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          جرّب نفس الحصة في التلاتة — عدادات النقرات الحية فوق بتظهرلك تجربتك الشخصية جنب الأرقام المُقاسة.</p>
      </div>
    </div>
  );
}
