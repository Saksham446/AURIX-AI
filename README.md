# AURIX AI — Intelligence Beyond Limits

## Requirements
Node.js 20.19+ or 22.12+; npm; OpenAI API key with billing enabled.

## Quick start
1. Open this project folder in VS Code.
2. `npm install`
3. `cp .env.example .env`
4. Open `.env` and paste your OpenAI API key. NEVER share or commit it.
5. `npm run dev`
6. Open http://localhost:5173

## Features
- AI chat with persistent local JSON conversation history
- Image upload and image recognition
- Microphone recording -> OpenAI Whisper transcription
- Browser text-to-speech playback
- Wikimedia Commons image search (internet connection required)
- Live camera vision: press camera button, ask a question, then press Analyze to send a frame
- Responsive mobile layout, PWA manifest and icon

## Notes / limitations
- Single-user developer prototype, not secure multi-user production hosting. Chat history is saved on the server in `server/data/chats.json`, not in MongoDB. Do not deploy publicly with personal data before adding authentication, per-user storage, abuse limits and access controls.
- Live Vision is snapshot-based and **not** continuous realtime video or realtime two-way voice conversation. Mic recording transcribes into chat input; it does not automatically send speech to Live Vision.
- Image search uses Wikimedia Commons rather than Google Images.
- Chat replies are not streamed in this version.
- PDF upload is not implemented in this version.
- PWA installation requires HTTPS on an actual iPhone (localhost on Mac is only for desktop testing). A manifest alone does not provide offline AI chat.
- AI, image, and transcription API requests cost money. Keep API keys server-side and set usage limits in your OpenAI account.
- `npm run build` generates dist; for one-service hosting, set `NODE_ENV=production` and run `npm start` after build. Ensure persistent storage or replace JSON storage with a database.
