import { useEffect, useState } from "react";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectPage } from "./pages/ProjectPage";
import { EditorPage } from "./pages/EditorPage";

/** Router por hash: #/ · #/projeto/:id · #/piso/:id */
function useHash() {
  const [hash, setHash] = useState(() => window.location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  const project = /^#\/projeto\/([\w-]+)$/.exec(hash);
  const floor = /^#\/piso\/([\w-]+)$/.exec(hash);
  if (floor) return <EditorPage key={floor[1]} floorId={floor[1]!} />;
  if (project) return <ProjectPage key={project[1]} projectId={project[1]!} />;
  return <ProjectsPage />;
}
