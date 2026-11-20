import { currentRole } from "@/lib/docs/auth";
import { toMarkdown } from "@/lib/docs/markdown";
import { getPublicConfig, getPublicContent } from "@/lib/docs/store";
import { isDocsVisible } from "@/lib/docs/visibility";

export const dynamic = "force-dynamic";

/** The published /docs content as a Markdown file. Follows the same visibility rules as the page. */
export async function GET() {
  const visible = isDocsVisible(await getPublicConfig()).visible;
  if (!visible && !(await currentRole())) {
    return new Response("BlueSense docs are not available right now.", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  const { content } = await getPublicContent();
  return new Response(toMarkdown(content), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="BlueSense-docs.md"',
      "Cache-Control": "no-store",
    },
  });
}
