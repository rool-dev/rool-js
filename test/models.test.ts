import assert from "node:assert/strict";
import { test } from "node:test";
import { RoolClient, type ModelCatalog } from "../src/index.js";

const catalog: ModelCatalog = {
  default: "rool-1",
  models: [
    {
      id: "rool-1",
      name: "Rool 1",
      description: "Rool's current model",
      defaultEffort: "reasoning",
      efforts: [
        { id: "reasoning", name: "Reasoning", description: "More deliberate step-by-step thinking", icon: "brain", cost: "medium" },
        { id: "deep", name: "Deep", description: "A tier this SDK predates", icon: "telescope", cost: "max" },
      ],
    },
  ],
};

test("getModels reads the catalog, passing through values the SDK predates", async () => {
  const paths: string[] = [];
  const client = new RoolClient({
    apiUrl: "https://api.example.test",
    fetch: async (input) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      paths.push(url.pathname);
      return Response.json(catalog);
    },
  });

  assert.deepEqual(await client.getModels(), catalog);
  assert.deepEqual(paths, ["/v2/models"]);
});
