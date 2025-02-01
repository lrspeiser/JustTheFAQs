//
// lib/secondPass.js
//

import { openai, functions } from "./processSinglePage"; // We'll import the same openai client
import {
  truncateContent,
  formatCrossLinks,
  generateEmbedding,
  insertDataToSupabase,
  formatWikipediaSlug
} from "./processSinglePage";
import { createClient } from "@supabase/supabase-js";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";
dotenv.config();

/**
 * Since this second file might need a Supabase/Pinecone client as well,
 * you can reinitialize here if needed. Otherwise, you could reuse
 * the processSinglePage clients. For clarity, we'll show how to
 * define them again locally. If you'd rather use the exported ones
 * from 'processSinglePage', that's fine too.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const indexName = "faq-embeddings";
const index = pc.index(indexName);

/**
 * 2nd Pass: generateAdditionalFAQs
 *
 * We generate additional FAQs by calling the same OpenAI function-calling approach
 * but focusing on new questions that weren't covered in the first pass.
 */
export async function generateAdditionalFAQs(title, content, existingFAQs) {
  const retryAttempts = 3;
  let lastError = null;
  const existingQuestions = existingFAQs
  .map(
    (faq) => `- ${faq.question}\n  Subheader: ${faq.subheader}`
  )
  .join("\n");



  for (let attempt = 0; attempt < retryAttempts; attempt++) {
    try {
      console.log(`[generateAdditionalFAQs] Attempt ${attempt + 1}/${retryAttempts} for "${title}"`);

      // 1) Truncate as usual
      const { truncatedContent } = truncateContent(content);


      console.log(
        `[generateAdditionalFAQs] 🟡 Calling OpenAI for additional FAQs on "${title}"...`
      );
      const startTime = Date.now();

      const [response] = await Promise.all([
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "You are a brilliant writer tasked with extracting additional fascinating FAQs from Wikipedia content that weren't covered in the first pass. Start with the most interesting uncovered questions and work your way down. Focus on clarity, relevance, and engagement while avoiding jargon. Use all available information from Wikipedia, but prioritize what most people would find most interesting among the topics not yet covered. Ensure comprehensive answers and proper use of available images that haven't been used before."
            },
            {
              role: "user",
              content: `Generate additional structured FAQs from this Wikipedia content, avoiding overlap with existing questions while maintaining the same high-quality standards. Focus on interesting aspects that weren't covered in the first pass. DO NOT REPEAT EXISTING QUESTIONS.

Title: ${title}

Content:
${truncatedContent}

Existing Questions (to avoid duplication):
${existingQuestions}

Requirements:
1. Generate entirely new questions that don't overlap with existing ones
2. Focus on the most interesting uncovered aspects first
3. Provide comprehensive, engaging answers
4. Only use images that weren't used in the first pass
5. Maintain the same high standards of clarity and relevance
6. Group under appropriate subheaders
7. Include relevant cross-links,
`
            }
          ],
          functions,
          function_call: { name: "generate_additional_faqs" }
        })
      ]);

      const duration = Date.now() - startTime;
      console.log(`[generateAdditionalFAQs] ✅ Done in ${duration}ms`);

      //
      // NEW LOGGING FOR DEBUGGING: Truncate or omit large fields
      //
      console.log(
        "[generateAdditionalFAQs] openaiRequestId:",
        response.headers?.["openai-request-id"] || "No request ID"
      );
      // We won't log usage or full headers. Just mention them:
      // console.log("[generateAdditionalFAQs] openaiResponse usage:", response.usage || "No usage data");
      // console.log("[generateAdditionalFAQs] openaiResponse headers: (omitted)");

      if (response.choices?.length) {
        console.log("[generateAdditionalFAQs] Received openaiResponse choices. Not logging full text.");
      } else {
        console.log("[generateAdditionalFAQs] No choices returned or empty array.");
      }

      const functionCall = response.choices[0].message.function_call;
      if (!functionCall) {
        throw new Error(`No function call generated for ${title}`);
      }

      // Parse the arguments from the function call
      const args = JSON.parse(functionCall.arguments);

      // Instead of logging the entire JSON, log only length or count:
      const jsonString = JSON.stringify(args);
      console.log(
        `[generateAdditionalFAQs] Received from OpenAI for "${title}". Length of data:`,
        jsonString.length
      );

      if (!args.additional_faqs || !args.additional_faqs.length) {
        console.log(`[generateAdditionalFAQs] No additional FAQs for "${title}".`);
      } else {
        console.log(
          `[generateAdditionalFAQs] ✅ Received ${args.additional_faqs.length} additional FAQ(s) for "${title}"`
        );
      }

      console.log(
        `[generateAdditionalFAQs] ✅ Successfully generated additional FAQs for "${title}"`
      );
      return args.additional_faqs || [];
    } catch (error) {
      lastError = error;
      console.error(
        `[generateAdditionalFAQs] Attempt ${attempt + 1} failed for "${title}":`,
        error.message
      );

      if (attempt < retryAttempts - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[generateAdditionalFAQs] Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`[generateAdditionalFAQs] ❌ All attempts failed for "${title}".`);
  return [];
}


/**
 * Save second-pass (additional) FAQs
 */
export async function saveAdditionalFAQs(title, additionalFaqs, url, humanReadableName, lastUpdated) {
  if (!additionalFaqs || !additionalFaqs.length) {
    console.error("[saveAdditionalFAQs] No additional FAQs to save.");
    return;
  }

  console.log(`[saveAdditionalFAQs] Storing ${additionalFaqs.length} additional FAQ(s) for "${title}".`);

  const slug = formatWikipediaSlug(title);
  const { data: faqFile, error } = await supabase
    .from("faq_files")
    .select("id")
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();

  if (error || !faqFile) {
    console.error(`[saveAdditionalFAQs] ❌ No FAQ file found for "${slug}".`);
    return;
  }
  const faqFileId = faqFile.id;

  const { data: fileRow, error: fileErr } = await supabase
    .from("faq_files")
    .select("slug")
    .eq("id", faqFileId)
    .single();

  if (fileErr) {
    console.error("[saveAdditionalFAQs] ❌ Error fetching slug from faq_files:", fileErr.message);
  }
  const dbSlug = fileRow?.slug || "";

  // Optionally queue cross-links
  const allCrossLinks = formatCrossLinks(additionalFaqs);
  for (const link of allCrossLinks) {
    const crossLinkSlug = formatWikipediaSlug(link);
    const crossLinkTitle = link.replace(/_/g, " ");
    const crossLinkUrl = `https://en.wikipedia.org/wiki/${link}`;
    try {
      const { data: existing } = await supabase
        .from("processing_queue")
        .select("id")
        .eq("slug", crossLinkSlug)
        .maybeSingle();

      if (!existing) {
        await supabase.from("processing_queue").insert([
          {
            title: crossLinkTitle,
            slug: crossLinkSlug,
            url: crossLinkUrl,
            human_readable_name: crossLinkTitle,
            status: "pending",
            source: "cross_link"
          }
        ]);
        console.log(
          `[saveAdditionalFAQs] ✅ Queued cross-link: ${crossLinkTitle}`
        );
      }
    } catch (error) {
      console.error(
        `[saveAdditionalFAQs] Error queueing cross-link ${crossLinkTitle}:`,
        error
      );
    }
  }

  const vectors = []; // We'll store embeddings here
  for (const faq of additionalFaqs) {
    try {
      console.log(`[saveAdditionalFAQs] Inserting FAQ: "${faq.question}"`);
      let mediaUrl = faq.media_links?.[0] || null;
      if (mediaUrl && typeof mediaUrl === "object" && mediaUrl.url) {
        mediaUrl = mediaUrl.url;
      } else if (mediaUrl && typeof mediaUrl === "object" && mediaUrl.media) {
        mediaUrl = mediaUrl.media;
      }

      const relatedPages = Array.isArray(faq.cross_links)
        ? faq.cross_links
            .filter(Boolean)
            .map((link) => link.replace(/^\/wiki\//, ""))
            .join(", ") || null
        : null;

      // Insert the row in raw_faqs
      const faqData = {
        faq_file_id: faqFileId,
        url,
        title,
        human_readable_name: humanReadableName,
        last_updated: lastUpdated,
        subheader: faq.subheader || null,
        question: faq.question,
        answer: faq.answer,
        cross_link: relatedPages,
        media_link: mediaUrl
      };

      const savedFaq = await insertDataToSupabase("raw_faqs", faqData);
      if (!savedFaq) {
        throw new Error("Failed to insert additional FAQ");
      }

      // Generate embedding
      const embeddingText = `
Page Title: ${title}
Subcategory: ${faq.subheader || "General"}
Question: ${faq.question}
Answer: ${faq.answer}
Related Pages: ${relatedPages}
      `.trim();

      console.log(
        `[saveAdditionalFAQs] Generating embedding for additional FAQ: "${faq.question}"`
      );
      const embedding = await generateEmbedding(embeddingText);

      // FIXED: Safely handle 'media_links' array as well
      let cleanedMediaLinks = [];
      if (faq.media_links && Array.isArray(faq.media_links)) {
        cleanedMediaLinks = faq.media_links.map((item) => {
          if (typeof item === "string") {
            return item.trim();
          } else if (item && typeof item === "object" && item.url) {
            return item.url.trim();
          } else if (item && typeof item === "object" && item.media) {
            return item.media.trim();
          }
          return "";
        });
      }

      // If you want to ensure the DB slug is used (rather than from the FAQ object):
      const slug = dbSlug;

      const vector = {
        id: savedFaq.id.toString(),
        values: embedding,
        metadata: {
          faq_file_id: faqFileId.toString(),
          slug: slug,
          question: faq.question || "Unknown Question",
          answer: faq.answer || "No Answer Available",
          url,
          human_readable_name: humanReadableName || "Unknown",
          last_updated: lastUpdated || new Date().toISOString(),
          subheader: faq.subheader || "",
          cross_link: relatedPages
            ? relatedPages.split(",").map((x) => x.trim())
            : [],
          media_link: mediaUrl || ""
        }
      };

      vectors.push(vector);
    } catch (err) {
      console.error(
        `[saveAdditionalFAQs] ❌ Error handling additional FAQ "${faq.question}":`,
        err
      );
    }
  }

  // Upsert them in one go
  if (vectors.length > 0) {
    console.log(
      `[saveAdditionalFAQs] 🟡 Upserting ${vectors.length} embeddings to Pinecone...`
    );
    try {
      await index.upsert(vectors);
      console.log(
        `[saveAdditionalFAQs] ✅ Upserted ${vectors.length} items to Pinecone.`
      );

      // Mark pinecone_upsert_success = true for all inserted rows
      const justUpsertedIds = vectors.map((v) => parseInt(v.id, 10));
      const { error: updateError } = await supabase
        .from("raw_faqs")
        .update({ pinecone_upsert_success: true })
        .in("id", justUpsertedIds);

      if (updateError) {
        console.error(
          `[saveAdditionalFAQs] ❌ Error marking pinecone_upsert_success:`,
          updateError.message
        );
      } else {
        console.log(
          `[saveAdditionalFAQs] ✅ Marked pinecone_upsert_success=true for ${justUpsertedIds.length} additional rows.`
        );
      }
    } catch (upsertError) {
      console.error(
        `[saveAdditionalFAQs] ❌ Pinecone upsert failed:`,
        upsertError.message
      );
    }
  } else {
    console.log(`[saveAdditionalFAQs] ⚠️ No vectors to upsert.`);
  }

  console.log(
    `[saveAdditionalFAQs] ✅ Finished saving additional FAQs for "${title}".`
  );
}
