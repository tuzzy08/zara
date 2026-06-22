import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface TenantJsonStateRecord {
  organizationId: string;
}

export interface TenantJsonStateRepository<TRecord extends TenantJsonStateRecord> {
  listOrganizationIds: () => string[];
  load: (organizationId: string) => TRecord | null;
  save: (record: TRecord) => void;
}

export interface CreateTenantJsonStateRepositoryInput<TRecord extends TenantJsonStateRecord> {
  directoryPath: string;
  validate: (value: unknown, organizationId: string) => value is TRecord;
  normalize?: ((record: TRecord) => TRecord) | undefined;
  quarantineCorrupt?: boolean | undefined;
  trailingNewline?: boolean | undefined;
}

export function createTenantJsonStateRepository<TRecord extends TenantJsonStateRecord>(
  input: CreateTenantJsonStateRepositoryInput<TRecord>,
): TenantJsonStateRepository<TRecord> {
  return new FileTenantJsonStateRepository(input);
}

class FileTenantJsonStateRepository<TRecord extends TenantJsonStateRecord>
  implements TenantJsonStateRepository<TRecord> {
  private readonly directoryPath: string;
  private readonly validate: (value: unknown, organizationId: string) => value is TRecord;
  private readonly normalize: (record: TRecord) => TRecord;
  private readonly quarantineCorrupt: boolean;
  private readonly trailingNewline: boolean;

  constructor(input: CreateTenantJsonStateRepositoryInput<TRecord>) {
    this.directoryPath = resolve(input.directoryPath);
    this.validate = input.validate;
    this.normalize = input.normalize ?? ((record) => record);
    this.quarantineCorrupt = input.quarantineCorrupt ?? true;
    this.trailingNewline = input.trailingNewline ?? false;
  }

  listOrganizationIds() {
    if (!existsSync(this.directoryPath)) {
      return [];
    }

    return readdirSync(this.directoryPath)
      .filter((fileName) => fileName.endsWith(".json") && !fileName.includes(".corrupt-"))
      .map((fileName) => fileName.slice(0, -".json".length))
      .map((fileToken) => this.decodeOrganizationId(fileToken))
      .sort((left, right) => left.localeCompare(right));
  }

  load(organizationId: string): TRecord | null {
    const filePath = this.resolveStateFilePath(organizationId);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8"));

      if (!this.validate(parsed, organizationId)) {
        throw new Error("Tenant JSON state snapshot structure is invalid.");
      }

      return this.normalize(parsed);
    } catch (error) {
      if (!this.quarantineCorrupt) {
        throw error;
      }

      this.quarantineCorruptSnapshot(organizationId, filePath);
      return null;
    }
  }

  save(record: TRecord) {
    mkdirSync(this.directoryPath, { recursive: true });

    const nextFilePath = this.resolveStateFilePath(record.organizationId);
    const temporaryFilePath = `${nextFilePath}.tmp`;
    const serialized = JSON.stringify(record, null, 2);

    writeFileSync(
      temporaryFilePath,
      this.trailingNewline ? `${serialized}\n` : serialized,
      "utf8",
    );
    rmSync(nextFilePath, { force: true });
    renameSync(temporaryFilePath, nextFilePath);
  }

  private resolveStateFilePath(organizationId: string) {
    return this.resolveContainedPath(`${this.encodeOrganizationIdForFile(organizationId)}.json`);
  }

  private quarantineCorruptSnapshot(organizationId: string, filePath: string) {
    const fileToken = this.encodeOrganizationIdForFile(organizationId);
    const corruptFilePath = this.resolveContainedPath(`${fileToken}.corrupt-${Date.now()}.json`);

    mkdirSync(this.directoryPath, { recursive: true });
    renameSync(filePath, corruptFilePath);
  }

  private encodeOrganizationIdForFile(organizationId: string) {
    return encodeURIComponent(organizationId);
  }

  private decodeOrganizationId(fileToken: string) {
    try {
      return decodeURIComponent(fileToken);
    } catch {
      return fileToken;
    }
  }

  private resolveContainedPath(fileName: string) {
    const filePath = resolve(this.directoryPath, fileName);
    const relativePath = relative(this.directoryPath, filePath);

    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new Error("Tenant JSON state path escaped the repository directory.");
    }

    return filePath;
  }
}
