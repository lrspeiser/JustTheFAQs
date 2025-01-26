import { main } from "../../scripts/fetchAndGenerate";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    console.log("[fetch-and-generate] Starting main process...");
    await main();  // Kick off your generation logic (fetchAndGenerate.js)
    console.log("[fetch-and-generate] Completed main process.");

    // Return a simple success message
    return res.status(200).json({
      message: "FAQ generation process completed!",
    });
  } catch (error) {
    console.error("[fetch-and-generate] ❌ Error:", error);
    return res.status(500).json({
      message: "Error processing the request",
      error: error.message,
    });
  }
}
