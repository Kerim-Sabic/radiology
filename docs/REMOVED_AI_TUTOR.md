# AI tutor removed (27 Oct 2026)

At the owner's request the optional AI tutor was removed entirely: the Tutor tab, the “Ask why” button, the `/api/tutor` Netlify/Vercel functions, the shared server code and the `@anthropic-ai/sdk` dependency. The app has no server functions and needs no API keys. Hints, explanations, book links and all grading are unchanged (they never depended on AI). Old progress backups that contain `tutorUsed` still import.
