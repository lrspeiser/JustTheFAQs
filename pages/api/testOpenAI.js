// pages/api/testOpenAI.js
import OpenAI from "openai";

export default async function handler(req, res) {
  try {
    // 1) Check for OPENAI_API_KEY
    if (!process.env.OPENAI_API_KEY) {
      return res
        .status(400)
        .json({ error: "Missing OPENAI_API_KEY in environment variables." });
    }

    // 2) Initialize OpenAI client with the default import "OpenAI"
    console.log("[testOpenAI] Using default import: OpenAI");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 3) Make a Chat Completion request
    console.log("[testOpenAI] Sending request to OpenAI chat API...");
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Hello from a test!" }],
    });

    // 4) Extract the AI's reply
    const aiReply = response.choices?.[0]?.message?.content ?? "(No response)";
    console.log("[testOpenAI] Received from OpenAI:", aiReply);

    // 5) Return as JSON
    return res.status(200).json({
      success: true,
      openAiReply: aiReply,
    });

  } catch (err) {
    // Handle any errors
    console.error("[testOpenAI] ❌ Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
