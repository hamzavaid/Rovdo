/**
 * Synthetic provider responses for adapter and local HTTP-server tests.
 * Streaming/tool/usage fixtures exercise real normalization paths without paid model requests.
 */
export function sse(events: unknown[], anthropic = false): Response {
  const data =
    events
      .map(
        (event) =>
          `${anthropic ? `event: ${(event as { type: string }).type}\r\n` : ''}data: ${JSON.stringify(event)}\r\n\r\n`,
      )
      .join('') + (anthropic ? '' : 'data: [DONE]\r\n\r\n');
  const bytes = new TextEncoder().encode(data);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 17)
          controller.enqueue(bytes.slice(offset, offset + 17));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

export function completion(kind: string, tool = false, text = 'Hello café'): Response {
  if (kind === 'anthropic')
    return sse(
      [
        {
          type: 'message_start',
          message: {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            content: [],
            usage: { input_tokens: 12, output_tokens: 0 },
          },
        },
        {
          type: 'content_block_start',
          index: 0,
          content_block: tool
            ? { type: 'tool_use', id: 'call_1', name: 'workspace_info', input: {} }
            : { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: tool
            ? { type: 'input_json_delta', partial_json: '{' }
            : { type: 'text_delta', text: text.slice(0, 4) },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: tool
            ? { type: 'input_json_delta', partial_json: '}' }
            : { type: 'text_delta', text: text.slice(4) },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'message_delta',
          delta: { stop_reason: tool ? 'tool_use' : 'end_turn' },
          usage: { output_tokens: 5 },
        },
        { type: 'message_stop' },
      ],
      true,
    );
  return sse([
    {
      choices: [
        {
          index: 0,
          delta: tool
            ? {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'workspace_info', arguments: '{' },
                  },
                ],
              }
            : { content: text.slice(0, 4) },
          finish_reason: null,
        },
      ],
    },
    {
      choices: [
        {
          index: 0,
          delta: tool
            ? { tool_calls: [{ index: 0, function: { arguments: '}' } }] }
            : { content: text.slice(4) },
          finish_reason: null,
        },
      ],
    },
    { choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }] },
    {
      choices: [],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 2 },
      },
    },
  ]);
}
