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
  const withoutBase = (() => {
    if (pathname === "/opsflow") return "/";
    if (pathname.startsWith("/opsflow/")) return pathname.replace(/^\/opsflow/, "");
    return pathname;
  })();

  if (withoutBase.length > 1 && withoutBase.endsWith("/")) {
    return withoutBase.slice(0, -1);
  }

  return withoutBase;
}
