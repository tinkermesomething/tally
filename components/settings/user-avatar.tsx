const DEFAULT_COLOR = "#2a78d6";

function initialsOf(name: string | null, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/** A generated avatar - initials over a color the user picked (see
 * avatar-picker.tsx) - never an uploaded image, no file storage involved. */
export function UserAvatar({ name, email, color, size = 40 }: { name: string | null; email: string; color: string | null; size?: number }) {
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
