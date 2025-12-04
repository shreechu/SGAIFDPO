
import { Router } from "express";
import speechRoutes from "./routes/speech";
import quizRoutes from "./routes/quiz";
import openaiTtsRoutes from "./routes/openai-tts";
import sessionsRoutes from "./routes/sessions";
import adminRoutes from "./routes/admin";

const router = Router();
router.use("/speech", speechRoutes);
router.use("/openai", openaiTtsRoutes);
router.use("/admin", adminRoutes);
router.use("/", sessionsRoutes);
router.use("/", quizRoutes);
export default router;
