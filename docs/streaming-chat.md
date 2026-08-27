# Chat streaming contract

`/api/chat` and `/api/copilot/reply` return UTF-8 NDJSON (`application/x-ndjson`). Each line is one JSON event with a request ID and one of these stable types:

- `meta`: internal classification metadata; never customer-visible body text.
- `status`: progress label/detail and elapsed time; never customer-visible body text.
- `delta`: a model body fragment to append immediately and in order.
- `final`: the authoritative, fully post-processed customer reply which replaces the draft assembled from deltas.
- `error`: an explicit terminal stream failure message.

The client must use a streaming `TextDecoder`, retain incomplete lines between network reads, and scope updates to the request and conversation that started generation. Cancellation aborts the upstream model fetch.

## Current limitation

The existing QA review, language repair, terminology enforcement, sanitization, and structured-reply construction still require the complete draft. To preserve current business results, `delta` events show the main model draft as it arrives, while `final` atomically replaces it with the existing post-processed result. A preview can therefore change when final QA completes. This task intentionally does not redesign those model and post-processing rules.

## Preview verification

With a deployed preview and real model configuration:

1. Generate a long multilingual reply and confirm text appears before model completion.
2. Stop generation after several visible fragments and confirm no further text appears.
3. Rapidly click send, switch conversations during generation, then generate in both conversations; confirm no content crosses conversations.
4. Confirm the final reply still follows the configured knowledge, prompt, provider/model, terminology, language, QA, and structured-section rules.
5. Exercise the browser extension reply flow and confirm the deployed proxy begins returning NDJSON immediately.
