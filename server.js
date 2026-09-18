// server.js
// Minimal demo: UPLOAD a file -> AI reads its content -> AI GENERATES a reviewer
// (summary + flashcards + quiz) from that specific content.
//
// This is the part that makes it "AI-integrated": the AI is not a chatbot
// bolted on the side, it is the core feature. The app's output (the reviewer)
// does not exist until the AI generates it from the user's uploaded file.

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const pdfParse = require("pdf-parse");
require("dotenv").config({ path: "api.env" });

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(express.json());
app.use(express.static("public"));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "openai/gpt-oss-120b";

// ---- Step 1: extract raw text from whatever file was uploaded ----
async function extractText(file) {
  const buffer = fs.readFileSync(file.path);

  if (file.mimetype === "application/pdf") {
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }

  // .txt and anything else readable as plain text
  return buffer.toString("utf-8");
}

// ---- Step 2: send that text to the AI and ask it to GENERATE study material ----
async function generateReviewer(sourceText) {
  const prompt = `
You are turning study material into a reviewer for a student.

Using ONLY the content below, produce:
1. A concise summary (5-8 sentences)
2. 5 flashcards (term/question -> answer)
3. ONE multiple choice quiz question (4 choices) with the correct answer marked

Respond strictly as JSON with this shape:
{
  "summary": "string",
  "flashcards": [{ "question": "string", "answer": "string" }],
  "quiz": { "question": "string", "choices": ["a","b","c","d"], "answer": "a" }
}

CONTENT:
"""
${sourceText.slice(0, 12000)}
"""
`.trim();

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const raw = data.choices[0].message.content;
  return JSON.parse(raw);
}

// ---- The actual "upload -> AI generation" endpoint ----
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
    const sourceText = await extractText(req.file);

    if (!sourceText || sourceText.trim().length < 20) {
      return res.status(422).json({
        error: "Could not extract usable text from this file (try a .txt or text-based .pdf).",
      });
    }

    const reviewer = await generateReviewer(sourceText);

    // clean up the temp upload
    fs.unlink(req.file.path, () => {});

    res.json({
      filename: req.file.originalname,
      extractedChars: sourceText.length,
      reviewer,
    });
  } catch (err) {
    console.error(err);
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`AralNa demo running at http://localhost:${PORT}`));