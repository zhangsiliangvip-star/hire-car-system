export async function readAllPages<T>(
  readPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const pageSize = 500;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await readPage(from, from + pageSize - 1);
    if (error) throw error;
    if (!data) throw new Error("Supabase returned a null page without a query error.");
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
}
