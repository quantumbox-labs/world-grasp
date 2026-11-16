import type { Core, World } from '../core';

export function WorldTabs({ core, worlds, value, onChange, className = 'tabs' }: {
  core: Core; worlds: World[]; value: World; onChange: (w: World) => void; className?: string;
}) {
  return (
    <div className={className}>
      {worlds.map((w) => (
        <button key={w} data-w={w} className={w === value ? 'on' : ''} onClick={() => onChange(w)}>
          {core.world(w).icon} {core.world(w).label}
        </button>
      ))}
    </div>
  );
}
