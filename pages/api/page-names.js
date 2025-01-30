// pages/api/page-names.js

import { supabase } from '../../lib/db'; // Adjust path if needed

/**
 * An API route that handles server-side pagination:
 * - Accepts a "page" param (default=1).
 * - Returns 200 items for that page, sorted by 'human_readable_name'.
 * - Also returns 'totalCount' so the client can compute total pages.
 *
 * Example request: GET /api/page-names?page=2
 * Example response:
 * {
 *   "pages": [
 *     { "name": "Cavalier", "slug": "cavalier" },
 *     ...
 *   ],
 *   "totalCount": 1032,
 *   "page": 2,
 *   "pageSize": 200
 * }
 */

export default async function handler(req, res) {
  console.log("[page-names] Entered route with query:", req.query);

  try {
    // 1) Determine which page we want
    const pageParam = parseInt(req.query.page, 10) || 1;  // default 1 if not provided
    const PAGE_SIZE = 200;

    // 2) Calculate row range for Supabase
    // Supabase's range is inclusive, so we do endIndex = startIndex + PAGE_SIZE - 1
    const startIndex = (pageParam - 1) * PAGE_SIZE;
    const endIndex = startIndex + PAGE_SIZE - 1;

    // 3) Query the table with an exact count
    // We'll sort by 'human_readable_name' ascending
    // The result includes 'count' so we know how many rows total
    const { data, count, error } = await supabase
      .from('faq_files')
      .select('id, slug, human_readable_name', { count: 'exact' }) 
      .order('human_readable_name', { ascending: true })
      .range(startIndex, endIndex);

    // Handle any Supabase error
    if (error) {
      console.error("[page-names] Supabase error:", error);
      return res.status(500).json({ error: 'Failed to fetch data from database' });
    }

    // If no rows found, return an empty array
    if (!data) {
      console.log("[page-names] No rows found. Returning empty array.");
      return res.status(200).json({
        pages: [],
        totalCount: 0,
        page: pageParam,
        pageSize: PAGE_SIZE
      });
    }

    // 4) Transform each row into { name, slug }
    const pages = data.map(row => ({
      name: row.human_readable_name || row.slug, // fallback if name is null
      slug: row.slug,
    }));

    console.log(`[page-names] Returning ${pages.length} items (page ${pageParam}). Total in DB = ${count}`);

    // Return both the data slice and the total count
    return res.status(200).json({
      pages,
      totalCount: count || 0,
      page: pageParam,
      pageSize: PAGE_SIZE,
    });
  } catch (err) {
    console.error("[page-names] Unexpected error:", err);
    return res.status(500).json({ error: err.message });
  }
}
