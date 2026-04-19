import { useEffect, useRef, useState } from 'react';

import { Drawer } from './components/Drawer';
import { FloatingControl, type DrawerKey } from './components/FloatingControl';
import { ResultPanel } from './components/ResultPanel';
import { RunButton } from './components/RunButton';
import { ScenarioSelector } from './components/ScenarioSelector';
import { SitePickerMap } from './components/SitePickerMap';
import { StructureForm } from './components/StructureForm';
import { StructurePreview3D } from './components/StructurePreview3D';
import { useLoadScenarios, useTerrainFetch } from './features/viability/hooks';
import { useViabilityStore } from './features/viability/store';

const TITLES: Record<DrawerKey, string> = {
  structure: 'Structure',
  scenario: 'Scenario',
  result: 'Viability result',
};

const App = (): JSX.Element => {
  useLoadScenarios();
  useTerrainFetch();
  const [activeDrawer, setActiveDrawer] = useState<DrawerKey | null>(null);

  const result = useViabilityStore((s) => s.result);
  const lastAutoOpenedFor = useRef<typeof result>(null);

  // Auto-open Result drawer on Run success — but only once per result, and only
  // if the user isn't currently editing something else.
  useEffect(() => {
    if (result && result !== lastAutoOpenedFor.current && activeDrawer === null) {
      lastAutoOpenedFor.current = result;
      setActiveDrawer('result');
    }
  }, [result, activeDrawer]);

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-line px-6 py-3 flex-shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">
          Seismo <span className="text-muted font-normal">— conceptual seismic viability</span>
        </h1>
        <p className="text-xs text-muted">
          Conceptual screening only. Not licensed engineering software.
        </p>
      </header>

      <main className="flex-1 flex flex-col md:flex-row gap-5 p-5 pb-8 md:pb-10 min-h-0">
        <section className="surface relative flex-1 min-h-[55vh] md:min-h-0 md:h-auto p-0 overflow-hidden">
          <StructurePreview3D />
          <FloatingControl activeDrawer={activeDrawer} onOpen={setActiveDrawer} />
          <RunButton />
        </section>

        <aside className="surface flex-1 md:flex-1 md:max-w-[36%] xl:max-w-[34%] min-h-[280px] md:min-h-0 p-0 overflow-hidden">
          <SitePickerMap />
        </aside>
      </main>

      <Drawer
        open={activeDrawer !== null}
        title={activeDrawer ? TITLES[activeDrawer] : ''}
        onClose={() => setActiveDrawer(null)}
      >
        {activeDrawer === 'structure' && <StructureForm />}
        {activeDrawer === 'scenario' && <ScenarioSelector />}
        {activeDrawer === 'result' && <ResultPanel />}
      </Drawer>
    </div>
  );
};

export default App;
