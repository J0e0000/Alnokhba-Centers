"use client";

import { Component, Suspense, lazy, type ReactNode } from "react";
import type { RobotHeadShape } from "robot-heads";
import { cn } from "@/lib/utils";
import type { ZakiRobotState } from "./zaki-status";

/* ============================================================
   ZakiRobot — الغلاف القابل لإعادة الاستخدام لشخصية زكي.
   - تحميل كسول (dynamic import) — مش في الـ critical path لأي صفحة.
   - ألوان ثابتة من هوية AlNokhba الرسمية (globals.css brand sheet).
   - Fallback ثابت لو المكتبة فشلت في التحميل أو الرسم.
   - prefers-reduced-motion بيتعالج جوه المكتبة نفسها (رسم ثابت).
============================================================ */

const RobotHead = lazy(() => import("robot-heads").then((m) => ({ default: m.RobotHead })));

/** الألوان المعتمدة — مستخرجة من البراند شيت الرسمي في globals.css */
export const ZAKI_BRAND_VARIANTS = {
  /** الكحلي — الهوية الأساسية (الافتراضي) */
  navy: { color: "#0B1B4F", trimColor: "#93A8D4", screenColor: "#E6F0FF" },
  /** الأزرق — درجة الحركة الرسمية */
  blue: { color: "#1D4ED8", trimColor: "#93A8D4", screenColor: "#E6F0FF" },
  /** التركواز — لون الإبراز الرسمي */
  teal: { color: "#0F766E", trimColor: "#93A8D4", screenColor: "#ECFDF5" },
} as const;

export type ZakiBrandVariant = keyof typeof ZAKI_BRAND_VARIANTS;

export interface ZakiRobotProps {
  /** حالة الروبوت — من mapZakiRobotState فقط، ممنوع اختراع حالات */
  state: ZakiRobotState;
  /** حجم الصندوق بالبكسل — الحركة (النط/الظل) بتطلع بره الصندوق زي box-shadow */
  size: number;
  /** شكل الرأس — المربع هو الاعتماد الرسمي لزكي */
  shape?: RobotHeadShape;
  /** نسخة ألوان البراند */
  variant?: ZakiBrandVariant;
  /** تفاعل مع المؤشر (عيون تتابع + نطة على كليك) — افتراضي true */
  interactive?: boolean;
  /** تجميد الحركة على الوضعية الحالية */
  paused?: boolean;
  /** مضاعف السرعة */
  speed?: number;
  /** إخفاء الهوائي للأحجام الصغيرة — الرأس يملأ الصندوق أكتر */
  antenna?: boolean;
  /** ظل الأرضية */
  floorShadow?: boolean;
  ariaLabel?: string;
  /** إخفاء الوصف عن قارئ الشاشة لما الزرار اللي جنبه فيه اسم واضح بالفعل */
  ariaHidden?: boolean;
  className?: string;
}

/** العنصر الثابت الاحتياطي — نفس مقاس الصندوق، بدون أي حركة */
function ZakiRobotFallback({ size, className, children }: { size: number; className?: string; children?: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-grid place-items-center rounded-[28%] nk-brand-grad text-white shadow-md shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {children ?? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: size * 0.42, height: size * 0.42 }} aria-hidden="true">
          <path d="M12 3v2M5.6 5.6 7 7M3 12h2M19 12h2M17 7l1.4-1.4" />
          <rect x="5" y="9" width="14" height="10" rx="3" />
          <path d="M9 14h.01M15 14h.01" />
        </svg>
      )}
    </span>
  );
}

/** Error boundary — لو الرسم فشل بنعرض العنصر الثابت بدل شاشة مكسورة */
class ZakiRobotBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    /* صامت — الروبوت تحسين بصري مش وظيفة حرجة */
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function ZakiRobot({
  state,
  size,
  shape = "square",
  variant = "navy",
  interactive = true,
  paused = false,
  speed = 1,
  antenna = true,
  floorShadow = true,
  ariaLabel,
  ariaHidden,
  className,
}: ZakiRobotProps) {
  const fallback = <ZakiRobotFallback size={size} className={className} />;
  return (
    <ZakiRobotBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <RobotHead
          state={state}
          size={size}
          shape={shape}
          {...ZAKI_BRAND_VARIANTS[variant]}
          speed={speed}
          paused={paused}
          interactive={interactive}
          antenna={antenna}
          floorShadow={floorShadow}
          aria-label={ariaLabel}
          aria-hidden={ariaHidden}
          className={cn("shrink-0", className)}
        />
      </Suspense>
    </ZakiRobotBoundary>
  );
}
