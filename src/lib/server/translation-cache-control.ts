let knowledgeGeneration = 0;

export function getKnowledgeCacheGeneration(): number {
  return knowledgeGeneration;
}

export function invalidateKnowledgeTranslationCaches(): void {
  knowledgeGeneration += 1;
}
