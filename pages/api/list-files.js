import { exec } from "child_process";

export default function handler(req, res) {
  exec("ls -R /var/task", (error, stdout, stderr) => {
    if (error) {
      console.error(`[Error]: ${error.message}`);
      return res.status(500).json({ error: error.message });
    }

    if (stderr) {
      console.error(`[Stderr]: ${stderr}`);
      return res.status(500).json({ stderr });
    }

    console.log(`[File Structure]:\n${stdout}`);
    res.status(200).json({ files: stdout });
  });
}

