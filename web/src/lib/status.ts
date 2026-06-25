import type { BadgeProps } from "../components/ui/badge";

/** Cor semântica por classe de status HTTP (ADR-6 — lição Bruno/Hoppscotch). */
export function statusVariant(status: number): NonNullable<BadgeProps["variant"]> {
  if (status >= 200 && status < 300) return "success";
  if (status >= 300 && status < 400) return "warning";
  return "danger"; // 4xx/5xx (e qualquer outro) → erro
}
