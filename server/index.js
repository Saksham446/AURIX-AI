
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "18mb" }));

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const dataDir = path.join(root, "server", "data");
const dbFile = path.join(dataDir, "chats.json");
const distDir = path.join(root, "dist");

const PORT = Number(process.env.PORT) || 5001;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

let queue = Promise.resolve();

// ============================================
// GEMINI CLIENT
// ============================================

function getAI() {
  const key = process.env.GEMINI_API_KEY;

  if (!key || key.includes("your_actual_gemini_api_key")) {
    throw new Error("GEMINI_API_KEY missing. Please configure environment variables.");
  }

  return new GoogleGenAI({ apiKey: key });
}

// ============================================
// GENERAL AI INSTRUCTIONS
// ============================================

const SYSTEM_INSTRUCTION = `
You are AURIX AI, a helpful and intelligent AI assistant.

Rules:
- Understand Hindi, English and Hinglish.
- Respond in the user's language.
- Keep answers direct, clear and useful.
- Explain difficult topics in simple language.
- Write correct code when requested.
- Never invent facts.
- Admit uncertainty when necessary.
- For images, describe only visible details.
`;

// ============================================
// HELPERS
// ============================================

const safe = (value, max = 6000) =>
  typeof value === "string" ? value.slice(0, max) : "";

function getImageData(image) {
  if (
    typeof image !== "string" ||
    image.length > 14000000 ||
    !/^data:image\/(png|jpeg|webp|gif);base64,/.test(image)
  ) {
    throw new Error("Invalid image. Upload a supported image.");
  }

  const match = image.match(/^data:(image\/[^;]+);base64,(.+)$/);

  return {
    mimeType: match[1],
    data: match[2]
  };
}

// ============================================
// LOCAL JSON DATABASE
// ============================================

async function readDB() {
  try {
    return JSON.parse(await readFile(dbFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function mutate(callback) {
  const result = queue.then(async () => {
    await mkdir(dataDir, { recursive: true });

    const db = await readDB();
    const value = callback(db);

    await writeFile(dbFile, JSON.stringify(db, null, 2));

    return value;
  });

  queue = result.catch(() => {});

  return result;
}

// ============================================
// GENERAL GEMINI RESPONSE
// ============================================

async function generate(contents, options = {}) {
  const ai = getAI();

  const response = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      maxOutputTokens: options.maxOutputTokens || 1500,
      temperature: options.temperature ?? 0.7
    }
  });

  const answer = response.text?.trim();

  if (!answer) {
    throw new Error("Gemini returned an empty response.");
  }

  return answer;
}

// ============================================
// SPECIALIZED VISUAL QUESTION ANSWERING
// ============================================

async function generateVision(imageData, question) {
  const ai = getAI();

  const instructions = `
You are AURIX AI's visual identification system.

The user wants an answer to this exact question:
${question}

VISUAL ANALYSIS RULES:

1. Answer only the exact question.
2. Do not automatically describe the entire image.
3. Never guess or invent visual details.
4. Match the user's language: Hindi, English or Hinglish.
5. Keep the answer short, normally one or two sentences.

PRODUCT AND PHONE IDENTIFICATION:

6. When asked to identify a phone or product, inspect all visible
   distinguishing details before answering.

7. For smartphones inspect:
   - Number of rear cameras.
   - Camera arrangement and lens positions.
   - Flash position.
   - LiDAR sensor if visible.
   - Camera bump shape.
   - Body edges and proportions.
   - Buttons, ports and screen design.

8. Compare these details with your knowledge of different
   product generations.

9. Never identify an exact model using only the brand or colour.

10. If the image clearly supports an exact model, provide that model
    and briefly mention the visible evidence.

11. If multiple models look similar and cannot be distinguished
    from this angle, explain that briefly and request a clearer view.

12. If the requested detail is not visible, say so honestly.

ACCURACY IS MORE IMPORTANT THAN CONFIDENCE.
`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { text: instructions },
          { inlineData: imageData }
        ]
      }
    ],
    config: {
      systemInstruction:
        "You are a precise visual question answering assistant. " +
        "Never hallucinate product details. " +
        "Use visible hardware evidence for device identification. " +
        "When uncertain, say so instead of guessing.",
      maxOutputTokens: 180,
      temperature: 0.1,
      topP: 0.8
    }
  });

  const answer = response.text?.trim();

  if (!answer) {
    throw new Error("Gemini returned an empty visual answer.");
  }

  return answer;
}

// ============================================
// ERROR HANDLER HELPER
// ============================================

function sendError(res, error, label = "Request") {
  console.error(`${label} error:`, error);

  const message = error.message || "Unexpected server error.";

  let status = 500;

  if (/API key|API_KEY|authentication|permission|unauthorized/i.test(message)) {
    status = 401;
  } else if (/quota|rate limit|429|resource exhausted/i.test(message)) {
    status = 429;
  } else if (/not found|not supported/i.test(message)) {
    status = 400;
  }

  res.status(status).json({ error: message });
}

// ============================================
// HEALTH CHECK
// ============================================

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    app: "AURIX AI",
    provider: "Google Gemini",
    model: MODEL,
    keyConfigured: Boolean(process.env.GEMINI_API_KEY)
  });
});

// ============================================
// TEST GEMINI CONNECTION
// ============================================

app.get("/api/test-ai", async (req, res) => {
  try {
    const answer = await generate(
      "Reply with exactly: AURIX AI is online.",
      { maxOutputTokens: 50 }
    );

    res.json({
      ok: true,
      provider: "Gemini",
      answer
    });
  } catch (error) {
    sendError(res, error, "Gemini connection");
  }
});

// ============================================
// GET CHATS
// ============================================

app.get("/api/chats", async (req, res) => {
  try {
    res.json(await readDB());
  } catch (error) {
    sendError(res, error, "Read chats");
  }
});

// ============================================
// CREATE CHAT
// ============================================

app.post("/api/chats", async (req, res) => {
  try {
    const chat = {
      id: randomUUID(),
      title: safe(req.body.title || "New chat", 80),
      createdAt: Date.now(),
      messages: []
    };

    await mutate((db) => db.unshift(chat));

    res.json(chat);
  } catch (error) {
    sendError(res, error, "Create chat");
  }
});

// ============================================
// DELETE CHAT
// ============================================

app.delete("/api/chats/:id", async (req, res) => {
  try {
    await mutate((db) => {
      const index = db.findIndex(
        (chat) => chat.id === req.params.id
      );

      if (index !== -1) {
        db.splice(index, 1);
      }
    });

    res.json({ ok: true });
  } catch (error) {
    sendError(res, error, "Delete chat");
  }
});

// ============================================
// NORMAL CHAT
// ============================================

app.post("/api/chat", async (req, res) => {
  try {
    const { chatId, text, image } = req.body || {};
    const userText = safe(text);

    if (!chatId || (!userText.trim() && !image)) {
      return res.status(400).json({
        error: "Please enter a message or upload an image."
      });
    }

    const chats = await readDB();
    const chat = chats.find((item) => item.id === chatId);

    if (!chat) {
      return res.status(404).json({
        error: "Chat not found."
      });
    }

    const contents = [];

    for (const message of (chat.messages || []).slice(-14)) {
      const parts = [];

      if (message.text) {
        parts.push({ text: safe(message.text) });
      }

      if (message.image) {
        try {
          parts.push({
            inlineData: getImageData(message.image)
          });
        } catch {
          // Ignore invalid old image.
        }
      }

      if (parts.length) {
        contents.push({
          role: message.role === "assistant" ? "model" : "user",
          parts
        });
      }
    }

    const userParts = [
      {
        text: userText || "Please describe this image."
      }
    ];

    if (image) {
      userParts.push({
        inlineData: getImageData(image)
      });
    }

    contents.push({
      role: "user",
      parts: userParts
    });

    const answer = await generate(contents, {
      maxOutputTokens: 1500
    });

    await mutate((db) => {
      const currentChat = db.find(
        (item) => item.id === chatId
      );

      if (!currentChat) return;

      currentChat.messages.push(
        {
          id: randomUUID(),
          role: "user",
          text: userText,
          image: image || null
        },
        {
          id: randomUUID(),
          role: "assistant",
          text: answer
        }
      );

      if (currentChat.messages.length === 2) {
        currentChat.title = safe(
          userText || "Image conversation",
          55
        );
      }
    });

    res.json({ answer });
  } catch (error) {
    sendError(res, error, "Chat");
  }
});

// ============================================
// LIVE CAMERA ANALYSIS
// ============================================

app.post("/api/vision", async (req, res) => {
  try {
    const { image, question } = req.body || {};

    if (!image) {
      return res.status(400).json({
        error: "Camera image is required."
      });
    }

    const cleanQuestion = safe(question, 1200).trim();

    if (!cleanQuestion) {
      return res.status(400).json({
        error: "Please ask a specific question."
      });
    }

    const imageData = getImageData(image);
    const answer = await generateVision(imageData, cleanQuestion);

    res.json({ answer });
  } catch (error) {
    sendError(res, error, "Vision");
  }
});

// ============================================
// AUDIO TRANSCRIPTION
// ============================================

app.post(
  "/api/transcribe",
  express.raw({
    type: [
      "audio/webm",
      "audio/mp4",
      "audio/mpeg",
      "audio/wav",
      "audio/ogg",
      "audio/aac",
      "audio/flac",
      "application/octet-stream"
    ],
    limit: "15mb"
  }),
  async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({
          error: "Audio recording is required."
        });
      }

      const mime = (req.headers["content-type"] || "audio/webm")
        .split(";")[0]
        .toLowerCase();

      const supported = [
        "audio/webm",
        "audio/mp4",
        "audio/mpeg",
        "audio/wav",
        "audio/ogg",
        "audio/aac",
        "audio/flac",
        "application/octet-stream"
      ];

      if (!supported.includes(mime)) {
        return res.status(400).json({
          error: "Unsupported audio format: " + mime
        });
      }

      const audioBase64 = req.body.toString("base64");

      const answer = await generate(
        [
          {
            role: "user",
            parts: [
              {
                text:
                  "Transcribe this audio accurately. Preserve Hindi, " +
                  "English or Hinglish. Return only the transcription."
              },
              {
                inlineData: {
                  mimeType:
                    mime === "application/octet-stream"
                      ? "audio/webm"
                      : mime,
                  data: audioBase64
                }
              }
            ]
          }
        ],
        { maxOutputTokens: 1000 }
      );

      res.json({ text: answer.trim() });
    } catch (error) {
      sendError(res, error, "Audio transcription");
    }
  }
);

// ============================================
// IMAGE SEARCH
// ============================================

app.get("/api/image-search", async (req, res) => {
  try {
    const query = safe(req.query.q, 120).trim();

    if (!query) {
      return res.json({ images: [] });
    }

    const url = new URL(
      "https://commons.wikimedia.org/w/api.php"
    );

    url.search = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrsearch: `filetype:bitmap ${query}`,
      gsrnamespace: "6",
      gsrlimit: "12",
      prop: "imageinfo",
      iiprop: "url|extmetadata",
      iiurlwidth: "600",
      format: "json",
      origin: "*"
    }).toString();

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Image search provider unavailable.");
    }

    const data = await response.json();

    const images = Object.values(data.query?.pages || {})
      .map((page) => ({
        title: page.title.replace(/^File:/, ""),
        url:
          page.imageinfo?.[0]?.thumburl ||
          page.imageinfo?.[0]?.url,
        page: page.imageinfo?.[0]?.descriptionurl
      }))
      .filter(
        (item) => item.url && item.url.startsWith("https:")
      );

    res.json({ images });
  } catch (error) {
    sendError(res, error, "Image search");
  }
});

// ============================================
// API 404 HANDLER
// ============================================

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API endpoint not found."
  });
});

// ============================================
// SERVE REACT FRONTEND IN PRODUCTION
// ============================================

if (existsSync(distDir)) {
  app.use(express.static(distDir));

  // React SPA fallback
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      return next();
    }

    res.sendFile(
      path.join(distDir, "index.html"),
      (error) => {
        if (error) next(error);
      }
    );
  });
}

// ============================================
// GLOBAL ERROR HANDLER
// ============================================

app.use((error, req, res, next) => {
  console.error("Server error:", error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error: "Internal server error."
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, "0.0.0.0", () => {
  console.log("--------------------------------");
  console.log("          AURIX AI SERVER");
  console.log("--------------------------------");
  console.log(`Server: http://localhost:${PORT}`);
  console.log("AI Provider: Google Gemini");
  console.log(`Model: ${MODEL}`);

  console.log(
    "API Key:",
    process.env.GEMINI_API_KEY ? "Configured" : "Missing"
  );

  console.log(
    "Frontend:",
    existsSync(distDir)
      ? "Production build available"
      : "Not built yet"
  );

  console.log("--------------------------------");
});
