import type { Metadata } from "next";
import Link from "next/link";
import { AlNokhbaMark } from "@/components/nokhba/shared";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({ title: "الصفحة غير موجودة", noindex: true });

/* 404 مخصص بهوية الموقع — روابط فعلية مفيدة، ومن غير redirect تلقائي للرئيسية */
export default function NotFound() {
  return (
    <main className="light-locked min-h-screen grid place-items-center px-4 py-16 bg-background">
      <div className="text-center max-w-md w-full">
        <div className="flex justify-center mb-6">
          <AlNokhbaMark size={48} />
        </div>
        <p className="nk-num font-extrabold text-6xl nk-brand-text leading-none" aria-hidden>404</p>
        <h1 className="text-2xl font-extrabold mt-4">الصفحة مش موجودة</h1>
        <p className="text-muted-foreground text-sm mt-3 leading-relaxed font-bold">
          الرابط اللي فتحته غلط أو اتنقل. لو جاي من كود QR، امسح الكود تاني من شاشة السنتر —
          الروابط دي بتتغير باستمرار لأسباب أمنية.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-7">
          <Link href="/" className="nk-btn-brand h-11 rounded-xl px-6 font-extrabold text-sm flex items-center gap-2">
            الصفحة الرئيسية
          </Link>
          <Link
            href="/login"
            className="h-11 rounded-xl px-6 font-bold text-sm flex items-center gap-2 border border-border bg-card hover:border-[color:var(--c-primary)]/50 transition"
          >
            تسجيل الدخول
          </Link>
        </div>
      </div>
    </main>
  );
}
