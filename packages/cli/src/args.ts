const DEFAULT_API_URL = 'https://api.rool.dev';
const DEFAULT_SPACE_NAME = 'Rool CLI';
const DEFAULT_CONVERSATION_ID = 'rool-dev';

export interface CommonArgs {
  space: string;
  conversation: string;
  url: string;
  message: string | undefined;
}

export interface ParsedArgs extends CommonArgs {
  rest: string[];
}

const FLAG_ALIASES: Record<string, keyof CommonArgs> = {
  '-s': 'space',
  '--space': 'space',
  '-c': 'conversation',
  '--conversation': 'conversation',
  '-u': 'url',
  '--url': 'url',
  '-m': 'message',
  '--message': 'message',
};

export function parseArgs(args: string[]): ParsedArgs {
  const result: ParsedArgs = {
    space: DEFAULT_SPACE_NAME,
    conversation: DEFAULT_CONVERSATION_ID,
    url: DEFAULT_API_URL,
    message: undefined,
    rest: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const key = FLAG_ALIASES[arg];

    if (key) {
      const value = args[++i];
      if (!value || value.startsWith('-')) {
        console.error(`Missing value for ${arg}`);
        process.exit(1);
      }
      result[key] = value;
    } else if (arg.startsWith('-')) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    } else {
      result.rest.push(arg);
    }
  }

  return result;
}

export function printCommonOptions(): void {
  console.error('Options:');
  console.error(`  -s, --space <name>         Space name (default: "${DEFAULT_SPACE_NAME}")`);
  console.error(`  -c, --conversation <id>    Conversation ID (default: "${DEFAULT_CONVERSATION_ID}")`);
  console.error(`  -u, --url <url>            API URL (default: ${DEFAULT_API_URL})`);
}
