/** Creates an opaque, stable identifier for one saved game record. */
export function createShogiGameRecordId(): string {
  return `shogi-game-${globalThis.crypto.randomUUID()}`;
}
