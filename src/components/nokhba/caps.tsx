"use client";

import { createContext, useContext, type ReactNode } from "react";
import { defaultCapabilityMap, type CapabilityKey, type CapabilityMap } from "@/lib/capabilities";

/* ============================================================
   سياق قدرات المركز (Center Capabilities Context)
   - بيتحمّل مرة واحدة في App/Portal وبيتوزع على كل الشاشات.
   - كل شاشة بتسأل has("dynamic_qr") مثلاً وتعرض بس المسموح —
     والتحقق الحقيقي بيقوم بيه السيرفر (ده مجرد تكييف واجهة).
   - قبل التحميل: الافتراضي (كله مفعّل عدا البصمة) عشان مفيش وميض.
============================================================ */

const CapsContext = createContext<CapabilityMap>(defaultCapabilityMap());

export function CapsProvider({ value, children }: { value: CapabilityMap | null; children: ReactNode }) {
  return <CapsContext.Provider value={value ?? defaultCapabilityMap()}>{children}</CapsContext.Provider>;
}

export function useCaps() {
  return useContext(CapsContext);
}

/** اختصار: هل القدرة مفعّلة؟ */
export function useHasCap(key: CapabilityKey): boolean {
  return useContext(CapsContext)[key].enabled;
}

/** بلّغ التطبيق إن القدرات اتغيرت (من الإعدادات) — عشان كل الشاشات تتحمّل من جديد */
export function notifyCapsChanged() {
  try { window.dispatchEvent(new Event("nk-caps-changed")); } catch { /* ignore */ }
}
