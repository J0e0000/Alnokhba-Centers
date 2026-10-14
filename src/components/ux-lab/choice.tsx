"use client";
/* تسجيل اختيار المالك — القرار بيتخزن محليًا (localStorage) ومش بيتطبق على الإنتاج إطلاقًا،
   وقابل للمسح/التعديل في أي لحظة. */

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useLab } from "./store";
import { OPTION_META, OptionId } from "./types";
import { CheckCircle2, Copy, Trash2, Save, Clock3 } from "lucide-react";

export default function ChoiceCard() {
  const lab = useLab();
  const [picked, setPicked] = useState<OptionId | null>(lab.choice.option);
  const [comment, setComment] = useState(lab.choice.comment);
  const [copied, setCopied] = useState(false);

  /* مزامنة مع الاختيار المحفوظ بنمط التعديل أثناء الرندر (بدون effect) */
  const [lastChoice, setLastChoice] = useState(lab.choice);
  if (lastChoice !== lab.choice) {
    setLastChoice(lab.choice);
    setPicked(lab.choice.option);
    setComment(lab.choice.comment);
  }

  const options: OptionId[] = ["quick", "guided", "cockpit"];

  async function copySummary() {
    const c = lab.choice;
    const m = c.option ? lab.metrics(c.option) : null;
    const text = [
      "قرار المالك من مختبر UX — النخبة:",
      c.option ? `البديل المختار: ${OPTION_META[c.option].name} (${c.option})` : "لسه مفيش اختيار",
      m ? `تجربتي الشخصية: ${m.clicks} نقرة · ${m.transitions} انتقال` : "",
      c.comment ? `تعليق: ${c.comment}` : "",
      `تاريخ التسجيل: ${c.savedAt ? new Date(c.savedAt).toLocaleString("ar-EG") : "—"}`,
    ].filter(Boolean).join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* تجاهل */ }
  }

  return (
    <div className="nk-card rounded-3xl p-5 nk-anim-in" data-lab-scope>
      <h3 className="font-extrabold text-lg flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-600" /> سجّل اختيارك</h3>
      <p className="text-sm text-muted-foreground mt-1">
        القرار بيتخزن في المتصفح ده بس (localStorage) — <b className="text-foreground">مش بيغير أي حاجة في الإنتاج</b>، وتقدر تمسحه أو تغيّره في أي وقت.
      </p>

      <div className="grid sm:grid-cols-3 gap-2 mt-4" role="radiogroup" aria-label="اختيار البديل">
        {options.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={picked === id}
            onClick={() => setPicked(id)}
            className={cn(
              "rounded-2xl border p-3.5 text-start transition-all active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              picked === id ? "border-primary ring-2 ring-ring/40 bg-primary/5" : "border-border bg-card hover:bg-muted/50",
            )}
          >
            <div className="font-extrabold flex items-center justify-between gap-2">
              {OPTION_META[id].name}
              {picked === id && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
            </div>
            <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{OPTION_META[id].pitch}</div>
          </button>
        ))}
      </div>

      <label className="block text-sm font-extrabold mt-4 mb-1.5" htmlFor="ux-choice-comment">ليه؟ (اختياري — بيساعد نفهم القرار)</label>
      <textarea
        id="ux-choice-comment"
        rows={3}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="مثال: عاجبني الافتراض اللي بيوفّر نقرات، بس عايزين إلزام ملاحظات زي المُوجَّهة…"
        className="w-full rounded-2xl border border-input bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      />

      <div className="flex flex-wrap gap-2 mt-3">
        <Button className="h-11 rounded-2xl nk-btn-brand" onClick={() => lab.saveChoice(picked, comment)} disabled={!picked}>
          <Save className="w-4 h-4" /> حفظ الاختيار
        </Button>
        <Button variant="outline" className="h-11 rounded-2xl" onClick={copySummary}>
          <Copy className="w-4 h-4" /> {copied ? "اتنسخ ✓" : "نسخ الملخص للشات"}
        </Button>
        <Button variant="ghost" className="h-11 rounded-2xl text-destructive hover:text-destructive" onClick={() => { lab.clearChoice(); setPicked(null); setComment(""); }}>
          <Trash2 className="w-4 h-4" /> مسح القرار
        </Button>
        {lab.choice.savedAt && (
          <span className="text-xs text-muted-foreground self-center flex items-center gap-1">
            <Clock3 className="w-3.5 h-3.5" /> محفوظ: {new Date(lab.choice.savedAt).toLocaleString("ar-EG")}
          </span>
        )}
      </div>

      {lab.choice.option && (
        <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20 p-3 text-sm">
          <Badge className="bg-emerald-600">القرار الحالي</Badge>
          <span className="ms-2 font-extrabold">{OPTION_META[lab.choice.option].name}</span>
          {lab.choice.comment && <span className="text-muted-foreground"> — {lab.choice.comment}</span>}
        </div>
      )}
    </div>
  );
}
