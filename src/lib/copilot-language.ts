/**
 * Return a reliable language hint for extension requests.
 *
 * Product names and UI labels often add Latin characters to an otherwise
 * Chinese customer message. Treat a real run of Han text as authoritative so
 * the downstream model cannot mistake that message for English.
 */
export function getCopilotLanguageHint(message: string): "zh" | undefined {
  const hanCharacters = message.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return hanCharacters >= 2 ? "zh" : undefined;
}