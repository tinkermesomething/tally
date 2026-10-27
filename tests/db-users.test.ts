import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "./helpers/db";
import { getUserBySub, inviteUser, listUsers, relinkUserSub, resolveAndApplySignIn, setUserDisabled, deleteUser } from "@/lib/db/users";
import { openDek, dekToHex } from "@/lib/user-dek";
import { getOrOpenUserDb, fileFor, closeAndForget } from "@/lib/db/pool";

const ADMIN = "admin@example.com";
beforeEach(() => resetDb());

describe("resolveAndApplySignIn", () => {
  it("the admin email creates the admin row on first login", async () => {
    const { resolution, user } = await resolveAndApplySignIn(ADMIN, "admin-sub", "Admin", ADMIN);
    expect(resolution).toMatchObject({ action: "create-admin" });
    expect(user).toMatchObject({ email: ADMIN, oidcSub: "admin-sub", isAdmin: true });
    expect(await listUsers()).toHaveLength(1);
  });

  it("the SAME admin logging in again just signs in - no duplicate row", async () => {
    await resolveAndApplySignIn(ADMIN, "admin-sub", "Admin", ADMIN);
    const second = await resolveAndApplySignIn(ADMIN, "admin-sub", "Admin", ADMIN);
    expect(second.resolution).toMatchObject({ action: "sign-in" });
    expect(await listUsers()).toHaveLength(1);
  });

  it("an uninvited stranger is refused and no row is created", async () => {
    const { resolution, user } = await resolveAndApplySignIn("stranger@example.com", "sub-x", "Stranger", ADMIN);
    expect(resolution).toMatchObject({ allow: false, reason: "not-invited" });
    expect(user).toBeNull();
    expect(await listUsers()).toHaveLength(0);
  });

  it("an invited email completes on its first real login, linking the sub", async () => {
    const invited = await inviteUser("sam@example.com");
    expect(invited.oidcSub).toBeNull();
    const { resolution, user } = await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN);
    expect(resolution).toMatchObject({ action: "complete-invite" });
    expect(user).toMatchObject({ id: invited.id, oidcSub: "sam-sub" });
    expect(await getUserBySub("sam-sub")).toMatchObject({ id: invited.id });
  });

  it("invite matching is case-insensitive", async () => {
    await inviteUser("Sam@Example.com");
    const { resolution } = await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN);
    expect(resolution).toMatchObject({ action: "complete-invite" });
  });

  it("a disabled account is refused even with the right sub", async () => {
    await resolveAndApplySignIn(ADMIN, "admin-sub", "Admin", ADMIN);
    const invited = await inviteUser("sam@example.com");
    await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN);
    await setUserDisabled(invited.id, true);
    const { resolution } = await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN);
    expect(resolution).toMatchObject({ allow: false, reason: "disabled" });
  });

  it("re-enabling lets them sign in again", async () => {
    const invited = await inviteUser("sam@example.com");
    await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN);
    await setUserDisabled(invited.id, true);
    await setUserDisabled(invited.id, false);
    expect((await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN)).resolution).toMatchObject({ allow: true });
  });
});

describe("relinkUserSub", () => {
  it("repoints which identity opens an existing account, data untouched", async () => {
    const invited = await inviteUser("sam@example.com");
    await resolveAndApplySignIn("sam@example.com", "old-sub", "Sam", ADMIN);
    const res = await relinkUserSub(invited.id, "new-sub");
    expect(res.ok).toBe(true);
    expect(await getUserBySub("new-sub")).toMatchObject({ id: invited.id });
    expect(await getUserBySub("old-sub")).toBeUndefined();
  });

  it("refuses to steal a sub already claimed by someone else", async () => {
    const a = await inviteUser("a@example.com");
    await resolveAndApplySignIn("a@example.com", "sub-a", "A", ADMIN);
    const b = await inviteUser("b@example.com");
    await resolveAndApplySignIn("b@example.com", "sub-b", "B", ADMIN);
    const res = await relinkUserSub(b.id, "sub-a");
    expect(res).toMatchObject({ ok: false });
    expect(await getUserBySub("sub-a")).toMatchObject({ id: a.id });
  });

  it("re-linking to itself (no-op) is harmless", async () => {
    const invited = await inviteUser("sam@example.com");
    await resolveAndApplySignIn("sam@example.com", "sub-1", "Sam", ADMIN);
    expect((await relinkUserSub(invited.id, "sub-1")).ok).toBe(true);
  });
});

describe("resolveAndApplySignIn - group-driven admin status", () => {
  it("an invited user's admin group claim makes them an admin on their first login", async () => {
    await inviteUser("sam@example.com");
    const { user } = await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN, ["admin"]);
    expect(user).toMatchObject({ isAdmin: true });
  });

  it("losing the admin group demotes on the NEXT sign-in that explicitly says so", async () => {
    await inviteUser("sam@example.com");
    await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN, ["admin"]);
    const { user } = await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN, ["someone-else"]);
    expect(user).toMatchObject({ isAdmin: false });
  });

  it("a sign-in where the groups claim is simply ABSENT never demotes an existing admin", async () => {
    await inviteUser("sam@example.com");
    await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN, ["admin"]);
    const { user } = await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN, undefined);
    expect(user).toMatchObject({ isAdmin: true });
  });

  it("the bootstrap admin stays admin even with an explicit groups claim that excludes them", async () => {
    const { user } = await resolveAndApplySignIn(ADMIN, "admin-sub", "Admin", ADMIN, ["not-admin-group"]);
    expect(user).toMatchObject({ isAdmin: true });
  });

  it("OIDC_ADMIN_GROUP, when set, replaces 'admin' as the group that grants admin", async () => {
    await inviteUser("sam@example.com");
    // Plain "admin" no longer counts once a custom group is configured.
    const notAdmin = await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN, ["admin"], "staff");
    expect(notAdmin.user).toMatchObject({ isAdmin: false });
    // The configured group does.
    const isAdmin = await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN, ["staff"], "staff");
    expect(isAdmin.user).toMatchObject({ isAdmin: true });
  });
});

describe("deleteUser", () => {
  it("removes the account row and its encrypted file on disk", async () => {
    const { user: admin } = await resolveAndApplySignIn(ADMIN, "admin-sub", "Admin", ADMIN);
    await inviteUser("sam@example.com");
    const { user: sam } = await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN, undefined);
    await inviteUser("placeholder@example.com"); // never used - just proves this isn't the only row
    // Create sam's real file on disk, same as a real first page load would.
    const dek = openDek(sam!.dekSealed!, "sam-sub");
    getOrOpenUserDb(sam!.id, dekToHex(dek));
    closeAndForget(sam!.id);
    expect(fs.existsSync(fileFor(sam!.id))).toBe(true);

    const result = await deleteUser(sam!.id, admin!.id, ADMIN);
    expect(result).toMatchObject({ ok: true });
    expect(await getUserBySub("sam-sub")).toBeUndefined();
    expect(fs.existsSync(fileFor(sam!.id))).toBe(false);
  });

  it("refuses to delete the bootstrap admin", async () => {
    const { user: admin } = await resolveAndApplySignIn(ADMIN, "admin-sub", "Admin", ADMIN);
    await inviteUser("sam@example.com");
    const { user: sam } = await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN, undefined);
    const result = await deleteUser(admin!.id, sam!.id, ADMIN);
    expect(result).toMatchObject({ ok: false });
    expect(await getUserBySub("admin-sub")).toBeDefined();
  });

  it("a non-admin can delete their own account", async () => {
    await resolveAndApplySignIn(ADMIN, "admin-sub", "Admin", ADMIN);
    await inviteUser("sam@example.com");
    const { user: sam } = await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN, undefined);
    const result = await deleteUser(sam!.id, sam!.id, ADMIN);
    expect(result).toMatchObject({ ok: true });
    expect(await getUserBySub("sam-sub")).toBeUndefined();
  });

  it("an admin refuses to delete their own account", async () => {
    await inviteUser("sam@example.com");
    // An admin via the group claim, not the bootstrap email - this is
    // specifically testing the id===callerId-and-isAdmin rule, not the
    // separate bootstrap-email rule covered above.
    const { user: sam } = await resolveAndApplySignIn("sam@example.com", "sam-sub", "Sam", ADMIN, ["admin"]);
    const result = await deleteUser(sam!.id, sam!.id, ADMIN);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/own account/) });
    expect(await getUserBySub("sam-sub")).toBeDefined();
  });

  it("a deleted id that no longer exists is a clean failure, not a crash", async () => {
    const { user: admin } = await resolveAndApplySignIn(ADMIN, "admin-sub", "Admin", ADMIN);
    const result = await deleteUser(99999, admin!.id, ADMIN);
    expect(result).toMatchObject({ ok: false });
  });
});
