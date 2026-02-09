import { prisma } from "../lib/db/prisma";

async function run() {
  const sources = await prisma.docSource.findMany({
    where: { NOT: { productKey: null } },
  });

  const byKey = new Map<string, typeof sources>();

  for (const s of sources) {
    if (!s.productKey) continue;
    const existing = byKey.get(s.productKey) || [];
    existing.push(s);
    byKey.set(s.productKey, existing);
  }

  for (const [key, group] of byKey.entries()) {
    if (group.length < 2) continue;

    console.log(`\nDuplicate found for '${key}': ${group.length} entries`);

    // Sort: 'ready' first, then oldest created
    group.sort((a, b) => {
      const aReady = a.status === "ready" ? 1 : 0;
      const bReady = b.status === "ready" ? 1 : 0;
      if (aReady !== bReady) return bReady - aReady; // valid/ready comes first
      return a.createdAt.getTime() - b.createdAt.getTime(); // Oldest comes first
    });

    const winner = group[0];
    const losers = group.slice(1);

    console.log(`Winner: ${winner.id} (${winner.rootUrl})`);

    for (const loser of losers) {
      console.log(`Processing loser: ${loser.id} (${loser.rootUrl})...`);

      // 1. Handle Workspaces
      const loserWorkspaces = await prisma.workspace.findMany({
        where: { docSourceId: loser.id },
      });

      for (const workspace of loserWorkspaces) {
        // Check if user already has a workspace for the winner
        const existingWinnerWorkspace = await prisma.workspace.findUnique({
          where: {
            userId_docSourceId: {
              userId: workspace.userId,
              docSourceId: winner.id,
            },
          },
        });

        if (existingWinnerWorkspace) {
          console.log(`  User ${workspace.userId} already has winner workspace. Merging chats...`);
          // Move chats to existing winner workspace
          await prisma.chat.updateMany({
            where: { workspaceId: workspace.id },
            data: { workspaceId: existingWinnerWorkspace.id },
          });
          // Delete duplicate workspace
          await prisma.workspace.delete({ where: { id: workspace.id } });
        } else {
          console.log(`  Migrating workspace to winner...`);
          // Just reassign the workspace to the winner docSource
          await prisma.workspace.update({
            where: { id: workspace.id },
            data: { docSourceId: winner.id },
          });
        }
      }

      // 2. Delete loser DocSource (cascades to chunks if configured, otherwise we delete manual)
      // Assuming cascade delete for chunks is NOT set in schema we saw, but usually is. 
      // Let's safe delete chunks first just in case.
      
      await prisma.chunk.deleteMany({ where: { docSourceId: loser.id } });
      await prisma.docSource.delete({ where: { id: loser.id } });
      console.log(`  Deleted loser DocSource.`);
    }
  }

  console.log("\nDeduplication complete.");
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
