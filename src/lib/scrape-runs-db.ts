import { Prisma } from '@prisma/client';

/** Prisma P2021: table does not exist (e.g. migration not applied). */
export function isMissingScrapeRunsTable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021'
  );
}
