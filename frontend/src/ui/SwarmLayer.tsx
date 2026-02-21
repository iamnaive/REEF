import { useMemo, useState, type CSSProperties } from "react";
import type { DebuffId } from "../base/mechanics";
import type { SwarmInstance } from "../events/SwarmEventSystem";

type SwarmLayerProps = {
  drawRect: { left: number; top: number; width: number; height: number };
  mapScaleX: number;
  mapScaleY: number;
  swarms: Partial<Record<DebuffId, SwarmInstance>>;
  onWipe: (debuffId: DebuffId, x: number, y: number) => { hits: number; kills: number } | null;
};

type LocalBurst = {
  id: string;
  x: number;
  y: number;
  count: number;
  t0: number;
};

export function SwarmLayer({ drawRect, mapScaleX, mapScaleY, swarms, onWipe }: SwarmLayerProps) {
  const [bursts, setBursts] = useState<LocalBurst[]>([]);

  const units = useMemo(() => {
    const out: Array<{ debuffId: DebuffId; unit: SwarmInstance["units"][number] }> = [];
    (Object.keys(swarms) as DebuffId[]).forEach((id) => {
      const swarm = swarms[id];
      if (!swarm) return;
      swarm.units.forEach((unit) => out.push({ debuffId: id, unit }));
    });
    return out;
  }, [swarms]);

  return (
    <div
      className="swarm-layer"
      style={{
        left: drawRect.left,
        top: drawRect.top,
        width: drawRect.width,
        height: drawRect.height
      }}
    >
      {units.map(({ debuffId, unit }) => (
        <div
          key={unit.id}
          className={["swarm-unit", "mop-cursor", `swarm-${debuffId}`, unit.hitUntilMs > Date.now() ? "hit" : ""].join(" ")}
          style={{
            left: unit.x * mapScaleX,
            top: unit.y * mapScaleY
          }}
          onClick={(event) => {
            event.stopPropagation();
            const result = onWipe(debuffId, unit.x, unit.y);
            if (result && result.hits > 0) {
              const burst: LocalBurst = {
                id: crypto.randomUUID(),
                x: unit.x,
                y: unit.y,
                count: Math.max(8, Math.min(16, result.hits * 2)),
                t0: Date.now()
              };
              setBursts((prev) => [...prev, burst]);
              window.setTimeout(() => {
                setBursts((prev) => prev.filter((item) => item.id !== burst.id));
              }, 650);
            }
          }}
        >
          <div className="swarm-dot" />
          <div className="swarm-label">{unit.label}</div>
        </div>
      ))}
      {bursts.map((burst) => (
        <div
          key={burst.id}
          className="swarm-burst"
          style={{
            left: burst.x * mapScaleX,
            top: burst.y * mapScaleY
          }}
        >
          {Array.from({ length: burst.count }).map((_, idx) => (
            <span
              key={`${burst.id}-${idx}`}
              className="swarm-burst-particle"
              style={
                {
                  "--ang": `${(idx * 360) / burst.count}deg`,
                  "--dist": `${22 + (idx % 5) * 6}px`
                } as CSSProperties
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}
