import { redirect } from "next/navigation";
import { getAcaUser } from "@/lib/academia/guard";
import { SessionWorkspace } from "@/components/academia/session-workspace";

/* /academia/session/[id] — FOCUS MODE route (spec §16):
   only the workspace mounts here — no global navigation,
   no theme/language controls, no unrelated tools. */
export default async function AcademiaSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getAcaUser();
  if (!user) redirect("/login");
  if (user.role === "STUDENT") redirect("/academia");
  const { id } = await params;
  return <SessionWorkspace sessionId={id} user={user} />;
}
