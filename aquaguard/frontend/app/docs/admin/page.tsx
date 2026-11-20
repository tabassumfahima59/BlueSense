import { redirect } from "next/navigation";
import { currentRole } from "@/lib/docs/auth";
import { readConfig, readDraft, storageMode } from "@/lib/docs/store";
import { SEED_CONTENT } from "@/lib/docs/seed";
import type { DocsConfig, DocsContent } from "@/lib/docs/types";
import { DEFAULT_CONFIG } from "@/lib/docs/visibility";
import { AdminPanel } from "./AdminPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "BlueSense Docs — admin", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const role = await currentRole();
  if (!role) redirect("/docs/admin/login");
  let draft: DocsContent = SEED_CONTENT;
  let config: DocsConfig = DEFAULT_CONFIG;
  let storageError: string | null = null;
  try {
    [draft, config] = await Promise.all([readDraft(), readConfig()]);
  } catch {
    storageError = "Storage could not be read. You can edit, but saving will fail until the Blob store is connected.";
  }
  return <AdminPanel role={role} initialDraft={draft} initialConfig={config} storage={storageMode()} storageError={storageError} />;
}
