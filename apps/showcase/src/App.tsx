import { useEffect, useState } from "react";

import { LandingPage } from "./LandingPage.js";
import { PlayerPage } from "./PlayerPage.js";

type Route = { name: "landing" } | { manifestUrl?: string; name: "demo" };

export function App() {
  const [route, setRoute] = useState<Route>(() => readRoute());

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route.name === "demo" ? (
    <PlayerPage
      {...(route.manifestUrl === undefined
        ? {}
        : { requestedManifestUrl: route.manifestUrl })}
    />
  ) : (
    <LandingPage />
  );
}

function readRoute(): Route {
  const hash = window.location.hash.replace(/^#/, "");
  const [path = "/", query = ""] = hash.split("?", 2);
  if (path === "/demo" || path === "demo") {
    const manifestUrl = new URLSearchParams(query).get("manifest")?.trim();
    return {
      ...(manifestUrl === undefined || manifestUrl === "" ? {} : { manifestUrl }),
      name: "demo",
    };
  }
  return { name: "landing" };
}
