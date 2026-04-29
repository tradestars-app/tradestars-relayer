export function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} env var is required`);
  }
  return value;
}
