import { test, describe } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { CatalogProvider } from "../../src/catalog/index.js";

describe("CatalogProvider & Meta-Catalog MCP", () => {
  const definitionsFile = path.resolve("config/catalog-definitions.yaml");
  const provider = new CatalogProvider(definitionsFile);

  test("loads catalog definitions and returns tool definitions", () => {
    const tools = provider.getToolDefinitions();
    assert.strictEqual(tools.length, 2);
    assert.strictEqual(tools[0].name, "list_catalog");
    assert.strictEqual(tools[1].name, "get_catalog_detail");
  });

  test("listCatalog allows analyst role to see npb_baseball_analytics", () => {
    const items = provider.listCatalog(["analyst"]);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].id, "npb_baseball_analytics");
    assert.strictEqual(items[0].target_mcp, "mariadb");
    assert.strictEqual(items[0].target_tool, "read_query");
    // Schema and GenUI must be omitted in list view
    assert.strictEqual((items[0] as any).schema, undefined);
    assert.strictEqual((items[0] as any).gen_ui, undefined);
  });

  test("listCatalog allows admin role to see all catalogs", () => {
    const items = provider.listCatalog(["admin"]);
    assert.ok(items.length >= 1);
    const found = items.find((i) => i.id === "npb_baseball_analytics");
    assert.ok(found);
  });

  test("listCatalog hides catalogs for unauthorized role (guest) (Context Masking)", () => {
    const items = provider.listCatalog(["guest"]);
    assert.strictEqual(items.length, 0);
  });

  test("getCatalogDetail returns full schema and GenUI specification for authorized role", () => {
    const detail = provider.getCatalogDetail("npb_baseball_analytics", ["analyst"]);
    assert.strictEqual(detail.id, "npb_baseball_analytics");
    assert.ok(detail.schema);
    assert.ok(Array.isArray(detail.schema.tables));
    
    // Check tables
    const tableNames = detail.schema.tables.map((t) => t.name);
    assert.ok(tableNames.includes("batting_stats"));
    assert.ok(tableNames.includes("pitching_stats"));
    assert.ok(tableNames.includes("players"));

    // Check GenUI specifications
    assert.ok(detail.gen_ui);
    assert.strictEqual(detail.gen_ui.recommended_layout, "ComparisonDashboard");
    assert.strictEqual(detail.gen_ui.framework, "TailwindCSS + Chart.js");
    assert.ok(Array.isArray(detail.gen_ui.components));
    
    const chartComponent = detail.gen_ui.components.find((c) => c.type === "chart");
    assert.ok(chartComponent);
    assert.strictEqual(chartComponent.chart_type, "bar");
    assert.strictEqual(chartComponent.x_axis, "name");
    assert.strictEqual(chartComponent.y_axis, "war");

    const detailCard = detail.gen_ui.components.find((c) => c.type === "detail_card");
    assert.ok(detailCard);
  });

  test("getCatalogDetail denies access for unauthorized role", () => {
    assert.throws(
      () => {
        provider.getCatalogDetail("npb_baseball_analytics", ["guest"]);
      },
      (err: any) => {
        return err.message.includes("forbidden by ZTA policy");
      }
    );
  });

  test("getCatalogDetail throws error for non-existent service ID", () => {
    assert.throws(
      () => {
        provider.getCatalogDetail("unknown_service_id", ["admin"]);
      },
      (err: any) => {
        return err.message.includes("not found");
      }
    );
  });
});
