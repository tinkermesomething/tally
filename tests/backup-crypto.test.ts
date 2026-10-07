import { describe, expect, it } from "vitest";
import { decryptBackup, encryptBackup, isEncryptedBackup } from "@/lib/backup-crypto";

const data = Buffer.from("SQLite format 3\0 pretend database contents ".repeat(50));

describe("backup password protection", () => {
  it("round-trips with the right password and hides the contents", () => {
    const enc = encryptBackup(data, "correct horse");
    expect(isEncryptedBackup(enc)).toBe(true);
    expect(enc.includes(Buffer.from("pretend database"))).toBe(false);
    expect(decryptBackup(enc, "correct horse").equals(data)).toBe(true);
  });

  it("uses a fresh salt and iv each time", () => {
    expect(encryptBackup(data, "password1").equals(encryptBackup(data, "password1"))).toBe(false);
  });

  it("rejects a wrong password", () => {
    expect(() => decryptBackup(encryptBackup(data, "password1"), "password2")).toThrow("Wrong password");
  });

  it("rejects a tampered file", () => {
    const enc = encryptBackup(data, "password1");
    enc[enc.length - 5] ^= 0xff;
    expect(() => decryptBackup(enc, "password1")).toThrow("Wrong password, or the backup file is damaged");
  });

  it("rejects short passwords and plain files", () => {
    expect(() => encryptBackup(data, "short")).toThrow("at least 8");
    expect(isEncryptedBackup(data)).toBe(false);
    expect(() => decryptBackup(data, "password1")).toThrow("isn't a protected");
    expect(() => decryptBackup(Buffer.from("TALLYBK1"), "password1")).toThrow("isn't a protected");
  });
});
