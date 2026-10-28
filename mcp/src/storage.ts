import { access, constants, mkdir, readFile, rename, chmod, writeFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";

function segment(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value)) throw new Error("Invalid local record identifier.");
  return value;
}

/** Private, local JSON artifacts. Source histories are never changed. */
export class Store {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); }
  async init(): Promise<void> {
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await chmod(this.root, 0o700);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "unknown error";
      throw new Error(`Local storage ${this.root} is unavailable (${code}). Mount the volume that holds it, or set AGENT_ME_MCP_DATA_DIR to a writable folder.`);
    }
  }
  /** Whether records can be written now, without creating anything. */
  async available(): Promise<boolean> { return access(this.root, constants.W_OK).then(() => true, () => false); }
  path(kind: string, id: string): string { return join(this.root, segment(kind), `${segment(id)}.json`); }
  async save<T>(kind: string, id: string, value: T): Promise<string> {
    const target = this.path(kind, id);
    const directory = join(this.root, segment(kind));
    await this.init();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => undefined); }
    return target;
  }
  async read<T>(kind: string, id: string): Promise<T> {
    return JSON.parse(await readFile(this.path(kind, id), "utf8")) as T;
  }
}
