import path from "path";

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

    // ✅ Dynamically import backend script using absolute path
    const scriptPath = path.join(process.cwd(), "api/scripts/fetchAndGenerate.js");
    const fetchAndGenerate = await import(scriptPath);

    if (!fetchAndGenerate || !fetchAndGenerate.main) {
      throw new Error("fetchAndGenerate.js does not export a `main` function.");
    }

    // ✅ Run backend script WITHOUT a target parameter
    await fetchAndGenerate.main(); 

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
