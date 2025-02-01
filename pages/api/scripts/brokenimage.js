//
// brokenimage.js
//

import dotenv from "dotenv";
dotenv.config();

import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

/**
 * Initialize Supabase
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

/**
 * Fetch all media links from Supabase
 */
async function fetchMediaLinksFromSupabase() {
  console.log("[Supabase] Fetching media links...");

  const { data, error } = await supabase
    .from("raw_faqs")
    .select("id, media_link")
    .not("media_link", "is", null);

  if (error) {
    console.error("[Supabase] ❌ Error fetching media links:", error.message);
    return [];
  }

  console.log(`[Supabase] Found ${data.length} media links.`);
  return data;
}

/**
 * Sleep function to delay requests (in milliseconds)
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if a media URL is broken by detecting "File not found" text.
 * Includes rate-limit handling (429 errors).
 */
async function isBrokenMedia(url, retryCount = 0) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "MyMediaChecker/1.0" }, // Some APIs require this
    });

    if (response.status === 429) {
      // Rate-limited, wait and retry
      const waitTime = Math.pow(2, retryCount) * 1000; // Exponential backoff
      console.log(`[Rate Limit] 429 received. Retrying in ${waitTime / 1000} seconds...`);
      await sleep(waitTime);
      return isBrokenMedia(url, retryCount + 1);
    }

    if (!response.ok) {
      console.log(`[Check] ❌ Broken URL: ${url} (Status: ${response.status})`);
      return true; // Clearly broken if non-200 status
    }

    const bodyText = await response.text();

    // Check if response body contains the "File not found" pattern
    if (bodyText.includes("File not found: /v1/AUTH_mw")) {
      console.log(`[Check] ❌ Found "File not found" error in response: ${url}`);
      return true;
    }

    return false;
  } catch (error) {
    console.log(`[Check] ❌ Error fetching URL: ${url}`);
    return true; // If we can't reach it, assume it's broken
  }
}

/**
 * Identify broken media links in Supabase with rate-limiting
 */
async function findBrokenMediaLinks() {
  const mediaRecords = await fetchMediaLinksFromSupabase();
  if (!mediaRecords.length) return [];

  const brokenMedia = [];
  for (const record of mediaRecords) {
    const { id, media_link } = record;

    // Slow down requests to avoid hitting API limits (delay 500ms per request)
    await sleep(500);

    const isBroken = await isBrokenMedia(media_link);
    if (isBroken) {
      brokenMedia.push({ id, media_link });
    }
  }

  console.log(`[Check] Found ${brokenMedia.length} broken media links.`);
  return brokenMedia;
}

/**
 * Delete broken media links from Supabase
 */
async function deleteBrokenMediaLinks(brokenMedia) {
  if (!brokenMedia.length) {
    console.log("[Delete] No broken media links to delete.");
    return;
  }

  console.log("[Delete] Deleting broken media links...");
  for (const { id, media_link } of brokenMedia) {
    const { error } = await supabase
      .from("raw_faqs")
      .update({ media_link: null }) // Remove media_link
      .eq("id", id);

    if (error) {
      console.error(`[Delete] ❌ Error deleting media_link for ID=${id}:`, error.message);
    } else {
      console.log(`[Delete] ✅ Removed media_link for ID=${id}, URL=${media_link}`);
    }
  }

  console.log("[Delete] ✅ Finished deleting broken media links.");
}

/**
 * Main function: Find and remove broken media links
 */
async function checkAndRemoveBrokenMedia() {
  try {
    const brokenMedia = await findBrokenMediaLinks();

    if (!brokenMedia.length) {
      console.log("[Main] 🎉 No broken media links found. Exiting.");
      return;
    }

    console.log("[Main] Broken media links detected:");
    console.table(brokenMedia);

    // Confirm before deleting
    const userInput = await promptUser(
      "Do you want to delete these broken media links from Supabase? (yes/no): "
    );
    if (userInput.toLowerCase() === "yes") {
      await deleteBrokenMediaLinks(brokenMedia);
    } else {
      console.log("[Main] ❌ Deletion canceled. Exiting.");
    }
  } catch (err) {
    console.error("[Main] ❌ Unexpected error:", err.message);
  }
}

/**
 * Helper function to prompt user for confirmation
 */
async function promptUser(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.once("data", (data) => resolve(data.toString().trim()));
  });
}

// Run
checkAndRemoveBrokenMedia();
