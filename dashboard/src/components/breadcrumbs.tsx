import type { Route } from "@/routes";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";

import * as React from "react";

type BreadcrumbsProps = {
  routes: Route[];
  currentHref?: string;
  rootLabel?: string;
  rootHref?: string;
};

function getBrowserHref(): string {
  if (typeof window === "undefined") return "/";
  return window.location.href;
}

function extractPathFromHref(href: string): string {
  const trimmed = href.trim();
  if (!trimmed || trimmed === "#") return "";

  // Hash-based routing support (e.g. "#/temperatura").
  if (trimmed.startsWith("#")) {
    const hash = trimmed.slice(1);
    return hash.startsWith("/") ? hash : "";
  }

  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const url = new URL(trimmed, base);
    return url.pathname;
  } catch {
    const withoutHash = trimmed.split("#")[0] ?? "";
    const withoutQuery = withoutHash.split("?")[0] ?? "";
    return withoutQuery;
  }
}

function normalizePath(pathname: string): string {
  const raw = pathname.trim();
  if (!raw) return "/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  const withoutTrailing = withLeadingSlash !== "/" ? withLeadingSlash.replace(/\/+$/g, "") : "/";
  return withoutTrailing || "/";
}

function useCurrentHref(providedHref?: string) {
  const [href, setHref] = React.useState(() => providedHref ?? getBrowserHref());

  React.useEffect(() => {
    if (providedHref) {
      setHref(providedHref);
      return;
    }

    const handleChange = () => setHref(getBrowserHref());
    window.addEventListener("popstate", handleChange);
    window.addEventListener("hashchange", handleChange);
    return () => {
      window.removeEventListener("popstate", handleChange);
      window.removeEventListener("hashchange", handleChange);
    };
  }, [providedHref]);

  return href;
}

function findBestRoutePath(routes: Route[], currentPath: string, parents: Route[] = []): Route[] | null {
  let bestPath: Route[] | null = null;
  let bestScore = 0;
  let bestMatchedLength = -1;

  const consider = (candidatePath: Route[], score: number, matchedLength: number) => {
    if (score <= 0) return;
    if (score > bestScore || (score === bestScore && matchedLength > bestMatchedLength)) {
      bestPath = candidatePath;
      bestScore = score;
      bestMatchedLength = matchedLength;
    }
  };

  for (const route of routes) {
    const routePath = normalizePath(extractPathFromHref(route.href));
    const exact = routePath === currentPath;
    const prefix = !exact && (routePath === "/" || currentPath.startsWith(routePath + "/"));

    if (exact) {
      consider([...parents, route], 2, routePath.length);
    } else if (prefix) {
      consider([...parents, route], 1, routePath.length);
    }

    if (route.children?.length) {
      const childBest = findBestRoutePath(route.children, currentPath, [...parents, route]);
      if (childBest) {
        const leaf = childBest[childBest.length - 1];
        const leafPath = normalizePath(extractPathFromHref(leaf.href));
        const childExact = leafPath === currentPath;
        const childPrefix = !childExact && (leafPath === "/" || currentPath.startsWith(leafPath + "/"));
        const childScore = childExact ? 2 : childPrefix ? 1 : 0;
        consider(childBest, childScore, leafPath.length);
      }
    }
  }

  return bestPath;
}

export function Breadcrumbs({
  routes,
  currentHref,
  rootLabel = "Dashboard",
  rootHref = "#",
}: BreadcrumbsProps) {
  const href = useCurrentHref(currentHref);

  const currentPath = React.useMemo(() => {
    if (typeof window !== "undefined" && window.location.hash?.startsWith("#/")) {
      return normalizePath(window.location.hash.slice(1));
    }
    return normalizePath(extractPathFromHref(href));
  }, [href]);

  const routePath = React.useMemo(() => {
    const found = findBestRoutePath(routes, currentPath);
    return found ?? [];
  }, [routes, currentPath]);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem className="hidden md:block">
          <BreadcrumbLink href={rootHref}>{rootLabel}</BreadcrumbLink>
        </BreadcrumbItem>
        {routePath.length > 0 ? <BreadcrumbSeparator className="hidden md:block" /> : null}
        {routePath.map((r, idx) => {
          const isLast = idx === routePath.length - 1;
          return (
            <React.Fragment key={r.name}>
              <BreadcrumbItem className={isLast ? undefined : "hidden md:block"}>
                {isLast ? (
                  <BreadcrumbPage>{r.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={r.href}>{r.label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast ? <BreadcrumbSeparator className="hidden md:block" /> : null}
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
