import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { db } from "@/lib/db";
import { categories } from "@/lib/db/schema";
import { getGroupStyles, renameGroup, setGroupColor } from "@/lib/db/groups";
import { buildGroupColorMap, GROUP_PALETTE } from "@/lib/group-colors";
import { bulkUpdateCategoryGroup } from "@/lib/db/queries";

beforeEach(() => resetDb());

describe("setGroupColor / getGroupStyles", () => {
  it("sets, overwrites, and clears a group's colour", async () => {
    await setGroupColor("Housing", "#112233");
    expect(await getGroupStyles()).toEqual(new Map([["Housing", "#112233"]]));
    await setGroupColor("Housing", "#445566");
    expect(await getGroupStyles()).toEqual(new Map([["Housing", "#445566"]]));
    await setGroupColor("Housing", null);
    expect(await getGroupStyles()).toEqual(new Map());
  });

  it("rejects an invalid colour", async () => {
    await expect(setGroupColor("Housing", "red")).rejects.toThrow(/#1a2b3c/);
  });

  it("clearing a group with no override is harmless", async () => {
    await expect(setGroupColor("Nothing Set", null)).resolves.not.toThrow();
  });
});

describe("buildGroupColorMap with overrides", () => {
  it("a stored override wins over the auto-palette pick", async () => {
    await setGroupColor("Housing", "#ff00ff");
    const overrides = await getGroupStyles();
    const map = buildGroupColorMap([{ groupName: "Housing" }, { groupName: "Utilities" }], overrides);
    expect(map.get("Housing")).toBe("#ff00ff");
    expect(map.get("Utilities")).toBe(GROUP_PALETTE[1]); // no override - still auto-picked
  });

  it("with no overrides at all, behaves exactly as before", () => {
    const map = buildGroupColorMap([{ groupName: "Housing" }, { groupName: "Utilities" }]);
    expect(map.get("Housing")).toBe(GROUP_PALETTE[0]);
    expect(map.get("Utilities")).toBe(GROUP_PALETTE[1]);
  });
});

describe("renameGroup", () => {
  async function seedCategory(name: string, groupName: string) {
    return (await db.insert(categories).values({ name, groupName }).returning())[0];
  }

  it("moves every category using the old name to the new one", async () => {
    await seedCategory("Rent", "Housing");
    await seedCategory("Council Tax", "Housing");
    await seedCategory("Netflix", "Subscriptions");
    await renameGroup("Housing", "Home");
    const rows = await db.select().from(categories);
    expect(rows.filter((r) => r.groupName === "Home").map((r) => r.name).sort()).toEqual(["Council Tax", "Rent"]);
    expect(rows.find((r) => r.name === "Netflix")?.groupName).toBe("Subscriptions");
  });

  it("renames the group's own style row to match", async () => {
    await seedCategory("Rent", "Housing");
    await setGroupColor("Housing", "#112233");
    await renameGroup("Housing", "Home");
    expect(await getGroupStyles()).toEqual(new Map([["Home", "#112233"]]));
  });

  it("merging into a group that already has its own colour: the destination colour wins, no unique-constraint error", async () => {
    await seedCategory("Rent", "Housing");
    await seedCategory("Netflix", "Subscriptions");
    await setGroupColor("Housing", "#111111");
    await setGroupColor("Subscriptions", "#222222");
    await renameGroup("Housing", "Subscriptions");
    expect(await getGroupStyles()).toEqual(new Map([["Subscriptions", "#222222"]]));
  });

  it("rejects an empty name", async () => {
    await seedCategory("Rent", "Housing");
    await expect(renameGroup("Housing", "   ")).rejects.toThrow("Give it a name.");
  });

  it("renaming to the same name is a harmless no-op", async () => {
    await seedCategory("Rent", "Housing");
    await expect(renameGroup("Housing", "Housing")).resolves.not.toThrow();
  });
});

describe("bulkUpdateCategoryGroup", () => {
  async function seedCategory(name: string, groupName: string | null = null) {
    return (await db.insert(categories).values({ name, groupName }).returning())[0];
  }

  it("sets the group on every top-level id given, skipping a subcategory and a nonexistent id without throwing", async () => {
    const rent = await seedCategory("Rent");
    const council = await seedCategory("Council Tax");
    const mobile = await seedCategory("Mobile");
    const [giffgaff] = await db.insert(categories).values({ name: "Giffgaff", parentId: mobile.id }).returning();

    const updated = await bulkUpdateCategoryGroup([rent.id, council.id, giffgaff.id, 999], "Housing");

    expect(updated).toBe(2);
    const rows = await db.select().from(categories);
    expect(rows.find((r) => r.id === rent.id)?.groupName).toBe("Housing");
    expect(rows.find((r) => r.id === council.id)?.groupName).toBe("Housing");
    expect(rows.find((r) => r.id === giffgaff.id)?.groupName).toBeNull();
  });

  it("de-duplicates repeated ids", async () => {
    const rent = await seedCategory("Rent");
    const updated = await bulkUpdateCategoryGroup([rent.id, rent.id], "Housing");
    expect(updated).toBe(1);
  });

  it("clears the group when given null", async () => {
    const rent = await seedCategory("Rent", "Housing");
    await bulkUpdateCategoryGroup([rent.id], null);
    const row = await db.query.categories.findFirst({ where: (c, { eq }) => eq(c.id, rent.id) });
    expect(row?.groupName).toBeNull();
  });
});
