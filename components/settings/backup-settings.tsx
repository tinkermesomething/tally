import { AutoBackupPanel, type AutoBackupView } from "@/components/settings/auto-backup-panel";

/** Settings > Backup (admin only): the automatic scheduled backup - a
 * shared folder/password set up for the whole stack, not any one
 * account's own data. See components/settings/manual-backup.tsx for the
 * per-account "download/restore my data" pair every user gets instead,
 * on the Account tab. */
export function BackupSettings({ auto }: { auto: AutoBackupView }) {
  return (
    <div data-testid="backup-settings">
      <AutoBackupPanel auto={auto} />
    </div>
  );
}
