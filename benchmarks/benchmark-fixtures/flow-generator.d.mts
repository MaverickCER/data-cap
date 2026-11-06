export const FLOW_FIXTURE_VERSION: number
export interface FlowProjectOptions {
  readonly files: number
  readonly groupSize?: number
  readonly leakEvery?: number
  readonly logEvery?: number
}
export function renderFlowModule(index: number, options: FlowProjectOptions): string
export function flowProjectFiles(options: FlowProjectOptions): Record<string, string>
export function writeFlowProject(
  outputDir: string,
  options: FlowProjectOptions,
): Promise<{ readonly files: number; readonly functions: number; readonly written: number }>
export function wrapperChainProject(depth: number): Record<string, string>
export function explosiveProject(breadth: number, levels: number): Record<string, string>
