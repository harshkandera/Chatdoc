import "dotenv/config";
import neo4j from "neo4j-driver";

const { NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD } = process.env;

if (!NEO4J_URI || !NEO4J_USERNAME || !NEO4J_PASSWORD) {
  console.error("Missing env vars: NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD");
  process.exit(1);
}

const driver = neo4j.driver(
  NEO4J_URI,
  neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD),
);

const session = driver.session();

async function main() {
  try {
    await session.run(
      "CREATE CONSTRAINT IF NOT EXISTS FOR (p:Page) REQUIRE p.id IS UNIQUE",
    );
    await session.run(
      "CREATE CONSTRAINT IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE",
    );
    console.log("Neo4j constraints created successfully.");
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch(console.error);
