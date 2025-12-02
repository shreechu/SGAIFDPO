import { Router } from "express";
import { getAllSessions, saveSession } from "../services/store";

const router = Router();

// Get all sessions (from Cosmos DB or local storage)
router.get("/sessions", async (req, res) => {
  try {
    const sessions = await getAllSessions();
    // Sort by timestamp descending (newest first)
    sessions.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    res.json(sessions);
  } catch (err: any) {
    console.error("Error reading sessions:", err);
    res.status(500).json({ error: "Failed to load sessions" });
  }
});

// Save a new session (to Cosmos DB or local storage)
router.post("/sessions", async (req, res) => {
  try {
    const sessionData = req.body;
    const savedSession = await saveSession(sessionData);
    
    res.json({ success: true, message: "Session saved successfully" });
  } catch (err: any) {
    console.error("Error saving session:", err);
    res.status(500).json({ error: "Failed to save session" });
  }
});

export default router;
