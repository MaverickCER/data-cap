export function printJsonLines(value: unknown, print: (line: string) => void): void {
  for (const line of JSON.stringify(value, null, 2).split("\n")) print(line)
}
