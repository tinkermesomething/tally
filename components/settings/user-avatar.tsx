const DEFAULT_COLOR = "#2a78d6";

function initialsOf(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/** The real image when one's been uploaded (app/settings/avatar/[userId]) -
 * `imageVersion` (the row's avatarImageUpdatedAt, as a number) is a
 * cache-busting query param, not a real route param, so replacing a
 * picture shows up immediately instead of serving the old cached bytes
 * under the same URL. Falls back to the generated initials-over-color
 * avatar (see avatar-picker.tsx) whenever there's no uploaded image. */
export function UserAvatar({
  userId,
  name,
  email,
  color,
  imageVersion,
  size = 40,
}: {
  userId: number;
  name: string | null;
  email: string;
  color: string | null;
  imageVersion?: number | null;
  size?: number;
}) {
  if (imageVersion) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/settings/avatar/${userId}?v=${imageVersion}`}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ backgroundColor: color || DEFAULT_COLOR, width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {initialsOf(name, email)}
    </div>
  );
}
