export function appPath(path: string): string {
  if (!path.startsWith("/")) return path;
  if (typeof window === "undefined") return path;

  const base = window.location.pathname.startsWith("/opsflow/") || window.location.pathname === "/opsflow"
    ? "/opsflow"
    : "";

  return `${base}${path}`;
}
