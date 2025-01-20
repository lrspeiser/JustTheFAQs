import { main } from "../../api/scripts/fetchAndGenerate"; // Import backend script

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    console.log("[FetchAndGenerate API] 🚀 Received request...");

    // ✅ Run backend script WITHOUT a target parameter
    await main(); 

    return res.status(200).json({
      success: true,
      message: `Generation process started.`,
    });

  } catch (error) {
    console.error("[FetchAndGenerate API] ❌ Error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error",
    });
  }
}
