/**
 * Runs `create`, a learner table's creation, treating a table that already
 * exists as success: DynamoDB local keeps its tables until `pnpm db:down`, so
 * every local start after the first finds one.
 *
 * @returns Whether the table was created now.
 */
export async function ensureTable(create: () => Promise<void>): Promise<boolean> {
  try {
    await create();
    return true;
  } catch (error) {
    if (error instanceof Error && error.name === "ResourceInUseException") {
      return false;
    }
    throw error;
  }
}
