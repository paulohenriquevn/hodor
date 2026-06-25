import { useState } from "react";
import { postVerdict, ApiError } from "../api";
import { Button } from "./ui/button";

/**
 * Form de verdict (DoD #3). SÓ registra a decisão humana — NUNCA auto-aprova
 * (contrato M2). Erro de validação da API é exibido, não engolido (CLAUDE.md §8).
 */
export function VerdictForm({
  runId,
  hasFailingAsserts = false,
  onDecided,
}: {
  runId: string;
  hasFailingAsserts?: boolean;
  onDecided?: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function decide(verdict: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      await postVerdict(runId, { verdict, ...(note ? { note } : {}) });
      onDecided?.();
    } catch (e) {
      setError(e instanceof ApiError ? `Falha ao registrar verdict (${e.status})` : "Falha inesperada");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      {hasFailingAsserts && (
        <p role="status" className="text-sm text-amber-800 bg-amber-100 rounded p-2">
          ⚠ Este run tem <strong>asserts falhando</strong>. Aprová-lo o tornará o{" "}
          <strong>baseline de regressão (golden)</strong> deste cenário — confirme que o comportamento é mesmo o
          esperado.
        </p>
      )}
      <label className="text-sm font-medium" htmlFor="verdict-note">
        Nota (opcional)
      </label>
      <textarea
        id="verdict-note"
        className="border border-border rounded p-2 text-sm"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <Button variant="success" disabled={busy} onClick={() => decide("approved")}>
          Aprovar
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => decide("rejected")}>
          Rejeitar
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
