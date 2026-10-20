/**
 * Reusable in-flight action exclusion and visible progress state.
 * The gate closes synchronously, before React can render disabled controls after a rapid second click.
 */
import { useRef, useState } from 'react';
/** A ref-backed gate closes before React renders disabled controls. */
export function createActionGate() {
  let pending = false;
  return {
    async run(work: () => Promise<void>): Promise<boolean> {
      if (pending) return false;
      pending = true;
      try {
        await work();
        return true;
      } finally {
        pending = false;
      }
    },
  };
}
export function useActionState() {
  const gate = useRef(createActionGate());
  const [label, setLabel] = useState<string | null>(null);
  const run = (label: string, work: () => Promise<void>) =>
    gate.current.run(async () => {
      setLabel(label);
      try {
        await work();
      } finally {
        setLabel(null);
      }
    });
  return { pending: label !== null, label, run };
}
