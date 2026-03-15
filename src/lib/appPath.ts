export function appPath(path: string): string {
  if (!path.startsWith("/")) return path;
  if (typeof window === "undefined") return path;

  const base = window.location.pathname.startsWith("/opsflow/") || window.location.pathname === "/opsflow"
    ? "/opsflow"
    : "";

  return `${base}${path}`;
}

export function stripAppBasePath(pathname: string): string {
  if (!pathname.startsWith("/")) return pathname;
  if (pathname === "/opsflow") return "/";
  if (pathname.startsWith("/opsflow/")) return pathname.replace(/^\/opsflow/, "");
  return pathname;
}
