/**
 * Erros de domínio do core do Hodor.
 *
 * Fail-fast, tipado e com contexto (Unbreakable Rule 8): uma falha de rede
 * não é um "valor mágico" nem uma exceção genérica — é um erro nomeado que
 * carrega a URL e a causa original para diagnóstico.
 */
export class RequestExecutionError extends Error {
  override readonly name = "RequestExecutionError";

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}
