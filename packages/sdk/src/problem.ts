import type { RoolProblemDetails } from "./types.js";

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
    this.code = problem.code;
    this.detail = problem.detail;
  }
}

export async function throwProblemResponse(response: Response): Promise<never> {
  throw new RoolProblem((await response.json()) as RoolProblemDetails);
}
