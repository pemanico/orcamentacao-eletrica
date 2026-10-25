import { useEffect, useState } from "react";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ProjectPage } from "./pages/ProjectPage";
import { EditorPage } from "./pages/EditorPage";
import { RulesPage } from "./pages/RulesPage";
import { DataPage } from "./pages/DataPage";
import { CalculatorPage } from "./pages/CalculatorPage";
import { RULE_TABLE_IDS, type RuleTableId } from "@orc/core";

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
  const rules = /^#\/regras(?:\/([\w-]+))?$/.exec(hash);
  if (hash === "#/regras/calculadora") return <CalculatorPage />;
  if (rules) {
    const t = (RULE_TABLE_IDS as readonly string[]).includes(rules[1] ?? "") ? (rules[1] as RuleTableId) : "defaults_divisao";
    return <RulesPage key={t} tableId={t} />;
  }
  if (hash === "#/dados") return <DataPage />;
  if (hash === "#/arquivados") return <ProjectsPage key="arq" archived />;
  if (floor) return <EditorPage key={floor[1]} floorId={floor[1]!} />;
  if (project) return <ProjectPage key={project[1]} projectId={project[1]!} />;
  return <ProjectsPage />;
}
