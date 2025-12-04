import { Router, Request, Response } from "express";
import { readFileSync, writeFileSync } from "fs";
import path from "path";

const router = Router();

// Admin credentials - in production, use proper authentication
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

// Middleware to check admin auth
function requireAdmin(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const token = authHeader.substring(7);
  if (token !== ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

// Get all questions
router.get("/questions", (req: Request, res: Response) => {
  try {
    const possiblePaths = [
      path.resolve(process.cwd(), "scripts/questions.json"),
      path.resolve(process.cwd(), "../scripts/questions.json"),
      path.resolve(__dirname, "../../scripts/questions.json")
    ];
    
    let questions = [];
    let questionsPath = "";
    
    for (const qPath of possiblePaths) {
      try {
        questions = JSON.parse(readFileSync(qPath, "utf8"));
        questionsPath = qPath;
        break;
      } catch {}
    }
    
    res.json({ questions, path: questionsPath });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update questions
router.post("/questions", (req: Request, res: Response) => {
  try {
    const { questions } = req.body;
    
    if (!Array.isArray(questions)) {
      return res.status(400).json({ error: "Questions must be an array" });
    }
    
    // Validate question structure
    for (const q of questions) {
      if (!q.id || !q.question || !q.key_phrases || !Array.isArray(q.key_phrases)) {
        return res.status(400).json({ 
          error: "Each question must have id, question, and key_phrases array" 
        });
      }
    }
    
    const possiblePaths = [
      path.resolve(process.cwd(), "scripts/questions.json"),
      path.resolve(process.cwd(), "../scripts/questions.json"),
      path.resolve(__dirname, "../../scripts/questions.json")
    ];
    
    let questionsPath = "";
    for (const qPath of possiblePaths) {
      try {
        readFileSync(qPath, "utf8");
        questionsPath = qPath;
        break;
      } catch {}
    }
    
    if (!questionsPath) {
      return res.status(500).json({ error: "Questions file not found" });
    }
    
    writeFileSync(questionsPath, JSON.stringify(questions, null, 2), "utf8");
    res.json({ success: true, count: questions.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get leniency settings
router.get("/config", (req: Request, res: Response) => {
  try {
    const possiblePaths = [
      path.resolve(process.cwd(), "scripts/admin-config.json"),
      path.resolve(process.cwd(), "../scripts/admin-config.json"),
      path.resolve(__dirname, "../../scripts/admin-config.json")
    ];
    
    let settings = { leniency: 5 }; // Default to medium leniency
    
    for (const configPath of possiblePaths) {
      try {
        settings = JSON.parse(readFileSync(configPath, "utf8"));
        break;
      } catch {}
    }
    
    res.json(settings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update leniency settings
router.post("/config", (req: Request, res: Response) => {
  try {
    const { leniency } = req.body;
    
    if (typeof leniency !== "number" || leniency < 1 || leniency > 10) {
      return res.status(400).json({ 
        error: "Leniency must be a number between 1 and 10" 
      });
    }
    
    const possiblePaths = [
      path.resolve(process.cwd(), "scripts/admin-config.json"),
      path.resolve(process.cwd(), "../scripts/admin-config.json"),
      path.resolve(__dirname, "../../scripts/admin-config.json")
    ];
    
    let configPath = "";
    for (const cPath of possiblePaths) {
      try {
        readFileSync(cPath, "utf8");
        configPath = cPath;
        break;
      } catch {}
    }
    
    if (!configPath) {
      configPath = possiblePaths[0]; // Use first path if file doesn't exist yet
    }
    
    const settings = { leniency };
    writeFileSync(configPath, JSON.stringify(settings, null, 2), "utf8");
    res.json({ success: true, leniency });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Admin login
router.post("/login", (req: Request, res: Response) => {
  const { password } = req.body;
  
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: password });
  } else {
    res.status(401).json({ error: "Invalid password" });
  }
});

export default router;
