// The exec route's reply is the machine's own output frames, passed on unread:
// [kind u8][length u32 BE][payload]. 1 stdout, 2 stderr, 3 error (text), 4 exit (JSON).

export type MachineExecEvent =
  | { type: "stdout"; data: Uint8Array }
  | { type: "stderr"; data: Uint8Array }
  | { type: "exit"; exitCode: number; durationMs: number };

const STDOUT = 1;
const STDERR = 2;
const ERROR = 3;
const EXIT = 4;

/**
 * The command's output as it is produced; the last event is its exit. A
 * command the machine cut off, at its deadline for one, says why on stderr and
 * exits -1. One that could not be run at all rejects with the reason.
 */
export async function* readExecStream(
  response: Response,
): AsyncGenerator<MachineExecEvent> {
  if (!response.body) throw new Error("The exec reply has no body");
  const reader = response.body.getReader();
  let pending: Uint8Array = new Uint8Array(0);
  let failure: string | undefined;
  const received = { [STDOUT]: 0, [STDERR]: 0 };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending = concat(pending, value);
      while (pending.length >= 5) {
        const size = new DataView(pending.buffer, pending.byteOffset).getUint32(
          1,
        );
        if (pending.length < 5 + size) break;
        const kind = pending[0];
        const payload = pending.slice(5, 5 + size);
        pending = pending.subarray(5 + size);
        if (kind === STDOUT || kind === STDERR) {
          received[kind] += size;
          yield { type: kind === STDOUT ? "stdout" : "stderr", data: payload };
        } else if (kind === ERROR) {
          failure = new TextDecoder().decode(payload);
          yield {
            type: "stderr",
            data: new TextEncoder().encode(`${failure}\n`),
          };
        } else if (kind === EXIT) {
          const exit = JSON.parse(new TextDecoder().decode(payload)) as {
            exitCode: number;
            durationMs: number;
            stdoutBytes: number;
            stderrBytes: number;
          };
          const lost =
            exit.stdoutBytes !== received[STDOUT] ||
            exit.stderrBytes !== received[STDERR];
          if (lost) throw new Error("Part of the command's output was lost");
          yield {
            type: "exit",
            exitCode: exit.exitCode,
            durationMs: exit.durationMs,
          };
          return;
        } else {
          throw new Error(`Unknown exec frame kind ${kind}`);
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  throw new Error(failure ?? "The command's output ended before its exit");
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a);
  joined.set(b, a.length);
  return joined;
}
