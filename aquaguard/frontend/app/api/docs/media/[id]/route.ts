import { currentRole } from "@/lib/docs/auth";
import { getPublicConfig, readTeamPhoto } from "@/lib/docs/store";
import { isDocsVisible } from "@/lib/docs/visibility";

export const dynamic = "force-dynamic";

/** Team photos follow the same visibility as /docs (admins can always see them). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const visible = isDocsVisible(await getPublicConfig()).visible;
  if (!visible && !(await currentRole())) return new Response("Not available", { status: 403 });
  const bytes = await readTeamPhoto(id).catch(() => null);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
