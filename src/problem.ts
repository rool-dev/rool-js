import type { RoolProblemDetails } from "./types.js";

// Codes the server will rename once every client is on 2.2.0; callers see the
// new name from both the current and the future server.
const RENAMED_CODES: Record<string, string> = {
  account_suspended: "user_suspended",
  account_access_required: "plan_required",
};

export class RoolProblem extends Error {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail: string;

  constructor(problem: RoolProblemDetails) {
    super(problem.detail);
    this.name = "RoolProblem";
    this.type = problem.type;
    this.title = problem.title;
    this.status = problem.status;
    this.code = RENAMED_CODES[problem.code] ?? problem.code;
    this.detail = problem.detail;
  }
}

export async function throwProblemResponse(response: Response): Promise<never> {
  throw new RoolProblem((await response.json()) as RoolProblemDetails);
}
