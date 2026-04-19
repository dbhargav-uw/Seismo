import { useEffect, useRef, useState } from 'react';

import type { StructureSystem } from '../api/types';
import { useViabilityStore } from '../features/viability/store';

export type DrawerKey = 'structure' | 'scenario' | 'result';

interface FloatingControlProps {
  activeDrawer: DrawerKey | null;
  onOpen: (drawer: DrawerKey) => void;
}

const SYSTEM_LABELS: Record<StructureSystem, string> = {
  concrete_moment_frame: 'concrete frame',
  steel_moment_frame: 'steel frame',
  wood_light_frame: 'wood frame',
  masonry: 'masonry',
};

interface MenuItem {
  key: DrawerKey;
  label: string;
  sub: string;
  disabled: boolean;
  disabledHint?: string;
}

export const FloatingControl = ({ activeDrawer, onOpen }: FloatingControlProps): JSX.Element => {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fabRef = useRef<HTMLButtonElement | null>(null);

  const structure = useViabilityStore((s) => s.structure);
  const scenarios = useViabilityStore((s) => s.scenarios);
  const selectedScenarioId = useViabilityStore((s) => s.selectedScenarioId);
  const result = useViabilityStore((s) => s.result);

  const structureSummary = `${structure.stories}-st ${SYSTEM_LABELS[structure.system]} · ${structure.plan_x_m}×${structure.plan_y_m} m`;
  const activeScenario = scenarios.find((s) => s.scenario_id === selectedScenarioId);
  const scenarioSummary = activeScenario?.label ?? 'Pick a scenario';
  const resultSummary = result
    ? `${(result.score.total * 100).toFixed(0)} % · ${result.scenario.label}`
    : 'Run a check first';

  // Click-outside closes the menu (drawer interactions don't count as outside).
  useEffect(() => {
    if (!menuOpen) return undefined;
    const handler = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // ESC closes the menu (drawer's own ESC handler runs only when drawer is open).
  useEffect(() => {
    if (!menuOpen) return undefined;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setMenuOpen(false);
        fabRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [menuOpen]);

  const items: MenuItem[] = [
    { key: 'structure', label: 'Structure', sub: structureSummary, disabled: false },
    { key: 'scenario', label: 'Scenario', sub: scenarioSummary, disabled: false },
    {
      key: 'result',
      label: 'Result',
      sub: resultSummary,
      disabled: result === null,
      disabledHint: 'Run a viability check first',
    },
  ];

  const choose = (item: MenuItem): void => {
    if (item.disabled) return;
    onOpen(item.key);
    setMenuOpen(false);
  };

  return (
    <div ref={containerRef} className="absolute top-4 left-4 z-20">
      <button
        ref={fabRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={menuOpen ? 'Close controls' : 'Open controls'}
        onClick={() => setMenuOpen((v) => !v)}
        className={`flex items-center justify-center w-11 h-11 rounded-full bg-plate/90 border border-line text-slate-100 shadow-lg backdrop-blur transition-all duration-200 hover:border-accent/60 hover:text-accent focus:outline-none focus:ring-2 focus:ring-accent/60 ${
          menuOpen ? 'rotate-90 border-accent/60 text-accent' : ''
        }`}
      >
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      <div
        role="menu"
        aria-orientation="vertical"
        className={`absolute left-[calc(100%+10px)] top-0 w-[260px] origin-left bg-plate/95 backdrop-blur border border-line rounded-lg shadow-2xl overflow-hidden transition-all duration-200 ${
          menuOpen ? 'opacity-100 translate-x-0 pointer-events-auto' : 'opacity-0 -translate-x-1 pointer-events-none'
        }`}
      >
        {items.map((item) => {
          const isActive = activeDrawer === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={menuOpen ? 0 : -1}
              disabled={item.disabled}
              title={item.disabled ? item.disabledHint : undefined}
              onClick={() => choose(item)}
              className={`w-full text-left px-3 py-2.5 transition-colors border-l-2 focus:outline-none ${
                isActive ? 'border-l-accent bg-accent/10' : 'border-l-transparent hover:bg-line/40 focus:bg-line/40'
              } ${item.disabled ? 'opacity-50 cursor-not-allowed hover:bg-transparent' : ''}`}
            >
              <div className="text-sm font-medium text-slate-100">{item.label}</div>
              <div className="text-[11px] text-muted mt-0.5 truncate">{item.sub}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
