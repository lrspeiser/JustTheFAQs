//
// /api/util/fetch-and-generate.js
//
import {
  processOnePageFromDB
} from "../../../lib/processSinglePage"; 

export default async function handler(req, res) {
  try {
    // Only allow POST
    if (req.method !== "POST") {
      return res.status(405).json({ message: "Method not allowed" });
    }

    // We handle two cases:
    //  1) If "id" is provided -> use the DB-based approach
    //  2) Else if "title" is provided -> use the old direct approach
    const { id, title } = req.body;

    // 1) If the front-end passes an ID (Step 2: from your "pendingPages" array)
    if (id) {
      console.log(`[fetch-and-generate] Received ID=${id}, using DB-based flow...`);

      const success = await processOnePageFromDB(id);
      if (success) {
        return res.status(200).json({ message: `Successfully processed ID=${id}` });
      } else {
        return res.status(500).json({ message: `Failed to process ID=${id}` });
      }
    }

    // 2) Otherwise, if the front-end passes a "title" (the old approach)
    else if (title) {
      console.log(`[fetch-and-generate] Received title="${title}", using direct wiki fetch flow...`);
      // If you already have content, images, etc. in your DB, you can retrieve them instead.
      // Otherwise, fetch from Wikipedia:
      const metadata = await fetchWikipediaMetadata(title);
      const { lastUpdated, humanReadableName } = metadata;

      const pageData = await fetchWikipediaPage(title);
      if (!pageData) {
        return res.status(404).json({ message: "Page content not found" });
      }

      const { content, images } = pageData;
      const wikiUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`;

      const success = await processWithEnrichment(
        title,
        content,
        images,
        wikiUrl,
        humanReadableName,
        lastUpdated
      );

      if (success) {
        return res.status(200).json({ message: `Successfully processed page: ${title}` });
      } else {
        return res.status(500).json({ message: `Failed to process page: ${title}` });
      }
    }

    // 3) If neither "id" nor "title" was given
    else {
      return res.status(400).json({ message: "No ID or title provided." });
    }
  } catch (error) {
    console.error(`[fetch-and-generate] ❌ Error:`, error);
    return res.status(500).json({ message: error.message });
  }
}
