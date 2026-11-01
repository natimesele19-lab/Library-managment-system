import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { currentTenantId } from "./tenant-context.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL must be configured before initializing Prisma.");
}

const adapter = new PrismaPg({ connectionString });
const basePrisma = new PrismaClient({ adapter });

const tenantModels = new Set([
  "User", "Book", "ExamSheet", "Patron", "Loan", "LoanItem", "BookReservation",
  "InventoryAsset", "MediaAsset", "FinePayment", "OverdueReminder", "LibrarySetting",
  "CustomField", "AuditLog",
]);
const readOperations = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany",
  "count", "aggregate", "groupBy",
]);
const writeOperations = new Set([
  "update", "updateMany", "delete", "deleteMany",
]);

function scopeWhere(value: unknown, tenantId: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => scopeWhere(entry, tenantId));
  if (!value || typeof value !== "object") return value;
  return { ...(value as Record<string, unknown>), tenantId };
}

function scopeNested(value: unknown, tenantId: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => scopeNested(entry, tenantId));
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const record = value as Record<string, unknown>;
  const scoped: Record<string, unknown> = { ...record };
  for (const [key, nested] of Object.entries(record)) {
    if (key === "create") {
      scoped[key] = scopeRecord(nested, tenantId);
    } else if (key === "createMany") {
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const createMany = nested as Record<string, unknown>;
        scoped[key] = { ...createMany, data: scopeRecord(createMany.data, tenantId) };
      }
    } else if (key === "connectOrCreate") {
      const entries = Array.isArray(nested) ? nested : [nested];
      const updated = entries.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const operation = entry as Record<string, unknown>;
        return { ...operation, where: scopeWhere(operation.where, tenantId), create: scopeRecord(operation.create, tenantId) };
      });
      scoped[key] = Array.isArray(nested) ? updated : updated[0];
    } else if (key === "upsert") {
      const entries = Array.isArray(nested) ? nested : [nested];
      const updated = entries.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const operation = entry as Record<string, unknown>;
        return {
          ...operation,
          where: operation.where === undefined ? undefined : scopeWhere(operation.where, tenantId),
          create: scopeRecord(operation.create, tenantId),
          update: scopeRecord(operation.update, tenantId),
        };
      });
      scoped[key] = Array.isArray(nested) ? updated : updated[0];
    } else if (key === "connect" || key === "disconnect" || key === "deleteMany") {
      scoped[key] = scopeWhere(nested, tenantId);
    } else if (key === "update") {
      const entries = Array.isArray(nested) ? nested : [nested];
      const updated = entries.map((entry) => {
        if (!entry || typeof entry !== "object") return scopeRecord(entry, tenantId);
        const operation = entry as Record<string, unknown>;
        return operation.where === undefined
          ? scopeRecord(operation, tenantId)
          : { ...operation, where: scopeWhere(operation.where, tenantId), data: scopeRecord(operation.data, tenantId) };
      });
      scoped[key] = Array.isArray(nested) ? updated : updated[0];
    } else if (nested && typeof nested === "object") {
      scoped[key] = scopeNested(nested, tenantId);
    }
  }
  return scoped;
}

function scopeRecord(value: unknown, tenantId: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => scopeRecord(entry, tenantId));
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const record = value as Record<string, unknown>;
  const scoped: Record<string, unknown> = { ...record, tenantId };
  for (const [key, nested] of Object.entries(record)) {
    if (key === "create") {
      scoped[key] = scopeRecord(nested, tenantId);
    } else if (key === "createMany") {
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        const createMany = nested as Record<string, unknown>;
        scoped[key] = { ...createMany, data: scopeRecord(createMany.data, tenantId) };
      }
    } else if (key === "connectOrCreate") {
      const entries = Array.isArray(nested) ? nested : [nested];
      scoped[key] = entries.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const operation = entry as Record<string, unknown>;
        return { ...operation, where: scopeWhere(operation.where, tenantId), create: scopeRecord(operation.create, tenantId) };
      });
    } else if (key === "upsert") {
      const entries = Array.isArray(nested) ? nested : [nested];
      const updated = entries.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const operation = entry as Record<string, unknown>;
        return {
          ...operation,
          where: operation.where === undefined ? undefined : scopeWhere(operation.where, tenantId),
          create: scopeRecord(operation.create, tenantId),
          update: scopeRecord(operation.update, tenantId),
        };
      });
      scoped[key] = Array.isArray(nested) ? updated : updated[0];
    } else if (key === "connect" || key === "disconnect" || key === "deleteMany") {
      scoped[key] = scopeWhere(nested, tenantId);
    } else if (key === "update") {
      const entries = Array.isArray(nested) ? nested : [nested];
      const updated = entries.map((entry) => {
        if (!entry || typeof entry !== "object") return scopeRecord(entry, tenantId);
        const operation = entry as Record<string, unknown>;
        return operation.where === undefined
          ? scopeRecord(operation, tenantId)
          : { ...operation, where: scopeWhere(operation.where, tenantId), data: scopeRecord(operation.data, tenantId) };
      });
      scoped[key] = Array.isArray(nested) ? updated : updated[0];
    } else if (nested && typeof nested === "object") {
      scoped[key] = scopeNested(nested, tenantId);
    }
  }
  return scoped;
}

export const prisma = basePrisma.$extends({
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        const tenantId = currentTenantId();
        if (!tenantId || !tenantModels.has(model)) return query(args);
        const scopedArgs = { ...args } as typeof args & {
          where?: Record<string, unknown>;
          data?: unknown;
          create?: unknown;
          update?: unknown;
        };
        if (readOperations.has(operation) || writeOperations.has(operation)) {
          scopedArgs.where = { ...scopedArgs.where, tenantId };
        }
        if (operation === "create") scopedArgs.data = scopeRecord(scopedArgs.data, tenantId);
        if (operation === "createMany") scopedArgs.data = scopeRecord(scopedArgs.data, tenantId);
        if (operation === "upsert") {
          scopedArgs.create = scopeRecord(scopedArgs.create, tenantId);
          scopedArgs.update = scopeRecord(scopedArgs.update, tenantId);
        }
        if (operation === "update" || operation === "updateMany") scopedArgs.data = scopeRecord(scopedArgs.data, tenantId);
        return query(scopedArgs);
      },
    },
  },
});
